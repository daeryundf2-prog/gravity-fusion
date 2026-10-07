/**
 * test/perf.test.mjs
 * Proves IS-12: Hook execution latency budget p95 < 300ms.
 *
 * Executes each hook script via child process spawn 20 times with realistic inputs.
 * Computes p50, p90, p95 execution time.
 * Asserts p95 is strictly under 300ms.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const FIXTURE_PATH = path.resolve(repoRoot, 'test/fixtures/hub-2.21.0/default-ready.jsonl');

function computePercentile(sortedArray, p) {
  if (sortedArray.length === 0) return 0;
  const index = Math.ceil((p / 100) * sortedArray.length) - 1;
  const clamped = Math.max(0, Math.min(index, sortedArray.length - 1));
  return sortedArray[clamped];
}

const HOOK_TARGETS = [
  {
    name: 'zen-shell-guard',
    scriptPath: path.resolve(repoRoot, 'plugin/hooks/zen-shell-guard.mjs'),
    payload: {
      toolCall: {
        name: 'run_command',
        args: { CommandLine: 'dir' },
      },
      transcriptPath: FIXTURE_PATH,
    },
  },
  {
    name: 'excavator-shell-guard',
    scriptPath: path.resolve(repoRoot, 'plugin/hooks/excavator-shell-guard.mjs'),
    payload: {
      toolCall: {
        name: 'run_command',
        args: { CommandLine: 'dir' },
      },
      transcriptPath: FIXTURE_PATH,
    },
  },
  {
    name: 'mcp-role-guard',
    scriptPath: path.resolve(repoRoot, 'plugin/hooks/mcp-role-guard.mjs'),
    payload: {
      toolCall: {
        name: 'call_mcp_tool',
        args: { ServerName: 'lazyantigravity_ast_grep', ToolName: 'ast_grep_search' },
      },
      transcriptPath: FIXTURE_PATH,
    },
  },
  {
    name: 'primary-review-gate',
    scriptPath: path.resolve(repoRoot, 'plugin/hooks/primary-review-gate.mjs'),
    payload: {
      executionNum: 0,
      terminationReason: 'NO_TOOL_CALL',
      error: '',
      fullyIdle: true,
      transcriptPath: FIXTURE_PATH,
    },
  },
  {
    name: 'excavator-review-gate',
    scriptPath: path.resolve(repoRoot, 'plugin/hooks/excavator-review-gate.mjs'),
    payload: {
      executionNum: 0,
      terminationReason: 'NO_TOOL_CALL',
      error: '',
      fullyIdle: true,
      transcriptPath: FIXTURE_PATH,
    },
  },
];

const ITERATIONS = 20;
const P95_BUDGET_MS = 300;

for (const target of HOOK_TARGETS) {
  test(`IS-12 perf: ${target.name} p95 latency < ${P95_BUDGET_MS}ms (20 spawns)`, () => {
    const durations = [];

    // Warm-up single iteration
    const warmup = spawnSync(process.execPath, [target.scriptPath], {
      input: JSON.stringify(target.payload),
      encoding: 'utf8',
      cwd: path.resolve(repoRoot, 'plugin'),
      timeout: 10000,
    });
    assert.equal(warmup.status, 0, `Warm-up run failed for ${target.name}: ${warmup.stderr}`);

    for (let i = 0; i < ITERATIONS; i++) {
      const t0 = performance.now();
      const res = spawnSync(process.execPath, [target.scriptPath], {
        input: JSON.stringify(target.payload),
        encoding: 'utf8',
        cwd: path.resolve(repoRoot, 'plugin'),
        timeout: 10000,
      });
      const elapsed = performance.now() - t0;

      assert.equal(res.status, 0, `Run ${i + 1} failed for ${target.name}: ${res.stderr}`);
      const parsed = JSON.parse(res.stdout.trim());
      assert.ok('decision' in parsed, `Run ${i + 1} missing decision`);

      durations.push(elapsed);
    }

    durations.sort((a, b) => a - b);
    const p50 = computePercentile(durations, 50);
    const p90 = computePercentile(durations, 90);
    const p95 = computePercentile(durations, 95);
    const min = durations[0];
    const max = durations[durations.length - 1];

    console.log(
      `  [PERF] ${target.name.padEnd(23)} | min: ${min.toFixed(1).padStart(5)}ms | p50: ${p50.toFixed(1).padStart(5)}ms | p90: ${p90.toFixed(1).padStart(5)}ms | p95: ${p95.toFixed(1).padStart(5)}ms | max: ${max.toFixed(1).padStart(5)}ms`
    );

    assert.ok(
      p95 < P95_BUDGET_MS,
      `${target.name} p95 latency (${p95.toFixed(1)}ms) exceeded budget (${P95_BUDGET_MS}ms)`
    );
  });
}
