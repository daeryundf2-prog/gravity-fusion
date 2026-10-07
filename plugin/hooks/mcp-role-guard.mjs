import { readStdin, parseJsonObject, emit, isMain } from './lib/io.mjs';
import {
  normalizeKey,
  iterDicts,
  toolName,
  parseArgs,
  decodeHubValue,
  readTranscript,
  inboundRole,
  bannerRole,
  textContent,
} from './lib/transcript.mjs';
import { pySplit } from './lib/shell-lex.mjs';

/**
 * PreToolUse hook matcher for MCP tool invocations.
 */
export const MATCHER = /^(call_mcp_tool|mcp_tool|mcp_.+)$/i;

/**
 * Known Native Gravity structured identity keys.
 */
const IDENTITY_KEYS = new Set([
  'agentname',
  'agent_name',
  'customagentname',
  'custom_agent_name',
  'selectedagent',
  'selected_agent',
]);

/**
 * Native Gravity upstream role signature sentences.
 */
const ROLE_SIGNATURES = [
  ['bulldozer', "You are Bulldozer, Native Gravity's general Host and orchestrator."],
  ['excavator', "You are Excavator, Native Gravity's autonomous troubleshooting primary agent."],
  ['piledriver', "You are Piledriver, Native Gravity's plan-first primary agent."],
  ['steamroller', "You are Steamroller, Native Gravity's deep decision specialist."],
  ['zen', "You are the independent, non-mutating verification gate."],
  ['jaguar', "Your role is factual retrieval for Bulldozer."],
  ['strix-halo', "Act as Bobcat's read-only implementation advisor and local gate."],
  ['bobcat', "You implement the bounded contract received from Bulldozer."],
  ['puma', "Perform small, explicit, low-risk writing, formatting, and mechanical"],
];

/**
 * Read-only Native Gravity roles.
 */
const READ_ONLY_ROLES = new Set([
  'jaguar',
  'zen',
  'steamroller',
  'strix-halo',
  'strix_halo',
  'piledriver',
]);

/**
 * Known MCP server prefixes for mcp_<server>_<tool> parsing (longest prefix first).
 */
const KNOWN_SERVERS = [
  'lazyantigravity_korean_law_offline',
  'lazyothers_sequential-thinking',
  'lazyothers_sequential_thinking',
  'lazyantigravity_ast_index',
  'lazyantigravity_workspace',
  'lazyantigravity_ast_grep',
  'lazyantigravity_git_bash',
  'lazyantigravity_research',
  'lazyothers_playwright',
  'lazyantigravity_media',
  'lazyothers_context7',
  'lazyantigravity_lsp',
  'lazyothers_kordoc',
];

/**
 * Upstream Zen git read subcommands.
 */
const GIT_READ_SUBCOMMANDS = new Set([
  'status',
  'diff',
  'log',
  'show',
  'ls-files',
  'ls-tree',
  'rev-parse',
  'rev-list',
  'show-ref',
  'cat-file',
  'describe',
]);

/**
 * Upstream Zen safe git long options.
 */
const GIT_SAFE_LONG_OPTIONS = new Set([
  '--short',
  '--branch',
  '--porcelain',
  '--untracked-files',
  '--ignored',
  '--stat',
  '--name-only',
  '--name-status',
  '--numstat',
  '--shortstat',
  '--check',
  '--cached',
  '--staged',
  '--no-ext-diff',
  '--no-textconv',
  '--exit-code',
  '--quiet',
  '--relative',
  '--binary',
  '--oneline',
  '--graph',
  '--decorate',
  '--no-decorate',
  '--all',
  '--pretty',
  '--format',
  '--abbrev-ref',
  '--verify',
  '--show-toplevel',
  '--',
]);

/**
 * Extracts role from payload keys (Channel 1).
 * @param {object} payload
 * @returns {string|null}
 */
function detectRoleFromPayload(payload) {
  if (!payload || typeof payload !== 'object') return null;

  const directCandidates = [
    payload.roleHint,
    payload.role_hint,
    payload.agentName,
    payload.agent_name,
    payload.role,
  ];
  for (const cand of directCandidates) {
    if (typeof cand === 'string' && cand.trim()) {
      return cand.trim().toLowerCase();
    }
  }

  for (const [key, val] of Object.entries(payload)) {
    if (typeof val === 'string' && val.trim() && IDENTITY_KEYS.has(normalizeKey(key))) {
      return val.trim().toLowerCase();
    }
  }

  return null;
}

/**
 * Extracts role from transcript records (Channels 2-4).
 * @param {any[]} records
 * @returns {string|null}
 */
