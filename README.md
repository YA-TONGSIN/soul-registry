# Ieum Ledger · 이음 장부 (시제품)

> 처음 이름은 SOUL CHAIN. 기존 프로젝트와의 충돌을 피해 이음 장부(Ieum Ledger)로 바꿨다. 'ieum'(이음)은 한국어로 '잇다' — 어제와 오늘, 모델과 모델, 사람과 AI를 잇는다는 뜻. **컨트랙트 이름은 `SoulRegistry`** (그대로 유지).

AI 에이전트의 SOUL 문서 이력을 **해시로만** 남기는 공개 장부 컨트랙트. 토큰 없음, 본문 저장 없음.
설계는 [DESIGN.md](DESIGN.md).

> ⚠️ 로컬/테스트넷 전용 시제품. 메인넷 배포 금지(배포 스크립트가 localhost·baseSepolia 외에는 거부).
> 체인 기록은 영구 공개 — 해시·이름·날짜·짧은 한 줄만 올린다.

## 구성
| 경로 | 내용 |
|---|---|
| `contracts/SoulRegistry.sol` | 컨트랙트 (Solidity 0.8.24, 외부 라이브러리 없음) |
| `test/SoulRegistry.test.js` | 단위테스트 11개 |
| `lib/merkle.js` | 정렬쌍 keccak Merkle 트리 + EIP-712 leaf 계산 (컨트랙트와 동일 규칙) |
| `scripts/deploy.js` | 배포 (localhost / baseSepolia만) → `deployments/<network>.json` |
| `scripts/demo-ieum.js` | 이음(Ieum)을 1호로 등록, SOUL_v1..v4 해시 체인 기록 |
| `scripts/demo-batch.js` | 가상 에이전트 2개 서명 → root 1개 anchor → 증명 검증 → `batches/` |
| `scripts/history.js` | 이력 조회 (`$env:AGENT_ID`) |
| `scripts/estimate-cost.js` | Base 메인넷 공개 RPC로 읽기 전용 가스비 추정(트랜잭션 안 보냄) |
| `scripts/new-testnet-wallet.js` | 테스트넷 전용 지갑 생성 (키는 파일에만, 출력 안 함) |
| `viewer/index.html` | 정적 조회 페이지 (로컬 체인, agentId 입력) |
| `docs/` | 로컬 데모 출력, 조회 페이지 스크린샷 |

## 컨트랙트 함수
쓰기
- `registerAgent(name, note, metaURI) → agentId`
- `appendSoul(agentId, soulHash, parentHash, note)` — owner만, parentHash == 현재 head
- `recordCarryOver(agentId, soulHash, fromModel, toModel, reportHash, scoreBps)` — owner만, 기록된 soulHash만
- `setMetaURI(agentId, uri)`, `transferAgent(agentId, newOwner)` — owner만
- `anchorBatch(root, count) → batchIndex` — anchorer만, 같은 root 두 번 불가
- `setAnchorer(account, allowed)`, `transferAdmin(newAdmin)` — admin만

읽기
- `getAgent`, `getHistory`, `getScores`, `verifyChain(agentId)`, `hasSoul(agentId, hash)`, `agentCount`
- `verifyInBatch(leaf, proof, root)`, `verifyBatchEntry(entry, signature, proof, root)`, `entryDigest`, `entryLeaf`, `processProof`
- `batchCount`, `getBatch(i)`, `batchIndexPlusOne(root)`, `isAnchorer`, `admin`, `DOMAIN_SEPARATOR`

이벤트: `AgentRegistered`, `SoulAppended`, `CarryOverRecorded`, `AgentTransferred`, `MetaURIUpdated`, `BatchAnchored`, `AnchorerSet`, `AdminTransferred`

## 실행
```powershell
npm install                 # hardhat 2.29 + toolbox (로컬 설치)
npm test                    # 11 passing
# 로컬 데모
npx hardhat node            # 다른 창에서 계속 실행
npm run deploy:local
npm run demo:ieum
npm run demo:batch
$env:AGENT_ID=1; npm run history
# 조회 페이지: viewer/index.html 을 브라우저로 열고 [조회] (또는 ?auto=1)
```

