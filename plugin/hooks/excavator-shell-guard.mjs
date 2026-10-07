#!/usr/bin/env node
/**
 * Role-scoped behavioral backstop for Excavator shell calls.
 * Port of native-gravity's excavator-shell-guard.py to Node.js
 * with 1:1 POSIX parity plus Windows elevation and full-upgrade detection.
 */

import { readStdin, parseJsonObject, emit, isMain } from './lib/io.mjs';
import { splitPsMarker, isMarkedCommand } from './lib/markers.mjs';
import { pyShlex, pySplit, psTokenize } from './lib/shell-lex.mjs';

export const MARKER = 'NTG_EXCAVATOR=1 ';
export const PRIVILEGE = 'privilege';
export const FULL_UPGRADE = 'full-upgrade';

export const REASONS = {
  [PRIVILEGE]: (
    'Excavator may use sudo for task-relevant work, but it must not turn missing ' +
    'authorization into a credential-discovery or privilege-acquisition task. ' +
    'Continue with available diagnostics, ask the user to provide authorization, ' +
    'or report the privileged step as BLOCKED.'
  ),
  [FULL_UPGRADE]: (
    'Excavator must not use a full-system upgrade as an exploratory troubleshooting ' +
    'step. Preserve the user\'s constraints and make the smallest evidence-backed ' +
    'change needed for the bounded problem.'
  ),
};

export const CONTROL = new Set([';', '&&', '||', '|', '&']);
export const WRAPPERS = new Set(['command', 'nohup']);
export const SHELLS = new Set(['sh', 'bash', 'dash', 'zsh', 'fish']);
export const HISTORY_READERS = new Set([
  'cat', 'tail', 'head', 'grep', 'rg', 'sed', 'awk',
  'get-content', 'gc', 'type', 'select-string', 'sls', 'more', 'findstr',
]);
export const SUDO_VALUE_OPTIONS = new Set([
  '-u', '--user', '-g', '--group', '-h', '--host', '-p', '--prompt',
  '-C', '--close-from', '-T', '--command-timeout', '-R', '--chroot',
  '-D', '--chdir',
]);
export const PASSWORD_GUESS_LOOP = /\bfor\b[^;]*\bin\b[^;]*;\s*do\b[^;]*(?:sudo\b[^;]*-S|\bsu\b)/is;
export const PS_PASSWORD_GUESS_LOOP = /(?:\b(?:foreach|for|ForEach-Object)\b|(?:\s|^)%\s)[\s\S]*?(?:runas|-credential)\b/i;

export function basename(token) {
  if (typeof token !== 'string') return '';
  const parts = token.split(/[/\\]/);
  return parts[parts.length - 1];
}

export function normalizeExe(token) {
  const base = basename(token).toLowerCase();
  return base.endsWith('.exe') ? base.slice(0, -4) : base;
}

export function shell_commands(body) {
  const lexer = pyShlex(body, {
    posix: true,
    punctuationChars: ';&|',
    whitespaceSplit: true,
    commenters: '',
  });
  const commands = [];
  let current = [];
  for (const token of lexer) {
    if (CONTROL.has(token)) {
      if (current.length > 0) {
        commands.push(current);
        current = [];
      }
    } else {
      current.push(token);
    }
  }
  if (current.length > 0) {
    commands.push(current);
  }
  return commands;
}

export function strip_assignments(tokens) {
  let idx = 0;
  while (idx < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[idx])) {
    idx++;
  }
  return tokens.slice(idx);
}

