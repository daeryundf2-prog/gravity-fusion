# Wave 4 Verification Report: V1 Test Suite Results (Test Runner)

**Node:** V1 (test-runner)  
**Target:** `gravity-fusion` (`C:\Users\Daeryun\.gemini\antigravity\scratch\gravity-fusion`)  
**Execution Timestamp:** 2026-10-07T19:16:24+09:00  
**Overall Verdict:** **PASS (Exit Code: 0)**

---

## Executive Summary

As part of Wave 4 (Final Verification) under the `gravity-fusion` mass-ulw workflow, the entire test suite `npm test` (`node scripts/run-tests.mjs`) was executed.

- **Total Test Count:** 234
- **Total Suites Count:** 13
- **Passed Tests:** 234 (100%)
- **Failed Tests:** 0
- **Cancelled / Skipped / Todo:** 0
- **Test Suite Duration:** 13,338.50 ms (~13.34 s)
- **Exit Code:** `0`

All 13 test files passed cleanly with zero regressions, zero skipped tests, and full compliance across all invariant specifications (IS-1 through IS-15) and performance budgets (IS-12 p95 < 300 ms across all 5 hooks).

---

## Test Execution Metrics

| Metric | Measurement |
|---|---|
| **Command** | `npm test` (`node scripts/run-tests.mjs`) |
| **Working Directory** | `C:\Users\Daeryun\.gemini\antigravity\scratch\gravity-fusion` |
| **Runner** | Node.js built-in test runner (`node --test`) via `scripts/run-tests.mjs` |
| **Exit Code** | `0` |
| **Total Test Suites** | 13 |
| **Total Tests** | 234 |
| **Passed** | 234 |
| **Failed** | 0 |
| **Cancelled** | 0 |
| **Skipped** | 0 |
| **Todo** | 0 |
| **Execution Duration** | 13,338.50 ms (13.34 s) |

---

## Breakdown Per Test File

The test suite consists of 13 test files located under `test/`. The table and detailed sections below break down test counts, suites, durations, and scopes for each file.

### Summary Table

| # | Test File | Suites | Tests | Pass | Fail | Individual Duration | Status | Primary Focus / Subsystem |
|---|---|:---:|:---:|:---:|:---:|:---:|:---:|---|
| 1 | `test/check-upstream.test.mjs` | 1 | 4 | 4 | 0 | 796.7 ms | **PASS** | Upstream provenance lock & drift detection against `native-gravity` |
| 2 | `test/shell-lex.test.mjs` | 0 | 15 | 15 | 0 | 1,192.3 ms | **PASS** | Shell lexer, PowerShell tokenizer & Python 3.12 shlex differential tests (616 vectors) |
| 3 | `test/lib-io.test.mjs` | 0 | 7 | 7 | 0 | 253.7 ms | **PASS** | Standard I/O utilities, JSON line protocol, BOM stripping, entrypoint detection |
| 4 | `test/lib-markers.test.mjs` | 0 | 10 | 10 | 0 | 138.7 ms | **PASS** | Marker regexes, `$ENV:NTG_*` parsing, prefix stripping, case-insensitivity |
| 5 | `test/lib-transcript.test.mjs` | 0 | 14 | 14 | 0 | 149.0 ms | **PASS** | Transcript JSONL loader, `transcript_full.jsonl` substitution, role extraction, pairing |
| 6 | `test/zen-shell-guard.test.mjs` | 5 | 13 | 13 | 0 | 9,442.9 ms | **PASS** | Zen boundary shell guard, Python differential suite, PowerShell AST grammar, bypass corpus |
| 7 | `test/excavator-shell-guard.test.mjs` | 7 | 39 | 39 | 0 | 4,220.7 ms | **PASS** | Excavator shell guard, Windows privilege/upgrade detection, gsudo/RunAs, upstream 33 vectors |
| 8 | `test/primary-review-gate.test.mjs` | 0 | 40 | 40 | 0 | 955.7 ms | **PASS** | Bulldozer & Piledriver review gating, provenance security, child pairing |
| 9 | `test/excavator-review-gate.test.mjs` | 0 | 56 | 56 | 0 | 1,894.8 ms | **PASS** | Excavator review gating, status: ready detection, mutation invalidation, Python gate parity |
| 10 | `test/mcp-role-guard.test.mjs` | 0 | 11 | 11 | 0 | 302.9 ms | **PASS** | MCP role mutation guard, read-only role boundary, tool subsetting, CLI child process |
| 11 | `test/build-verify.test.mjs` | 0 | 9 | 9 | 0 | 710.1 ms | **PASS** | Agent generation (default & `--mcp`), static verification, IS-1/2/3/5/8/15 violation tests |
| 12 | `test/default-nonregression.test.mjs` | 0 | 11 | 11 | 0 | 505.5 ms | **PASS** | IS-1 Default session non-regression across all 5 hooks (direct & child CLI) |
| 13 | `test/perf.test.mjs` | 0 | 5 | 5 | 0 | 7,846.3 ms | **PASS** | IS-12 Performance benchmarks: p95 latency < 300 ms across 20 spawns per hook |
| **TOTAL** | **13 Files** | **13** | **234** | **234** | **0** | **~13.34 s** | **PASS** | **Entire Test Suite Passes Cleanly** |

