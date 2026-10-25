// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title SoulRegistry — public "AI story ledger" (prototype)
/// @notice Records only hashes, names, dates and one short line per entry.
///         Never put SOUL text or memory contents on-chain: everything here is public forever.
/// @dev No token of any kind is issued. Agents are plain records, not NFTs.
contract SoulRegistry {
    // ---------------------------------------------------------------------
    // Limits (keep entries short and cheap; discourages using the chain as storage)
    // ---------------------------------------------------------------------
    uint256 public constant MAX_NAME = 64;
    uint256 public constant MAX_NOTE = 160;
    uint256 public constant MAX_URI = 200;
    uint256 public constant MAX_MODEL = 64;
    uint16 public constant MAX_SCORE_BPS = 10_000; // 100.00 %

    // ---------------------------------------------------------------------
    // Data model
    // ---------------------------------------------------------------------
    struct Agent {
        uint256 id;
        string name;
        string note; // one short public line describing the agent
        address owner;
        uint64 createdAt;
        string metaURI; // optional pointer (e.g. ERC-8004 style registration file)
        bytes32 headHash; // latest soulHash (0 = no history yet)
        uint32 recordCount;
    }

    struct SoulRecord {
        uint256 agentId;
        bytes32 soulHash; // SHA-256 of the SOUL file bytes (computed off-chain)
        bytes32 parentHash; // previous soulHash, 0 for the first record
        string note; // one short public line
        uint64 timestamp;
    }

    struct CarryOverScore {
        uint256 agentId;
        bytes32 soulHash; // SOUL version that was tested
        string fromModel;
        string toModel;
        bytes32 reportHash; // SHA-256 of the full (off-chain) report
        uint16 scoreBps; // summary score in basis points (0..10000)
        uint64 timestamp;
    }

    struct Batch {
        bytes32 root;
        uint32 count;
        uint64 timestamp;
        address anchorer;
    }

    /// @notice Off-chain registration signed by the owner (EIP-712) and later included in a batch.
    struct SoulEntry {
        address owner;
        string agentName;
        bytes32 soulHash;
        bytes32 parentHash;
        string note;
        uint64 signedAt;
    }

    address public admin;
    uint256 public agentCount;

    mapping(uint256 => Agent) private _agents;
    mapping(uint256 => SoulRecord[]) private _history;
    mapping(uint256 => mapping(bytes32 => bool)) public hasSoul; // agentId => soulHash => recorded
    mapping(uint256 => CarryOverScore[]) private _scores;

    mapping(address => bool) public isAnchorer;
    Batch[] private _batches;
    mapping(bytes32 => uint256) public batchIndexPlusOne; // root => index + 1 (0 = unknown)

    // EIP-712
    bytes32 private constant _DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 public constant SOUL_ENTRY_TYPEHASH = keccak256(
        "SoulEntry(address owner,string agentName,bytes32 soulHash,bytes32 parentHash,string note,uint64 signedAt)"
    );
    bytes32 public immutable DOMAIN_SEPARATOR;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------
    event AgentRegistered(uint256 indexed agentId, address indexed owner, string name, string note, string metaURI);
    event SoulAppended(
        uint256 indexed agentId, bytes32 indexed soulHash, bytes32 parentHash, uint32 index, string note
    );
    event CarryOverRecorded(
        uint256 indexed agentId, bytes32 indexed soulHash, string fromModel, string toModel, bytes32 reportHash, uint16 scoreBps
    );
    event AgentTransferred(uint256 indexed agentId, address indexed from, address indexed to);
    event MetaURIUpdated(uint256 indexed agentId, string metaURI);
    event BatchAnchored(uint256 indexed batchIndex, bytes32 indexed root, uint32 count, address indexed anchorer);
    event AnchorerSet(address indexed account, bool allowed);
    event AdminTransferred(address indexed from, address indexed to);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------
    error NotAdmin();
    error NotAgentOwner();
    error NotAnchorer();
    error UnknownAgent();
    error EmptyName();
    error TooLong();
    error ZeroHash();
    error ZeroAddress();
    error BadParent(bytes32 expected, bytes32 given);
    error DuplicateSoul();
    error UnknownSoul();
    error ScoreOutOfRange();
    error RootAlreadyAnchored();
    error EmptyBatch();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    modifier onlyAgentOwner(uint256 agentId) {
        if (_agents[agentId].owner == address(0)) revert UnknownAgent();
        if (_agents[agentId].owner != msg.sender) revert NotAgentOwner();
        _;
    }

    constructor() {
        admin = msg.sender;
        isAnchorer[msg.sender] = true;
        emit AnchorerSet(msg.sender, true);
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                _DOMAIN_TYPEHASH, keccak256("SoulRegistry"), keccak256("1"), block.chainid, address(this)
            )
        );
    }

    // ---------------------------------------------------------------------
    // Direct registration (owner pays gas)
    // ---------------------------------------------------------------------

    function registerAgent(string calldata name, string calldata note, string calldata metaURI)
        external
        returns (uint256 agentId)
    {
        uint256 len = bytes(name).length;
        if (len == 0) revert EmptyName();
        if (len > MAX_NAME || bytes(note).length > MAX_NOTE || bytes(metaURI).length > MAX_URI) revert TooLong();

        agentId = ++agentCount;
        Agent storage a = _agents[agentId];
        a.id = agentId;
        a.name = name;
        a.note = note;
        a.owner = msg.sender;
        a.createdAt = uint64(block.timestamp);
        a.metaURI = metaURI;
        emit AgentRegistered(agentId, msg.sender, name, note, metaURI);
    }

    /// @notice Append a new SOUL version. parentHash must equal the current head (0 for the first).
    function appendSoul(uint256 agentId, bytes32 soulHash, bytes32 parentHash, string calldata note)
        external
        onlyAgentOwner(agentId)
    {
        if (soulHash == bytes32(0)) revert ZeroHash();
        if (bytes(note).length > MAX_NOTE) revert TooLong();
        Agent storage a = _agents[agentId];
        if (parentHash != a.headHash) revert BadParent(a.headHash, parentHash);
        if (hasSoul[agentId][soulHash]) revert DuplicateSoul();

        hasSoul[agentId][soulHash] = true;
        _history[agentId].push(SoulRecord(agentId, soulHash, parentHash, note, uint64(block.timestamp)));
        a.headHash = soulHash;
        uint32 index = a.recordCount;
        a.recordCount = index + 1;
        emit SoulAppended(agentId, soulHash, parentHash, index, note);
    }

    function recordCarryOver(
        uint256 agentId,
        bytes32 soulHash,
        string calldata fromModel,
        string calldata toModel,
        bytes32 reportHash,
        uint16 scoreBps
    ) external onlyAgentOwner(agentId) {
        if (!hasSoul[agentId][soulHash]) revert UnknownSoul();
        if (reportHash == bytes32(0)) revert ZeroHash();
        if (scoreBps > MAX_SCORE_BPS) revert ScoreOutOfRange();
        if (bytes(fromModel).length > MAX_MODEL || bytes(toModel).length > MAX_MODEL) revert TooLong();
        _scores[agentId].push(
            CarryOverScore(agentId, soulHash, fromModel, toModel, reportHash, scoreBps, uint64(block.timestamp))
        );
        emit CarryOverRecorded(agentId, soulHash, fromModel, toModel, reportHash, scoreBps);
    }

    function setMetaURI(uint256 agentId, string calldata metaURI) external onlyAgentOwner(agentId) {
        if (bytes(metaURI).length > MAX_URI) revert TooLong();
        _agents[agentId].metaURI = metaURI;
        emit MetaURIUpdated(agentId, metaURI);
    }

    function transferAgent(uint256 agentId, address newOwner) external onlyAgentOwner(agentId) {
        if (newOwner == address(0)) revert ZeroAddress();
        _agents[agentId].owner = newOwner;
        emit AgentTransferred(agentId, msg.sender, newOwner);
    }

    // ---------------------------------------------------------------------
    // Batched (free-for-users) registration: an anchorer posts one Merkle root per day
    // ---------------------------------------------------------------------

    function anchorBatch(bytes32 root, uint32 count) external returns (uint256 batchIndex) {
        if (!isAnchorer[msg.sender]) revert NotAnchorer();
        if (root == bytes32(0)) revert ZeroHash();
        if (count == 0) revert EmptyBatch();
        if (batchIndexPlusOne[root] != 0) revert RootAlreadyAnchored();
        batchIndex = _batches.length;
        _batches.push(Batch(root, count, uint64(block.timestamp), msg.sender));
        batchIndexPlusOne[root] = batchIndex + 1;
        emit BatchAnchored(batchIndex, root, count, msg.sender);
    }

    /// @notice True if `root` was anchored and `leaf` is included under it (sorted-pair keccak tree).
    function verifyInBatch(bytes32 leaf, bytes32[] calldata proof, bytes32 root) public view returns (bool) {
        if (batchIndexPlusOne[root] == 0) return false;
        return processProof(leaf, proof) == root;
    }

    /// @notice EIP-712 digest the owner signs off-chain for a batched entry.
    function entryDigest(SoulEntry calldata e) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                SOUL_ENTRY_TYPEHASH,
                e.owner,
                keccak256(bytes(e.agentName)),
                e.soulHash,
                e.parentHash,
                keccak256(bytes(e.note)),
                e.signedAt
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
    }

    /// @notice Leaf = double keccak of (digest, keccak(signature)) — double hashing avoids second-preimage tricks.
    function entryLeaf(SoulEntry calldata e, bytes calldata signature) public view returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(entryDigest(e), keccak256(signature)))));
    }

    /// @notice Full check of a batched entry: owner's signature is valid AND the entry is in an anchored batch.
    function verifyBatchEntry(SoulEntry calldata e, bytes calldata signature, bytes32[] calldata proof, bytes32 root)
        external
        view
        returns (bool)
    {
        if (e.owner == address(0) || _recover(entryDigest(e), signature) != e.owner) return false;
        return verifyInBatch(entryLeaf(e, signature), proof, root);
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    function setAnchorer(address account, bool allowed) external onlyAdmin {
        if (account == address(0)) revert ZeroAddress();
        isAnchorer[account] = allowed;
        emit AnchorerSet(account, allowed);
    }

    function transferAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        emit AdminTransferred(admin, newAdmin);
        admin = newAdmin;
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getAgent(uint256 agentId) external view returns (Agent memory) {
        if (_agents[agentId].owner == address(0)) revert UnknownAgent();
        return _agents[agentId];
    }

    function getHistory(uint256 agentId) external view returns (SoulRecord[] memory) {
        return _history[agentId];
    }

    function getScores(uint256 agentId) external view returns (CarryOverScore[] memory) {
        return _scores[agentId];
    }

    function batchCount() external view returns (uint256) {
        return _batches.length;
    }

    function getBatch(uint256 index) external view returns (Batch memory) {
        return _batches[index];
    }

    /// @notice Re-walks the stored chain: each record's parent must be the previous record's hash.
    function verifyChain(uint256 agentId) external view returns (bool) {
        SoulRecord[] storage h = _history[agentId];
        bytes32 prev = bytes32(0);
        for (uint256 i = 0; i < h.length; i++) {
            if (h[i].parentHash != prev) return false;
            prev = h[i].soulHash;
        }
        return prev == _agents[agentId].headHash;
    }

    // ---------------------------------------------------------------------
    // Internal helpers
    // ---------------------------------------------------------------------

    function processProof(bytes32 leaf, bytes32[] calldata proof) public pure returns (bytes32 computed) {
        computed = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 p = proof[i];
            computed = computed < p ? keccak256(abi.encode(computed, p)) : keccak256(abi.encode(p, computed));
        }
    }

    function _recover(bytes32 digest, bytes calldata sig) private pure returns (address) {
        if (sig.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        // reject malleable signatures (upper-half s)
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) return address(0);
        if (v < 27) v += 27;
        return ecrecover(digest, v, r, s);
    }
}
