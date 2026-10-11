#!/usr/bin/env node
/**
 * Read AGY PreToolUse JSON from stdin and emit its allow/deny decision.
 *
 * The role boundary is NTG_ZEN_VERIFY, not every user's shell command. Marked
 * commands must fit a small read-only grammar. Denials exit successfully so AGY
 * receives a policy decision, not a hook failure. This is not a general sandbox:
 * executable resolution and host configuration remain the host's responsibility.
 *
 * Supports both upstream POSIX grammar and PowerShell read-only grammar.
 */

import { readStdin, parseJsonObject, emit, isMain } from './lib/io.mjs';
import { splitPsMarker } from './lib/markers.mjs';
import { pyShlex, psTokenize } from './lib/shell-lex.mjs';

const POSIX_READ_COMMANDS = new Set([
  'cat', 'head', 'tail', 'wc', 'ls', 'pwd', 'stat', 'readlink', 'realpath',
  'cmp', 'od', 'sha256sum', 'sha512sum', 'true', 'false', 'test', '[',
]);

const GIT_READ_COMMANDS = new Set([
  'status', 'diff', 'log', 'show', 'ls-files', 'ls-tree', 'rev-parse',
  'rev-list', 'show-ref', 'cat-file', 'describe', 'branch',
]);

const GIT_SAFE_LONG_OPTIONS = new Set([
  '--short', '--branch', '--porcelain', '--untracked-files', '--ignored',
  '--stat', '--name-only', '--name-status', '--numstat', '--shortstat',
  '--check', '--cached', '--staged', '--no-ext-diff', '--no-textconv',
  '--exit-code', '--quiet', '--relative', '--binary', '--oneline',
  '--graph', '--decorate', '--no-decorate', '--all', '--pretty',
  '--format', '--abbrev-ref', '--verify', '--show-toplevel', '--',
]);

// `git branch NAME` creates a ref, so positional args are allowed only with
// --list (patterns) or as the value of --sort.
const GIT_BRANCH_SAFE_LONG_OPTIONS = new Set(['--list', '--show-current', '--sort']);
const GIT_BRANCH_SAFE_SHORT_OPTIONS = new Set(['-v', '-vv', '-a', '-r']);

function gitOptionsReadOnly(subcmd, optArgs) {
  if (subcmd === 'branch') {
    return optArgs.every((arg, i) => {
      if (arg.startsWith('--')) {
        return GIT_BRANCH_SAFE_LONG_OPTIONS.has(arg.split('=', 2)[0].toLowerCase());
      }
      if (arg.startsWith('-')) {
        return GIT_BRANCH_SAFE_SHORT_OPTIONS.has(arg);
      }
      return optArgs.includes('--list') || (i > 0 && optArgs[i - 1] === '--sort');
    });
  }
  return optArgs.every((arg) => {
    if (arg.startsWith('--')) {
      const longOpt = arg.split('=', 2)[0].toLowerCase();
      if (subcmd === 'ls-files' && (longOpt === '--others' || longOpt === '--exclude-standard')) {
        return true;
      }
      return GIT_SAFE_LONG_OPTIONS.has(longOpt);
    }
    // -o is --output for diff/log; for ls-files it means --others (read-only).
    return !arg.toLowerCase().startsWith('-o') || (subcmd === 'ls-files' && arg === '-o');
  });
}

const POSIX_SEPARATORS = new Set([';', '|', '&&', '||']);
const POSIX_FORBIDDEN_CHARS = new Set('<>$`\\(){}#');

const PS_READ_CMNDS = new Set([
  // Get-Content / gc / cat / type
  'get-content', 'gc', 'cat', 'type',
  // Get-ChildItem / gci / ls / dir
  'get-childitem', 'gci', 'ls', 'dir',
  // Select-String / sls
  'select-string', 'sls',
  // Get-FileHash, Test-Path, Get-Item/gi, Resolve-Path/rvpa, Get-Location/gl/pwd
  'get-filehash',
  'test-path',
  'get-item', 'gi',
  'resolve-path', 'rvpa',
  'get-location', 'gl', 'pwd',
  // Measure-Object/measure, Select-Object/select, Sort-Object/sort, Where-Object/where,
  // Compare-Object/compare/diff, Format-Table/ft, Format-List/fl, Out-String
  'measure-object', 'measure',
  'select-object', 'select',
  'sort-object', 'sort',
  'where-object', 'where',
  'compare-object', 'compare', 'diff',
  'format-table', 'ft',
  'format-list', 'fl',
  'out-string',
]);

