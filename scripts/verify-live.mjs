#!/usr/bin/env node
/**
 * scripts/verify-live.mjs
 * Post-install live health checks for Gravity Fusion.
 *
 * Verifies:
 * 1. Global plugin collision check in ~/.gemini/config/plugins (IS-8):
 *    - Directory collision for gravity-fusion
 *    - Duplicate agent names
 *    - Duplicate skill names
 * 2. hooks.json syntax and existence of all referenced hook scripts.
 * 3. Direct invocation of all hooks with mock payloads to ensure error-free Node.js launch.
 * 4. Optional --probe-mcp: tests whether gf-mcp-probe is recognized.
 *
 * Supports --json for machine-readable output. Returns exit code 0 on success, 1 on failure.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

// Parse command line arguments
const args = process.argv.slice(2);
let outputJson = false;
let probeMcp = false;
let customPluginsDir = null;
let customPluginRoot = null;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--json') {
    outputJson = true;
  } else if (arg === '--probe-mcp') {
    probeMcp = true;
  } else if (arg === '--plugins-dir' && i + 1 < args.length) {
    customPluginsDir = args[++i];
  } else if (arg === '--plugin-root' && i + 1 < args.length) {
    customPluginRoot = args[++i];
  } else if (arg === '--help' || arg === '-h') {
    console.log(`Usage: node scripts/verify-live.mjs [options]

Options:
  --json             Output checklist results as JSON
  --probe-mcp        Probe whether gf-mcp-probe is recognized
  --plugins-dir DIR  Override global plugins directory
  --plugin-root DIR  Override gravity-fusion plugin directory
  -h, --help         Show this help message
`);
    process.exit(0);
  }
}

// Resolve paths
const pluginsDir = path.resolve(
  customPluginsDir ||
  process.env.GEMINI_PLUGINS_DIR ||
  path.join(os.homedir(), '.gemini', 'config', 'plugins')
);

const pluginRoot = path.resolve(
  customPluginRoot ||
  path.join(repoRoot, 'plugin')
);

const results = {
  timestamp: new Date().toISOString(),
  pluginsDir,
  pluginRoot,
  checks: [],
  passed: true,
};

function recordCheck({ id, title, pass, details = null, error = null }) {
  if (!pass) {
    results.passed = false;
  }
  results.checks.push({ id, title, pass, details, error });
}

// ---------------------------------------------------------------------------
// Check 1: Plugin & Name Collision Scan
// ---------------------------------------------------------------------------
function checkNameCollisions() {
  if (!fs.existsSync(pluginsDir)) {
    recordCheck({
      id: 'plugins-dir-exists',
      title: 'Global plugins directory exists',
      pass: false,
      error: `Directory does not exist: ${pluginsDir}`,
    });
    return;
  }

  // 1A: Directory collision
  const targetPluginDir = path.join(pluginsDir, 'gravity-fusion');
  let dirCollision = false;
  let dirStatus = 'none';

  if (fs.existsSync(targetPluginDir)) {
    const pluginJsonPath = path.join(targetPluginDir, 'plugin.json');
    if (fs.existsSync(pluginJsonPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(pluginJsonPath, 'utf8'));
        if (manifest.name === 'gravity-fusion') {
          dirStatus = 'installed-valid';
        } else {
          dirCollision = true;
          dirStatus = `collision-other-name:${manifest.name}`;
        }
      } catch {
        dirCollision = true;
        dirStatus = 'collision-corrupt-manifest';
      }
    } else {
      dirCollision = true;
      dirStatus = 'collision-directory-exists-without-manifest';
    }
  } else {
    dirStatus = 'not-yet-installed';
  }

  recordCheck({
    id: 'directory-collision',
    title: 'Directory collision check',
    pass: !dirCollision,
    details: { status: dirStatus, targetPluginDir },
    error: dirCollision ? `Target directory exists but does not belong to gravity-fusion: ${targetPluginDir}` : null,
  });

  // Identify gravity-fusion agents and skills
  const gfAgents = new Set([
    'bobcat', 'bulldozer', 'excavator', 'jaguar', 'piledriver',
    'puma', 'steamroller', 'strix-halo', 'zen',
  ]);
  const agentsDir = path.join(pluginRoot, 'agents');
  if (fs.existsSync(agentsDir)) {
    for (const f of fs.readdirSync(agentsDir)) {
      if (f.endsWith('.md')) {
        gfAgents.add(path.basename(f, '.md').toLowerCase());
      }
    }
  }

  const gfSkills = new Set();
  const skillsDir = path.join(pluginRoot, 'skills');
  if (fs.existsSync(skillsDir)) {
    for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        gfSkills.add(entry.name.toLowerCase());
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        gfSkills.add(path.basename(entry.name, '.md').toLowerCase());
      }
    }
  }

  // Scan other installed plugins in pluginsDir
  const installedPlugins = [];
  const collidingAgents = [];
  const collidingSkills = [];

  const pluginEntries = fs.readdirSync(pluginsDir, { withFileTypes: true });
  for (const entry of pluginEntries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue; // skip .pytest_cache etc.
    if (entry.name.toLowerCase() === 'gravity-fusion') continue; // skip self

    const pDir = path.join(pluginsDir, entry.name);
    installedPlugins.push(entry.name);

    // Scan agents in installed plugin
    const otherAgentsDir = path.join(pDir, 'agents');
    if (fs.existsSync(otherAgentsDir)) {
      for (const f of fs.readdirSync(otherAgentsDir)) {
        if (f.endsWith('.md')) {
          const agentName = path.basename(f, '.md').toLowerCase();
          if (gfAgents.has(agentName)) {
            collidingAgents.push({ plugin: entry.name, agent: agentName });
          }
        }
      }
    }

    // Scan skills in installed plugin
    const otherSkillsDir = path.join(pDir, 'skills');
    if (fs.existsSync(otherSkillsDir)) {
      for (const s of fs.readdirSync(otherSkillsDir, { withFileTypes: true })) {
        if (s.isDirectory()) {
          const skillName = s.name.toLowerCase();
          if (gfSkills.has(skillName)) {
            collidingSkills.push({ plugin: entry.name, skill: skillName });
          }
        }
      }
    }
  }

  recordCheck({
    id: 'agent-collisions',
    title: 'Duplicate agent names check',
    pass: collidingAgents.length === 0,
    details: { scannedPlugins: installedPlugins, collisions: collidingAgents },
    error: collidingAgents.length > 0 ? `Agent collisions found: ${JSON.stringify(collidingAgents)}` : null,
  });

  recordCheck({
    id: 'skill-collisions',
    title: 'Duplicate skill names check',
    pass: collidingSkills.length === 0,
    details: { scannedPlugins: installedPlugins, collisions: collidingSkills },
    error: collidingSkills.length > 0 ? `Skill collisions found: ${JSON.stringify(collidingSkills)}` : null,
  });
}

// ---------------------------------------------------------------------------
// Check 2: hooks.json Syntax & Target Scripts Existence
// ---------------------------------------------------------------------------
function checkHooksJson() {
  const candidatePaths = [
    path.join(pluginRoot, 'hooks.json'),
    path.join(repoRoot, 'plugin', 'hooks.json'),
    path.join(pluginsDir, 'gravity-fusion', 'hooks.json'),
  ];

  let hooksJsonPath = null;
  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      hooksJsonPath = p;
      break;
    }
  }

  if (!hooksJsonPath) {
    recordCheck({
      id: 'hooks-json-exists',
      title: 'hooks.json file existence',
      pass: false,
      error: `hooks.json not found in plugin root or installed plugin directory (searched: ${candidatePaths.join(', ')})`,
    });
    return [];
  }

  let hooksData;
  try {
    const raw = fs.readFileSync(hooksJsonPath, 'utf8');
    hooksData = JSON.parse(raw);
  } catch (err) {
    recordCheck({
      id: 'hooks-json-syntax',
      title: 'hooks.json syntax validity',
      pass: false,
      error: `Failed to parse hooks.json as JSON: ${err.message}`,
    });
    return [];
  }

  recordCheck({
    id: 'hooks-json-syntax',
    title: 'hooks.json syntax validity',
    pass: true,
    details: { path: hooksJsonPath },
  });

  // Extract all target scripts from hooks.json
  const hookDir = path.dirname(hooksJsonPath);
  const hookEntries = [];
  const missingFiles = [];

  for (const [hookName, hookBlock] of Object.entries(hooksData)) {
    if (!hookBlock || typeof hookBlock !== 'object') continue;
    for (const [eventName, entries] of Object.entries(hookBlock)) {
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        const cmdList = [];
        if (typeof entry.command === 'string') {
          cmdList.push(entry.command);
        }
        if (Array.isArray(entry.hooks)) {
          for (const sub of entry.hooks) {
            if (typeof sub.command === 'string') {
              cmdList.push(sub.command);
            }
          }
        }

        for (const cmd of cmdList) {
          const parts = cmd.trim().split(/\s+/);
          // e.g. "node hooks/zen-shell-guard.mjs" -> script is parts[1]
          const scriptRel = parts.length > 1 ? parts[1] : parts[0];
          const scriptAbs = path.resolve(hookDir, scriptRel);
          const exists = fs.existsSync(scriptAbs);

          hookEntries.push({
            hookName,
            eventName,
            command: cmd,
            scriptRel,
            scriptAbs,
            exists,
          });

          if (!exists) {
            missingFiles.push({ hookName, command: cmd, scriptAbs });
          }
        }
      }
    }
  }

  recordCheck({
    id: 'hook-scripts-exist',
    title: 'Target hook scripts exist on disk',
    pass: missingFiles.length === 0 && hookEntries.length > 0,
    details: { totalHooks: hookEntries.length, hooks: hookEntries },
    error: missingFiles.length > 0
      ? `Missing target hook scripts: ${JSON.stringify(missingFiles)}`
      : hookEntries.length === 0
      ? 'No hook commands registered in hooks.json'
      : null,
  });

  return hookEntries;
}

// ---------------------------------------------------------------------------
// Check 3: Direct Hook Invocations with Mock Payloads
// ---------------------------------------------------------------------------
function checkHookInvocations(registeredHooks = []) {
  // Core hooks to test
  const defaultHooks = [
    { name: 'zen-shell-guard', file: 'hooks/zen-shell-guard.mjs', type: 'PreToolUse' },
    { name: 'excavator-shell-guard', file: 'hooks/excavator-shell-guard.mjs', type: 'PreToolUse' },
    { name: 'mcp-role-guard', file: 'hooks/mcp-role-guard.mjs', type: 'PreToolUseMCP' },
    { name: 'primary-review-gate', file: 'hooks/primary-review-gate.mjs', type: 'Stop' },
    { name: 'excavator-review-gate', file: 'hooks/excavator-review-gate.mjs', type: 'Stop' },
  ];

  const scriptsToTest = new Map();
  for (const h of defaultHooks) {
    const absPath = path.resolve(pluginRoot, h.file);
    scriptsToTest.set(absPath, { ...h, scriptAbs: absPath });
  }

  // Include any extra scripts discovered from hooks.json
  for (const h of registeredHooks) {
    if (h.exists && !scriptsToTest.has(h.scriptAbs)) {
      const type = h.eventName === 'Stop' ? 'Stop' : 'PreToolUse';
      scriptsToTest.set(h.scriptAbs, {
        name: path.basename(h.scriptRel, '.mjs'),
        file: h.scriptRel,
        type,
        scriptAbs: h.scriptAbs,
      });
    }
  }

  const invocationResults = [];
  let allInvokedPass = true;

  for (const [absPath, info] of scriptsToTest) {
    if (!fs.existsSync(absPath)) {
      allInvokedPass = false;
      invocationResults.push({
        name: info.name,
        path: absPath,
        pass: false,
        error: `Hook script not found at ${absPath}`,
      });
      continue;
    }

    let mockPayload;
    if (info.type === 'Stop') {
      mockPayload = {
        executionNum: 0,
        terminationReason: 'NO_TOOL_CALL',
        error: '',
        fullyIdle: true,
        transcriptPath: '',
      };
    } else if (info.type === 'PreToolUseMCP') {
      mockPayload = {
        toolCall: {
          name: 'call_mcp_tool',
          args: { ServerName: 'mock_server', ToolName: 'mock_tool' },
        },
      };
    } else {
      mockPayload = {
        toolCall: {
          name: 'run_command',
          args: { CommandLine: 'dir' },
        },
      };
    }

    try {
      const child = spawnSync(process.execPath, [absPath], {
        input: JSON.stringify(mockPayload),
        encoding: 'utf8',
        cwd: pluginRoot,
        timeout: 10000,
      });

      if (child.status !== 0) {
        allInvokedPass = false;
        invocationResults.push({
          name: info.name,
          path: absPath,
          pass: false,
          exitCode: child.status,
          error: child.stderr || `Exited with code ${child.status}`,
        });
        continue;
      }

      const outText = (child.stdout || '').trim();
      let parsed;
      try {
        parsed = JSON.parse(outText);
      } catch (parseErr) {
        allInvokedPass = false;
        invocationResults.push({
          name: info.name,
          path: absPath,
          pass: false,
          error: `Output was not valid JSON: "${outText}" (${parseErr.message})`,
        });
        continue;
      }

      if (!parsed || typeof parsed.decision !== 'string') {
        allInvokedPass = false;
        invocationResults.push({
          name: info.name,
          path: absPath,
          pass: false,
          error: `Output JSON missing 'decision' string property: ${outText}`,
        });
        continue;
      }

      invocationResults.push({
        name: info.name,
        path: absPath,
        pass: true,
        decision: parsed.decision,
        reason: parsed.reason,
      });
    } catch (execErr) {
      allInvokedPass = false;
      invocationResults.push({
        name: info.name,
        path: absPath,
        pass: false,
        error: execErr.message,
      });
    }
  }

  recordCheck({
    id: 'hook-invocations',
    title: 'Direct hook execution check (Node launch without syntax error)',
    pass: allInvokedPass,
    details: invocationResults,
    error: allInvokedPass ? null : 'One or more hooks failed direct execution check',
  });
}

// ---------------------------------------------------------------------------
// Check 4: Optional --probe-mcp Check
// ---------------------------------------------------------------------------
function checkMcpProbe() {
  const probeCandidates = [
    path.join(pluginRoot, 'agents', 'gf-mcp-probe.md'),
    path.join(repoRoot, 'src', 'roles', 'gf-mcp-probe.md'),
  ];

  let probeFound = false;
  let probePath = null;
  for (const p of probeCandidates) {
    if (fs.existsSync(p)) {
      probeFound = true;
      probePath = p;
      break;
    }
  }

  // Note: per IS-15, call_mcp_tool is excluded by default and gf-mcp-probe is optional
  results.probeMcp = {
    requested: true,
    recognized: probeFound,
    path: probePath,
    details: probeFound
      ? 'gf-mcp-probe agent found'
      : 'gf-mcp-probe not present in current build (default build excludes call_mcp_tool per IS-15)',
  };

  recordCheck({
    id: 'probe-mcp',
    title: 'MCP probe check (--probe-mcp)',
    pass: true, // informational check, does not fail the build
    details: results.probeMcp,
  });
}

// ---------------------------------------------------------------------------
// Main execution
// ---------------------------------------------------------------------------
function run() {
  checkNameCollisions();
  const registeredHooks = checkHooksJson();
  checkHookInvocations(registeredHooks);

  if (probeMcp) {
    checkMcpProbe();
  }

  if (outputJson) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log('\n=== Gravity Fusion Live Health Verification ===');
    console.log(`Plugins Directory: ${pluginsDir}`);
    console.log(`Plugin Root:       ${pluginRoot}`);
    console.log('--------------------------------------------------');

    for (const check of results.checks) {
      const mark = check.pass ? 'PASS' : 'FAIL';
      const symbol = check.pass ? '[✔]' : '[✖]';
      console.log(`${symbol} [${mark}] ${check.title}`);
      if (check.error) {
        console.log(`    Error: ${check.error}`);
      }
      if (check.id === 'hook-invocations' && check.details) {
        for (const item of check.details) {
          const s = item.pass ? '✔' : '✖';
          console.log(`      ${s} ${item.name}: ${item.pass ? `decision=${item.decision}` : item.error}`);
        }
      }
    }
    console.log('--------------------------------------------------');
    console.log(`Overall Result: ${results.passed ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'}\n`);
  }

  process.exit(results.passed ? 0 : 1);
}

run();
