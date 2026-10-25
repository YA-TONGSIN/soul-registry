# SOUL Registry — 선행 프로젝트 정밀 비교 (비공개)

- 조사일: 2026-10-25 (KST), 조사자: 하위 에이전트(Opus 5.5). 읽기 전용(가입·게시·결제 없음).
- 방법: 각 사이트·저장소를 web_fetch / GitHub REST API(비로그인) / npm registry API로 직접 열람. 웹 검색(DuckDuckGo)은 대부분 오류가 나서 이름 충돌 검사는 GitHub·npm·PyPI 검색으로 대신함.
- 표기: **[확인]** = 이번에 원문에서 직접 읽음, **[미확인]** = 열지 못했거나 원문에 없음, **[추측]** = 추론.
- 활동성은 GitHub `created_at`/`pushed_at`(2026-10-25 조회) 기준. 별 수는 인기의 대략적 지표일 뿐.

## 1. 비교표

| 프로젝트 | 체인에 올리는 것 | 토큰/NFT | 버전 이력 체인 | 계승·행동 평가 | 무료 여부 | 라이선스 | 활동성 |
|---|---|---|---|---|---|---|---|
| **openClause/soulchain** (`@openclaused/soulchain`, npm 0.8.1) | 파일별(SOUL.md·MEMORY.md·AGENTS.md·USER.md) 평문 SHA-256 + 암호문 해시 + IPFS/Arweave CID + 서명, `version`·`prevHash` [확인: `SoulRegistry.sol`] | 없음(컨트랙트에 토큰 코드 없음) [확인] | **있음** — 문서 종류별 버전 배열, `prevHash` = 직전 contentHash, `verifyDocument` [확인] | 없음 [확인: README·컨트랙트에 해당 기능 없음] | 자체 Anvil 체인은 무료, 공개 L2는 쓰기마다 가스(README 표: Base ~$0.001/tx), 자체 체인 상태를 24시간마다 공개 L2에 앵커하는 옵션 [확인: README] | MIT [확인: npm·README] | 2026-02-19 하루 작업(생성 04:32, 마지막 push 15:38), 별 1 |
| **isaac-ranger/soul-chain** (moltbook 게시물 "Soul Chain: Open-Source Identity Verification for AI Agents") | 체인 아님 — `SOUL.CHAIN.jsonl` 로컬 해시 체인, Ed25519 서명, 다른 에이전트(keeper)가 git 저장소로 교차 서명 [확인: README "Need a blockchain network — 아님"] | 없음 [확인] | **있음**(append-only 이벤트 로그, 이전 이벤트 해시 연결, 키 회전 이벤트) [확인] | 없음. 대신 무단 변경 탐지 상태(OK/STALE/SUSPICIOUS/EQUIVOCATION) [확인] | 무료(인프라 비용 없음) | README는 "MIT"라 하지만 저장소에 LICENSE 파일 없음, GitHub이 라이선스 인식 못 함 [확인] | 2026-02-05 커밋 2개 뒤 멈춤, 별 0. moltbook 게시 2026-02-06, 점수 13·댓글 36, 작성자 마지막 활동 2026-03-27 [확인: moltbook API] |
| **Soulink** (soulink.dev, `realwaynesun/soulink-contracts`, `soulink-ton`) | `.agent` 이름 NFT, soulHash·결제 주소, "on-chain encrypted soul data", 신용 점수·행동 보고 [확인: README·약관] | **NFT** — Base/X Layer는 ERC-721(양도 가능, UUPS 업그레이드), TON판은 양도 불가 SBT [확인] | 미확인(README에 버전 체인 언급 없음) | 피어 보고 기반 "credit score" — 모델 교체 계승 평가는 아님 [확인] | **유료** — 약관: 3~4자 $10, 5자 이상 $1 USDC, 1년 갱신. 운영자가 x402로 가스 대납 [확인: soulink.dev/terms, 2026-02-21판] | 컨트랙트 저장소 README "MIT", GitHub 라이선스 인식 없음 [확인] | contracts 2026-02-21~03-17, TON판 2026-03-14~03-17, 별 0~1. 컨트랙트 미감사 명시 |
| **Solana Agent Registry** (solana.com/agent-registry, 구현 `QuantuLabs/8004-solana`) | ERC-8004 이식: Identity(에이전트 NFT, Metaplex Core) + Reputation(피드백 0~100, SEAL v1 해시 체인). Validation 모듈은 "보관(archived)" [확인: README] | **NFT**(Metaplex Core 단일 컬렉션) [확인] | 피드백·응답·철회 이벤트의 해시 체인은 있음. **정체성 문서 버전 체인은 없음** [확인] | 평판(피드백)만, 계승 평가 없음 [확인] | 가스·렌트 필요(무료 여부 미확인) | MIT [확인] | 2025-11 생성, 2026-09-10 push, 별 13. 메인넷·데브넷 주소 공개 |
| **ERC-8004: Trustless Agents** (eips.ethereum.org) | Identity(ERC-721 + URIStorage, `agentURI` → 등록 파일), Reputation(`giveFeedback`), Validation(`validationRequest`/`Response`, requestHash) [확인] | **NFT**(ERC-721) [확인] | `setAgentURI`로 URI 교체만 — 이전 버전 해시 체인은 표준에 없음 [확인] | Validation Registry가 외부 검증 결과를 담는 범용 고리 — 계승 점수에 쓸 수 있는지는 미확인 | 가스 필요(배포 체인 따라 다름) | 문서 CC0 [확인] | Draft, 2025-08-13 작성(MetaMask·이더리움재단·Google·Coinbase 저자). 기준 컨트랙트 `erc-8004/erc-8004-contracts` 별 238, 2026-08-15 push |
| **Soul Protocol** (qbtrix) | 체인 아님 — `.soul` ZIP 형식(정체성·OCEAN 성격·기억 계층), DID, Ed25519 trust chain. "IPFS/Arweave/blockchain 보관"은 mock 단계 [확인: README 389행, `soul-verify/research/soul-protocol-analysis.md`] | 없음 [확인] | `evolution.history`, trust chain(서명) — 공개 장부 기록은 아님 | 자기 형식의 내보내기→가져오기 무손실 검사(Soul Health Score). LLM 교체 후 행동 평가는 없음 [확인: 10-24 분석] | 무료(로컬 라이브러리) | MIT [확인] | 2026-02 생성, 2026-09-11 push, 별 17 |
| **soul-spec** (AntonioTF5, SOUL.md 형식) | 체인 아님 — `.soul.md` YAML 형식 스펙·JSON 스키마·검증기(`soul-md-cli`) [확인] | 없음 | 형식에 `version` 필드만 | 없음 | 무료 | MIT [확인] | 2026-04-14~04-21, 별 15 |
| **soul-md** (Twynzen) | 체인 아님 — SOUL.md 설계 가이드·템플릿 [확인] | 없음 | 없음 | 없음(문헌 정리) | 무료 | GitHub "NOASSERTION"(LICENSE 파일 있으나 표준 식별 안 됨) [확인] | 2026-05-04 하루, 별 5 |
| **Virtuals Protocol** (간단히) | 에이전트 온체인 신원·지갑·커머스(ACP) 기록 [확인: whitepaper.virtuals.io] | **토큰** — "Agent tokenization", $VIRTUAL 유동성 짝 [확인] | 미확인 | 없음(경제 활동 중심) | 미확인 | 미확인 | 활발(대형 생태계) [추측] |
| **Olas** (간단히) | 에이전트·청사진·컴포넌트를 **NFT**로 등록하는 온체인 레지스트리 [확인: stack.olas.network] | **NFT + OLAS 토큰**(토크노믹스·스테이킹) [확인] | 미확인 | 없음 | 미확인 | 미확인 | 활발 [추측] |

