import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  evaluate,
  detectRole,
  isReadOnlyRole,
  parseToolTarget,
  extractCommand,
  isZenGitReadCommand,
  isAllowedMcpTool,
  MATCHER,
} from '../plugin/hooks/mcp-role-guard.mjs';

const SCRIPT_PATH = path.resolve('plugin/hooks/mcp-role-guard.mjs');
const FIXTURES_DIR = path.resolve('test/fixtures/hub-2.21.0');

test('MATCHER regex matches MCP tool call names and rejects non-MCP tools', () => {
  assert.ok(MATCHER.test('call_mcp_tool'));
  assert.ok(MATCHER.test('mcp_tool'));
  assert.ok(MATCHER.test('mcp_lazyantigravity_ast_grep_ast_grep_search'));
  assert.ok(MATCHER.test('mcp_lazyothers_context7_query-docs'));

  assert.ok(!MATCHER.test('run_command'));
  assert.ok(!MATCHER.test('view_file'));
  assert.ok(!MATCHER.test('replace_file_content'));
});

test('No role or unknown role -> allow', () => {
  // No role specified anywhere
  const resNoRole = evaluate({
    toolCall: {
      name: 'call_mcp_tool',
      args: {
        ServerName: 'lazyantigravity_workspace',
        ToolName: 'blackboard_set',
      },
    },
  });
  assert.equal(resNoRole.decision, 'allow');
  assert.equal(resNoRole.reason, 'Not a read-only Native Gravity role');

  // Unknown role specified
  const resUnknownRole = evaluate({
    roleHint: 'unknown-agent-custom',
    toolCall: {
      name: 'call_mcp_tool',
      args: {
        ServerName: 'lazyantigravity_ast_grep',
        ToolName: 'ast_grep_replace',
      },
    },
  });
  assert.equal(resUnknownRole.decision, 'allow');
  assert.equal(resUnknownRole.reason, 'Not a read-only Native Gravity role');

  // Fixture with default agent (no role banner)
  const resDefaultFixture = evaluate({
    transcriptPath: path.join(FIXTURES_DIR, 'default-ready.jsonl'),
    toolCall: {
      name: 'call_mcp_tool',
      args: {
        ServerName: 'lazyantigravity_workspace',
        ToolName: 'session_tree_fork',
      },
    },
  });
  assert.equal(resDefaultFixture.decision, 'allow');
  assert.equal(resDefaultFixture.reason, 'Not a read-only Native Gravity role');
});

test('Excavator / Bobcat / Bulldozer roles -> allow (mutating roles)', () => {
  const mutatingRoles = ['excavator', 'bobcat', 'bulldozer', 'puma'];

  for (const role of mutatingRoles) {
    const res = evaluate({
      roleHint: role,
      toolCall: {
        name: 'call_mcp_tool',
        args: {
          ServerName: 'lazyantigravity_workspace',
          ToolName: 'blackboard_set',
          Arguments: { key: 'status', value: 'in-progress' },
        },
      },
    });
    assert.equal(res.decision, 'allow', `Expected role ${role} to be allowed`);
    assert.equal(res.reason, 'Not a read-only Native Gravity role');
  }

  // Fixture: bulldozer-go.jsonl has NTG_ROLE: bulldozer
  const resBulldozerFixture = evaluate({
    transcriptPath: path.join(FIXTURES_DIR, 'bulldozer-go.jsonl'),
    toolCall: {
      name: 'call_mcp_tool',
      args: {
        ServerName: 'lazyantigravity_ast_grep',
        ToolName: 'ast_grep_replace',
      },
    },
  });
  assert.equal(resBulldozerFixture.decision, 'allow');
  assert.equal(resBulldozerFixture.reason, 'Not a read-only Native Gravity role');

  // Fixture: excavator-go-fresh.jsonl has NTG_ROLE: excavator
  const resExcavatorFixture = evaluate({
    transcriptPath: path.join(FIXTURES_DIR, 'excavator-go-fresh.jsonl'),
    toolCall: {
      name: 'call_mcp_tool',
      args: {
        ServerName: 'lazyantigravity_media',
        ToolName: 'media_cleanup',
      },
    },
  });
  assert.equal(resExcavatorFixture.decision, 'allow');
  assert.equal(resExcavatorFixture.reason, 'Not a read-only Native Gravity role');
});