---

## Detailed Test Breakdown

### 1. `test/check-upstream.test.mjs`
- **Suites:** 1 (`upstream provenance lock and drift detection`)
- **Tests:** 4 (Pass: 4, Fail: 0)
- **Duration:** ~796.7 ms
- **Scope & Verified Behaviors:**
  - `lock then check exits 0 when untampered`: Ensures unmodified upstream lock passes with exit code 0.
  - `flip one byte causes check to exit 1 and report names the file`: Confirms 1-byte file drift detection.
  - `add a file causes check to exit 1 and report names the added file`: Detects untracked file injection.
  - `remove a file causes check to exit 1 and report names the removed file`: Detects missing file deletion.

### 2. `test/shell-lex.test.mjs`
- **Suites:** 0
- **Tests:** 15 (Pass: 15, Fail: 0)
- **Duration:** ~1,192.3 ms
- **Scope & Verified Behaviors:**
  - **Python 3.12 shlex Differential Testing (616 corpus inputs):**
    - Zen configuration parity (`posix=true`, `punctuationChars=';&|'`, `whitespaceSplit=true`, `commenters='#'`).
    - Excavator configuration parity (`posix=true`, `punctuationChars=';&|'`, `whitespaceSplit=true`, `commenters=''`).
    - `pySplit` POSIX splitting with and without comments.
  - **`psTokenize` Unit Tests:**
    - Unquoted basic commands, single quotes with `''` escape, double quotes and literal expressions.
    - Embedded separators (`;`, `|`, newlines normalized to `;`) and spaces.
    - Inter-token whitespace, unclosed quote detection (`ok: false`), empty segments (`ok: false`), adjacent unquoted/quoted tokens.

### 3. `test/lib-io.test.mjs`
- **Suites:** 0
- **Tests:** 7 (Pass: 7, Fail: 0)
- **Duration:** ~253.7 ms
- **Scope & Verified Behaviors:**
  - `parseJsonObject`: Parsing valid JSON, rejecting non-object values (primitives, arrays), syntax error handling, non-string input rejection.
  - `emit`: Writing standard single-line JSON to stdout without trailing newline noise.
  - `isMain`: ESM module entrypoint detection across Windows drive letter casing (`C:` vs `c:`).
  - `readStdin`: Reading stdin streams and stripping UTF-8 Byte Order Marks (BOM) in child processes.

### 4. `test/lib-markers.test.mjs`
- **Suites:** 0
- **Tests:** 10 (Pass: 10, Fail: 0)
- **Duration:** ~138.7 ms
- **Scope & Verified Behaviors:**
  - `PS_PREFIX_RE`: Compiles valid regular expressions for PowerShell marker extraction.
  - `splitPsMarker`: Single- and double-quoted values, whitespace around assignment and delimiter, case-insensitivity (`$ENV:` vs `$env:`), rejection of missing semicolons, non-1 values, unanchored prefixes, and graceful handling of non-string inputs.
  - Support for `NTG_EXCAVATOR` and `NTG_ZEN` marker variants.
  - `isMarkedCommand`: Unified detection of POSIX prefix (`NTG_*=1`) and PowerShell prefix (`$env:NTG_*=1;`).