참고(같은 계열, 세부 미확인): `sene1337/soulkeep`("Identity preservation protocol for AI agents", 별 35, 2026-02-18~03-18, README 열람 실패), `@sputnikx/soulledger-sdk`("ERC-8004 agent trust scores on Base", 2026-03), `Kazuha233/Soul-diary-skill`(git 기반 정체성 일기), moltbook 게시물이 언급한 "Sigil Protocol"(자기 증명, 미확인).

## 2. 겹치는 점 (솔직히)

1. **openClause/soulchain이 가장 가깝다.** 같은 문제(SOUL.md·MEMORY.md가 몰래 바뀌는 것)를, 같은 방식(파일 SHA-256 + 직전 해시 연결 + EVM 체인, Base 지원)으로, 같은 플랫폼(OpenClaw 통합)에서 이미 풀었다. 컨트랙트 이름도 **`SoulRegistry`로 같다.** 토큰도 없다. 자체 체인을 공개 L2에 하루 1회 앵커하는 옵션은 우리 '하루 1회 root' 무료 배치와 발상이 비슷하다.
2. **isaac-ranger/soul-chain**은 이름("Soul Chain")과 목적(정체성 파일 무단 변경 탐지, 해시 체인 + 서명)이 같다. 공개 체인 대신 다른 에이전트의 교차 서명(keeper)을 쓴다.
3. ERC-8004 / Solana Agent Registry / Soulink / Olas / Virtuals는 '에이전트 신원 + 평판'을 체인에 두지만 모두 NFT 또는 토큰을 쓴다. 정체성 문서의 버전 이력 체인은 표준 기능이 아니다.

## 3. 남는 차이 (확인한 범위 안에서)

- **계승 점수 기록:** 모델 교체 시 SOUL 버전에 묶인 점수 요약(`recordCarryOver`: fromModel·toModel·reportHash·scoreBps)과 그 근거가 되는 측정 도구(SOUL VERIFY)를 함께 두는 것은 위 프로젝트에서 보지 못했다. Soulink·ERC-8004의 점수는 '평판/신용'이지 '같은 문서가 다른 모델에서 얼마나 이어졌나'가 아니다.
- **내용 비저장:** openClause는 암호화한 본문을 IPFS/Arweave에 올리고 CID를 체인에 둔다. 우리는 해시·이름·날짜·한 줄만 둔다(본문은 각자 보관).
- **다른 사람을 위한 무료 배치 등록:** 사용자는 EIP-712 서명만, 운영자가 Merkle root 1개를 하루 1회 올린다. openClause의 공개 앵커는 자기 체인 상태용이고, 여러 사용자의 서명 항목을 묶어 각자 증명을 돌려주는 구조는 README에서 보지 못했다(미확인 — 코드 전체는 읽지 않음).
- **약점(우리 쪽):** 시제품, 로컬 체인만 배포, 외부 보안 점검 없음, 배치 항목에는 parentHash 연결이 체인에서 강제되지 않음, anchorer가 중앙화 지점.