export function unwrap(tokens) {
  tokens = strip_assignments(tokens);
  while (tokens.length > 0) {
    const exe = normalizeExe(tokens[0]);
    if (WRAPPERS.has(exe)) {
      tokens = strip_assignments(tokens.slice(1));
      continue;
    }
    if (exe !== 'env') {
      return tokens;
    }

    let index = 1;
    while (index < tokens.length) {
      const token = tokens[index];
      if (token === '--') {
        index += 1;
        break;
      }
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) {
        index += 1;
        continue;
      }
      if (token === '-i' || token === '--ignore-environment' || token === '-0' || token === '--null') {
        index += 1;
        continue;
      }
      if (token === '-u' || token === '--unset' || token === '-C' || token === '--chdir') {
        index += 2;
        continue;
      }
      if (
        token.startsWith('--unset=') ||
        token.startsWith('--chdir=') ||
        (token.startsWith('-u') && token !== '-u') ||
        (token.startsWith('-C') && token !== '-C')
      ) {
        index += 1;
        continue;
      }
      if (token.startsWith('-')) {
        return tokens;
      }
      break;
    }
    tokens = strip_assignments(tokens.slice(index));
  }
  return tokens;
}

export function sudo_target(tokens) {
  let index = 1;
  let stdin_password = false;
  while (index < tokens.length) {
    const token = tokens[index];
    if (token === '--') {
      return { stdin_password, target: tokens.slice(index + 1) };
    }
    if (token === '-S' || token === '--stdin') {
      stdin_password = true;
      index += 1;
      continue;
    }
    if (token.startsWith('--')) {
      if (SUDO_VALUE_OPTIONS.has(token) && !token.includes('=')) {
        index += 2;
      } else {
        index += 1;
      }
      continue;
    }
    if (token.startsWith('-') && token !== '-') {
      if (token.slice(1).includes('S')) {
        stdin_password = true;
      }
      index += SUDO_VALUE_OPTIONS.has(token) ? 2 : 1;
      continue;
    }
    break;
  }
  return { stdin_password, target: tokens.slice(index) };
}

export function is_full_upgrade(executable, args) {
  const name = normalizeExe(executable);
  const lowered = args.map((arg) => String(arg).toLowerCase());

  // POSIX package managers
  if (name === 'pacman' || name === 'yay' || name === 'paru') {
    const short_flags = lowered
      .filter((arg) => arg.startsWith('-') && !arg.startsWith('--'))
      .map((arg) => arg.slice(1))
      .join('');
    return (short_flags.includes('s') && short_flags.includes('u')) || lowered.includes('--sysupgrade');
  }

  const actions = {
    apt: new Set(['upgrade', 'full-upgrade', 'dist-upgrade']),
    'apt-get': new Set(['upgrade', 'full-upgrade', 'dist-upgrade']),
    dnf: new Set(['upgrade', 'update', 'system-upgrade']),
    yum: new Set(['upgrade', 'update']),
    zypper: new Set(['dup', 'dist-upgrade', 'update', 'up']),
  };
  if (actions[name] && lowered.some((arg) => actions[name].has(arg))) {
    return true;
  }

  // Windows additions from conventions section 7
  // winget upgrade with any of --all, -r, --recurse
  if (name === 'winget') {
    if (
      lowered.includes('upgrade') &&
      (lowered.includes('--all') || lowered.includes('-r') || lowered.includes('--recurse'))
    ) {
      return true;
    }
  }

  // choco upgrade all
  if (name === 'choco') {
    if (
      (lowered.includes('upgrade') || lowered.includes('up')) &&
      lowered.includes('all')
    ) {
      return true;
    }
  }

  // cup all
  if (name === 'cup') {
    if (lowered.includes('all')) {
      return true;
    }
  }

  // scoop update with * or --all/-a
  if (name === 'scoop') {
    if (
      (lowered.includes('update') || lowered.includes('up')) &&
      (lowered.includes('*') || lowered.includes('--all') || lowered.includes('-a'))
    ) {
      return true;
    }
  }

  // Install-WindowsUpdate
  if (name === 'install-windowsupdate') {
    return true;
  }

  // Update-Module with no positional name and no -Name
  if (name === 'update-module') {
    let hasName = false;
    let i = 0;
    while (i < lowered.length) {
      const arg = lowered[i];
      if (arg === '-name' || arg.startsWith('-name:')) {
        hasName = true;
        break;
      }
      if (!arg.startsWith('-')) {
        hasName = true;
        break;
      }
      if (
        arg === '-scope' ||
        arg === '-requiredversion' ||
        arg === '-maximumversion' ||
        arg === '-credential'
      ) {
        i += 2;
        continue;
      }
      i++;
    }
    if (!hasName) {
      return true;
    }
  }

  // usoclient with StartInstall / StartInteractiveScan / ScanInstallWait
  if (name === 'usoclient') {
    if (
      lowered.some((arg) =>
        arg === 'startinstall' ||
        arg === 'startinteractivescan' ||
        arg === 'scaninstallwait'
      )
    ) {
      return true;
    }
  }

  // wuauclt with /updatenow | /detectnow
  if (name === 'wuauclt') {
    if (
      lowered.some((arg) => arg === '/updatenow' || arg === '/detectnow')
    ) {
      return true;
    }
  }

  // Get-WindowsUpdate with -Install
  if (name === 'get-windowsupdate') {
    if (lowered.some((arg) => arg === '-install' || arg.startsWith('-install:'))) {
      return true;
    }
  }

  return false;
}