test('Read-only roles calling read-only tools -> allow', () => {
  const readOnlyCases = [
    {
      role: 'jaguar',
      server: 'lazyantigravity_ast_grep',
      tool: 'ast_grep_search',
    },
    {
      role: 'zen',
      server: 'lazyantigravity_lsp',
      tool: 'lsp_definitions',
    },
    {
      role: 'steamroller',
      server: 'lazyantigravity_research',
      tool: 'web_search',
    },
    {
      role: 'strix-halo',
      server: 'lazyothers_context7',
      tool: 'query-docs',
    },
    {
      role: 'piledriver',
      server: 'lazyantigravity_ast_index',
      tool: 'ast_index_find',
    },
    {
      role: 'zen',
      server: 'lazyantigravity_workspace',
      tool: 'memory_search',
    },
    {
      role: 'zen',
      server: 'lazyantigravity_workspace',
      tool: 'blackboard_get',
    },
    {
      role: 'zen',
      server: 'lazyantigravity_workspace',
      tool: 'blackboard_list',
    },
    {
      role: 'zen',
      server: 'lazyantigravity_workspace',
      tool: 'session_tree_render',
    },
    {
      role: 'jaguar',
      server: 'lazyantigravity_media',
      tool: 'media_probe',
    },
    {
      role: 'jaguar',
      server: 'lazyantigravity_media',
      tool: 'media_ocr',
    },
    {
      role: 'jaguar',
      server: 'lazyantigravity_media',
      tool: 'media_transcribe',
    },
    {
      role: 'jaguar',
      server: 'lazyantigravity_media',
      tool: 'media_transcribe_status',
    },
    {
      role: 'steamroller',
      server: 'lazyantigravity_korean_law_offline',
      tool: 'lookup_statute',
    },
    {
      role: 'steamroller',
      server: 'lazyothers_sequential-thinking',
      tool: 'sequentialthinking',
    },
  ];

  for (const { role, server, tool } of readOnlyCases) {
    // Via call_mcp_tool
    const resCallMcp = evaluate({
      roleHint: role,
      toolCall: {
        name: 'call_mcp_tool',
        args: { ServerName: server, ToolName: tool },
      },
    });
    assert.equal(resCallMcp.decision, 'allow', `Expected ${role} calling ${server}:${tool} to be allowed`);
    assert.equal(resCallMcp.reason, `Read-only MCP tool permitted for ${role}`);

    // Via mcp_<server>_<tool> name format
    const resPrefixed = evaluate({
      roleHint: role,
      toolCall: {
        name: `mcp_${server}_${tool}`,
        args: {},
      },
    });
    assert.equal(resPrefixed.decision, 'allow', `Expected ${role} calling mcp_${server}_${tool} to be allowed`);
    assert.equal(resPrefixed.reason, `Read-only MCP tool permitted for ${role}`);
  }
});