### 5. `test/lib-transcript.test.mjs`
- **Suites:** 0
- **Tests:** 14 (Pass: 14, Fail: 0)
- **Duration:** ~149.0 ms
- **Scope & Verified Behaviors:**
  - `normalizeKey`: Hyphen/underscore normalization and case canonicalization.
  - `iterDicts` & `iterToolCalls`: Recursive walking over arbitrarily nested AST structures and tool invocations.
  - `textContent`: Clean concatenation of nested text nodes with newline preservation.
  - `toolName`: Normalizing tool identifiers to lowercase trimmed forms.
  - `decodeHubValue` & `parseArgs`: Handling both upstream JSON-encoded arguments and native object payloads.
  - `readTranscript`: Missing files, tilde expansion, corrupted lines, loading all hub-2.21.0 fixtures.
  - Sibling transcript substitution: Resolving truncated transcript records from `transcript_full.jsonl`.
  - Inbound text and role detection: `firstInboundText`, `inboundRole` (from `NTG_ROLE` marker or `## Role` heading), and `bannerRole` (from first planner response).
  - `pairInvokeResults`: Accurate correlation of `invoke_subagent` calls with corresponding subagent result records.

### 6. `test/zen-shell-guard.test.mjs`
- **Suites:** 5
- **Tests:** 13 (Pass: 13, Fail: 0)
- **Duration:** ~9,442.9 ms
- **Sub-Suites & Verified Behaviors:**
  - `zen-shell-guard upstream vectors (evaluate)` (5 tests): Allows marked read-only commands, denies mutations and bypasses, permits unmarked commands outside boundary, denies hidden/disabled markers, fails closed on malformed input.
  - `zen-shell-guard differential test suite against Python` (1 test): Complete differential check of POSIX vectors against Python implementation.
  - `zen-shell-guard PowerShell read-only grammar` (1 test): Validates PowerShell read-only commands (`Get-ChildItem`, `Select-String`, `Test-Path`, `Get-Content`).
  - `zen-shell-guard adversarial bypass corpus` (1 test): Rejection of shell metacharacters, subshell executions, chaining (`&&`, `||`, `;`), redirects, and command substitutions.
  - `zen-shell-guard CLI integration` (5 tests): Child process stdin integration for valid commands, PowerShell commands, denied commands, out-of-boundary commands, and malformed JSON payloads.

### 7. `test/excavator-shell-guard.test.mjs`
- **Suites:** 7
- **Tests:** 39 (Pass: 39, Fail: 0)
- **Duration:** ~4,220.7 ms
- **Sub-Suites & Verified Behaviors:**
  - `Upstream 33 POSIX vectors` (4 tests): Permits task-relevant sudo (`sudo apt install`, `sudo systemctl`), denies privilege escalation (`sudo -i`, `su`), denies full upgrades (`apt upgrade`), leaves unmarked commands unaffected.
  - `Differential testing against upstream Python` (2 tests): Exact parity with Python gate across all 33 vectors, empty bodies, and non-run_command calls.
  - `Windows privilege detection` (7 tests): Denies `runas`, `cmdkey /list`, `vaultcmd /list*`, registry SAM/SECURITY/SYSTEM dumps, ConsoleHost history inspection, and credential loops. Benign registry queries permitted.
  - `Windows full-upgrade detection` (13 tests): Denies full updates across `winget --all`, `choco upgrade all`, `cup all`, `scoop update *`, `Install-WindowsUpdate`, `Update-Module` (unnamed), `usoclient`, `wuauclt`, `Get-WindowsUpdate -Install`. Allows single-package upgrades and queries.
  - `Windows elevation allowed & target recursion` (4 tests): Permits `gsudo` and `Start-Process -Verb RunAs` for benign targets; denies dangerous targets.
  - `Windows recursive shells` (4 tests): Detects `powershell.exe`, `pwsh`, and `cmd /c` wrapping full-upgrade or privilege commands; stops recursion beyond depth 2.
  - `Edge cases and CLI integration` (5 tests): Denies empty bodies with exact descriptive message; allows unmarked commands; allows non-run_command tools; fails open on malformed input; child process stdin integration.

