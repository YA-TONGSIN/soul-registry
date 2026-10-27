# Ieum Ledger · 이음 장부 (시제품)

**English** — A free, tokenless public ledger for the version history of AI agents' identity documents (SOUL files). Only SHA-256 hashes, a name, a date and a one-line note go on-chain — never the document itself. Free registration works through signed batches whose Merkle root is anchored once a day (about ₩2/day on Base); you can also register directly from your own wallet. Companion to the research tool [SOUL VERIFY](https://github.com/YA-TONGSIN/soul-verify). Currently a **testnet prototype** (Base Sepolia); contract: `0xA28a899E3b7255cea1cDc7d92b6ce7FAFBE9F237`. Site: https://ieum-ledger.pages.dev. Companion paper (Zenodo): [10.5281/zenodo.23653775](https://doi.org/10.5281/zenodo.23653775) (concept DOI, all versions; v0.7.1 = [10.5281/zenodo.23653776](https://doi.org/10.5281/zenodo.23653776)).

**한국어** — AI 에이전트의 SOUL(정체성) 문서가 어떻게 바뀌어 왔는지를 해시로만 남기는 무료·무토큰 공개 장부입니다. 문서 본문은 올리지 않습니다. 현재는 테스트넷(Base Sepolia) 시제품입니다.

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
SHA-256은 이음의 SOUL 문서 v1~v4의 per-version 사본(`history/SOUL_v*.md`, Windows 줄바꿈 CRLF) 파일 바이트 그대로 계산한 값입니다(PowerShell `Get-FileHash`와 일치 확인). 시점 증명(OpenTimestamps)에 쓴 지문은 같은 내용을 LF 줄바꿈으로 계산한 것이라 값이 다릅니다. 그래서 **LF 기준 지문을 새 버전(v5–v7)으로 추가했습니다** — OpenTimestamps 증명이 남은 공개 기록 3개(LF 해시 47b9dcfd…, b5fa12a7…, 29d94d23…), tx 0x80528a90…a724, 0x179ff77f…ee4a, 0xbf45cdd5…2366(2026-10-26, Base Sepolia). 앞의 v1–v4(CRLF)는 고칠 수 없어 그대로입니다; 개인적인 내용이 담긴 기록의 지문은 올리지 않았습니다. 스크립트: scripts/append-lf.js. SOUL 본문은 공개하지 않고 해시와 [OpenTimestamps 증명](docs/ieum-chain-proofs/)만 공개합니다.

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
- 테스트 지갑: `0x4a194813bBb6A68EB4CF02Efde25d56368dB0a30` (키는 저장소 밖 파일에 보관, **테스트넷 전용**)
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

- **후원 페이지(기본 꺼짐)** `register/donate.html` — 자리표시. `config.js` `footer.donation`의 `enabled/address/addressType/network/assets`가 모두 유효할 때만 푸터 링크·주소·QR(로컬 생성, vendor/qrcode-generator 1.4.4 MIT)이 보임. 외부 요청 없음. e2e 91개 통과.