test('Read-only roles calling mutating tools -> deny', () => {
  const mutatingCases = [
    {
      role: 'zen',
      server: 'lazyantigravity_ast_grep',
      tool: 'ast_grep_replace',
    },
    {
      role: 'jaguar',
      server: 'lazyantigravity_workspace',
      tool: 'blackboard_set',
    },
    {
      role: 'steamroller',
      server: 'lazyantigravity_workspace',
      tool: 'session_tree_fork',
    },
    {
      role: 'piledriver',
      server: 'lazyantigravity_media',
      tool: 'media_cleanup',
    },
    {
      role: 'strix-halo',
      server: 'lazyantigravity_ast_index',
      tool: 'ast_index_scan',
    },
    {
      role: 'zen',
      server: 'lazyothers_playwright',
      tool: 'browser_click',
    },
    {
      role: 'jaguar',
      server: 'lazyothers_kordoc',
      tool: 'patch_document',
    },
  ];

  for (const { role, server, tool } of mutatingCases) {
    // Via call_mcp_tool
    const resCallMcp = evaluate({
      roleHint: role,
      toolCall: {
        name: 'call_mcp_tool',
        args: { ServerName: server, ToolName: tool },
      },
    });
    assert.equal(resCallMcp.decision, 'deny', `Expected ${role} calling ${server}:${tool} to be denied`);
    assert.equal(
      resCallMcp.reason,
      `Role ${role} is restricted from mutating MCP tool: ${server}:${tool}`
    );

    // Via mcp_<server>_<tool> name
    const resPrefixed = evaluate({
      roleHint: role,
      toolCall: {
        name: `mcp_${server}_${tool}`,
        args: {},
      },
    });
    assert.equal(resPrefixed.decision, 'deny', `Expected ${role} calling mcp_${server}_${tool} to be denied`);
    assert.equal(
      resPrefixed.reason,
      `Role ${role} is restricted from mutating MCP tool: ${server}:${tool}`
    );
  }
});

test('Read-only roles calling git_bash_execute with git status -> allow; with rm / git commit / touch -> deny', () => {
  const readOnlyRole = 'zen';

  // Allowed git read commands
  const allowedCommands = [
    'git status',
    'git status --short',
    'git status --porcelain',
    'git diff',
    'git diff --cached',
    'git diff HEAD~1',
    'git log --oneline -n 5',
    'git show HEAD',
    'git ls-files',
    'git rev-parse --show-toplevel',
    'git --no-optional-locks status',
  ];

  for (const cmd of allowedCommands) {
    const res = evaluate({
      roleHint: readOnlyRole,
      toolCall: {
        name: 'call_mcp_tool',
        args: {
          ServerName: 'lazyantigravity_git_bash',
          ToolName: 'git_bash_execute',
          Arguments: { command: cmd },
        },
      },
    });
    assert.equal(res.decision, 'allow', `Expected "${cmd}" to be allowed`);
    assert.equal(res.reason, `Read-only MCP tool permitted for ${readOnlyRole}`);
  }

  // Denied mutating/destructive/chained commands
  const deniedCommands = [
    'rm -rf .',
    'rm file.txt',
    'git commit -m "update"',
    'git commit',
    'touch newfile.txt',
    'git push origin main',
    'git checkout branch',
    'git stash',
    'git merge main',
    'git rebase main',
    'git status; rm -rf /',
    'git status && touch bad',
    'git status | grep foo',
    'git status -o output.txt',
    'git status --output=out.txt',
    'echo hello',
    'pwd',
  ];

  for (const cmd of deniedCommands) {
    const res = evaluate({
      roleHint: readOnlyRole,
      toolCall: {
        name: 'call_mcp_tool',
        args: {
          ServerName: 'lazyantigravity_git_bash',
          ToolName: 'git_bash_execute',
          Arguments: { command: cmd },
        },
      },
    });
    assert.equal(res.decision, 'deny', `Expected "${cmd}" to be denied`);
    assert.equal(
      res.reason,
      `Role ${readOnlyRole} is restricted from mutating MCP tool: lazyantigravity_git_bash:git_bash_execute`
    );
  }
});

