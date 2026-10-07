import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import {
  evaluate,
  REVIEW_PENDING,
  REVIEW_REQUIRED_BULLDOZER,
  REVIEW_REQUIRED_PILEDRIVER,
  REVIEW_NO_GO,
  REVIEW_NO_VERDICT,
  CONTRADICTORY,
} from '../plugin/hooks/primary-review-gate.mjs';
import { findPython } from './helpers/python.mjs';

const ZEN_ID = '9fc98728-eb32-45d5-a643-2809d0e0d5f4';
const OTHER_ID = '11111111-2222-3333-4444-555555555555';
const UPSTREAM_ROOT = 'C:/Users/Daeryun/.gemini/antigravity/scratch/native-gravity';

function runGate(
  records,
  {
    fullyIdle = true,
    terminationReason = 'NO_TOOL_CALL',
    error = '',
    extraEvent = null,
  } = {}
) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-gate-test-'));
  const transcriptPath = path.join(tmpDir, 'transcript.jsonl');
  try {
    fs.writeFileSync(
      transcriptPath,
      records.map((r) => JSON.stringify(r) + '\n').join(''),
      'utf8'
    );
    const event = {
      executionNum: 0,
      terminationReason,
      error,
      fullyIdle,
      transcriptPath,
      ...(extraEvent || {}),
    };
    return evaluate(event);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function identity(role) {
  return { agentName: role };
}

function assistant(text) {
  return { message: { role: 'assistant', content: text } };
}

function wireAssistant(text, step = 9) {
  return {
    step_index: step,
    source: 'MODEL',
    type: 'PLANNER_RESPONSE',
    status: 'DONE',
    content: text,
  };
}

function zenCall() {
  return {
    step_index: 1,
    source: 'MODEL',
    type: 'PLANNER_RESPONSE',
    status: 'DONE',
    tool_calls: [
      {
        name: 'invoke_subagent',
        args: {
          Subagents: JSON.stringify([
            {
              TypeName: 'zen',
              Role: 'independent completion reviewer',
              Prompt: 'Review and return VERDICT: GO or VERDICT: NO-GO.',
            },
          ]),
        },
      },
    ],
  };
}

function zenCreated(convId = ZEN_ID) {
  return {
    step_index: 2,
    source: 'MODEL',
    type: 'GENERIC',
    status: 'DONE',
    content:
      'Created At: now\nCompleted At: now\nCreated the following subagents:\n' +
      '{\n' +
      `  "conversationId": "${convId}",\n` +
      '  "logAbsoluteUri": "file:///tmp/zen.jsonl"\n' +
      '}\nThe subagents will send you a message when they have completed their task.',
  };
}

function providerVerdict(value = 'GO', sender = ZEN_ID) {
  return {
    step_index: 3,
    source: 'SYSTEM',
    type: 'SYSTEM_MESSAGE',
    status: 'DONE',
    content:
      'The following is a <SYSTEM_MESSAGE> not actually sent by the user.\n' +
      '<SYSTEM_MESSAGE>\n' +
      `[Message] timestamp=now sender=${sender} priority=MESSAGE_PRIORITY_HIGH content=VERDICT: ${value}\n` +
      '</SYSTEM_MESSAGE>',
  };
}

function freshReviewMessage(convId = ZEN_ID) {
  return {
    step_index: 4,
    source: 'MODEL',
    type: 'PLANNER_RESPONSE',
    status: 'DONE',
    tool_calls: [
      {
        name: 'send_message',
        args: {
          ConversationId: convId,
          Message: 'Please perform a fresh review and issue your verdict.',
        },
      },
    ],
  };
}

function unrelatedToolVerdict() {
  return { message: { role: 'tool', content: 'VERDICT: GO' } };
}

// ---------------------------------------------------------------------------
// Upstream Python test vectors (1-31)
// ---------------------------------------------------------------------------

test('test_non_target_agent_is_unaffected', () => {
  assert.equal(runGate([identity('excavator'), assistant('READY')]).decision, 'stop');
});

test('test_bulldozer_ready_without_review_continues', () => {
  const result = runGate([identity('bulldozer'), assistant('READY')]);
  assert.equal(result.decision, 'continue');
  assert.ok(result.reason.includes('Zen'));
});

test('test_bulldozer_review_started_without_verdict_continues', () => {
  const result = runGate([identity('bulldozer'), zenCall(), zenCreated(), assistant('READY')]);
  assert.equal(result.decision, 'continue');
  assert.ok(result.reason.includes('pending'));
});

test('test_bulldozer_correlated_go_allows_ready', () => {
  const result = runGate([
    identity('bulldozer'),
    zenCall(),
    zenCreated(),
    providerVerdict(),
    assistant('READY'),
  ]);
  assert.equal(result.decision, 'stop');
});

test('test_bulldozer_wrong_sender_go_does_not_count', () => {
  const result = runGate([
    identity('bulldozer'),
    zenCall(),
    zenCreated(),
    providerVerdict('GO', OTHER_ID),
    assistant('READY'),
  ]);
  assert.equal(result.decision, 'continue');
});

test('test_bulldozer_self_reported_go_does_not_count', () => {
  const result = runGate([
    identity('bulldozer'),
    zenCall(),
    zenCreated(),
    assistant('Zen VERDICT: GO\nREADY'),
  ]);
  assert.equal(result.decision, 'continue');
});

test('test_bulldozer_unrelated_tool_go_does_not_count', () => {
  const result = runGate([
    identity('bulldozer'),
    zenCall(),
    zenCreated(),
    unrelatedToolVerdict(),
    assistant('READY'),
  ]);
  assert.equal(result.decision, 'continue');
});

test('test_fresh_send_message_invalidates_old_go_until_response', () => {
  const result = runGate([
    identity('bulldozer'),
    zenCall(),
    zenCreated(),
    providerVerdict(),
    freshReviewMessage(),
    assistant('READY'),
  ]);
  assert.equal(result.decision, 'continue');
  assert.ok(result.reason.includes('pending'));
});

test('test_fresh_send_message_then_correlated_go_allows_ready', () => {
  const result = runGate([
    identity('bulldozer'),
    zenCall(),
    zenCreated(),
    providerVerdict(),
    freshReviewMessage(),
    providerVerdict(),
    assistant('READY'),
  ]);
  assert.equal(result.decision, 'stop');
});

test('test_pending_review_blocks_even_nonterminal_stop', () => {
  const result = runGate([
    identity('bulldozer'),
    zenCall(),
    zenCreated(),
    assistant('I have requested the reviewer and will wait for the verdict.'),
  ]);
  assert.equal(result.decision, 'continue');
});

test('test_bulldozer_no_go_blocks_ready', () => {
  const result = runGate([
    identity('bulldozer'),
    zenCall(),
    zenCreated(),
    providerVerdict('NO-GO'),
    assistant('READY'),
  ]);
  assert.equal(result.decision, 'continue');
  assert.ok(result.reason.includes('NO-GO'));
});

test('test_bulldozer_progress_without_review_may_stop', () => {
  assert.equal(
    runGate([identity('bulldozer'), assistant('Need user input before continuing.')]).decision,
    'stop'
  );
});

test('test_bulldozer_blocked_may_stop', () => {
  assert.equal(runGate([identity('bulldozer'), assistant('BLOCKED')]).decision, 'stop');
});

test('test_bulldozer_ready_and_blocked_is_rejected', () => {
  const result = runGate([identity('bulldozer'), assistant('READY\nBLOCKED')]);
  assert.equal(result.decision, 'continue');
});

test('test_piledriver_plan_ready_without_review_continues', () => {
  const result = runGate([identity('piledriver'), assistant('PLAN_STATUS: READY\nPLAN READY')]);
  assert.equal(result.decision, 'continue');
});

test('test_piledriver_correlated_go_allows_plan_ready', () => {
  const result = runGate([
    identity('piledriver'),
    zenCall(),
    zenCreated(),
    providerVerdict(),
    assistant('PLAN_STATUS: READY\nPLAN READY'),
  ]);
  assert.equal(result.decision, 'stop');
});

test('test_piledriver_newer_invocation_invalidates_old_go', () => {
  const result = runGate([
    identity('piledriver'),
    zenCall(),
    zenCreated(),
    providerVerdict(),
    zenCall(),
    zenCreated(OTHER_ID),
    assistant('PLAN_STATUS: READY\nPLAN READY'),
  ]);
  assert.equal(result.decision, 'continue');
});

test('test_piledriver_needs_discovery_may_stop', () => {
  const result = runGate([
    identity('piledriver'),
    assistant('PLAN_STATUS: NEEDS_DISCOVERY'),
  ]);
  assert.equal(result.decision, 'stop');
});

test('test_piledriver_blocked_may_stop', () => {
  const result = runGate([identity('piledriver'), assistant('PLAN_STATUS: BLOCKED')]);
  assert.equal(result.decision, 'stop');
});

test('test_system_prompt_can_scope_bulldozer', () => {
  const result = runGate([
    {
      role: 'system',
      content: "You are Bulldozer, Native Gravity's general Host and orchestrator.",
    },
    assistant('READY'),
  ]);
  assert.equal(result.decision, 'continue');
});

test('test_system_prompt_can_scope_piledriver', () => {
  const result = runGate([
    {
      role: 'system',
      content: "You are Piledriver, Native Gravity's plan-first primary agent.",
    },
    assistant('PLAN READY'),
  ]);
  assert.equal(result.decision, 'continue');
});

test('test_role_hint_event_field_scopes_role', () => {
  const result = runGate([assistant('READY')], { extraEvent: { roleHint: 'bulldozer' } });
  assert.equal(result.decision, 'continue');
  assert.ok(result.reason.includes('Zen'));
});

test('test_agent_name_event_field_scopes_role', () => {
  const result = runGate([assistant('PLAN READY')], {
    extraEvent: { agentName: 'piledriver' },
  });
  assert.equal(result.decision, 'continue');
  assert.ok(result.reason.includes('Zen'));
});

test('test_ntg_role_marker_in_first_user_input_scopes_role', () => {
  const records = [
    {
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      content: 'NTG_ROLE: bulldozer\nDo the thing.',
    },
    wireAssistant('READY'),
  ];
  const result = runGate(records);
  assert.equal(result.decision, 'continue');
  assert.ok(result.reason.includes('Zen'));
});

test('test_ntg_role_marker_in_later_user_input_does_not_scope', () => {
  const records = [
    { source: 'USER_EXPLICIT', type: 'USER_INPUT', content: 'Do the thing.' },
    wireAssistant('progress'),
    { source: 'USER_EXPLICIT', type: 'USER_INPUT', content: 'NTG_ROLE: bulldozer' },
    wireAssistant('READY'),
  ];
  const result = runGate(records);
  assert.equal(result.decision, 'stop');
});

test('test_runner_role_heading_scopes_role', () => {
  const records = [
    {
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      content: '## Role\nbulldozer\n\n## Role Body\nstub\n\n## Task\nDo it.',
    },
    wireAssistant('READY'),
  ];
  const result = runGate(records);
  assert.equal(result.decision, 'continue');
  assert.ok(result.reason.includes('Zen'));
});

test('test_runner_role_heading_with_non_gated_role_stays_out', () => {
  const records = [
    {
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      content: '## Role\nsteamroller\n\n## Task\nScan it.',
    },
    wireAssistant('DONE'),
  ];
  const result = runGate(records);
  assert.equal(result.decision, 'stop');
});

test('test_unknown_role_hint_falls_through_to_transcript', () => {
  const records = [identity('bulldozer'), assistant('READY')];
  const result = runGate(records, { extraEvent: { roleHint: 'zen' } });
  assert.equal(result.decision, 'continue');
});

test('test_no_role_anywhere_still_stops', () => {
  const result = runGate([wireAssistant('READY')]);
  assert.equal(result.decision, 'stop');
});

test('test_abnormal_termination_fails_open', () => {
  const result = runGate([identity('bulldozer'), assistant('READY')], {
    terminationReason: 'error',
    error: 'boom',
  });
  assert.equal(result.decision, 'stop');
});

test('test_non_idle_ready_continues', () => {
  const result = runGate(
    [
      identity('bulldozer'),
      zenCall(),
      zenCreated(),
      providerVerdict(),
      assistant('READY'),
    ],
    { fullyIdle: false }
  );
  assert.equal(result.decision, 'continue');
});

// ---------------------------------------------------------------------------
// HooksJsonPathsTest ported (32, 33)
// ---------------------------------------------------------------------------

function getRegisteredHookCommands() {
  const localHooks = path.resolve('plugin/hooks.json');
  const upstreamHooks = path.join(UPSTREAM_ROOT, 'hooks.json');
  const targetFile = fs.existsSync(localHooks) ? localHooks : upstreamHooks;
  const rootDir = fs.existsSync(localHooks) ? path.resolve('plugin') : UPSTREAM_ROOT;

  if (!fs.existsSync(targetFile)) {
    return { rootDir, commands: [] };
  }

  const hooks = JSON.parse(fs.readFileSync(targetFile, 'utf8'));
  const commands = [];
  for (const [name, block] of Object.entries(hooks)) {
    for (const [event, entries] of Object.entries(block)) {
      for (const entry of entries) {
        if (entry.command) {
          commands.push({ name, event, cmd: entry.command });
        }
        for (const hook of entry.hooks || []) {
          if (hook.command) {
            commands.push({ name, event, cmd: hook.command });
          }
        }
      }
    }
  }
  return { rootDir, commands };
}

test('test_hook_commands_use_repo_relative_paths', () => {
  const { rootDir, commands } = getRegisteredHookCommands();
  assert.ok(commands.length >= 4, 'Should register at least 4 hooks');
  for (const { name, cmd } of commands) {
    const words = cmd.trim().split(/\s+/);
    assert.ok(
      words[0] === 'python3' || words[0] === 'python' || words[0] === 'node',
      `${name}: interpreter should be python or node, got ${words[0]}`
    );
    assert.ok(
      words[1].startsWith('./') || words[1].startsWith('hooks/'),
      `${name}: path should be relative, got ${words[1]}`
    );
    assert.ok(!words[1].startsWith('/'), `${name}: path must not be absolute`);
    const resolved = path.resolve(rootDir, words[1]);
    assert.ok(fs.existsSync(resolved), `${name}: file must exist at ${resolved}`);
  }
});

test('test_registered_commands_execute_from_plugin_root', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-root-exec-'));
  const transcriptPath = path.join(tmpDir, 'transcript.jsonl');
  fs.writeFileSync(
    transcriptPath,
    JSON.stringify(identity('zen')) + '\n',
    'utf8'
  );

  const stopEvent = {
    executionNum: 0,
    terminationReason: 'NO_TOOL_CALL',
    error: '',
    fullyIdle: true,
    transcriptPath,
  };
  const toolEvent = {
    toolCall: { name: 'run_command', args: { CommandLine: 'pwd' } },
  };

  try {
    // Test the Node.js primary-review-gate hook CLI execution directly
    const nodeGatePath = path.resolve('plugin/hooks/primary-review-gate.mjs');
    const nodeRun = spawnSync(process.execPath, [nodeGatePath], {
      input: JSON.stringify(stopEvent),
      encoding: 'utf8',
      cwd: path.resolve('plugin'),
      timeout: 10000,
    });
    assert.equal(nodeRun.status, 0);
    const nodeDec = JSON.parse(nodeRun.stdout.trim());
    assert.ok('decision' in nodeDec);

    // Also verify upstream hook commands if Python is available
    const { rootDir, commands } = getRegisteredHookCommands();
    const py = findPython();
    if (py && commands.length > 0) {
      for (const { name, event, cmd } of commands) {
        const payload = event === 'PreToolUse' ? toolEvent : stopEvent;
        const words = cmd.trim().split(/\s+/);
        const execPath = words[0].startsWith('python') ? py : process.execPath;
        const args = [words[1]];
        const res = spawnSync(execPath, args, {
          input: JSON.stringify(payload),
          encoding: 'utf8',
          cwd: rootDir,
          timeout: 10000,
        });
        assert.equal(res.status, 0, `${name}: ${res.stderr}`);
        const decision = JSON.parse(res.stdout.trim());
        assert.ok('decision' in decision, `${name} output must contain decision`);
      }
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Hub-2.21.0 Fixture Tests
// ---------------------------------------------------------------------------

test('fixture: default-ready.jsonl -> stop (fail open / not a primary)', () => {
  const fixturePath = path.resolve('test/fixtures/hub-2.21.0/default-ready.jsonl');
  const res = evaluate({
    transcriptPath: fixturePath,
    terminationReason: 'NO_TOOL_CALL',
    fullyIdle: true,
  });
  assert.equal(res.decision, 'stop');
});

test('fixture: bulldozer-go.jsonl -> stop', () => {
  const fixturePath = path.resolve('test/fixtures/hub-2.21.0/bulldozer-go.jsonl');
  const res = evaluate({
    transcriptPath: fixturePath,
    terminationReason: 'NO_TOOL_CALL',
    fullyIdle: true,
  });
  assert.equal(res.decision, 'stop');
});

test('fixture: bulldozer-nogo.jsonl -> continue (REVIEW_NO_GO)', () => {
  const fixturePath = path.resolve('test/fixtures/hub-2.21.0/bulldozer-nogo.jsonl');
  const res = evaluate({
    transcriptPath: fixturePath,
    terminationReason: 'NO_TOOL_CALL',
    fullyIdle: true,
  });
  assert.equal(res.decision, 'continue');
  assert.equal(res.reason, REVIEW_NO_GO);
});

test('fixture: bulldozer-no-zen.jsonl -> continue (REVIEW_REQUIRED_BULLDOZER)', () => {
  const fixturePath = path.resolve('test/fixtures/hub-2.21.0/bulldozer-no-zen.jsonl');
  const res = evaluate({
    transcriptPath: fixturePath,
    terminationReason: 'NO_TOOL_CALL',
    fullyIdle: true,
  });
  assert.equal(res.decision, 'continue');
  assert.equal(res.reason, REVIEW_REQUIRED_BULLDOZER);
});

test('fixture: bulldozer-resend.jsonl -> continue (REVIEW_PENDING)', () => {
  const fixturePath = path.resolve('test/fixtures/hub-2.21.0/bulldozer-resend.jsonl');
  const res = evaluate({
    transcriptPath: fixturePath,
    terminationReason: 'NO_TOOL_CALL',
    fullyIdle: true,
  });
  assert.equal(res.decision, 'continue');
  assert.equal(res.reason, REVIEW_PENDING);
});

test('fixture: piledriver-go.jsonl -> stop', () => {
  const fixturePath = path.resolve('test/fixtures/hub-2.21.0/piledriver-go.jsonl');
  const res = evaluate({
    transcriptPath: fixturePath,
    terminationReason: 'NO_TOOL_CALL',
    fullyIdle: true,
  });
  assert.equal(res.decision, 'stop');
});

test('fixture: multi-invoke.jsonl -> correct zen child pairing', () => {
  const fixturePath = path.resolve('test/fixtures/hub-2.21.0/multi-invoke.jsonl');
  const res = evaluate({
    transcriptPath: fixturePath,
    terminationReason: 'NO_TOOL_CALL',
    fullyIdle: true,
  });
  assert.equal(res.decision, 'stop');
});
