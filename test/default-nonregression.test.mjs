/**
 * test/default-nonregression.test.mjs
 * Proves IS-1: Default session has 0 regression.
 *
 * Injects test/fixtures/hub-2.21.0/default-ready.jsonl into all 5 hooks:
 * - zen-shell-guard.mjs: returns allow, reason "Outside the Zen-marked boundary"
 * - excavator-shell-guard.mjs: returns allow
 * - mcp-role-guard.mjs: returns allow, reason contains "Not a read-only"
 * - primary-review-gate.mjs: returns stop (fail-open for non-primary)
 * - excavator-review-gate.mjs: returns stop (pass-through for non-excavator)
 *
 * Verifies that in an unmarked Default session, NO hook blocks or alters model execution.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { evaluate as evaluateZenShellGuard } from '../plugin/hooks/zen-shell-guard.mjs';
import { evaluate as evaluateExcavatorShellGuard } from '../plugin/hooks/excavator-shell-guard.mjs';
import { evaluate as evaluateMcpRoleGuard } from '../plugin/hooks/mcp-role-guard.mjs';
import { evaluate as evaluatePrimaryReviewGate } from '../plugin/hooks/primary-review-gate.mjs';
import { evaluate as evaluateExcavatorReviewGate } from '../plugin/hooks/excavator-review-gate.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const FIXTURE_PATH = path.resolve(repoRoot, 'test/fixtures/hub-2.21.0/default-ready.jsonl');

const HOOK_SCRIPTS = {
  zenShellGuard: path.resolve(repoRoot, 'plugin/hooks/zen-shell-guard.mjs'),
  excavatorShellGuard: path.resolve(repoRoot, 'plugin/hooks/excavator-shell-guard.mjs'),
  mcpRoleGuard: path.resolve(repoRoot, 'plugin/hooks/mcp-role-guard.mjs'),
  primaryReviewGate: path.resolve(repoRoot, 'plugin/hooks/primary-review-gate.mjs'),
  excavatorReviewGate: path.resolve(repoRoot, 'plugin/hooks/excavator-review-gate.mjs'),
};

function runHookCli(scriptPath, payload) {
  const res = spawnSync(process.execPath, [scriptPath], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    cwd: path.resolve(repoRoot, 'plugin'),
    timeout: 10000,
  });
  assert.equal(res.status, 0, `CLI failed with code ${res.status}: ${res.stderr}`);
  const stdout = (res.stdout || '').trim();
  assert.ok(stdout.length > 0, `Expected stdout from ${scriptPath}`);
  return JSON.parse(stdout);
}

// ---------------------------------------------------------------------------
// 1. Direct evaluate() tests on Default session fixture
// ---------------------------------------------------------------------------

test('IS-1 / zen-shell-guard: returns allow with "Outside the Zen-marked boundary"', () => {
  const payload = {
    toolCall: {
      name: 'run_command',
      args: {
        CommandLine: 'dir',
      },
    },
    transcriptPath: FIXTURE_PATH,
  };

  const res = evaluateZenShellGuard(payload);
  assert.equal(res.decision, 'allow', 'Zen shell guard must allow unmarked shell command');
  assert.equal(res.reason, 'Outside the Zen-marked boundary');
});

test('IS-1 / excavator-shell-guard: returns allow on unmarked shell command', () => {
  const payload = {
    toolCall: {
      name: 'run_command',
      args: {
        CommandLine: 'dir',
      },
    },
    transcriptPath: FIXTURE_PATH,
  };

  const res = evaluateExcavatorShellGuard(payload);
  assert.equal(res.decision, 'allow', 'Excavator shell guard must allow unmarked command');
});

test('IS-1 / mcp-role-guard: returns allow with reason containing "Not a read-only"', () => {
  const payloadCallMcp = {
    toolCall: {
      name: 'call_mcp_tool',
      args: {
        ServerName: 'lazyantigravity_workspace',
        ToolName: 'blackboard_set',
      },
    },
    transcriptPath: FIXTURE_PATH,
  };

  const res1 = evaluateMcpRoleGuard(payloadCallMcp);
  assert.equal(res1.decision, 'allow', 'MCP role guard must allow default non-read-only session');
  assert.match(
    res1.reason,
    /Not a read-only/i,
    'Reason must contain "Not a read-only"'
  );

  const payloadMcpPrefix = {
    toolCall: {
      name: 'mcp_lazyantigravity_workspace_blackboard_set',
      args: {
        Key: 'test',
        Value: 'test',
      },
    },
    transcriptPath: FIXTURE_PATH,
  };

  const res2 = evaluateMcpRoleGuard(payloadMcpPrefix);
  assert.equal(res2.decision, 'allow');
  assert.match(res2.reason, /Not a read-only/i);
});

test('IS-1 / primary-review-gate: returns stop (fail-open for non-primary)', () => {
  const payload = {
    executionNum: 0,
    terminationReason: 'NO_TOOL_CALL',
    error: '',
    fullyIdle: true,
    transcriptPath: FIXTURE_PATH,
  };

  const res = evaluatePrimaryReviewGate(payload);
  assert.equal(res.decision, 'stop', 'Primary review gate must let default session stop normally');
});

test('IS-1 / excavator-review-gate: returns stop (pass-through for non-excavator)', () => {
  const payload = {
    executionNum: 0,
    terminationReason: 'NO_TOOL_CALL',
    error: '',
    fullyIdle: true,
    transcriptPath: FIXTURE_PATH,
  };

  const res = evaluateExcavatorReviewGate(payload);
  assert.equal(res.decision, 'stop', 'Excavator review gate must pass through non-excavator session');
});

// ---------------------------------------------------------------------------
// 2. CLI process invocation tests (full end-to-end stdin/stdout)
// ---------------------------------------------------------------------------

test('IS-1 CLI / zen-shell-guard CLI returns allow on default session', () => {
  const payload = {
    toolCall: { name: 'run_command', args: { CommandLine: 'dir' } },
    transcriptPath: FIXTURE_PATH,
  };
  const res = runHookCli(HOOK_SCRIPTS.zenShellGuard, payload);
  assert.equal(res.decision, 'allow');
  assert.equal(res.reason, 'Outside the Zen-marked boundary');
});

test('IS-1 CLI / excavator-shell-guard CLI returns allow on default session', () => {
  const payload = {
    toolCall: { name: 'run_command', args: { CommandLine: 'dir' } },
    transcriptPath: FIXTURE_PATH,
  };
  const res = runHookCli(HOOK_SCRIPTS.excavatorShellGuard, payload);
  assert.equal(res.decision, 'allow');
});

test('IS-1 CLI / mcp-role-guard CLI returns allow on default session', () => {
  const payload = {
    toolCall: { name: 'call_mcp_tool', args: { ServerName: 'test', ToolName: 'test' } },
    transcriptPath: FIXTURE_PATH,
  };
  const res = runHookCli(HOOK_SCRIPTS.mcpRoleGuard, payload);
  assert.equal(res.decision, 'allow');
  assert.match(res.reason, /Not a read-only/i);
});

test('IS-1 CLI / primary-review-gate CLI returns stop on default session', () => {
  const payload = {
    executionNum: 0,
    terminationReason: 'NO_TOOL_CALL',
    error: '',
    fullyIdle: true,
    transcriptPath: FIXTURE_PATH,
  };
  const res = runHookCli(HOOK_SCRIPTS.primaryReviewGate, payload);
  assert.equal(res.decision, 'stop');
});

test('IS-1 CLI / excavator-review-gate CLI returns stop on default session', () => {
  const payload = {
    executionNum: 0,
    terminationReason: 'NO_TOOL_CALL',
    error: '',
    fullyIdle: true,
    transcriptPath: FIXTURE_PATH,
  };
  const res = runHookCli(HOOK_SCRIPTS.excavatorReviewGate, payload);
  assert.equal(res.decision, 'stop');
});

// ---------------------------------------------------------------------------
// 3. System-wide IS-1 verification: No hook blocks or alters model execution
// ---------------------------------------------------------------------------

test('IS-1: In an unmarked Default session, NO hook blocks or alters model execution', () => {
  const preToolEvents = [
    {
      hook: evaluateZenShellGuard,
      name: 'zen-shell-guard',
      payload: {
        toolCall: { name: 'run_command', args: { CommandLine: 'git status' } },
        transcriptPath: FIXTURE_PATH,
      },
    },
    {
      hook: evaluateExcavatorShellGuard,
      name: 'excavator-shell-guard',
      payload: {
        toolCall: { name: 'run_command', args: { CommandLine: 'git status' } },
        transcriptPath: FIXTURE_PATH,
      },
    },
    {
      hook: evaluateMcpRoleGuard,
      name: 'mcp-role-guard',
      payload: {
        toolCall: { name: 'call_mcp_tool', args: { ServerName: 'lazyothers_context7', ToolName: 'query-docs' } },
        transcriptPath: FIXTURE_PATH,
      },
    },
  ];

  for (const { hook, name, payload } of preToolEvents) {
    const res = hook(payload);
    assert.equal(
      res.decision,
      'allow',
      `${name} must return 'allow' in Default session (got '${res.decision}')`
    );
  }

  const stopEvents = [
    {
      hook: evaluatePrimaryReviewGate,
      name: 'primary-review-gate',
      payload: {
        executionNum: 0,
        terminationReason: 'NO_TOOL_CALL',
        error: '',
        fullyIdle: true,
        transcriptPath: FIXTURE_PATH,
      },
    },
    {
      hook: evaluateExcavatorReviewGate,
      name: 'excavator-review-gate',
      payload: {
        executionNum: 0,
        terminationReason: 'NO_TOOL_CALL',
        error: '',
        fullyIdle: true,
        transcriptPath: FIXTURE_PATH,
      },
    },
  ];

  for (const { hook, name, payload } of stopEvents) {
    const res = hook(payload);
    assert.equal(
      res.decision,
      'stop',
      `${name} must return 'stop' in Default session (got '${res.decision}', should never continue)`
    );
  }
});
