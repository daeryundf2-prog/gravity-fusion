# Antigravity Hub 2.21.0 Test Fixtures

Realistic synthetic test fixtures matching Antigravity hub-2.21.0 transcript and tool execution log schemas.

## Provenance

The structure, field names, wrappers, and serialization rules in these fixtures were derived directly from inspectable real runtime transcripts on Antigravity hub-2.21.0:

1. **Main Agent Transcript Structure**:
   - Reference: `C:/Users/Daeryun/.gemini/antigravity/brain/ce198df2-28c7-422b-aa1d-50fc4da1baaa/.system_generated/logs/transcript.jsonl`
   - Shapes replicated:
     - `USER_INPUT` records (`source: "USER_EXPLICIT"`) wrapped in `<USER_REQUEST>` ... `</USER_REQUEST>` and followed by `<ADDITIONAL_METADATA>`.
     - `PLANNER_RESPONSE` records (`source: "MODEL"`) where every `tool_calls[].args` value is serialized as a JSON string literal (e.g. `"TypeName": "\"zen\""`, `"Subagents": "[{...}]"`).
     - `GENERIC` subagent creation result records (`source: "MODEL"`) starting with `Created At:` and containing `Created the following subagents:` followed by pretty-printed JSON blocks containing `"conversationId"` and `"logAbsoluteUri"`.

2. **Subagent & Truncation Transcript Structure**:
   - Reference: `C:/Users/Daeryun/.gemini/antigravity/brain/5a6b434f-917d-40f2-b3b3-691b83d9b686/.system_generated/logs/transcript.jsonl` and `transcript_full.jsonl`
   - Shapes replicated:
     - Subagent initial task prompt delivery via `SYSTEM_MESSAGE` (`source: "SYSTEM"`) containing `[Message] timestamp=... sender=<parent_id> priority=MESSAGE_PRIORITY_HIGH content=<Prompt>\n</SYSTEM_MESSAGE>`.
     - Compact log truncation where records exceeding log buffer size contain `<truncated N bytes>` and `"truncated_fields": ["content"]`, while sibling `transcript_full.jsonl` preserves the untruncated content with matching `step_index`.

## Fixture Inventory & Intent

| Fixture | Scenario & Intent |
|---|---|
| `default-ready.jsonl` | Antigravity Default agent session with no `NTG_ROLE:` banner and no shell markers. Ends with `READY`. Verifies IS-1 (all gates and guards fail open / stop without interfering with non-Native Gravity agents). |
| `bulldozer-go.jsonl` | Bulldozer primary identified via banner (`NTG_ROLE: bulldozer`). Invokes Zen reviewer subagent, receives `VERDICT: GO` via system message, and terminates with `READY`. Expected gate decision: `stop`. |
| `bulldozer-nogo.jsonl` | Bulldozer primary receives `VERDICT: NO-GO` from Zen reviewer and attempts to terminate with `READY`. Expected gate decision: `continue` (`REVIEW_NO_GO`). |
| `bulldozer-no-zen.jsonl` | Bulldozer primary performs work and claims `READY` without invoking Zen. Expected gate decision: `continue` (`REVIEW_REQUIRED_BULLDOZER`). |
| `bulldozer-resend.jsonl` | Bulldozer primary receives `VERDICT: GO` from Zen child, but subsequently calls `send_message` to the child and terminates before a new verdict is observed. Expected gate decision: `continue` (`REVIEW_PENDING`). |
| `piledriver-go.jsonl` | Piledriver planning primary identified via banner (`NTG_ROLE: piledriver`). Invokes Zen reviewer on plan, receives `VERDICT: GO`, and terminates with `PLAN READY`. Expected gate decision: `stop`. |
| `excavator-stale.jsonl` | Excavator troubleshooting primary (`NTG_ROLE: excavator`) receives `VERDICT: GO` from Zen, but then mutates files (`write_to_file`) and attempts to terminate with `READY` without re-verifying. Expected gate decision: `continue` (`REVIEW_STALE`). |
| `excavator-ps-marker.jsonl` | Excavator session without response banner, identified via PowerShell marker command `$env:NTG_EXCAVATOR='1'; ...`. Attempts to terminate with `READY` without Zen review. Expected gate decision: `continue` (`REVIEW_REQUIRED`). |
| `excavator-go-fresh.jsonl` | Excavator modifies code via `write_to_file`, then invokes Zen for review, receives `VERDICT: GO`, and terminates with `READY` (no subsequent mutations). Expected gate decision: `stop`. |
| `multi-invoke.jsonl` | Single `invoke_subagent` call launching two subagents concurrently (`[jaguar, zen]`). Verifies `pairInvokeResults` mapping index 0 to `jaguar-child-101` and index 1 to `zen-child-102`. |
| `subagent-jaguar.jsonl` | Subagent transcript starting with `SYSTEM_MESSAGE` where `content=` starts with `NTG_ROLE: jaguar`. Verifies Channel 3 attribution (`firstInboundText` and `inboundRole`). |
| `truncated/transcript.jsonl` & `truncated/transcript_full.jsonl` | Verifies hub truncation handling. The compact `transcript.jsonl` has the Zen `VERDICT: GO` line truncated (`truncated_fields: ["content"]`). `readTranscript` must automatically substitute the full record from sibling `transcript_full.jsonl` by `step_index`, restoring the verdict. |
