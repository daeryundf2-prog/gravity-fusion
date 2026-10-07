# Gravity Fusion 사용자 및 유지보수 가이드

## 1. 개요 (Overview)

Gravity Fusion은 `native-gravity` (커밋 `bc1d8ad010ef1cd336eac9acb4a8ca97c315e125`)의 9개 전문 에이전트 역할과 4개 품질 제어 훅을 윈도우 PowerShell 환경에서 구동할 수 있도록 재설계한 독립 플러그인이다. 외부 npm 패키지나 Python 설치 없이 Node.js (>= 18) 내장 런타임만으로 동작하며 LazyAntigravity 스킬 및 MCP 인프라와 결합하여 고난도 설계, 계획, 자율 장애 진단, 엄격한 코드 검토 작업을 지원한다.

Antigravity 기본 환경 및 기존에 설치된 LazyAntigravity 플러그인과 격리되어 상호 간섭 없이 안전하게 동작한다.

---

## 2. 핵심 아키텍처 및 변경점 (Architecture & Delta)

### 2.1 Python 의존성 완전 제거 (Node >= 18 네이티브)
upstream `native-gravity`의 훅은 Python 3 스크립트로 구성되어 있었다. 윈도우 환경에서는 `python3` 실행 명령이 Microsoft Store 설치 별칭(WindowsApps alias)으로 연결되어 훅 실행이 실패하거나 무음(silent) 종료되는 문제가 발생한다.

Gravity Fusion은 모든 훅 로직을 Node.js 내장 모듈(`node:fs`, `node:path`, `node:process`) 기반의 ESM(`.mjs`)으로 다시 작성했다. 외부 npm 패키지 의존성이 전혀 없는 zero-dependency 구조를 갖추어 윈도우 환경에서 안정적으로 동작한다.

### 2.2 상시 주입 규칙(`rules/`) 배제 (Default 세션 0% 리그레션 보장)
Antigravity 플러그인 루트의 `rules/` 디렉터리에 마크다운 규칙을 배치하면, 플러그인이 활성화된 모든 세션(기본 Default 에이전트 포함)에 해당 규칙이 상시 주입된다. 이로 인해 불필요한 컨텍스트 토큰이 소모되고 일반 대화 경험이 변형될 수 있다.

Gravity Fusion은 루트 `rules/` 디렉터리를 배제했다. 공통 하네스 규칙(`harness.md`)과 오케스트레이션 지침(`orchestration.md`)은 에이전트 빌드 단계(`scripts/build-agents.mjs`)에서 각 역할 프롬프트 본문 내부로만 인라인 합성된다. 따라서 Default 에이전트 세션에는 어떠한 규칙도 주입되지 않으며 훅 역시 고유 역할이 식별되지 않으면 즉시 통과(`allow` 및 `stop`)하므로 기본 세션의 사용성을 온전히 보존한다 (IS-1).

### 2.3 PowerShell 호환 마커 체계 및 POSIX 호환 유지
upstream은 `NTG_ZEN_VERIFY=1 <명령>` 또는 `NTG_EXCAVATOR=1 <명령>`과 같은 POSIX 인라인 환경 변수 구문을 강제했다. 이 구문은 PowerShell 환경에서 문법 오류를 일으킨다.

Gravity Fusion은 PowerShell 문법에 맞춘 마커 체계를 지원한다.
- Zen 검증 명령: `$env:NTG_ZEN_VERIFY='1'; <명령>`
- Excavator 명령: `$env:NTG_EXCAVATOR='1'; <명령>`

가드 모듈(`zen-shell-guard.mjs`, `excavator-shell-guard.mjs`)은 PowerShell 접두사 형태를 검증하며 기존 POSIX 형식 접두사도 함께 인식하여 상위 호환성을 유지한다.

