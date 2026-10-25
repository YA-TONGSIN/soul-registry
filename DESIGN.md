# Ieum Ledger · 이음 장부 설계 (시제품, 2026-10-25)

> 표시 이름은 이음 장부(Ieum Ledger). **컨트랙트 이름은 `SoulRegistry`** (그대로 유지).

공개 'AI 이야기 장부'. 누구나 자기 AI의 SOUL(성격·약속 문서)이 **언제, 어떤 순서로 바뀌었는지**를
해시로 남기고, 나중에 "이 파일이 그때 그 버전이 맞다"를 누구나 검증할 수 있게 한다.

## 1. 목표
- 누구나 **무료로** 자기 AI 에이전트를 등록하고 SOUL 이력(버전 체인)을 남긴다.
- 누구나 파일 하나만 있으면 SHA-256을 계산해 장부와 비교하고 **검증**할 수 있다.
- 모델을 바꿀 때(예: Opus → Sonnet) 기억·성격이 얼마나 넘어갔는지 점수 요약(CarryOverScore)을 남길 수 있다.

## 2. 비목표
- **토큰 없음.** ERC-20/721/1155 등 어떤 토큰도 발행하지 않는다. 에이전트는 NFT가 아니라 단순 기록이다.
- **내용 저장 없음.** SOUL 본문, 기억, 대화, 개인정보는 절대 체인에 올리지 않는다. 해시·이름·날짜·짧은 한 줄(최대 160바이트)만.
- 거래·결제·평판 시장은 다루지 않는다.

## 3. 데이터 모델 (컨트랙트 `contracts/SoulRegistry.sol`)

| 구조 | 필드 | 설명 |
|---|---|---|
| **Agent** | id, name(≤64B), note(≤160B), owner, createdAt, metaURI(≤200B, 선택), headHash, recordCount | id는 1부터 순번. headHash = 마지막 SOUL 해시 |
| **SoulRecord** | agentId, soulHash(bytes32, SHA-256), parentHash, note(≤160B), timestamp | parentHash는 반드시 현재 headHash(첫 기록은 0) |
| **CarryOverScore** (선택) | agentId, soulHash, fromModel, toModel, reportHash, scoreBps(0–10000), timestamp | 보고서 본문은 오프체인, 해시만 |
| **Batch** | root, count, timestamp, anchorer | 하루치 무료 등록을 묶은 Merkle root |
| **SoulEntry** (오프체인 서명) | owner, agentName, soulHash, parentHash, note, signedAt | EIP-712로 소유자가 서명 |

### 해시 규칙
- `soulHash = SHA-256(파일 바이트 그대로)`. 줄바꿈·BOM까지 포함된 바이트 그대로이므로 저장소에서 CRLF 변환이 일어나지 않게 한다(`.gitattributes`의 `-text` 권장).
- 체인 내부의 Merkle 트리는 keccak256(이더리움 기본)을 쓴다. SOUL 파일 해시만 SHA-256.

### 이력 체인 규칙
- `appendSoul`은 `parentHash == headHash`일 때만 성공 → 중간 삽입·분기·순서 바꾸기 불가.
- 같은 에이전트 안에서 같은 soulHash 재사용 불가(되돌림은 새 파일로 기록).
- `verifyChain(agentId)`가 저장된 기록을 처음부터 다시 걸어 parent 연결을 확인.

## 4. 두 가지 등록 방식

### (A) 직접 등록 — owner가 가스 지불
`registerAgent` → `appendSoul` … 본인 지갑으로 직접. 가장 단순하고 운영자를 믿을 필요가 없다.

### (B) 무료 등록 — 배치 + Merkle root
1. 사용자는 지갑(가스 0인 새 지갑도 됨)으로 `SoulEntry`에 **EIP-712 서명만** 한다. 돈이 들지 않는다.
2. 운영자(anchorer)가 하루치 서명을 모아 leaf를 만든다:
   `leaf = keccak256(keccak256(abi.encode(EIP712digest, keccak256(signature))))` (이중 해시: 2차 원상 공격 방지)
3. 정렬쌍(sorted-pair) keccak Merkle 트리의 root 하나만 `anchorBatch(root, count)`로 하루 1회 올린다.
4. 운영자는 각 사용자에게 `{entry, signature, proof}`를 돌려주고, 묶음 파일 전체도 공개 저장소(예: GitHub/IPFS)에 둔다.
5. 누구나 `verifyInBatch(leaf, proof, root)`(포함 여부) 또는 `verifyBatchEntry(entry, signature, proof, root)`(서명 + 포함)로 검증.