function parseStartProcess(tokens) {
  let verb = null;
  let filePath = null;
  const argumentListParts = [];
  const positional = [];

  let i = 1;
  while (i < tokens.length) {
    const tok = tokens[i];
    const tokLower = tok.toLowerCase();

    const colonIdx = tok.indexOf(':');
    if (tok.startsWith('-') && colonIdx > 1) {
      const paramName = tok.slice(1, colonIdx).toLowerCase();
      const paramVal = tok.slice(colonIdx + 1);
      if (paramName === 'verb') {
        verb = paramVal;
      } else if (paramName === 'filepath') {
        filePath = paramVal;
      } else if (paramName === 'argumentlist' || paramName === 'args') {
        argumentListParts.push(paramVal);
      }
      i++;
      continue;
    }

    if (tokLower === '-verb') {
      if (i + 1 < tokens.length) {
        verb = tokens[i + 1];
        i += 2;
        continue;
      }
    } else if (tokLower === '-filepath') {
      if (i + 1 < tokens.length) {
        filePath = tokens[i + 1];
        i += 2;
        continue;
      }
    } else if (tokLower === '-argumentlist' || tokLower === '-args') {
      i++;
      while (i < tokens.length && !tokens[i].startsWith('-')) {
        argumentListParts.push(tokens[i]);
        i++;
      }
      continue;
    } else if (tok.startsWith('-')) {
      const knownValParams = new Set([
        '-windowstyle',
        '-workingdirectory',
        '-credential',
        '-redirectstandardinput',
        '-redirectstandardoutput',
        '-redirectstandarderror',
      ]);
      if (knownValParams.has(tokLower) && i + 1 < tokens.length && !tokens[i + 1].startsWith('-')) {
        i += 2;
      } else {
        i++;
      }
      continue;
    } else {
      positional.push(tok);
      i++;
    }
  }

  if (!filePath && positional.length > 0) {
    filePath = positional[0];
    if (argumentListParts.length === 0 && positional.length > 1) {
      argumentListParts.push(...positional.slice(1));
    }
  }

  return { verb, filePath, argumentListParts };
}