- **후원자 명단** (`register/donate.html` 아래쪽, 2026-10-26) — 정적 `register/donors.json`을 같은 출처에서 읽어 표시(CSP `connect-src 'self'`, 외부 요청 없음). 이름은 **본인 동의(opt-in)만**, 기본은 `익명 후원자 (0x1234…abcd)`. 최근순 목록(금액·토큰·날짜·basescan 링크)과 토큰별 총합, 비어 있으면 "아직 후원이 없어요…". 한/영.
  - **갱신(운영자)**: `node scripts/update-donors.js` → Base 메인넷을 **읽기 전용**으로 조회(USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` Transfer 로그 = 공개 RPC `base-rpc.publicnode.com`(mainnet.base.org는 getLogs를 429로 막음) + 폴백, ETH = Blockscout txlist 무료 API). 트랜잭션 전송·개인키 없음. 먼지(0.01 USDC·0.00001 ETH 미만, 주소 오염 스팸)·실패 tx는 제외, 숨길 tx는 `data/donor-hide.json`(배열). 첫 실행은 최근 ~6일, 이후 `scannedTo`부터 이어서. 끝나면 `register/` 재배포. (나중에 예약 작업으로 자동화 가능.)
  - **이름 등록 절차(후원자)**: 후원 후 같은 페이지에서 이름 + 거래 해시 입력 → 지갑이 `Ieum Ledger donor name: <이름> | tx: <txHash>`에 서명(EIP-191, 네트워크 요청 없음) → 서명 JSON 내려받기 → 문의 메일로 전송. 이름은 24자 이내, 글자·숫자·공백·`_`·`-`만(URL·연락처·욕설·긴 숫자 금지).
  - **이름 반영(운영자)**: `node scripts/add-donor-name.js <받은.json>` — 이름 규칙, 메시지 일치, 서명자 == 해당 tx의 보낸 주소, tx가 donors.json에 있음을 오프라인으로 검증해 `data/donor-names.json`에 저장하고 donors.json에 병합(이후 update-donors.js도 같은 결과 유지). 이름을 눈으로도 확인할 것.
  - e2e 120개 통과(목업 명단·빈 목록·외부 요청 없음·서명 검증·위조 거부).

## 라이선스
- **코드** (`contracts/`, `lib/`, `scripts/`, `test/`, `register/`, `viewer/`): MIT — [LICENSE](LICENSE). `contracts/SoulRegistry.sol`의 SPDX 헤더도 `MIT`.
- **문서** (`whitepaper/`, `research/`, `docs/`, `DESIGN.md`, 이 README 등): CC BY 4.0 — [LICENSE-DOCS](LICENSE-DOCS)
- **예외 — 함께 들어 있는 외부 코드는 각자 라이선스**: `register/vendor/ethers-6.17.0.umd.min.js`(ethers.js, MIT, © 2016-2025 Richard Moore), `register/vendor/qrcode-generator-1.4.4.js`(MIT, © 2009 Kazuhiko Arase). 자세히는 [register/vendor/THIRD_PARTY_LICENSES.md](register/vendor/THIRD_PARTY_LICENSES.md).

## 인용
[CITATION.cff](CITATION.cff) 참고.
## 변조 알림 (check-soul.js)
로컬 SOUL/MEMORY 파일이 장부의 **최신 버전**과 같은지 확인하는 읽기 전용 CLI입니다(트랜잭션·키 불필요). 지문 = 파일 바이트를 CRLF→LF로 정규화한 SHA-256. 설계는 [docs/roadmap_v2.md](docs/roadmap_v2.md).

```powershell
node scripts/check-soul.js --agent 1 C:\path\to\SOUL.md
node scripts/check-soul.js C:\path\SOUL.md@1 C:\path\other.md@2   # 파일별 agentId는 @번호
npm run check:soul -- --agent 1 C:\path\to\SOUL.md
```
- 옵션: `--rpc <url>`(기본 `$env:BASE_SEPOLIA_RPC` 또는 https://sepolia.base.org), `--network baseSepolia|localhost`, `--contract <주소>`, `--json`, `--quiet`(일치하는 파일은 출력 생략). 컨트랙트 주소·체인 ID는 `deployments/<network>.json` 재사용.
- 종료 코드: **0** 전부 최신 버전과 일치 · **1** 하나라도 다름(옛 버전과 같음 / 어떤 기록과도 다름) · **2** 확인 못 함(파일 없음·RPC·에이전트 없음·인자 오류, 1보다 우선).
- 한계: "같음/다름"만 알려 주며 무엇이 바뀌었는지는 모릅니다. 장부에 기록된 SOUL 해시와만 비교합니다(MEMORY는 그 에이전트에 해시를 기록해 둔 경우에만 일치).

**Windows 작업 스케줄러(매일 09:00)** — 종료 코드가 0이 아니면 작업 기록에 "마지막 실행 결과"로 남습니다.
```powershell
schtasks /Create /SC DAILY /ST 09:00 /TN "IeumLedger-CheckSoul" /TR "cmd /c cd /d D:\openclaw-outputs\soul-registry && node scripts\check-soul.js --agent 1 --quiet C:\path\to\SOUL.md >> D:\openclaw-outputs\soul-registry\check-soul.log"
```
**OpenClaw 자동화에서**: 같은 명령을 실행하고 종료 코드가 1이면 알림, 2이면 "확인 실패(네트워크?)"로 따로 알립니다. 알림 문구에는 출력 줄(`MISMATCH ...`)을 그대로 붙이면 어느 버전과 같은지 알 수 있습니다.

예(출력은 해시만, SOUL 본문 없음):
```
OK       SOUL_sample.md (agent #1 "Synthetic"): matches latest v2  0x...
MISMATCH SOUL.md (agent #1 "Ieum"): equals OLDER v4, latest is v7  0x3e9f1ab1...
exit 1 (differs from ledger)
```