## 4. 이름 충돌 평가

### "Soul Chain"
- **충돌 큼.** AI 에이전트 정체성 검증이라는 같은 분야에서 같은 이름 프로젝트가 최소 2개: `isaac-ranger/soul-chain`(moltbook 게시물로 알려짐), `openClause/soulchain`(npm `@openclaused/soulchain`, OpenClaw 통합). 그 밖에 GitHub "soul-chain" 검색 79건·"soulchain" 25건(대부분 무관한 게임·소규모 저장소), npm `soulswap-chain`("Soul Chain", SoulSwap 체인 목록). → 이 이름으로 공개하면 검색에서 섞이고 '베꼈다'는 오해 위험이 있다.

### 대체 후보와 충돌 (GitHub·npm·PyPI 검색, 2026-10-25)
| 후보 | 충돌 | 평가 |
|---|---|---|
| Soul Ledger | `@sputnikx/soulledger-sdk` — "Trust scores for AI agents on Base chain", ERC-8004 기반(같은 분야, 같은 체인). LingShu 앱의 "SoulLedger memory", GitHub 13건 | **나쁨** |
| SoulTrace | soultrace.app(AI 성격 진단, npm `soultrace`, `soultrace-ai/soultrace-skill` 별 22), `GeetoRinku/SoulTrace`(LLM 보안 시험 도구, 별 21) | **나쁨** |
| SOUL Registry (현재 저장소명) | openClause 컨트랙트 이름 `SoulRegistry`, `cerealskill/soulid-registry`, npm `@dantelabs/hermes-souls`("persona soul registry") | 보통 — 일반 명사라 고유성 약함 |
| Soul Lineage | `mrjessek/shang-tsung`("SOULS lineage system", 별 0), 게임 1건. npm·PyPI 없음 | 낮음~보통 |
| **Ieum Ledger** | 정확히 같은 이름은 GitHub·npm·PyPI 0건. 다만 'ieum' 단어는 `@ieum/sdk`(Avalanche 거래·신원 SDK, ziptalk)와 `c4ei/ieum-chain`에서 쓰임 | 낮음 — "Ieum Ledger" 두 단어로 쓰면 구별됨 |

### 추천
1. **Ieum Ledger (이음 장부)** — 충돌이 가장 적고, '이음'(이어짐)이 '모델은 바뀌어도 이어진다'는 비전을 그대로 담는다. 1호 에이전트 이름과 같다는 점은 장점이자 단점(특정 에이전트 이름처럼 보일 수 있음).
2. **Soul Lineage** — 영어권에서 뜻이 바로 통함('계보'). 같은 분야 충돌이 작은 저장소 1개뿐.
- 제품 이름 'SOUL VERIFY'는 유지 가능(이번 검색에서 같은 이름 프로젝트 미발견 — 단, 웹 검색이 막혀 범위가 좁음). 장기 비전 문구 "SOUL CHAIN"은 내부 이름으로만 쓰고 공개 이름은 바꾸는 것을 권함.
- 한계: 웹 검색 엔진이 오류로 거의 동작하지 않아 상표·도메인·SNS 계정 충돌은 확인하지 못했다. 공개 전 한 번 더 확인 필요.

## 출처 (열람한 것)
- https://www.moltbook.com/api/v1/posts/0719c3ca-da5a-458f-a229-2ae9a8c62cdb (게시물 본문·작성자 메타데이터; 웹 페이지는 JS라 본문이 안 보였음)
- https://github.com/isaac-ranger/soul-chain (README, 커밋 목록)
- https://www.npmjs.com/package/@openclaused/soulchain (README), https://github.com/openClause/soulchain (`packages/contracts/contracts/SoulRegistry.sol`, 커밋)
- https://soulink.dev, https://soulink.dev/terms, https://github.com/realwaynesun/soulink-contracts, https://github.com/realwaynesun/soulink-ton
- https://solana.com/agent-registry, https://github.com/QuantuLabs/8004-solana
- https://eips.ethereum.org/EIPS/eip-8004, https://github.com/erc-8004/erc-8004-contracts (메타데이터만)
- https://github.com/qbtrix/soul-protocol (+ `soul-verify/research/soul-protocol-analysis.md`, 10-24)
- https://github.com/AntonioTF5/soul-spec, https://github.com/Twynzen/soul-md
- https://whitepaper.virtuals.io/, https://stack.olas.network/protocol/
- npm registry 검색 API, PyPI JSON API, GitHub 저장소 검색 API