function buildStartProcessTarget(filePath, argumentListParts) {
  const targetTokens = [filePath];
  for (const part of argumentListParts) {
    if (typeof part === 'string' && part.trim()) {
      const cleaned = part.replace(/^['"]|['"]$/g, '').replace(/,$/, '');
      try {
        const subTokens = pySplit(cleaned);
        if (subTokens.length > 0) {
          targetTokens.push(...subTokens);
        } else {
          targetTokens.push(cleaned);
        }
      } catch {
        targetTokens.push(...cleaned.trim().split(/\s+/));
      }
    }
  }
  return targetTokens;
}

export function classify_command(tokens, depth = 0) {
  if (depth > 2) {
    return null;
  }

  tokens = unwrap(tokens);
  if (!tokens || tokens.length === 0) {
    return null;
  }

  const name = normalizeExe(tokens[0]);
  const args = tokens.slice(1);

  // sudo
  if (name === 'sudo') {
    const { stdin_password, target } = sudo_target(tokens);
    if (stdin_password) {
      return PRIVILEGE;
    }
    return classify_command(target, depth + 1);
  }

  // gsudo
  if (name === 'gsudo') {
    let index = 1;
    while (index < tokens.length) {
      const tok = tokens[index];
      if (tok === '--') {
        index++;
        break;
      }
      if (tok.startsWith('-')) {
        index++;
        continue;
      }
      break;
    }
    return classify_command(tokens.slice(index), depth + 1);
  }

  // Start-Process / saps / start
  if (name === 'start-process' || name === 'saps' || name === 'start') {
    const sp = parseStartProcess(tokens);
    if (sp.filePath) {
      const targetTokens = buildStartProcessTarget(sp.filePath, sp.argumentListParts);
      return classify_command(targetTokens, depth + 1);
    }
  }

  // Privilege: su, pkexec, runas
  if (name === 'su' || name === 'pkexec' || name === 'runas') {
    return PRIVILEGE;
  }

  // Privilege: cmdkey /list
  if (name === 'cmdkey') {
    if (args.some((a) => a.toLowerCase().startsWith('/list'))) {
      return PRIVILEGE;
    }
  }

  // Privilege: vaultcmd /list*
  if (name === 'vaultcmd') {
    if (args.some((a) => a.toLowerCase().startsWith('/list'))) {
      return PRIVILEGE;
    }
  }

  // Privilege: reg save|export of HKLM\SAM|HKLM\SECURITY|HKLM\SYSTEM
  if (name === 'reg') {
    const sub = args[0]?.toLowerCase();
    if (sub === 'save' || sub === 'export') {
      const regKeyPattern = /^(?:hklm|hkey_local_machine)[/\\](?:sam|security|system)(?:[/\\]|$)/i;
      if (args.slice(1).some((a) => regKeyPattern.test(a.trim()))) {
        return PRIVILEGE;
      }
    }
  }

  // Privilege: ssh root@localhost
  if (name === 'ssh') {
    const sshRootRe = /^root@(?:localhost|127\.0\.0\.1|\[?::1\]?)$/i;
    if (args.some((a) => sshRootRe.test(a))) {
      return PRIVILEGE;
    }
  }

  // Privilege: history readers
  if (HISTORY_READERS.has(name)) {
    if (args.some((arg) => arg.includes('.bash_history') || arg.includes('.zsh_history'))) {
      return PRIVILEGE;
    }
    if (
      args.some((arg) => {
        const lower = arg.toLowerCase();
        return lower.includes('consolehost_history.txt') || lower.includes('historysavepath');
      })
    ) {
      return PRIVILEGE;
    }
  }

  // Full system upgrade
  if (is_full_upgrade(tokens[0], args)) {
    return FULL_UPGRADE;
  }

  // Recursive shells: sh, bash, dash, zsh, fish
  if (SHELLS.has(name)) {
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-c' && i + 1 < args.length) {
        return classify_shell(args[i + 1], depth + 1);
      }
    }
  }

  // PowerShell recursive shell
  if (name === 'powershell' || name === 'pwsh') {
    for (let i = 0; i < args.length; i++) {
      const lower = args[i].toLowerCase();
      if ((lower === '-command' || lower === '-c') && i + 1 < args.length) {
        const rest = args.slice(i + 1).join(' ');
        return classify_ps(rest, depth + 1);
      }
      if (lower.startsWith('-command:') || lower.startsWith('-c:')) {
        const colonIdx = args[i].indexOf(':');
        const rest = [args[i].slice(colonIdx + 1), ...args.slice(i + 1)].join(' ');
        return classify_ps(rest, depth + 1);
      }
    }
  }

  // CMD recursive shell
  if (name === 'cmd') {
    for (let i = 0; i < args.length; i++) {
      const lower = args[i].toLowerCase();
      if ((lower === '/c' || lower === '/k') && i + 1 < args.length) {
        const rest = args.slice(i + 1).join(' ');
        return classify_shell(rest, depth + 1);
      }
      if (lower.startsWith('/c:') || lower.startsWith('/k:')) {
        const colonIdx = args[i].indexOf(':');
        const rest = [args[i].slice(colonIdx + 1), ...args.slice(i + 1)].join(' ');
        return classify_shell(rest, depth + 1);
      }
    }
  }

  return null;
}