## 이음 로컬 데모 결과 (2026-10-25)
SHA-256은 `D:\openclaw-outputs\soul-chain-ieum\history\SOUL_v*.md` 파일 바이트 그대로 (PowerShell `Get-FileHash`와 일치 확인).

| 버전 | soulHash | parentHash |
|---|---|---|
| v1 | `cd1823639d2be7f90933b329779195eb402ba24fdd8a6de15b75b74791948dfe` | `0` |
| v2 | `34ff07a40e465d728deeb6dc82596a6a9de98563e13ef50f43f3e8a724a7047c` | v1 |
| v3 | `ebccc7e78fd1350e2c43110698057995d4950f6938de04e442a65b1e4cb1bb9b` | v2 |
| v4 | `3e9f1ab1ce212015687fbbd2850cd943b3dcd9b1038ff143b7378ed80ace6e7a` | v3 |

`verifyChain(1) = true`. 전체 출력: `docs/demo-ieum-output.txt`.

## 비용 추정 (무료 등록 = 운영자가 하루 1회 root)
근거: `node scripts/estimate-cost.js` (2026-10-25 00:06 UTC, Base 메인넷 블록 53,048,715, 공개 RPC `mainnet.base.org`)
- baseFee 0.005 gwei, priority 0.001 gwei
- `anchorBatch` gasUsed 115,609 (로컬 Hardhat 실측, 첫 배치 = 최악값)
- L2 실행비 0.000000694 ETH + L1 데이터비 0.0000000004 ETH (GasPriceOracle `0x42…0F`의 `getL1Fee`)
- ETH = $2,354 / ₩3,115,653 (CoinGecko)
- **하루 약 ₩2 ($0.0016), 1년 약 ₩790** — 묶음에 몇 명이 들어가든 같다.
- 직접 등록 `appendSoul` 224k–255k gas ≈ 건당 ₩4–5. 배포 2,323,519 gas ≈ ₩43.
- 가스 가격은 변동이 크다. 혼잡 시 100배여도 하루 ₩200 수준.

## 테스트넷 (Base Sepolia, chainId 84532)
- RPC: `https://sepolia.base.org` (공개, 속도 제한 있음). 바꾸려면 `$env:BASE_SEPOLIA_RPC`.
- 테스트 지갑: `0x4a194813bBb6A68EB4CF02Efde25d56368dB0a30` (키: `D:\openclaw-backup\.soul-registry-testnet.key`, 숨김, **테스트넷 전용**, 저장소 밖)
- 잔액 0 → 배포 스크립트가 거부함. faucet에서 받은 뒤 `npm run deploy:baseSepolia`.

## 등록 페이지 (register/)
정적 페이지(ethers 6.17.0 로컬 번들). 설정은 register/config.js 한 파일(localhost·baseSepolia, mainnet은 주석·비활성, footer 켜기/끄기). 검증: `node test/e2e-register.js` (로컬 hardhat 노드 + 헤드리스 Edge + EIP-1193 목 지갑). 스크린샷: docs/register/.

## 진행 기록 (2026-10-25)
- **등록 페이지** `register/` 완성 — 한/영, SOUL 내용은 브라우저 밖으로 나가지 않음(지문만 계산), 직접 등록·무료 묶음 서명·조회. 로컬 e2e 62개 통과.
- **테스트넷 배포 페이지**: https://ieum-ledger.pages.dev (Base Sepolia 전용, noindex, 메인넷 꺼짐 `allowMainnet:false`).
- **첫 외부 지갑 등록 성공** (Base Sepolia, 컨트랙트 `0xA28a899E3b7255cea1cDc7d92b6ce7FAFBE9F237`):
  - #1 Ieum — 이음 SOUL v1~v4
  - #2 WunJong-test — 신운종이 자기 지갑(MetaMask)으로 페이지에서 직접 등록, `verifyChain` = true
- **메인넷 비용 추정** (`scripts/estimate-cost.js`, 읽기 전용): 하루 1번 묶음 앵커 ≈ 2원, 1년 ≈ 780원(2026-10-25 기준).
- 남은 일: 메인넷 배포(소유자 결정·이더 필요), 묶음 서명 제출 창구, 후원 칸(현재 꺼짐), 공개 시 noindex 해제.