### 8. `test/primary-review-gate.test.mjs`
- **Suites:** 0
- **Tests:** 40 (Pass: 40, Fail: 0)
- **Duration:** ~955.7 ms
- **Scope & Verified Behaviors:**
  - **Bulldozer Lifecycle Gating:**
    - Non-target agents unaffected.
    - Ready attempt without review forces `continue`.
    - Review started without verdict forces `continue`.
    - Correlated `GO` verdict permits `stop`.
    - Wrong sender or self-reported `GO` is rejected.
    - Unrelated tool `GO` does not count.
    - Fresh `send_message` invalidates previous `GO` until new response arrives.
    - Pending review blocks even non-terminal stops.
    - `NO_GO` blocks ready. Progress updates and explicit blocked status may stop.
    - Contradictory ready + blocked rejected.
  - **Piledriver Lifecycle Gating:**
    - Plan ready without review forces `continue`; correlated `GO` permits plan ready.
    - Newer invocation invalidates older `GO`.
    - Discovery requirements and blocked status may stop.
  - **Scoping & Provenance:**
    - System prompt scoping, role hint events, agent name events, `NTG_ROLE` markers, runner role headings.
    - Unknown role hint fall-through to transcript; absent role stops normally; abnormal termination fails open.
    - Repo-relative hook paths and plugin root execution.
    - Hub fixture tests (`default-ready.jsonl`, `bulldozer-go.jsonl`, `bulldozer-nogo.jsonl`, `bulldozer-no-zen.jsonl`, `bulldozer-resend.jsonl`, `piledriver-go.jsonl`, `multi-invoke.jsonl`).

### 9. `test/excavator-review-gate.test.mjs`
- **Suites:** 0
- **Tests:** 56 (Pass: 56, Fail: 0)
- **Duration:** ~1,894.8 ms
- **Scope & Verified Behaviors:**
  - Non-excavator session unaffected (fail-open).
  - System prompt scoping and marker scoping without agent identity field.
  - Blocked excavator may stop without review.
  - Ready without Zen review forced to continue.
  - Zen `GO` allows ready; Zen `NO_GO` forces correction.
  - New Zen invocation invalidates older `GO`.
  - Material write (`write_to_file`) or marked shell execution after `GO` requires fresh review; subsequent `GO` allows ready.
  - Non-idle excavator waits; abnormal termination avoids infinite loop.
  - Progress updates and user input requests without ready may stop; mid-investigation stops proceed.
  - Text matching heuristics: "not ready yet", explanatory prose, or progress mentions do not trigger ready gating.
  - Formal `status: ready` detection; past ready followed by progress/user input allowed to stop.
  - Provenance rejection (A through H): Rejection of self-reported `GO`s, spoofed sender system messages, generic command outputs, and embedded model markdown tags.
  - Stale blocked state resolution (A through D).
  - Subagent role inspection (`zen` typename vs role string).
  - Fixtures & Hub integration (`default-ready`, `excavator-go-fresh`, `excavator-stale`, `excavator-ps-marker`, `truncated/`).
  - CLI integration: child process invocation, blocking incomplete runs, failing open on invalid JSON.
  - Differential verification against upstream Python gate.

