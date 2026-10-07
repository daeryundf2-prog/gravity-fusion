import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  buildAgents,
  ROLES,
  ORCHESTRATION_ROLES,
  MCP_OPT_IN_ROLES,
} from '../scripts/build-agents.mjs';
import {
  verifyAll,
  parseFrontmatter,
  checkIS1,
  checkIS2,
  checkIS3,
  checkIS5,
  checkIS8,
  checkIS10,
  checkIS15,
} from '../scripts/verify.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const pluginDir = path.join(repoRoot, 'plugin');
const agentsDir = path.join(pluginDir, 'agents');

test('build-agents: generates 9 agent files in default mode (no --mcp)', () => {
  const generated = buildAgents({ repoRoot, withMcp: false });
  assert.equal(generated.length, 9, 'Should generate exactly 9 files');

  const files = fs.readdirSync(agentsDir).filter((f) => f.endsWith('.md')).sort();
  assert.deepEqual(
    files,
    [...ROLES].sort().map((r) => `${r}.md`),
    'Files in plugin/agents should match 9 roles'
  );

  const probePath = path.join(agentsDir, 'gf-mcp-probe.md');
  assert.ok(!fs.existsSync(probePath), 'gf-mcp-probe.md must be omitted without --mcp');

  for (const file of files) {
    const fullPath = path.join(agentsDir, file);
    const content = fs.readFileSync(fullPath, 'utf8');
    const { frontmatter, body } = parseFrontmatter(content);
    const roleName = path.basename(file, '.md');

    // Frontmatter checks
    assert.ok(!('rules' in frontmatter), `${file}: must not have rules: frontmatter key`);
    const tools = Array.isArray(frontmatter.tools) ? frontmatter.tools : [];
    assert.ok(
      !tools.includes('call_mcp_tool'),
      `${file}: must not contain call_mcp_tool in default build`
    );

    // Body inlining checks
    assert.ok(
      body.includes('## Shared Harness'),
      `${file}: must contain ## Shared Harness in body`
    );

    if (ORCHESTRATION_ROLES.has(roleName)) {
      assert.ok(
        body.includes('## Orchestration Delta'),
        `${file}: must contain ## Orchestration Delta in body`
      );
    } else {
      assert.ok(
        !body.includes('## Orchestration Delta'),
        `${file}: must NOT contain ## Orchestration Delta in body`
      );
    }
  }
});

test('build-agents: generates 10 files with --mcp flag and binds MCP tools', () => {
  try {
    const generated = buildAgents({ repoRoot, withMcp: true });
    assert.equal(generated.length, 10, 'Should generate 10 files including probe');

    const probePath = path.join(agentsDir, 'gf-mcp-probe.md');
    assert.ok(fs.existsSync(probePath), 'gf-mcp-probe.md must exist in --mcp mode');

    const probeContent = fs.readFileSync(probePath, 'utf8');
    const { frontmatter: probeFm } = parseFrontmatter(probeContent);
    assert.deepEqual(probeFm.tools, ['view_file', 'call_mcp_tool']);

    for (const role of ROLES) {
      const filePath = path.join(agentsDir, `${role}.md`);
      const content = fs.readFileSync(filePath, 'utf8');
      const { frontmatter } = parseFrontmatter(content);
      const tools = Array.isArray(frontmatter.tools) ? frontmatter.tools : [];

      if (MCP_OPT_IN_ROLES.has(role)) {
        assert.ok(
          tools.includes('call_mcp_tool'),
          `${role}: must include call_mcp_tool in --mcp mode`
        );
      } else {
        assert.ok(
          !tools.includes('call_mcp_tool'),
          `${role}: must NOT include call_mcp_tool in --mcp mode`
        );
      }
    }
  } finally {
    // Reset back to default build
    buildAgents({ repoRoot, withMcp: false });
  }
});

