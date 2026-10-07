# ulw-loop brief: gravity-fusion

Build the standalone Antigravity plugin `gravity-fusion` in this repo: native-gravity (bc1d8ad) roles and hooks ported to Windows/PowerShell/AGY hub-2.21.0 as zero-dependency Node, bound to lazyantigravity skills and MCP tools. Plan: `.omo/plans/gravity-fusion.md`. Contract: `contracts/conventions.md`.

## Goals

1. G-LIB: hook libraries (io, markers, transcript with hub-2.21.0 decoding and truncated-record substitution, Python-exact shlex + PowerShell tokenizer) with differential tests against CPython shlex.
2. G-GUARDS: zen-shell-guard and excavator-shell-guard ported with 1:1 POSIX parity (all upstream vectors + differential vs Python) plus PowerShell/Windows grammar; adversarial bypass corpus all denied.
3. G-GATES: primary-review-gate and excavator-review-gate ported with all upstream vectors passing plus hub-2.21.0 fixtures (JSON-encoded args, subagent SYSTEM_MESSAGE verdicts, banner/inbound role attribution, truncated records); no infinite continue loop; GO staleness kept.
4. G-MCP: mcp-role-guard limits read-only roles to read-only MCP tools; allows everything when no role is detected.
5. G-ROLES: 9 adapted role sources + shared harness/orchestration + gf-qa skills; generated agents contain only existing tool names, no call_mcp_tool by default, PowerShell markers, lazy toolkit sections, upstream signatures and terminal strings intact.
6. G-BUILD: build-agents, hooks.json, plugin.json, verify (static validator), verify-live, install.ps1 (dry-run default), lock-upstream/check-upstream, UPSTREAM.lock.json; `npm test` and `npm run verify` green.
7. G-DOCS: Korean README (install, usage, troubleshooting, MCP permission, live verification, uninstall, coexistence with lazyantigravity).
8. G-QA: Default-session non-regression, hook latency p95 < 300 ms, IS-1..IS-15 conformance audit with zero open gaps, final quality gate.