### 2.4 Antigravity hub-2.21.0 트랜스크립트 디코딩 및 프롬프트 잘림 대응
Antigravity hub-2.21.0 런타임의 실제 동작 특성을 반영하여 트랜스크립트 파싱 계층을 구현했다.
- **인자 이중 인코딩 디코딩**: 트랜스크립트 내부의 `tool_calls[].args` 값이 JSON 문자열로 감싸여 있는 현상(`"TypeName": "\"zen\""`)을 `decodeHubValue` 함수로 정규화하여 서브에이전트 호출 및 판정을 정확히 추적한다.
- **프롬프트 잘림 대응**: 대용량 프롬프트로 인해 `transcript.jsonl`에 `truncated_fields` 배열이 기록된 경우, 인접한 `transcript_full.jsonl` 파일에서 원본 레코드를 복원하여 역할 및 도구 인자 누락을 방지한다.
- **역할 식별 채널 추가**: 메인 에이전트의 첫 모델 응답 첫 줄(`NTG_ROLE: <role>`)과 서브에이전트 첫 수신 메시지(`NTG_ROLE: <TypeName>`)를 파싱하여 정확한 역할 귀속(Role Attribution)을 보장한다.

### 2.5 역할별 LazyAntigravity 스킬 및 읽기 전용 MCP 허용 목록 연결
각 에이전트의 작업 특성에 맞추어 필요한 LazyAntigravity 전문 스킬(`start-work`, `ulw-plan`, `debugging`, `programming`, `review-work` 등)을 프롬프트에 매핑했다. 또한 읽기 전용 역할(Jaguar, Zen, Steamroller, Strix-Halo, Piledriver)에 대해서는 `mcp-role-guard.mjs`를 통해 허용된 읽기 전용 MCP 도구만 실행할 수 있도록 통제한다.

---

## 3. 9개 에이전트 역할 안내 (Roles Directory)

Gravity Fusion은 3개의 Primary 에이전트와 6개의 Specialist/Worker 에이전트로 구성된다.

| 역할 | 성격 및 구분 | 권한 경계 (Tools) | 매핑된 Lazy 스킬 | 허용 MCP (옵트인 시) | 종료 및 판정 프로토콜 |
|---|---|---|---|---|---|
| **Bulldozer** | Primary (실행 총괄) | run_command, invoke_subagent, send_message, manage_subagents, 파일 읽기 | `start-work`, `mass-ulw`, `git-master`, `review-work` | 없음 (Jaguar/Bobcat에 위임) | 서브에이전트 작업 통합 후 Zen의 `VERDICT: GO` 확인 시 `READY` 종료 |
| **Piledriver** | Primary (전략/계획 수립) | invoke_subagent (`jaguar`, `zen` 한정), 파일 읽기 (코드 수정 불가) | `ulw-plan`, `init-deep` | 없음 (Jaguar에 위임) | 계획 완성 후 Zen의 계획 검증 `VERDICT: GO` 확인 시 `PLAN READY` 종료 |
| **Excavator** | Primary (자율 장애 진단/해결) | 파일 읽기/쓰기, run_command (마커 필수), invoke_subagent (`zen` 한정) | `debugging`, `programming`, `lsp-setup`, `report-bug` | ast_grep, ast_index, lsp, git_bash, research | 원인 규명 및 최소 수정 후 Zen의 `VERDICT: GO` 확인 시 `READY` 종료 |
| **Bobcat** | Worker (구현 전담) | 파일 읽기/쓰기, run_command, invoke_subagent (`strix-halo` 한정) | `programming`, `refactor`, `frontend`, `remove-ai-slops` | ast_grep, lsp, ast_index | 구현 완료 후 Strix Halo의 `VERDICT: ACCEPT` 확인 시 로컬 `READY` 보고 |
| **Puma** | Worker (단순 텍스트/설정 편집) | 파일 읽기, write_to_file, replace_file_content (쉘 실행 및 위임 불가) | 없음 (`skills: []`) | 없음 (`mcpServers: []`) | 작업 완료 후 로컬 `READY` 보고 |
| **Jaguar** | Worker (사실 탐색 전담) | view_file, grep_search (읽기 전용, 쉘 실행 및 수정 불가) | 없음 (`skills: []`) | ast_grep_search, ast_index_find, lsp 읽기, research 읽기 등 | 탐색 결과(OBSERVED/UNKNOWN) 정리 후 보고 |
| **Steamroller** | Specialist (심층 추론 및 설계 판정) | 파일 읽기 전용 (코드 수정 및 위임 불가) | `cove-verify`, `boost` | 없음 | 문제 모델링, 트레이드오프 분석, 권고안 산출 |
| **Strix-Halo** | Advisor (Bobcat 전용 구현 검토) | view_file, grep_search (읽기 전용, 수정 및 위임 불가) | 없음 (`skills: []`) | 없음 (`mcpServers: []`) | Bobcat 구현물 대조 후 `ACCEPT`, `REVISE`, `NEEDS_DEEP` 판정 |
| **Zen** | Independent Reviewer (독립 검증관) | 파일 읽기, run_command (읽기 전용 검증 명령 한정) | `review-work`, `visual-qa` | 읽기 전용 MCP 및 git 읽기 서브커맨드 한정 | 계약 충족 확인 후 `VERDICT: GO` 또는 `VERDICT: NO-GO` 판정 |