function detectRoleFromTranscript(records) {
  if (!Array.isArray(records) || records.length === 0) return null;

  // Channel 2: transcript structured identity keys
  for (const record of records) {
    for (const dict of iterDicts(record)) {
      for (const [key, val] of Object.entries(dict)) {
        if (typeof val === 'string' && val.trim() && IDENTITY_KEYS.has(normalizeKey(key))) {
          return val.trim().toLowerCase();
        }
      }
    }
  }

  // Channel 2: upstream role signature sentences
  const fullText = textContent(records);
  for (const [roleName, sig] of ROLE_SIGNATURES) {
    if (fullText.includes(sig)) {
      return roleName;
    }
  }

  // Channel 3: first inbound task message (inboundRole)
  const inbound = inboundRole(records);
  if (inbound) {
    return inbound;
  }

  // Channel 4: banner line of first PLANNER_RESPONSE (bannerRole)
  const banner = bannerRole(records);
  if (banner) {
    return banner;
  }

  return null;
}

/**
 * Resolves the active role via Section 4 priority channels:
 * 1. Payload keys (roleHint, agentName, identity keys).
 * 2. Transcript structured identity keys and role signature sentences.
 * 3. Inbound task prompt (inboundRole).
 * 4. Response banner (bannerRole).
 * @param {object} payload
 * @returns {string|null}
 */
export function detectRole(payload) {
  if (!payload || typeof payload !== 'object') return null;

  const fromPayload = detectRoleFromPayload(payload);
  if (fromPayload) return fromPayload;

  const transcriptPath = payload.transcriptPath || payload.transcript_path;
  let records = [];
  if (transcriptPath) {
    records = readTranscript(transcriptPath);
  } else if (Array.isArray(payload.transcript)) {
    records = payload.transcript;
  }

  return detectRoleFromTranscript(records);
}

/**
 * Checks whether a detected role is in the read-only list.
 * @param {string|null} role
 * @returns {boolean}
 */
export function isReadOnlyRole(role) {
  if (!role || typeof role !== 'string') return false;
  return READ_ONLY_ROLES.has(normalizeKey(role));
}

/**
 * Parses tool call target into { server, tool, args }.
 * Supports both {ServerName, ToolName} inside args and mcp_<server>_<tool> names.
 * @param {object} call
 * @returns {{ server: string|null, tool: string|null, args: object } | null}
 */
export function parseToolTarget(call) {
  if (!call || typeof call !== 'object') return null;
  const callName = toolName(call);
  if (!callName) return null;

  const parsedArgs = parseArgs(call);

  if (callName === 'call_mcp_tool' || callName === 'mcp_tool') {
    const server =
      parsedArgs.ServerName ??
      parsedArgs.serverName ??
      parsedArgs.server_name ??
      parsedArgs.Server ??
      parsedArgs.server;
    const tool =
      parsedArgs.ToolName ??
      parsedArgs.toolName ??
      parsedArgs.tool_name ??
      parsedArgs.Tool ??
      parsedArgs.tool;

    return {
      server: server ? String(server).trim() : null,
      tool: tool ? String(tool).trim() : null,
      args: parsedArgs,
    };
  }

  if (callName.startsWith('mcp_')) {
    const remainder = callName.slice(4);
    for (const known of KNOWN_SERVERS) {
      if (remainder.startsWith(known + '_') || remainder.startsWith(known + '-')) {
        return {
          server: known,
          tool: remainder.slice(known.length + 1),
          args: parsedArgs,
        };
      }
    }
    const match = remainder.match(/^([a-z0-9_-]+?)_([a-z0-9_-]+)$/i);
    if (match) {
      return {
        server: match[1],
        tool: match[2],
        args: parsedArgs,
      };
    }
    return {
      server: null,
      tool: remainder,
      args: parsedArgs,
    };
  }

  return null;
}

/**
 * Extracts command string from args object/nested Arguments.
 * @param {any} args
 * @returns {string}
 */
export function extractCommand(args) {
  if (!args) return '';
  if (typeof args === 'string') {
    const decoded = decodeHubValue(args);
    if (typeof decoded === 'object' && decoded !== null) {
      return extractCommand(decoded);
    }
    return args.trim();
  }
  if (typeof args !== 'object') return '';

  let targetObj = args;
  if ('Arguments' in args || 'arguments' in args) {
    const rawArg = args.Arguments ?? args.arguments;
    if (typeof rawArg === 'string') {
      const decoded = decodeHubValue(rawArg);
      if (typeof decoded === 'object' && decoded !== null) {
        targetObj = decoded;
      } else {
        return rawArg.trim();
      }
    } else if (typeof rawArg === 'object' && rawArg !== null) {
      targetObj = rawArg;
    }
  }

  const cmd = targetObj.command ?? targetObj.CommandLine ?? targetObj.cmd ?? '';
  if (typeof cmd === 'string') {
    const decodedCmd = decodeHubValue(cmd);
    return typeof decodedCmd === 'string' ? decodedCmd.trim() : String(decodedCmd).trim();
  }
  return '';
}

/**
 * Verifies if a command string is an allowed Zen git read command.
 * @param {string} cmdString
 * @returns {boolean}
 */