export function classify_shell(body, depth = 0) {
  if (depth > 2) {
    return null;
  }
  if (PASSWORD_GUESS_LOOP.test(body)) {
    return PRIVILEGE;
  }
  let commands;
  try {
    commands = shell_commands(body);
  } catch {
    return null;
  }
  for (const command of commands) {
    const result = classify_command(command, depth);
    if (result) {
      return result;
    }
  }
  return null;
}

function isLoopPrivilegeSegment(segment) {
  const text = segment.join(' ');
  const hasLoop =
    segment.some((tok) => {
      const lower = normalizeExe(tok);
      return lower === 'foreach' || lower === 'for' || lower === 'foreach-object' || lower === '%';
    }) ||
    /\b(foreach|for|foreach-object)\b/i.test(text) ||
    /(?:^|\s)%\s/.test(text);

  if (!hasLoop) return false;

  const hasPriv =
    segment.some((tok) => {
      const lower = tok.toLowerCase();
      return lower === 'runas' || lower === '-credential' || lower.startsWith('-credential:');
    }) || /(?:runas|-credential)\b/i.test(text);

  return hasPriv;
}

export function classify_ps(body, depth = 0) {
  if (depth > 2) {
    return null;
  }
  if (PASSWORD_GUESS_LOOP.test(body) || PS_PASSWORD_GUESS_LOOP.test(body)) {
    return PRIVILEGE;
  }
  const tokenized = psTokenize(body);
  if (!tokenized.ok) {
    return null; // fail open on tokenizer error, like upstream bad input
  }
  for (const segment of tokenized.segments) {
    if (isLoopPrivilegeSegment(segment)) {
      return PRIVILEGE;
    }
    const result = classify_command(segment, depth);
    if (result) {
      return result;
    }
  }
  return null;
}

/**
 * Pure evaluation function for excavator-shell-guard.
 * @param {object} payload - AGY hook input payload
 * @returns {{ decision: 'allow' | 'deny', reason?: string }}
 */
export function evaluate(payload) {
  if (!payload || typeof payload !== 'object') {
    return { decision: 'allow' };
  }

  const toolCall = payload.toolCall || {};
  if (toolCall.name !== 'run_command') {
    return { decision: 'allow' };
  }

  const args = toolCall.args || {};
  const command = typeof args.CommandLine === 'string' ? args.CommandLine : String(args.CommandLine || '');

  let isPs = false;
  let body = '';

  const psMatch = splitPsMarker(command, 'NTG_EXCAVATOR');
  if (psMatch.matched) {
    isPs = true;
    body = psMatch.body.trim();
  } else if (command.startsWith(MARKER)) {
    isPs = false;
    body = command.slice(MARKER.length).trim();
  } else {
    return { decision: 'allow' };
  }

  if (!body) {
    return { decision: 'deny', reason: 'Excavator shell command was empty.' };
  }

  const violation = isPs ? classify_ps(body, 0) : classify_shell(body, 0);
  if (violation) {
    return { decision: 'deny', reason: REASONS[violation] };
  }

  return { decision: 'allow' };
}

export async function main() {
  try {
    const raw = await readStdin();
    const parsed = parseJsonObject(raw);
    if (!parsed.ok) {
      emit({ decision: 'allow' });
      return;
    }
    const result = evaluate(parsed.value);
    emit(result);
  } catch {
    emit({ decision: 'allow' });
  }
}

if (isMain(import.meta.url)) {
  await main();
}