### 3.1 Primary 에이전트 상세
- **Bulldozer (`mainAgent: true`)**:
  프로젝트 수준의 작업 단위를 분해하고 적합한 전문 에이전트에게 라우팅한다. 직접 프로젝트 소스코드를 수정하지 않으며 Bobcat과 Puma에게 구현을 위임한다. 작업 완료를 선언하기 전 반드시 Zen에게 독립 검증을 요청하여 `VERDICT: GO`를 확인해야 한다.
- **Piledriver (`mainAgent: true`)**:
  구현 착수 전 목표, 인수 조건, 작업 그래프, 소유권 제안, 위험 요소를 체계화한 계획을 수립한다. 직접 소스코드를 편집하지 않으며 사실 확인을 위해 Jaguar를, 계획 검토를 위해 Zen을 호출한다. 최종 계획이 검증되면 `PLAN READY`로 종료한다.
- **Excavator (`mainAgent: true`)**:
  복잡한 장애와 버그를 자율적으로 조사, 재현, 진단하고 최소한의 근본 수정을 거쳐 엔드투엔드로 검증한다. 모든 쉘 명령은 `$env:NTG_EXCAVATOR='1';` 마커를 부착해야 한다. 수정을 완료한 뒤 Zen의 최종 검증을 거쳐 `READY`로 종료한다.

### 3.2 Specialist 및 Worker 에이전트 상세
- **Bobcat**: Bulldozer가 지정한 범위 안에서 코드를 구현하고 테스트를 작성한다. 중요한 변경 사항에 대해서는 Strix Halo의 검토를 거쳐 `VERDICT: ACCEPT`를 받아야 한다.
- **Puma**: 단순 텍스트, 주석, 포맷팅, 설정 파일 수정을 수행한다. 하위 위임 절차 없이 작업을 완료한다.
- **Jaguar**: 코드베이스에서 사실 관계와 참조 위치를 찾는 읽기 전용 탐색 에이전트이다. 파일 변경이나 명령 실행 권한이 없다.
- **Steamroller**: 아키텍처 충돌, 요구사항 상충, 설계 모호성을 해소하기 위한 심층 추론 에이전트이다. 소스코드를 직접 수정하지 않는다.
- **Strix-Halo**: Bobcat의 구현 결과를 계약 조건과 대조 검토하는 로컬 어드바이저이다. Bobcat 호출에만 응답하며 독립적인 완료 권한은 없다.
- **Zen**: 전달된 결과물이 요구사항을 충족하는지 검증하는 독립적인 최종 검토자이다. 코드 수정 권한이 없으며 검증 쉘 명령 실행 시 `$env:NTG_ZEN_VERIFY='1';` 마커와 읽기 전용 명령만 허용된다.

---

## 4. 설치 방법 (Installation)

Gravity Fusion은 Antigravity 플러그인 규격을 따르며 전용 PowerShell 스크립트(`scripts/install.ps1`)를 통해 안전하게 설치할 수 있다.

### 4.1 사전 준비 사항
- Node.js >= 18 설치 확인 (`node -v`)
- Antigravity IDE 종료 (또는 설치 후 재시작 준비)

### 4.2 안전한 설치 스크립트 실행
스크립트는 기본적으로 실제 파일을 복사하지 않고 대상 디렉터리와 변경 사항을 미리 확인하는 드라이런(DryRun) 모드로 동작한다.

```powershell
# 1. 설치 경로 및 복사 대상 미리보기 (기본값 DryRun)
powershell -ExecutionPolicy Bypass -File scripts/install.ps1
```

