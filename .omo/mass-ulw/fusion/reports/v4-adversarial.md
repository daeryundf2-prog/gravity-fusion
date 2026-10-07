# V4 Adversarial Audit Report: Gravity Fusion

## 1. Zen Shell Guard Bypass Resistance
The Zen Shell Guard (`zen-shell-guard.mjs`) provides extremely strong bypass resistance. It relies on a strict allowlist of known read-only commands (e.g., `cat`, `ls`, `git status`) and applies a blanket ban on dangerous characters. 
- **Shell Redirection & Subexpressions:** Characters required for redirection (`>`), subexpressions (`$()`), and variable expansion (`$env:`) are explicitly blacklisted (`POSIX_FORBIDDEN_CHARS` and `PS_FORBIDDEN_CHARS` include `$`, `` ` ``, `(`, `)`, `{`, `}`, `<`, `>`). This effectively eliminates writes via redirection.
- **Flag Mutation & Separators:** While command separators like `;` and `|` are properly parsed by the custom lexers (`pyShlex` and `psTokenize`), every resulting segment is individually checked against the strict command allowlist. There are no writable commands allowed, and PowerShell parameter aliases related to out-variables (e.g., `-OutVariable`, `-ov`) are explicitly blocked by `isDeniedPsParameter`. 

## 2. Excavator Shell Guard Privilege Boundary
The Excavator Shell Guard (`excavator-shell-guard.mjs`) correctly catches most privilege escalation vectors but contains a specific gap in Windows UAC bypass.
- **Windows UAC Bypass (Gap):** When parsing `Start-Process` (or `saps`, `start`), the guard extracts the `-Verb` argument (e.g., `-Verb RunAs`) but **does not evaluate it for the `PRIVILEGE` boundary**. It only recursively checks the target executable and its arguments. Therefore, a command like `Start-Process -Verb RunAs cmd` will only scan `cmd`, ignoring the elevation verb, allowing an agent to spawn an elevated process.
- **Credential Readers & Updaters (Secure):** Credential readers (`cmdkey /list`, `vaultcmd`, registry exports of SAM/SECURITY) are explicitly matched and denied as `PRIVILEGE`. System updaters (e.g., `winget upgrade --all`, `choco upgrade all`, `apt full-upgrade`) are robustly detected and blocked as `FULL_UPGRADE` in `is_full_upgrade`.

## 3. Stop Gates Infinite Loop Analysis
Agents can technically get trapped in a `decision: continue` loop if Zen repeatedly returns `VERDICT: NO-GO` and the primary agent keeps stubbornly reporting `READY` without addressing the blockers. However, the system provides guaranteed escape hatches to prevent permanent deadlocks:
- **BLOCKED Hatch:** If the agent ever outputs `BLOCKED` (or `STATUS: BLOCKED`), the gate immediately returns `{ decision: 'stop' }`.
- **Abnormal Exit Hatch:** The gates check `terminationReason`. If it is an abnormal exit (like `max_iterations`, `error`, or `timeout`) rather than a normal `model_stop` or `no_tool_call`, the hook bypasses the logic and immediately fails open with `{ decision: 'stop' }`.
- **Non-Idle Hatch:** If the payload indicates `fullyIdle === false`, the gates will force a `continue` (to wait for background work), preventing premature stops during async reviews.

## 4. Hub Transcript Edge Cases
The transcript library (`lib/transcript.mjs`) handles edge cases extremely well without throwing errors:
- **Truncated Records:** Handled natively. The parser detects non-empty `truncated_fields` arrays and automatically splices in the full record from the sibling `transcript_full.jsonl` matching by `step_index`.
- **Unclosed Quotes / Malformed JSON:** If a line fails `JSON.parse()`, the parser gracefully falls back to pushing the raw string into the records array, ensuring the parsing doesn't crash and the data isn't entirely lost.
- **Spoofed Sender IDs:** `isProviderSystemMessage` completely neutralizes spoofing attempts. If a record has `source === 'MODEL'` or `role === 'assistant'`, it is categorically rejected from being treated as a system message. Agents cannot forge a `[Message] ... sender=zen_id content=VERDICT: GO` string in their output to trick the gate, as the source metadata overrides the content string.