const PS_FORBIDDEN_CHARS = new Set(['$', '`', '(', ')', '{', '}', '[', ']', '@', '#', '>', '<', '&']);
const PS_COMMON_PARAM_ALIASES = new Set(['ov', 'pv', 'ev', 'wv', 'iv', 'ob']);

function posixReadOnlyCommand(words) {
  let w = words.slice();
  if (w.length && w[0] === 'env') {
    w = w.slice(1);
  }
  while (w.length && w[0] === 'NTG_ZEN_VERIFY=1') {
    w = w.slice(1);
  }
  if (!w.length) {
    return false;
  }
  const [command, ...args] = w;
  if (POSIX_READ_COMMANDS.has(command)) {
    return true;
  }
  if (command === 'grep' || command === 'rg') {
    return !args.some((arg) => arg.startsWith('--pre') || arg.startsWith('--hostname-bin'));
  }
  if (command === 'git') {
    let gArgs = args.slice();
    if (gArgs.length && gArgs[0] === '--no-optional-locks') {
      gArgs = gArgs.slice(1);
    }
    if (!gArgs.length || !GIT_READ_COMMANDS.has(gArgs[0])) {
      return false;
    }
    return gitOptionsReadOnly(gArgs[0], gArgs.slice(1));
  }
  if (command === 'node' || command === 'python3' || command === 'python') {
    if ((args.length === 1 && args[0] === '--version') || (args.length === 1 && args[0] === '-V')) {
      return true;
    }
    return command === 'node' && args.length === 2 && args[0] === '--check' && !args[1].startsWith('-');
  }
  return false;
}

function inspectPosixCommand(command) {
  const denied = { decision: 'deny', reason: 'Zen permits only read-only verification commands' };
  for (const c of command) {
    if (POSIX_FORBIDDEN_CHARS.has(c)) {
      return denied;
    }
  }
  let words;
  try {
    words = pyShlex(command.replace(/\n/g, ';'), {
      posix: true,
      punctuationChars: ';&|',
      whitespaceSplit: true,
    });
  } catch {
    return denied;
  }
  if (!words.length || !/^(?:env\s+)?NTG_ZEN_VERIFY=1(?:\s|$)/.test(command.trim())) {
    return denied;
  }
  let simple = [];
  for (const word of words) {
    if (POSIX_SEPARATORS.has(word)) {
      if (!posixReadOnlyCommand(simple)) {
        return denied;
      }
      simple = [];
    } else if (word && Array.from(word).every((c) => c === ';' || c === '&' || c === '|')) {
      return denied;
    } else {
      simple.push(word);
    }
  }
  if (!posixReadOnlyCommand(simple)) {
    return denied;
  }
  return { decision: 'allow', reason: 'Marked read-only verification command' };
}

function isDeniedPsParameter(token, firstToken) {
  if (!token.startsWith('-')) return false;
  const raw = token.slice(1).replace(/^-+/, '');
  const name = raw.split(/[:=]/)[0].toLowerCase();
  if (!name) return false;

  // 1. Two-letter common parameter aliases: -ov, -pv, -ev, -wv, -iv, -ob
  if (PS_COMMON_PARAM_ALIASES.has(name)) {
    return true;
  }

  // 2. OutVariable / OutBuffer prefixes: 'out', 'outv...', 'outb...'
  if (name === 'out' || name.startsWith('outv') || name.startsWith('outb')) {
    return true;
  }

  // 3. PipelineVariable prefixes (pipe...)
  if (name.startsWith('pipe')) {
    return true;
  }

  // 4. ErrorVariable prefixes (err...)
  if (name.startsWith('err')) {
    return true;
  }

  // 5. WarningVariable prefixes (warn...)
  if (name.startsWith('warn')) {
    return true;
  }

  // 6. InformationVariable prefixes (info...)
  if (name.startsWith('info')) {
    return true;
  }

  // 7. -Wait (blocks forever)
  if (name === 'wait' || name === 'wai' || name === 'wa') {
    return true;
  }
  if (name === 'w' && (firstToken === 'get-content' || firstToken === 'gc' || firstToken === 'cat' || firstToken === 'type')) {
    return true;
  }

  return false;
}

