# 보안 점검 2026-10-29 — 이음 장부 (ieum-ledger.pages.dev, `register/`)

GeekNews 공개 전 점검. 읽기와 로컬 분석만 했고, 운영 사이트에는 일반 GET 요청(헤더 확인) 외에 아무것도 보내지 않았다.
기준 커밋: `7cd657a`. 범위: `register/` 정적 사이트, 저장소 git 이력 전체(34 커밋, 모든 ref), npm 의존성.

## 결과

| 항목 | 위험도 | 상태 | 근거 |
|---|---|---|---|
| XSS: 체인 note·agentName·metaURI 표시 | 낮음 | 해당없음 | `register/*.js`에 HTML 문자열 싱크(innerHTML·outerHTML·insertAdjacentHTML·document.write·eval)가 없다. 체인 값은 `el()`의 `text` → `textContent`로만 들어간다(`app.js` 477·493·611행). metaURI는 계보 계산(`lineage.js` `parseFork`)에만 쓰이고 링크로 만들지 않는다. 회귀 테스트 `test/security-static.test.js` 추가. |
| XSS·피싱: 링크(href)로 쓰이는 값 | 낮음 | 해당없음 | href는 고정 접두(`mailto:`, `net.explorer + "/tx/"`, blob URL, config 값)이거나 `evidenceUrl()`이 `^https://`이고 `sha256(url) == reportHash`일 때만 만든다. `javascript:` URL이 들어갈 경로 없음. 같은 테스트에서 확인. |
| XSS: 후원자 이름(donors.json) | 낮음 | 해당없음 | `textContent`로 표시. 기존 e2e가 `<img onerror>` 이름이 요소를 만들지 않음을 확인(`e2e-register.js` 574행). |
| CSP | 낮음 | 해당없음 | `index.html`·`donate.html`에 meta CSP `default-src 'none'; script-src 'self'; style-src 'self'; ... base-uri 'none'; form-action 'none'`. 인라인 스크립트·인라인 이벤트 핸들러 없음. |
| 클릭재킹(지갑 서명 화면을 iframe에 넣기) | 중간 | 수정함 | `frame-ancestors`는 meta CSP로 설정할 수 없어 운영 응답에 프레임 차단이 없었다(점검 시 헤더: nosniff, referrer-policy만). `register/_headers` 추가: `X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'none'`. |
| 기타 보안 헤더 | 낮음 | 수정함 | 같은 `_headers`에 `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`(camera·mic·geolocation·payment·usb 끔). 이전에는 배포 폴더에서만 nosniff를 따로 넣었는데, 이제 저장소에 들어 있다. |
| 외부 스크립트 | 낮음 | 해당없음 | 모든 스크립트가 같은 출처. ethers 6.17.0과 qrcode는 `register/vendor/`에 들어 있다(CDN 없음). |
| 하드코딩된 비밀 값 | 낮음 | 해당없음 | `config.js`에는 공개 RPC 주소·컨트랙트 주소·익스플로러 주소만 있다. 테스트넷 키는 저장소 밖(`D:\openclaw-backup`)에 있고 `.gitignore`에 `*.key`, `.env`. |
| git 이력의 키·토큰·비밀번호 | 높음(노출 시) | 해당없음 | 이력 전체(34 커밋)를 정규식(개인키 hex·PEM·니모닉·AWS·GitHub·Slack·OpenAI·Anthropic·Google·Cloudflare·Discord·password/secret 대입·Bearer)과 **실제 비밀 값 일치 검사**(`D:\openclaw-backup`의 토큰·키 파일 7개, 채점 사이트 `.dev.vars`)로 검사했다. 검출 0건. gitleaks는 설치돼 있지 않아 쓰지 않았고, PDF·PNG 같은 바이너리 내용은 검사 범위 밖이다. |
| 의존성(npm audit) | 낮음 | 남김 | 47건(high 18, moderate 10, low 19, critical 0). 모두 devDependencies(hardhat·hardhat-toolbox와 그 하위: undici, ws, tmp, lodash, serialize-javascript, adm-zip 등)이다. 배포되는 `register/`에는 포함되지 않는다. 고치려면 hardhat 3 / hardhat-toolbox 7 메이저 업그레이드가 필요해서 자동 수정은 하지 않았다. 로컬 개발 도구로만 쓰는 동안은 위험이 낮다. |
| CSP `connect-src`의 `http://127.0.0.1:*`, `http://localhost:*` | 낮음 | 남김 | 로컬 hardhat 노드 테스트용이다. 운영에서 공격 경로는 없지만(로컬 네트워크는 `config.js`에서 testnet 목록으로만 고름), 공개용 빌드에서 빼면 더 깔끔하다. e2e가 같은 `index.html`을 쓰므로 이번에는 바꾸지 않았다. |
| CORS `Access-Control-Allow-Origin: *` | 낮음 | 해당없음 | Cloudflare Pages 정적 파일 기본값이다. 인증·쿠키가 없는 공개 정적 파일이다. |

## 확인한 것
- `npx hardhat test test/*.test.js` 56 passing (기존 52 + 새 static 보안 테스트 4).
- e2e(로컬, headless Edge): `e2e-register.js` 131/0, `e2e-lineage.js` 21/0, `e2e-lineage-hash.js` 18/0, `e2e-demo.js` 20/0.
- 배포 뒤 `curl -I https://ieum-ledger.pages.dev/`로 새 헤더가 붙었는지 확인.

## 남은 일(사용자 결정)
- hardhat 메이저 업그레이드(개발 도구만 해당)는 급하지 않다.
- 공개용 빌드에서 `connect-src`의 localhost 허용을 뺄지.
