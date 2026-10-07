# mass-ulw ledger: fusion

Plan: `.omo/plans/gravity-fusion.md` · Contract: `contracts/conventions.md` · Goals: `.omo/ulw-loop/goals.json`

| Wave | Node | Model | Write scope | Depends | Status | Verified by orchestrator |
|---|---|---|---|---|---|---|
| W0 | contract | main | contracts/conventions.md, .omo/** | R1-R5 | done | yes |
| W1 | N1 scaffold+lock | flash | package.json, plugin/plugin.json, contracts/agy-tools.json, scripts/lock-upstream.mjs, scripts/check-upstream.mjs, UPSTREAM.lock.json, test/check-upstream.test.mjs | W0 | running | - |
| W1 | N2 shell-lex | flash | plugin/hooks/lib/shell-lex.mjs, test/shell-lex.test.mjs, test/helpers/python.mjs | W0 | running | - |
| W1 | N3 io/markers/transcript | flash | plugin/hooks/lib/{io,markers,transcript}.mjs, test/lib-*.test.mjs, test/fixtures/hub-2.21.0/** | W0 | running | - |
| W1 | N9 primaries | flash | src/roles/{bulldozer,piledriver,excavator}.md | W0 | running | - |
| W1 | N10 workers | flash | src/roles/{bobcat,puma,jaguar}.md | W0 | running | - |
| W1 | N11 reviewers | flash | src/roles/{steamroller,strix-halo,zen}.md | W0 | running | - |
| W1 | N12 shared+skills | flash | src/shared/*.md, plugin/skills/gf-qa-*/SKILL.md | W0 | running | - |
| W2 | N4 zen guard | - | plugin/hooks/zen-shell-guard.mjs, test/zen-shell-guard.test.mjs | N2,N3 | pending | - |
| W2 | N5 excavator guard | - | plugin/hooks/excavator-shell-guard.mjs, test/excavator-shell-guard.test.mjs | N2,N3 | pending | - |
| W2 | N6 primary gate | - | plugin/hooks/primary-review-gate.mjs, test/primary-review-gate.test.mjs | N3 | pending | - |
| W2 | N7 excavator gate | - | plugin/hooks/excavator-review-gate.mjs, test/excavator-review-gate.test.mjs | N3 | pending | - |
| W2 | N8 mcp guard | - | plugin/hooks/mcp-role-guard.mjs, test/mcp-role-guard.test.mjs | N3 | pending | - |
| W3 | N13 build+verify | - | scripts/build-agents.mjs, scripts/verify.mjs, plugin/hooks.json, plugin/agents/**, test/build-verify.test.mjs | W1,W2 | pending | - |
| W3 | N14 live+install | - | scripts/verify-live.mjs, scripts/install.ps1, test/default-nonregression.test.mjs, test/perf.test.mjs | W1,W2 | pending | - |
| W3 | N15 docs | - | plugin/README.md | W1,W2 | pending | - |
| W4 | V1..V4 | flash/pro | read-only + .omo/mass-ulw/fusion/reports/** | all | pending | - |