test('verify: passes clean on current repository', () => {
  buildAgents({ repoRoot, withMcp: false });
  const result = verifyAll({ repoRoot });
  assert.equal(result.ok, true, `Expected clean pass but got errors: ${result.errors.join('; ')}`);
  assert.equal(result.failed.length, 0);
  assert.deepEqual(result.passed.sort(), [
    'IS-1',
    'IS-10',
    'IS-15',
    'IS-2',
    'IS-3',
    'IS-5',
    'IS-8',
  ]);

  // CLI spawn execution
  const cli = spawnSync(process.execPath, [path.join(repoRoot, 'scripts', 'verify.mjs')], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(cli.status, 0, `verify.mjs CLI exited with code ${cli.status}: ${cli.stderr}`);
  assert.ok(cli.stdout.includes('All 7 IS criteria passed.'));

  // CLI --json flag
  const cliJson = spawnSync(
    process.execPath,
    [path.join(repoRoot, 'scripts', 'verify.mjs'), '--json'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
    }
  );
  assert.equal(cliJson.status, 0);
  const jsonResult = JSON.parse(cliJson.stdout.trim());
  assert.equal(jsonResult.ok, true);
  assert.equal(jsonResult.failed.length, 0);
});

test('verify: detects injected IS-1 violation (plugin/rules directory)', () => {
  const dummyRulesDir = path.join(pluginDir, 'rules');
  fs.mkdirSync(dummyRulesDir, { recursive: true });
  fs.writeFileSync(path.join(dummyRulesDir, 'foo.md'), '# Injected rule\n', 'utf8');

  try {
    const is1 = checkIS1(repoRoot);
    assert.equal(is1.ok, false);
    assert.ok(is1.errors[0].includes('plugin/rules directory must not exist'));

    const all = verifyAll({ repoRoot });
    assert.equal(all.ok, false);
    assert.ok(all.failed.includes('IS-1'));

    const cli = spawnSync(process.execPath, [path.join(repoRoot, 'scripts', 'verify.mjs')], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    assert.equal(cli.status, 1);
    assert.ok(cli.stderr.includes('IS-1') || cli.stdout.includes('IS-1'));
  } finally {
    fs.rmSync(dummyRulesDir, { recursive: true, force: true });
  }
});

test('verify: detects injected IS-2 violation (.py file in plugin)', () => {
  const dummyPy = path.join(pluginDir, 'injected_test.py');
  fs.writeFileSync(dummyPy, 'print("forbidden")\n', 'utf8');

  try {
    const is2 = checkIS2(repoRoot);
    assert.equal(is2.ok, false);
    assert.ok(is2.errors.some((e) => e.includes('.py file in plugin')));

    const all = verifyAll({ repoRoot });
    assert.equal(all.ok, false);
    assert.ok(all.failed.includes('IS-2'));
  } finally {
    fs.rmSync(dummyPy, { force: true });
  }
});

test('verify: detects injected IS-3 violation (unescaped POSIX marker)', () => {
  const dummyAgent = path.join(agentsDir, 'dummy-posix.md');
  const content = [
    '---',
    'name: dummy-posix',
    'tools:',
    '  - view_file',
    '  - run_command',
    '---',
    '',
    'Run this check: NTG_ZEN_VERIFY=1 cat file.txt',
    '',
  ].join('\n');
  fs.writeFileSync(dummyAgent, content, 'utf8');

  try {
    const is3 = checkIS3(repoRoot);
    assert.equal(is3.ok, false);
    assert.ok(is3.errors.some((e) => e.includes('Unescaped/unqualified POSIX marker')));
  } finally {
    fs.rmSync(dummyAgent, { force: true });
  }
});

test('verify: detects injected IS-5 violation (forbidden write tool in read-only role)', () => {
  const dummyAgent = path.join(agentsDir, 'dummy-jaguar-bad.md');
  const content = [
    '---',
    'name: jaguar',
    'tools:',
    '  - view_file',
    '  - write_to_file',
    '---',
    '',
    '# Bad Jaguar',
    '',
  ].join('\n');
  fs.writeFileSync(dummyAgent, content, 'utf8');

  try {
    const is5 = checkIS5(repoRoot);
    assert.equal(is5.ok, false);
    assert.ok(is5.errors.some((e) => e.includes('forbidden write tool')));
  } finally {
    fs.rmSync(dummyAgent, { force: true });
  }
});

test('verify: detects injected IS-8 violation (agent-skill name collision)', () => {
  const dummyAgent = path.join(agentsDir, 'gf-qa-computed-outputs.md');
  const content = [
    '---',
    'name: gf-qa-computed-outputs',
    'tools:',
    '  - view_file',
    '---',
    '',
    '# Collision with skill',
    '',
  ].join('\n');
  fs.writeFileSync(dummyAgent, content, 'utf8');

  try {
    const is8 = checkIS8(repoRoot);
    assert.equal(is8.ok, false);
    assert.ok(is8.errors.some((e) => e.includes('Collision between agent and skill')));
  } finally {
    fs.rmSync(dummyAgent, { force: true });
  }
});

test('verify: detects injected IS-15 violation (call_mcp_tool in default build)', () => {
  try {
    // Generate agents with --mcp
    buildAgents({ repoRoot, withMcp: true });

    const is15 = checkIS15(repoRoot);
    assert.equal(is15.ok, false);
    assert.ok(
      is15.errors.some(
        (e) => e.includes('call_mcp_tool in tools') || e.includes('gf-mcp-probe.md')
      )
    );

    const all = verifyAll({ repoRoot });
    assert.equal(all.ok, false);
    assert.ok(all.failed.includes('IS-15'));
  } finally {
    // Restore default build
    buildAgents({ repoRoot, withMcp: false });
  }
});