function inspectPsCommand(body) {
  const denied = { decision: 'deny', reason: 'Zen permits only read-only verification commands' };

  if (/NTG_ZEN_VERIFY/i.test(body)) {
    return denied;
  }
  if (body.includes('::') || body.includes('--%')) {
    return denied;
  }
  for (const c of body) {
    if (PS_FORBIDDEN_CHARS.has(c)) {
      return denied;
    }
  }

  const tok = psTokenize(body);
  if (!tok.ok || !tok.segments.length) {
    return denied;
  }

  for (const segment of tok.segments) {
    if (!segment.length) {
      return denied;
    }

    let first = segment[0].toLowerCase();
    if (first.endsWith('.exe')) {
      const base = first.slice(0, -4);
      if (base === 'git' || base === 'node' || base === 'python' || base === 'python3') {
        first = base;
      }
    }

    if (first === 'git') {
      let gitArgs = segment.slice(1);
      if (gitArgs.length && gitArgs[0].toLowerCase() === '--no-optional-locks') {
        gitArgs = gitArgs.slice(1);
      }
      if (!gitArgs.length) {
        return denied;
      }
      const subcmd = gitArgs[0].toLowerCase();
      if (!GIT_READ_COMMANDS.has(subcmd)) {
        return denied;
      }
      const optArgs = gitArgs.slice(1);
      if (optArgs.some((arg) => isDeniedPsParameter(arg, first)) || !gitOptionsReadOnly(subcmd, optArgs)) {
        return denied;
      }
    } else if (first === 'node' || first === 'python' || first === 'python3') {
      const args = segment.slice(1);
      if (args.length === 1 && (args[0] === '--version' || args[0] === '-V')) {
        // ok
      } else if (first === 'node' && args.length === 2 && args[0] === '--check' && !args[1].startsWith('-')) {
        // ok
      } else {
        return denied;
      }
    } else if (PS_READ_CMNDS.has(first)) {
      const args = segment.slice(1);
      for (const arg of args) {
        if (isDeniedPsParameter(arg, first)) {
          return denied;
        }
      }
    } else {
      return denied;
    }
  }

  return { decision: 'allow', reason: 'Marked read-only verification command' };
}

export function inspectCommand(command) {
  const psMarker = splitPsMarker(command, 'NTG_ZEN_VERIFY');
  if (psMarker.matched) {
    return inspectPsCommand(psMarker.body);
  }

  if (!command.includes('NTG_ZEN_VERIFY')) {
    return { decision: 'allow', reason: 'Outside the Zen-marked boundary' };
  }

  return inspectPosixCommand(command);
}

export function evaluate(payload) {
  try {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new TypeError('Expected AGY toolCall object');
    }
    const call = payload.toolCall;
    if (!call || typeof call !== 'object' || Array.isArray(call)) {
      throw new TypeError('Expected AGY toolCall object');
    }
    if (call.name !== 'run_command') {
      return { decision: 'allow', reason: 'Not a shell tool' };
    }
    const args = call.args;
    if (!args || typeof args !== 'object' || Array.isArray(args) || typeof args.CommandLine !== 'string') {
      throw new TypeError('Expected toolCall.args.CommandLine string');
    }
    return inspectCommand(args.CommandLine);
  } catch (error) {
    return { decision: 'deny', reason: 'Malformed hook input: ' + (error?.message || String(error)) };
  }
}

export async function main() {
  let result;
  try {
    const raw = await readStdin();
    const parsed = parseJsonObject(raw);
    if (!parsed.ok) {
      result = { decision: 'deny', reason: 'Malformed hook input: ' + parsed.error };
    } else {
      result = evaluate(parsed.value);
    }
  } catch (error) {
    result = { decision: 'deny', reason: 'Malformed hook input: ' + (error?.message || String(error)) };
  }
  emit(result);
}

if (isMain(import.meta.url)) {
  await main();
}