export function isZenGitReadCommand(cmdString) {
  if (!cmdString || typeof cmdString !== 'string') return false;
  const trimmed = cmdString.trim();
  if (!trimmed) return false;

  // Reject shell chaining, redirects, subshells, substitutions
  if (/[;&|\n<>`$()]/.test(trimmed)) {
    return false;
  }

  let tokens;
  try {
    tokens = pySplit(trimmed);
  } catch {
    return false;
  }
  if (!tokens || tokens.length === 0) return false;

  const firstWord = tokens[0].toLowerCase();
  if (firstWord !== 'git' && firstWord !== 'git.exe') {
    return false;
  }

  let args = tokens.slice(1);
  if (args.length > 0 && args[0] === '--no-optional-locks') {
    args = args.slice(1);
  }
  if (args.length === 0) return false;

  const subcmd = args[0].toLowerCase();
  if (!GIT_READ_SUBCOMMANDS.has(subcmd)) {
    return false;
  }

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const opt = arg.split('=', 1)[0];
      if (!GIT_SAFE_LONG_OPTIONS.has(opt)) {
        return false;
      }
    } else if (arg.startsWith('-o')) {
      return false;
    }
  }

  return true;
}

/**
 * Evaluates whether an MCP tool target is in the read-only allowlist.
 * @param {string} server
 * @param {string} tool
 * @param {object} args
 * @returns {boolean}
 */
export function isAllowedMcpTool(server, tool, args) {
  if (!server || !tool) return false;
  const s = normalizeKey(server);
  const t = String(tool).trim().toLowerCase();

  if (s === 'lazyantigravity_ast_grep') {
    return t === 'ast_grep_search';
  }
  if (s === 'lazyantigravity_ast_index') {
    return t === 'ast_index_find' || t === 'ast_index_callers' || t === 'ast_index_impact';
  }
  if (s === 'lazyantigravity_lsp') {
    return (
      t === 'lsp_diagnostics' ||
      t === 'lsp_definitions' ||
      t === 'lsp_references' ||
      t === 'lsp_symbols'
    );
  }
  if (s === 'lazyantigravity_research') {
    return true;
  }
  if (s === 'lazyantigravity_korean_law_offline') {
    return true;
  }
  if (s === 'lazyantigravity_workspace') {
    return (
      t === 'memory_search' ||
      t === 'blackboard_get' ||
      t === 'blackboard_list' ||
      t === 'session_tree_render'
    );
  }
  if (s === 'lazyantigravity_media') {
    return (
      t === 'media_probe' ||
      t === 'media_ocr' ||
      t === 'media_transcribe' ||
      t === 'media_transcribe_status'
    );
  }
  if (s === 'lazyothers_context7') {
    return true;
  }
  if (s === 'lazyothers_sequential_thinking') {
    return true;
  }
  if (s === 'lazyantigravity_git_bash') {
    if (t === 'git_bash_execute') {
      const cmd = extractCommand(args);
      return isZenGitReadCommand(cmd);
    }
    return false;
  }

  return false;
}

/**
 * Pure evaluation function for PreToolUse MCP hook.
 * @param {object} payload
 * @returns {{ decision: 'allow'|'deny', reason: string }}
 */
export function evaluate(payload) {
  try {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { decision: 'allow', reason: 'Malformed or unhandled MCP tool payload' };
    }

    const call = payload.toolCall || payload.tool_call || payload.call;
    if (!call || typeof call !== 'object') {
      return { decision: 'allow', reason: 'Malformed or unhandled MCP tool payload' };
    }

    const cName = toolName(call);
    if (!MATCHER.test(cName)) {
      return { decision: 'allow', reason: 'Not an MCP tool' };
    }

    const role = detectRole(payload);
    if (!isReadOnlyRole(role)) {
      return { decision: 'allow', reason: 'Not a read-only Native Gravity role' };
    }

    const targetInfo = parseToolTarget(call);
    if (!targetInfo || !targetInfo.server || !targetInfo.tool) {
      const fallbackTarget = targetInfo?.tool || cName;
      return {
        decision: 'deny',
        reason: `Role ${role} is restricted from mutating MCP tool: ${fallbackTarget}`,
      };
    }

    const { server, tool, args } = targetInfo;
    const target = `${server}:${tool}`;

    if (isAllowedMcpTool(server, tool, args)) {
      return {
        decision: 'allow',
        reason: `Read-only MCP tool permitted for ${role}`,
      };
    }

    return {
      decision: 'deny',
      reason: `Role ${role} is restricted from mutating MCP tool: ${target}`,
    };
  } catch {
    return { decision: 'allow', reason: 'Malformed or unhandled MCP tool payload' };
  }
}

/**
 * CLI main entry point.
 */
export async function main() {
  try {
    const raw = await readStdin();
    const parsed = parseJsonObject(raw);
    if (!parsed.ok) {
      emit({ decision: 'allow', reason: 'Malformed or unhandled MCP tool payload' });
      return;
    }
    const result = evaluate(parsed.value);
    emit(result);
  } catch {
    emit({ decision: 'allow', reason: 'Malformed or unhandled MCP tool payload' });
  }
}

if (isMain(import.meta.url)) {
  main();
}