미리보기 결과를 확인한 뒤, 다음 명령으로 실제 설치를 진행한다.

```powershell
# 2. 실제 플러그인 디렉터리로 복사 및 설치 수행
powershell -ExecutionPolicy Bypass -File scripts/install.ps1 -Execute
# 또는
powershell -ExecutionPolicy Bypass -File scripts/install.ps1 -Confirm:$false
```

기본 설치 경로는 `%USERPROFILE%\.gemini\config\plugins\gravity-fusion`이다.

### 4.3 IDE 재시작 절차
설치가 완료되면 실행 중인 Antigravity IDE를 완전히 종료한 뒤 다시 시작한다. 플러그인 매니페스트(`plugin.json`, `hooks.json`)와 에이전트 목록이 재시작 시점에 로드된다.

---

## 5. 라이브 검증 절차 (Live Verification Checklist)

설치 후 플러그인이 정상적으로 인식되고 훅 체계가 준비되었는지 확인하기 위해 다음 절차를 수행한다.

### 5.1 사전 정합성 검증 스크립트 실행
터미널에서 검증 스크립트를 실행하여 이름 충돌과 훅 구동 상태를 확인한다.

```powershell
node scripts/verify-live.mjs
```

이 스크립트는 다음 항목을 점검한다.
- 설치된 다른 플러그인(`lazyantigravity`, `lazyforensic-`, `lazyothers`, `lazyagentic` 등)과의 에이전트 및 스킬 이름 충돌 여부
- `hooks.json` 매니페스트 문법 및 진입점 모듈 존재 여부
- 모의 입력을 통한 훅 프로세스 응답성 및 JSON 형식 준수 여부

### 5.2 IDE UI 드롭다운 확인
1. Antigravity IDE 대화창 상단의 Primary Agent 드롭다운을 확인한다.
2. `Bulldozer`, `Piledriver`, `Excavator` 항목이 정상적으로 표시되는지 확인한다.
3. 서브에이전트 목록에 `Bobcat`, `Puma`, `Jaguar`, `Steamroller`, `Strix-Halo`, `Zen`이 등록되었는지 확인한다.

---

## 6. MCP 도구 연동 및 권한 승인 (MCP Integration & Permissions)