### 10. `test/mcp-role-guard.test.mjs`
- **Suites:** 0
- **Tests:** 11 (Pass: 11, Fail: 0)
- **Duration:** ~302.9 ms
- **Scope & Verified Behaviors:**
  - `MATCHER` regular expression matches MCP tool names (`mcp_*`, `call_mcp_tool`) and rejects native tools.
  - No role or unknown role permits execution (fail open).
  - Mutating roles (`Excavator`, `Bobcat`, `Bulldozer`) allowed full tool access.
  - Read-only roles calling read-only tools allowed.
  - Read-only roles calling mutating tools denied.
  - Read-only roles calling `git_bash_execute`: `git status` allowed; `rm`, `git commit`, `touch` denied.
  - Decoding hub JSON-encoded arguments vs native object arguments.
  - Role attribution channel prioritization.
  - Fail-open resilience on malformed payloads.
  - CLI child process integration.

### 11. `test/build-verify.test.mjs`
- **Suites:** 0
- **Tests:** 9 (Pass: 9, Fail: 0)
- **Duration:** ~710.1 ms
- **Scope & Verified Behaviors:**
  - `build-agents`: Generates 9 agent definitions in default mode (no `--mcp`).
  - `build-agents`: Generates 10 agent definitions with `--mcp` flag and binds MCP tools.
  - `verify`: Clean pass on current repository state.
  - Injected violation detection:
    - IS-1 violation (`plugin/rules` directory injection).
    - IS-2 violation (`.py` file in `plugin/` directory).
    - IS-3 violation (unescaped POSIX marker).
    - IS-5 violation (forbidden write tool in read-only role).
    - IS-8 violation (agent-skill name collision).
    - IS-15 violation (`call_mcp_tool` in default build).

### 12. `test/default-nonregression.test.mjs`
- **Suites:** 0
- **Tests:** 11 (Pass: 11, Fail: 0)
- **Duration:** ~505.5 ms
- **Scope & Verified Behaviors:**
  - **IS-1 Direct API Non-Regression:**
    - `zen-shell-guard`: Returns `allow` ("Outside the Zen-marked boundary").
    - `excavator-shell-guard`: Returns `allow` on unmarked shell commands.
    - `mcp-role-guard`: Returns `allow` ("Not a read-only role").
    - `primary-review-gate`: Returns `stop` (fail-open for non-primary sessions).
    - `excavator-review-gate`: Returns `stop` (pass-through for non-excavator sessions).
  - **IS-1 CLI Non-Regression:**
    - All 5 hooks return their respective pass-through / allow decisions when spawned via CLI child processes.
  - **Combined Invariant Assertion:**
    - In an unmarked Default session, NO hook blocks or alters model execution.

### 13. `test/perf.test.mjs` (IS-12 Performance Benchmarks)
- **Suites:** 0
- **Tests:** 5 (Pass: 5, Fail: 0)
- **Duration:** ~7,846.3 ms
- **Latency Budget:** p95 < 300 ms across 20 process spawns per hook
- **Measured Latency Results:**

| Hook Target | Min Latency | p50 Latency | p90 Latency | p95 Latency | Max Latency | Budget (p95) | Status |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| `zen-shell-guard` | 98.1 ms | 141.2 ms | 170.0 ms | **174.2 ms** | 202.1 ms | < 300 ms | **PASS** |
| `excavator-shell-guard` | 90.3 ms | 99.8 ms | 107.1 ms | **108.2 ms** | 108.9 ms | < 300 ms | **PASS** |
| `mcp-role-guard` | 82.4 ms | 88.4 ms | 98.2 ms | **98.7 ms** | 102.9 ms | < 300 ms | **PASS** |
| `primary-review-gate` | 80.8 ms | 89.1 ms | 99.9 ms | **121.9 ms** | 123.9 ms | < 300 ms | **PASS** |
| `excavator-review-gate` | 83.0 ms | 89.7 ms | 96.4 ms | **98.5 ms** | 104.5 ms | < 300 ms | **PASS** |

All 5 hooks operate well under the 300 ms p95 latency ceiling, averaging under 175 ms at the 95th percentile.

---

## Conclusion

The full test suite execution confirms complete functional correctness, security boundary enforcement, differential parity against upstream Python implementations, and strict performance compliance across all gravity-fusion components.

- **Total Tests:** 234 / 234 Passed
- **Exit Code:** `0`
- **Result:** **VERIFIED READY FOR RELEASE**
