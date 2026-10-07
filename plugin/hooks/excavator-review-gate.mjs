import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStdin, parseJsonObject, emit, isMain } from './lib/io.mjs';
import { isMarkedCommand } from './lib/markers.mjs';
import {
  normalizeKey,
  iterDicts,
  iterToolCalls,
  textContent,
  readTranscript,
  toolName,
  parseArgs,
  bannerRole,
  inboundRole,
  pairInvokeResults,
} from './lib/transcript.mjs';

export const EXCAVATOR_MARKER = 'NTG_EXCAVATOR=1 ';
export const ROLE_SIGNATURE = "You are Excavator, Native Gravity's autonomous troubleshooting primary agent.";

export const DIRECT_MUTATION_TOOLS = new Set([
  'write_to_file',
  'replace_file_content',
  'multi_replace_file_content',
]);

export const IDENTITY_KEYS = new Set([
  'agentname',
  'agent_name',
  'customagentname',
  'custom_agent_name',
  'selectedagent',
  'selected_agent',
]);

export const NORMAL_STOP_REASONS = new Set([
  'model_stop',
  'no_tool_call',
  'stop',
  'completed',
  'complete',
  '',
]);

export const REVIEW_REQUIRED =
  'Excavator completion requires an independent Zen review of the current artifact. ' +
  'Invoke only the `zen` subagent with the original task contract, current changed-artifact ' +
  'context, and verification evidence. Observe its verdict before claiming READY.';

export const REVIEW_PENDING =
  'Excavator cannot stop while background work is still active. Wait for the Zen review ' +
  'or other active verification to finish, then observe the result before claiming READY.';

export const REVIEW_NO_GO =
  'Zen returned VERDICT: NO-GO. Address the smallest concrete blockers, re-run relevant ' +
  'verification, then request a fresh Zen review. Do not claim READY yet.';

export const REVIEW_STALE =
  'The last Zen VERDICT: GO predates a later Excavator write or marked shell call. Re-run ' +
  'relevant verification and obtain a fresh Zen review of the current artifact before ' +
  'claiming READY.';

export const REVIEW_NO_VERDICT =
  'A Zen review was started but no final VERDICT: GO was observed. Wait for or inspect the ' +
  'review result before claiming READY.';

export const REVIEW_CONTRADICTORY =
  'Excavator reported contradictory terminal states (both READY and BLOCKED). Reconcile ' +
  'completion status before stopping.';

export const READY_LINE = /^\s*READY\s*$/;
export const STATUS_READY_LINE = /^\s*STATUS\s*[:\-\u2014]\s*READY\s*$/;
export const BLOCKED_LINE = /^\s*BLOCKED\s*$/;
export const STATUS_BLOCKED_LINE = /^\s*STATUS\s*[:\-\u2014]\s*BLOCKED\s*$/;

const PROMPT_KEYS = new Set([
  'systemprompt',
  'system_prompt',
  'systeminstruction',
  'system_instruction',
  'instructions',
]);

/**
 * Converts a file URI or local path string to a local filesystem path.
 * @param {string} uri
 * @returns {string}
 */
export function uriToPath(uri) {
  if (typeof uri !== 'string') return '';
  if (uri.startsWith('file://')) {
    try {
      return fileURLToPath(uri);
    } catch {
      let p = uri.slice(7);
      if (process.platform === 'win32' && /^\/[A-Za-z]:/.test(p)) {
        p = p.slice(1);
      }
      return p;
    }
  }
  return uri;
}

/**
 * Extracts and unquotes the command line string from a tool call.
 * @param {object} call
 * @returns {string}
 */
export function commandLine(call) {
  if (!call || typeof call !== 'object') return '';
  const args = parseArgs(call);
  let cmd = String(
    args.CommandLine || args.commandLine || args.command || ''
  ).trim();
  if (
    (cmd.startsWith('"') && cmd.endsWith('"')) ||
    (cmd.startsWith("'") && cmd.endsWith("'"))
  ) {
    cmd = cmd.slice(1, -1).trim();
  }
  return cmd;
}

/**
 * Checks whether any record contains an explicit structured excavator identity.
 * @param {any[]} records
 * @returns {boolean}
 */