### 6.1 `call_mcp_tool` 초기화 이슈(#783) 방지 정책
일부 Antigravity CLI 및 IDE 환경에서 에이전트 매니페스트의 `tools` 목록에 `call_mcp_tool`을 직접 명시할 경우, "no tool converter registered" 오류가 발생하며 에이전트 기동 자체가 중단되는 현상이 보고되었다 (antigravity-cli #783).

이러한 기동 실패를 방지하기 위해 Gravity Fusion의 기본 빌드는 모든 에이전트의 `tools` 목록에서 `call_mcp_tool`을 제외한다.

### 6.2 `--mcp` 옵트인 가이드
환경에서 `call_mcp_tool`이 안정적으로 지원되는 경우, 옵트인 플래그를 사용하여 에이전트에 MCP 도구를 포함하도록 다시 빌드할 수 있다.

```powershell
# MCP 도구를 포함하여 에이전트 프롬프트 재빌드
npm run build -- --mcp

# 재빌드 후 플러그인 재설치
powershell -ExecutionPolicy Bypass -File scripts/install.ps1 -Execute
```

### 6.3 권한 프롬프트 거부 시 대처 원칙
런타임에서 MCP 도구를 호출할 때 사용자에게 권한 승인 프롬프트가 표시될 수 있다.
- **재시도 금지**: 사용자가 권한을 거부(Deny)한 경우, 동일한 MCP 호출을 반복하여 세션을 방해하지 않는다.
- **내장 도구 폴백**: 즉시 내장 읽기 도구(`view_file`, `grep_search`)나 쉘 검증 명령으로 폴백하여 사실 조사를 이어간다.
- **UNKNOWN 기록**: MCP 도구 미승인으로 인해 확인하지 못한 사실이나 단서는 추측으로 메우지 않고 명시적으로 `UNKNOWN` 상태로 기록하여 상위 에이전트나 최종 검토자에게 보고한다.

---

## 7. 문제 해결 (Troubleshooting)

### 7.1 훅 차단(Deny 또는 Continue) 발생 시 점검 사항
- **PreToolUse 훅 차단 (`decision: "deny"`)**:
  - Zen 명령 차단: 명령어 앞에 `$env:NTG_ZEN_VERIFY='1';` 접두사가 누락되었거나, 세미콜론/파이프 뒤에 허용되지 않은 cmdlet(`Set-Content`, `Out-File`, `Remove-Item` 등) 또는 특수문자(`$`, 따옴표 내 서브식, `-Wait`)가 포함되었는지 확인한다.
  - Excavator 명령 차단: `$env:NTG_EXCAVATOR='1';` 접두사가 누락되었거나, 자격 증명 획득 시도(`runas`, `cmdkey`, SAM 레지스트리 접근) 또는 시스템 전체 업데이트(`winget upgrade --all`, `choco upgrade all` 등) 패턴이 포함되었는지 확인한다.
- **Stop 훅 차단 (`decision: "continue"`)**:
  - Bulldozer 또는 Excavator 세션이 종료되지 않고 계속 진행을 요구받는 경우, 트랜스크립트 내에 Zen의 최종 `VERDICT: GO` 응답이 누락되었는지 확인한다.
  - Zen 검증 완료 이후 추가적인 파일 수정이나 쉘 명령이 실행되어 검토 결과가 무효화(stale)되었는지 확인한다.
- **트랜스크립트 상태 확인**:
  - 프롬프트 길이가 길어져 `truncated_fields`가 발생한 경우, 작업 디렉터리에 `transcript_full.jsonl`이 함께 생성되어 있는지 점검한다.

### 7.2 윈도우 권한 상승(UAC) 관련 원칙
- Excavator나 디버깅 세션에서 관리자 권한이 요구되는 작업이 발생할 경우, 에이전트가 백그라운드에서 임의로 패스워드를 획득하려 시도하지 않는다.
- 명시적인 윈도우 UAC 프롬프트(`gsudo` 또는 `Start-Process -Verb RunAs`)를 통한 사용자 승인을 요청하며 사용자 권한 승인이 불가능한 환경에서는 해당 단계를 안전하게 `BLOCKED`로 처리하고 진행 가능한 다른 조사 작업을 이어간다.

---

## 8. LazyAntigravity 공존 원칙 (Coexistence)

Gravity Fusion은 동일한 환경에 설치된 LazyAntigravity 플러그인과 상호 보완적으로 작동하도록 설계되었다.

1. **독립된 훅 네임스페이스**:
   Gravity Fusion의 훅은 오직 자신의 9개 역할(Bulldozer, Excavator, Zen 등)에 대해서만 검증과 차단을 수행한다. 역할 배너가 없는 일반 세션(Default 에이전트)이나 다른 플러그인의 세션에 대해서는 즉시 `allow` 또는 `stop`을 반환하여 아무런 제약을 가하지 않는다.
2. **판정 상호 간섭 없음**:
   LazyAntigravity의 훅 판정을 뒤집거나 중복 차단하지 않는다. 두 플러그인의 훅은 각자의 평가 기준에 따라 독립적으로 판정하며 충돌을 일으키지 않는다.
3. **스킬 및 리소스 공유**:
   Gravity Fusion 에이전트는 LazyAntigravity가 제공하는 유용한 분석 및 프로그래밍 스킬을 프롬프트 레벨에서 호출하여 활용하되, LazyAntigravity의 파일이나 설정을 변경하지 않는다.

---

## 9. 제거 방법 (Uninstallation)

Gravity Fusion을 환경에서 완전히 제거하려면 다음 단계를 따른다.

### 9.1 플러그인 디렉터리 삭제
PowerShell 터미널을 열고 설치된 플러그인 디렉터리를 삭제한다.

```powershell
Remove-Item -Recurse -Force "$HOME\.gemini\config\plugins\gravity-fusion"
```

### 9.2 IDE 재시작
Antigravity IDE를 재시작하여 등록된 플러그인과 에이전트가 정상적으로 해제되었는지 확인한다.

### 9.3 작업 디렉터리 정리 (선택 사항)
빌드 소스가 위치한 로컬 작업 디렉터리(`scratch/gravity-fusion`)는 필요에 따라 보관하거나 삭제한다.