test('Argument decoding: handles both hub JSON-encoded args and direct object args', () => {
  const role = 'jaguar';

  // Hub JSON-encoded string values in args object
  const hubPayload = {
    roleHint: role,
    toolCall: {
      name: 'call_mcp_tool',
      args: {
        ServerName: '"lazyantigravity_ast_grep"',
        ToolName: '"ast_grep_search"',
        Arguments: '{"query":"function evaluate"}',
      },
    },
  };
  const hubRes = evaluate(hubPayload);
  assert.equal(hubRes.decision, 'allow');
  assert.equal(hubRes.reason, `Read-only MCP tool permitted for ${role}`);

  // Entire args serialized as a JSON string
  const stringArgsPayload = {
    roleHint: role,
    toolCall: {
      name: 'call_mcp_tool',
      args: JSON.stringify({
        ServerName: 'lazyantigravity_ast_grep',
        ToolName: 'ast_grep_search',
        Arguments: { query: 'test' },
      }),
    },
  };
  const stringRes = evaluate(stringArgsPayload);
  assert.equal(stringRes.decision, 'allow');
  assert.equal(stringRes.reason, `Read-only MCP tool permitted for ${role}`);

  // Direct object args
  const directPayload = {
    roleHint: role,
    toolCall: {
      name: 'call_mcp_tool',
      args: {
        ServerName: 'lazyantigravity_ast_grep',
        ToolName: 'ast_grep_search',
        Arguments: { query: 'direct' },
      },
    },
  };
  const directRes = evaluate(directPayload);
  assert.equal(directRes.decision, 'allow');
  assert.equal(directRes.reason, `Read-only MCP tool permitted for ${role}`);

  // Hub JSON-encoded git_bash_execute
  const hubGitBashPayload = {
    roleHint: 'zen',
    toolCall: {
      name: 'call_mcp_tool',
      args: {
        ServerName: '"lazyantigravity_git_bash"',
        ToolName: '"git_bash_execute"',
        Arguments: '{"command":"git status --short"}',
      },
    },
  };
  const hubGitRes = evaluate(hubGitBashPayload);
  assert.equal(hubGitRes.decision, 'allow');
  assert.equal(hubGitRes.reason, 'Read-only MCP tool permitted for zen');

  // Hub JSON-encoded git_bash_execute mutating command denied
  const hubGitMutating = {
    roleHint: 'zen',
    toolCall: {
      name: 'call_mcp_tool',
      args: {
        ServerName: '"lazyantigravity_git_bash"',
        ToolName: '"git_bash_execute"',
        Arguments: '{"command":"git commit -m \\"wip\\""}',
      },
    },
  };
  const hubGitMutatingRes = evaluate(hubGitMutating);
  assert.equal(hubGitMutatingRes.decision, 'deny');
  assert.equal(
    hubGitMutatingRes.reason,
    'Role zen is restricted from mutating MCP tool: lazyantigravity_git_bash:git_bash_execute'
  );
});

test('Role attribution channels prioritization', () => {
  // Channel 1: payload roleHint overrides transcript
  const channel1 = evaluate({
    roleHint: 'zen',
    transcriptPath: path.join(FIXTURES_DIR, 'bulldozer-go.jsonl'), // transcript has bulldozer
    toolCall: {
      name: 'call_mcp_tool',
      args: { ServerName: 'lazyantigravity_ast_grep', ToolName: 'ast_grep_replace' },
    },
  });
  assert.equal(channel1.decision, 'deny');
  assert.equal(channel1.reason, 'Role zen is restricted from mutating MCP tool: lazyantigravity_ast_grep:ast_grep_replace');

  // Channel 2: structured identity keys in transcript
  const channel2Transcript = [
    { type: 'SYSTEM_MESSAGE', agent_name: 'zen', content: 'Init' },
  ];
  const channel2 = evaluate({
    transcript: channel2Transcript,
    toolCall: {
      name: 'call_mcp_tool',
      args: { ServerName: 'lazyantigravity_ast_grep', ToolName: 'ast_grep_replace' },
    },
  });
  assert.equal(channel2.decision, 'deny');
  assert.equal(channel2.reason, 'Role zen is restricted from mutating MCP tool: lazyantigravity_ast_grep:ast_grep_replace');

  // Channel 3: subagent fixture (subagent-jaguar.jsonl inbound role)
  const channel3 = evaluate({
    transcriptPath: path.join(FIXTURES_DIR, 'subagent-jaguar.jsonl'),
    toolCall: {
      name: 'call_mcp_tool',
      args: { ServerName: 'lazyantigravity_ast_grep', ToolName: 'ast_grep_search' },
    },
  });
  assert.equal(channel3.decision, 'allow');
  assert.equal(channel3.reason, 'Read-only MCP tool permitted for jaguar');

  // Channel 4: banner in piledriver fixture (piledriver-go.jsonl banner role)
  const channel4 = evaluate({
    transcriptPath: path.join(FIXTURES_DIR, 'piledriver-go.jsonl'),
    toolCall: {
      name: 'call_mcp_tool',
      args: { ServerName: 'lazyantigravity_workspace', ToolName: 'blackboard_set' },
    },
  });
  assert.equal(channel4.decision, 'deny');
  assert.equal(channel4.reason, 'Role piledriver is restricted from mutating MCP tool: lazyantigravity_workspace:blackboard_set');
});