export function hasStructuredExcavatorIdentity(records) {
  for (const record of records) {
    for (const node of iterDicts(record)) {
      for (const [key, value] of Object.entries(node)) {
        if (
          IDENTITY_KEYS.has(normalizeKey(key)) &&
          String(value || '').trim().toLowerCase() === 'excavator'
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Checks whether any record contains Excavator's system prompt signature.
 * @param {any[]} records
 * @returns {boolean}
 */
export function hasExcavatorSystemPrompt(records) {
  for (const record of records) {
    for (const node of iterDicts(record)) {
      const role = String(node.role || '').trim().toLowerCase();
      if (role === 'system' && textContent(node).includes(ROLE_SIGNATURE)) {
        return true;
      }
      for (const [key, value] of Object.entries(node)) {
        if (
          PROMPT_KEYS.has(normalizeKey(key)) &&
          textContent(value).includes(ROLE_SIGNATURE)
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Checks whether any record contains a marked Excavator shell invocation
 * (POSIX NTG_EXCAVATOR=1 or PowerShell $env:NTG_EXCAVATOR='1';).
 * @param {any[]} records
 * @returns {boolean}
 */
export function hasExcavatorMarker(records) {
  for (const record of records) {
    for (const call of iterToolCalls(record)) {
      if (toolName(call) === 'run_command') {
        const cmd = commandLine(call);
        if (isMarkedCommand(cmd, 'NTG_EXCAVATOR')) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Identifies whether the current session is an Excavator primary session.
 * Evaluates attribution channels in priority order:
 * 1. Payload roleHint / agentName / identity keys
 * 2. Transcript structured identity keys
 * 2b. Transcript system prompt with ROLE_SIGNATURE
 * 3. Inbound task message role (NTG_ROLE: excavator)
 * 4. Response banner role (NTG_ROLE: excavator)
 * 5. Marked command in transcript
 * @param {object} payload
 * @param {any[]} records
 * @returns {boolean}
 */
export function isExcavatorSession(payload, records) {
  // Channel 1: payload identity keys / roleHint / agentName
  if (payload && typeof payload === 'object') {
    for (const key of [
      'roleHint',
      'agentName',
      'agent_name',
      'customAgentName',
      'custom_agent_name',
      'selectedAgent',
      'selected_agent',
      'role',
    ]) {
      const rawVal = payload[key];
      if (rawVal !== undefined && rawVal !== null && String(rawVal).trim() !== '') {
        const val = String(rawVal).trim().toLowerCase();
        return val === 'excavator';
      }
    }
  }

  // Channel 2: transcript structured identity keys
  for (const record of records) {
    for (const node of iterDicts(record)) {
      for (const [key, value] of Object.entries(node)) {
        if (IDENTITY_KEYS.has(normalizeKey(key))) {
          const val = String(value || '').trim().toLowerCase();
          if (val === 'excavator') return true;
          if (val !== '') return false;
        }
      }
    }
  }

  // Channel 2b: system prompt with ROLE_SIGNATURE
  if (hasExcavatorSystemPrompt(records)) {
    return true;
  }

  // Channel 3: inbound role
  const inRole = inboundRole(records);
  if (inRole) {
    return inRole.toLowerCase() === 'excavator';
  }

  // Channel 4: banner role
  const bRole = bannerRole(records);
  if (bRole) {
    return bRole.toLowerCase() === 'excavator';
  }

  // Fallback: marked command in transcript
  if (hasExcavatorMarker(records)) {
    return true;
  }

  return false;
}

/**
 * Extracts assistant response text from a single transcript record.
 * @param {any} record
 * @returns {string|null}
 */
export function extractAssistantTextFromRecord(record) {
  if (record && typeof record === 'object' && !Array.isArray(record)) {
    const source = String(record.source || '').trim().toUpperCase();
    const recType = String(record.type || '').trim().toUpperCase();
    if (source === 'MODEL' && (recType === 'PLANNER_RESPONSE' || recType === 'GENERIC')) {
      const content = record.content;
      if (typeof content === 'string' && content.trim()) {
        if (!content.trim().startsWith('Created At:')) {
          return content;
        }
      }
    }

    for (const node of iterDicts(record)) {
      const role = String(node.role || '').trim().toLowerCase();
      if (role === 'assistant') {
        const text = textContent('content' in node ? node.content : node);
        if (text.trim()) {
          return text;
        }
      }
    }
  }
  return null;
}

/**
 * Finds the latest assistant message text in the transcript tail.
 * @param {any[]} records
 * @returns {string|null}
 */
export function getLatestAssistantText(records) {
  for (let i = records.length - 1; i >= 0; i--) {
    const text = extractAssistantTextFromRecord(records[i]);
    if (text !== null) {
      return text;
    }
  }
  return null;
}

/**
 * Determines whether a tool call represents a Zen subagent invocation.
 * @param {object} call
 * @returns {boolean}
 */
export function isZenInvocation(call) {
  if (toolName(call) !== 'invoke_subagent') {
    return false;
  }
  const args = parseArgs(call);
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return false;
  }

  let subagents = args.Subagents !== undefined ? args.Subagents : args.subagents;
  let items = [];

  if (typeof subagents === 'string') {
    try {
      const parsed = JSON.parse(subagents);
      if (Array.isArray(parsed)) {
        items = parsed;
      } else if (parsed && typeof parsed === 'object') {
        items = [parsed];
      }
    } catch {
      items = [];
    }
  } else if (Array.isArray(subagents)) {
    items = subagents;
  } else if (subagents && typeof subagents === 'object') {
    items = [subagents];
  } else {
    items = [args];
  }

  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue;
    }
    for (const [k, v] of Object.entries(item)) {
      const normKey = normalizeKey(k);
      if (normKey === 'typename' || normKey === 'type_name') {
        if (String(v || '').trim().toLowerCase() === 'zen') {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Detects whether a record performs material mutation or shell execution
 * that potentially invalidates prior review freshness.
 * @param {any} record
 * @returns {boolean}
 */
export function materialChangeCandidateIn(record) {
  for (const call of iterToolCalls(record)) {
    const name = toolName(call);
    if (DIRECT_MUTATION_TOOLS.has(name)) {
      return true;
    }
    if (name === 'run_command') {
      const cmd = commandLine(call);
      if (isMarkedCommand(cmd, 'NTG_EXCAVATOR')) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Validates provider system message origin and extracts payload.
 * Model-generated records (including forged system message strings) are strictly rejected.
 * @param {any} record
 * @returns {{isSystem: boolean, sender: string|null, payload: string}}
 */
export function isProviderSystemMessage(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return { isSystem: false, sender: null, payload: '' };
  }
  const source = String(record.source || '').trim().toUpperCase();
  if (source === 'MODEL') {
    return { isSystem: false, sender: null, payload: '' };
  }
  const role = String(record.role || '').trim().toLowerCase();
  if (role === 'assistant') {
    return { isSystem: false, sender: null, payload: '' };
  }

  for (const node of iterDicts(record)) {
    if (String(node.role || '').trim().toLowerCase() === 'assistant') {
      return { isSystem: false, sender: null, payload: '' };
    }
    if (String(node.source || '').trim().toUpperCase() === 'MODEL') {
      return { isSystem: false, sender: null, payload: '' };
    }
  }

  const recType = String(record.type || '').trim().toUpperCase();
  let content = String(record.content || '');

  let isSystem = (source === 'SYSTEM' && recType === 'SYSTEM_MESSAGE') || role === 'system';
  if (!isSystem) {
    for (const node of iterDicts(record)) {
      if (String(node.role || '').trim().toLowerCase() === 'system') {
        isSystem = true;
        if (!content) {
          content = textContent(node);
        }
        break;
      }
    }
  }

  if (!isSystem) {
    return { isSystem: false, sender: null, payload: '' };
  }

  const m = content.match(
    /\[Message\][^\n]*\bsender=([^\s]+)[^\n]*\bcontent=([\s\S]*?)(?:<\/SYSTEM_MESSAGE>|$)/
  );
  if (m) {
    const sender = m[1].replace(/^["']|["']$/g, '').trim();
    const payload = m[2].trim();
    return { isSystem: true, sender, payload };
  }

  return { isSystem: true, sender: null, payload: content };
}

/**
 * Extracts conversationId and logAbsoluteUri from a subagent creation record.
 * @param {any} record
 * @returns {{convId: string|null, logUri: string|null}}
 */
export function extractCreatedSubagent(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return { convId: null, logUri: null };
  }
  const content = String(record.content || '');
  if (
    !content.includes('Created the following subagents:') &&
    !content.includes('conversationId')
  ) {
    return { convId: null, logUri: null };
  }
  let convId = null;
  let logUri = null;
  const mCid = content.match(/"conversationId":\s*"([^"]+)"/);
  if (mCid) convId = mCid[1].trim();
  const mUri = content.match(/"logAbsoluteUri":\s*"([^"]+)"/);
  if (mUri) logUri = mUri[1].trim();
  return { convId, logUri };
}

/**
 * Checks whether a legacy tool record returned a verdict.
 * @param {any} record
 * @returns {boolean}
 */
export function isLegacyToolRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return false;
  }
  const source = String(record.source || '').trim().toUpperCase();
  if (source === 'MODEL') return false;
  const role = String(record.role || '').trim().toLowerCase();
  if (role === 'assistant') return false;
  if (role === 'tool') return true;
  for (const node of iterDicts(record)) {
    const r = String(node.role || '').trim().toLowerCase();
    if (r === 'assistant') return false;
    if (r === 'tool') return true;
  }
  return false;
}

/**
 * Parses VERDICT: GO or VERDICT: NO-GO from arbitrary text.
 * @param {string} text
 * @returns {'GO'|'NO-GO'|null}
 */
export function extractVerdictFromText(text) {
  if (typeof text !== 'string') return null;
  const hasNoGo = text.includes('VERDICT: NO-GO');
  const hasGo = text.includes('VERDICT: GO');
  if (hasNoGo) return 'NO-GO';
  if (hasGo && !hasNoGo) return 'GO';
  return null;
}

/**
 * Inspects a child transcript file to discover send_message or final content verdict.
 * @param {string} uri
 * @returns {'GO'|'NO-GO'|null}
 */
export function checkChildLogVerdict(uri) {
  try {
    const filePath = path.resolve(uriToPath(uri));
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return null;
    }
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/);
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line) continue;
      let data;
      try {
        data = JSON.parse(line);
      } catch {
        continue;
      }
      if (!data || typeof data !== 'object') continue;

      const tcList = Array.isArray(data.tool_calls) ? data.tool_calls : [];
      for (const tc of tcList) {
        if (toolName(tc) === 'send_message') {
          const args = parseArgs(tc);
          const msg = String(args.Message || args.message || '');
          const v = extractVerdictFromText(msg);
          if (v) return v;
        }
      }

      const c = String(data.content || '');
      const v = extractVerdictFromText(c);
      if (v) return v;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Reconstructs the Zen review state, tracking invocation, verdict freshness,
 * and subsequent material modifications.
 * @param {any[]} records
 * @returns {{zenStarted: boolean, latestVerdict: string|null, verdictIndex: number, latestChange: number}}
 */
export function reviewState(records) {
  let zenStarted = false;
  let latestVerdict = null;
  let verdictIndex = -1;
  let latestChange = -1;
  let activeZenConvId = null;
  let activeZenLogUri = null;
  let awaitingSubagentCreation = false;

  // Pre-pair invocations using pairInvokeResults
  const pairs = pairInvokeResults(records);
  const pairedZenByRecord = new Map();
  for (const pair of pairs) {
    if (isZenInvocation(pair.call)) {
      const args = parseArgs(pair.call);
      let subagents = args.Subagents !== undefined ? args.Subagents : args.subagents;
      let items = [];
      if (typeof subagents === 'string') {
        try {
          const parsed = JSON.parse(subagents);
          if (Array.isArray(parsed)) items = parsed;
          else if (parsed && typeof parsed === 'object') items = [parsed];
        } catch {}
      } else if (Array.isArray(subagents)) {
        items = subagents;
      } else if (subagents && typeof subagents === 'object') {
        items = [subagents];
      } else {
        items = [args];
      }

      let zenIdx = 0;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item || typeof item !== 'object') continue;
        for (const [k, v] of Object.entries(item)) {
          const normKey = normalizeKey(k);
          if (normKey === 'typename' || normKey === 'type_name') {
            if (String(v || '').trim().toLowerCase() === 'zen') {
              zenIdx = i;
              break;
            }
          }
        }
      }

      const cid =
        (pair.childIds && pair.childIds[zenIdx]) ||
        (pair.childIds && pair.childIds[0]) ||
        null;
      const uri =
        (pair.logUris && pair.logUris[zenIdx]) ||
        (pair.logUris && pair.logUris[0]) ||
        null;
      pairedZenByRecord.set(pair.recordIndex, { cid, uri });
    }
  }

  for (let index = 0; index < records.length; index++) {
    const record = records[index];

    if (materialChangeCandidateIn(record)) {
      latestChange = index;
    }

    const invokedHere = Array.from(iterToolCalls(record)).some((call) =>
      isZenInvocation(call)
    );
    if (invokedHere) {
      zenStarted = true;
      latestVerdict = null;
      verdictIndex = -1;
      const paired = pairedZenByRecord.get(index);
      if (paired && paired.cid) {
        activeZenConvId = paired.cid;
        activeZenLogUri = paired.uri;
        awaitingSubagentCreation = false;
      } else {
        activeZenConvId = null;
        activeZenLogUri = null;
        awaitingSubagentCreation = true;
      }
      continue;
    }

    if (zenStarted && awaitingSubagentCreation) {
      const { convId, logUri } = extractCreatedSubagent(record);
      if (convId) {
        activeZenConvId = convId;
        activeZenLogUri = logUri;
        awaitingSubagentCreation = false;
      }
    }

    if (zenStarted) {
      const sysMsg = isProviderSystemMessage(record);
      if (sysMsg.isSystem) {
        if (activeZenConvId !== null) {
          if (sysMsg.sender === activeZenConvId) {
            const v = extractVerdictFromText(sysMsg.payload);
            if (v) {
              latestVerdict = v;
              verdictIndex = index;
            }
          }
        } else {
          const v = extractVerdictFromText(sysMsg.payload);
          if (v) {
            latestVerdict = v;
            verdictIndex = index;
          }
        }
        continue;
      }

      if (isLegacyToolRecord(record)) {
        const v = extractVerdictFromText(textContent(record));
        if (v) {
          latestVerdict = v;
          verdictIndex = index;
        }
        continue;
      }

      if (activeZenLogUri && latestVerdict === null) {
        const v = checkChildLogVerdict(activeZenLogUri);
        if (v) {
          latestVerdict = v;
          verdictIndex = index;
        }
      }
    }
  }

  return {
    zenStarted,
    latestVerdict,
    verdictIndex,
    latestChange,
  };
}

/**
 * Pure evaluation function for the Excavator Stop review gate.
 * Fails open with { decision: 'stop' } on error or non-excavator sessions.
 * @param {object} payload
 * @returns {{decision: 'stop'|'continue', reason?: string}}
 */
export function evaluate(payload) {
  try {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { decision: 'stop' };
    }

    const reason = String(payload.terminationReason || '').trim().toLowerCase();
    const error = String(payload.error || '').trim();
    if (error || !NORMAL_STOP_REASONS.has(reason)) {
      return { decision: 'stop' };
    }

    const records = Array.isArray(payload.records)
      ? payload.records
      : readTranscript(payload.transcriptPath);
    if (!records || records.length === 0) {
      return { decision: 'stop' };
    }

    const isExcavator = isExcavatorSession(payload, records);
    if (!isExcavator) {
      return { decision: 'stop' };
    }

    const latestText = getLatestAssistantText(records);
    if (latestText === null) {
      return { decision: 'stop' };
    }

    const lines = latestText.split(/\r?\n/);
    const hasReady = lines.some(
      (line) => READY_LINE.test(line) || STATUS_READY_LINE.test(line)
    );
    const hasBlocked = lines.some(
      (line) => BLOCKED_LINE.test(line) || STATUS_BLOCKED_LINE.test(line)
    );

    if (hasReady && hasBlocked) {
      return { decision: 'continue', reason: REVIEW_CONTRADICTORY };
    }

    if (hasBlocked) {
      return { decision: 'stop' };
    }

    if (!hasReady) {
      return { decision: 'stop' };
    }

    const { zenStarted, latestVerdict, verdictIndex, latestChange } =
      reviewState(records);

    const fullyIdle =
      payload.fullyIdle === undefined ? true : Boolean(payload.fullyIdle);
    if (!fullyIdle) {
      return { decision: 'continue', reason: REVIEW_PENDING };
    }

    if (!zenStarted) {
      return { decision: 'continue', reason: REVIEW_REQUIRED };
    }

    if (latestVerdict === 'NO-GO') {
      return { decision: 'continue', reason: REVIEW_NO_GO };
    }

    if (latestVerdict !== 'GO') {
      return { decision: 'continue', reason: REVIEW_NO_VERDICT };
    }

    if (latestChange > verdictIndex) {
      return { decision: 'continue', reason: REVIEW_STALE };
    }

    return { decision: 'stop' };
  } catch {
    return { decision: 'stop' };
  }
}

/**
 * CLI process entry point.
 */
export async function main() {
  try {
    const raw = await readStdin();
    const parsed = parseJsonObject(raw);
    if (!parsed.ok) {
      emit({ decision: 'stop' });
      return;
    }
    const result = evaluate(parsed.value);
    emit(result);
  } catch {
    emit({ decision: 'stop' });
  }
}

if (isMain(import.meta.url)) {
  await main();
}