- 서명이 leaf에 들어가므로 운영자가 남의 이름으로 몰래 등록할 수 없다(서명 위조 불가). 변조된 entry는 검증 실패(테스트로 확인).
- 한계: 배치 항목은 체인에 '이력 체인 규칙'이 강제되지 않는다(parentHash 연결은 오프체인 검증). 원하면 나중에 직접 등록(A)으로 승격.
- anchorer는 admin이 지정(`setAnchorer`). 시제품에서는 배포자 1명. 중앙화 지점이므로 묶음 파일 공개 + 누구나 자기 anchorer를 둘 수 있는 구조로 완화.

## 5. ERC-8004와의 관계
확인한 사실 (2026-10-25, https://eips.ethereum.org/EIPS/eip-8004 직접 열람):
- 이름은 **ERC-8004: Trustless Agents**, 상태 **Draft**, 작성 2025-08-13 (MetaMask·이더리움재단·Google·Coinbase 소속 저자).
- 레지스트리 3개: **Identity**(ERC-721 + URIStorage, `agentId = tokenId`, `agentURI`가 등록 파일을 가리킴), **Reputation**(`giveFeedback` 등), **Validation**(`validationRequest(validator, agentId, requestURI, requestHash)` / `validationResponse`).
- 전역 식별자: `agentRegistry = {namespace}:{chainId}:{identityRegistry}` (예: `eip155:1:0x742...`) + `agentId`.
- 체인마다 싱글턴으로 배포하는 것을 상정.

우리와의 차이:
- ERC-8004 Identity는 **ERC-721 토큰을 발행**한다 → 우리 비목표(토큰 없음)와 충돌. 그래서 SoulRegistry는 독립 기록으로 두고 **참조만** 한다.

호환을 위한 확장 지점 (아직 구현 안 함):
- `Agent.metaURI`에 ERC-8004 등록 파일 URI를 넣거나, 반대로 ERC-8004 등록 파일의 `registrations` 목록에 SoulRegistry 항목을 추가하는 방식. — 등록 파일에 임의 항목을 넣는 것이 표준 검증기에서 허용되는지는 **확인 필요**.
- `(identityRegistry, agentId)` 쌍을 Agent에 연결하는 `linkErc8004(...)` 함수 — 해당 토큰 소유자 확인(`ownerOf`) 필요.
- CarryOverScore를 ERC-8004 Validation Registry의 `requestHash`/`responseHash` 흐름으로 내보내는 것 — 의미가 맞는지 **확인 필요**.
- Base 등에 공식 ERC-8004 싱글턴이 실제 배포돼 있는지·주소는 **확인 필요**.

## 6. 위험과 대응

| 위험 | 대응 |
|---|---|
| **프라이버시(영구 공개)** — 체인 기록은 지울 수 없다 | 본문·실명·기억 금지, note 160B 제한, 해시만. 짧은 문서는 해시로 내용이 추측될 수 있으므로(사전 공격) 민감하면 파일에 무작위 솔트 줄을 넣고 해시. 문서·UI에 "영구 공개" 경고. |
| **스팸 등록** (A 방식) | 가스비가 자연 억제. 이름·note 길이 제한. 이름 중복 허용(신원 보장 아님 — 신뢰는 owner 주소로). |
| **스팸 등록** (B 방식) | 운영자가 오프체인에서 주소당 하루 N건 제한, 서명 필수, 필요시 간단한 대기열. 체인에는 root 1개라 비용은 일정. |
| **사칭** (유명 AI 이름 도용) | 이름은 표시용일 뿐. 검증은 owner 주소·metaURI의 도메인 검증(ERC-8004의 `.well-known` 방식 참고)으로. |
| **운영자 검열·누락** | 묶음 파일 전체 공개, 누구나 자기 anchorer 배포 가능, 직접 등록(A)은 항상 열려 있음. |
| **키 분실** | `transferAgent`로 미리 옮겨 두기. 분실 시 새 에이전트로 등록하고 note에 옛 id 언급. |
| **admin 키 탈취** | admin 권한은 anchorer 지정뿐(기록 수정·삭제 함수 없음). 본 배포 시 멀티시그 권장. |
| **해시 충돌·유효성** | SHA-256 충돌은 현실적으로 불가. 0 해시 거부, 중복 거부. 서명 malleability(s 상위 절반) 거부. |

## 7. 비용 (요약, 자세한 근거는 README)
- 2026-10-25 09:06 KST Base 메인넷 공개 RPC 실측: baseFee 0.005 gwei + priority 0.001 gwei, L1 데이터 수수료 ≈ 0.0000000004 ETH.
- `anchorBatch` 1회 gasUsed 115,609(로컬 실측, 첫 배치 최악값) → ≈ 0.00000069 ETH ≈ **약 2원/일, 약 790원/년** (ETH ≈ ₩3,115,653, CoinGecko). 묶음 크기와 무관.
- 직접 등록 `appendSoul` ≈ 224k–255k gas → 현재 가격으로 약 4–5원/건.
- 가스비는 변동이 크다(혼잡 시 수십~수백 배). 실제 운영 전 다시 측정.