test('Fails open on malformed input or unhandled parsing errors', () => {
  assert.deepEqual(evaluate(null), {
    decision: 'allow',
    reason: 'Malformed or unhandled MCP tool payload',
  });

  assert.deepEqual(evaluate(undefined), {
    decision: 'allow',
    reason: 'Malformed or unhandled MCP tool payload',
  });

  assert.deepEqual(evaluate('not a json object'), {
    decision: 'allow',
    reason: 'Malformed or unhandled MCP tool payload',
  });

  assert.deepEqual(evaluate([]), {
    decision: 'allow',
    reason: 'Malformed or unhandled MCP tool payload',
  });

  assert.deepEqual(evaluate({}), {
    decision: 'allow',
    reason: 'Malformed or unhandled MCP tool payload',
  });

  assert.deepEqual(evaluate({ toolCall: 'not an object' }), {
    decision: 'allow',
    reason: 'Malformed or unhandled MCP tool payload',
  });
});

test('Non-MCP tool call passes through', () => {
  const res = evaluate({
    roleHint: 'zen',
    toolCall: {
      name: 'run_command',
      args: { CommandLine: 'dir' },
    },
  });
  assert.equal(res.decision, 'allow');
  assert.equal(res.reason, 'Not an MCP tool');
});

test('CLI integration: main reads stdin JSON and outputs single JSON line', () => {
  const inputPayload = JSON.stringify({
    roleHint: 'zen',
    toolCall: {
      name: 'call_mcp_tool',
      args: {
        ServerName: 'lazyantigravity_ast_grep',
        ToolName: 'ast_grep_search',
      },
    },
  });

  const proc = spawnSync(process.execPath, [SCRIPT_PATH], {
    input: inputPayload,
    encoding: 'utf8',
  });

  assert.equal(proc.status, 0, `Expected exit status 0, stderr: ${proc.stderr}`);
  const stdoutLines = proc.stdout.trim().split(/\r?\n/);
  assert.equal(stdoutLines.length, 1, 'Expected exactly one line on stdout');

  const output = JSON.parse(stdoutLines[0]);
  assert.equal(output.decision, 'allow');
  assert.equal(output.reason, 'Read-only MCP tool permitted for zen');

  // CLI integration with malformed input fails open
  const malformedProc = spawnSync(process.execPath, [SCRIPT_PATH], {
    input: 'not valid json {{{',
    encoding: 'utf8',
  });
  assert.equal(malformedProc.status, 0);
  const malformedOutput = JSON.parse(malformedProc.stdout.trim());
  assert.equal(malformedOutput.decision, 'allow');
  assert.equal(malformedOutput.reason, 'Malformed or unhandled MCP tool payload');
});
