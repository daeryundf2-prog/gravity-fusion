# mass-ulw ledger: fusion

Plan: `.omo/plans/gravity-fusion.md` · Contract: `contracts/conventions.md` · Goals: `.omo/ulw-loop/goals.json`

| Wave | Node | Model | Write scope | Depends | Status | Verified by orchestrator |
|---|---|---|---|---|---|---|
| W0 | contract | main | contracts/conventions.md, .omo/** | R1-R5 | done | yes |
| W1 | N1 scaffold+lock | flash | package.json, plugin/plugin.json, contracts/agy-tools.json, scripts/lock-upstream.mjs, scripts/check-upstream.mjs, UPSTREAM.lock.json, test/check-upstream.test.mjs | W0 | done | yes (0c1feb2) |
| W1 | N2 shell-lex | flash | plugin/hooks/lib/shell-lex.mjs, test/shell-lex.test.mjs, test/helpers/python.mjs | W0 | done | yes (db06b69) |
| W1 | N3 io/markers/transcript | flash | plugin/hooks/lib/{io,markers,transcript}.mjs, test/lib-*.test.mjs, test/fixtures/hub-2.21.0/** | W0 | done | yes (af8d201) |
| W1 | N9 primaries | flash | src/roles/{bulldozer,piledriver,excavator}.md | W0 | done | yes (0ed92f1) |
| W1 | N10 workers | flash | src/roles/{bobcat,puma,jaguar}.md | W0 | done | yes (32ae97f) |
| W1 | N11 reviewers | flash | src/roles/{steamroller,strix-halo,zen}.md | W0 | done | yes (0ffba58) |
| W1 | N12 shared+skills | flash | src/shared/*.md, plugin/skills/gf-qa-*/SKILL.md | W0 | done | yes (17e56fe) |
| W2 | N4 zen guard | flash | plugin/hooks/zen-shell-guard.mjs, test/zen-shell-guard.test.mjs | N2,N3 | done | yes (24388a9) |
| W2 | N5 excavator guard | flash | plugin/hooks/excavator-shell-guard.mjs, test/excavator-shell-guard.test.mjs | N2,N3 | done | yes (ac6117b) |
| W2 | N6 primary gate | flash | plugin/hooks/primary-review-gate.mjs, test/primary-review-gate.test.mjs | N3 | done | yes (a005118) |
| W2 | N7 excavator gate | flash | plugin/hooks/excavator-review-gate.mjs, test/excavator-review-gate.test.mjs | N3 | done | yes (60f7056) |
| W2 | N8 mcp guard | flash | plugin/hooks/mcp-role-guard.mjs, test/mcp-role-guard.test.mjs | N3 | done | yes (cbb13d5) |
| W3 | N13 build+verify | flash | scripts/build-agents.mjs, scripts/verify.mjs, plugin/hooks.json, plugin/agents/**, test/build-verify.test.mjs | W1,W2 | done | yes (a8c7392) |
| W3 | N14 live+install | flash | scripts/verify-live.mjs, scripts/install.ps1, test/default-nonregression.test.mjs, test/perf.test.mjs | W1,W2 | done | yes (bccc015) |
| W3 | N15 docs | flash | plugin/README.md | W1,W2 | done | yes (0f90f25) |
| W4 | V1 test-runner | flash | .omo/mass-ulw/fusion/reports/v1-test-results.md | all | running | - |
| W4 | V2 static-auditor | flash | .omo/mass-ulw/fusion/reports/v2-static-verify.md | all | running | - |
| W4 | V3 is-conformance | pro | .omo/mass-ulw/fusion/reports/v3-is-audit.md | all | running | - |
| W4 | V4 adversarial-review | pro | .omo/mass-ulw/fusion/reports/v4-adversarial.md | all | running | - |
