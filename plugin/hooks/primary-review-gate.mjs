import { readStdin, parseJsonObject, emit, isMain } from './lib/io.mjs';
import {
  normalizeKey,
  iterDicts,
  iterToolCalls,
  textContent,
  toolName,
  parseArgs,
  readTranscript,
  firstInboundText,
  bannerRole,
  inboundRole,
  pairInvokeResults,
} from './lib/transcript.mjs';

export const ROLE_SIGNATURES = {
  bulldozer: "You are Bulldozer, Native Gravity's general Host and orchestrator.",
  piledriver: "You are Piledriver, Native Gravity's plan-first primary agent.",
};

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

export const READY_LINE = /^\s*READY\s*$/;
export const STATUS_READY_LINE = /^\s*STATUS\s*[:\-\u2014]\s*READY\s*$/;
export const BLOCKED_LINE = /^\s*BLOCKED\s*$/;
export const STATUS_BLOCKED_LINE = /^\s*STATUS\s*[:\-\u2014]\s*BLOCKED\s*$/;
export const PLAN_READY_LINE = /^\s*PLAN READY\s*$/;

export const REVIEW_PENDING =
  'A Zen review request is still pending. Wait for the current Zen child to return an ' +
  'observed verdict before stopping; requesting or messaging the reviewer is not review evidence.';

export const REVIEW_REQUIRED_BULLDOZER =
  'Bulldozer successful completion requires an independent Zen review of the current integrated ' +
  'artifact and an observed current VERDICT: GO before the final READY status.';

export const REVIEW_REQUIRED_PILEDRIVER =
  'Piledriver PLAN READY requires an independent Zen review of the current plan and an observed ' +
  'current VERDICT: GO.';

export const REVIEW_NO_GO =
  'The current Zen review returned VERDICT: NO-GO. Address only the concrete blockers within the ' +
  'active primary role, re-verify as needed, then request a fresh Zen review before claiming readiness.';

export const REVIEW_NO_VERDICT =
  'The current Zen review has no observed provenance-bound verdict. Do not convert a review request, ' +
  'self-report, or unrelated transcript text into VERDICT: GO.';

export const CONTRADICTORY =
  'The primary agent reported contradictory terminal states. Reconcile the completion status before stopping.';

const PREFERRED_TARGET_KEYS = new Set([
  'conversationid',
  'conversation_id',
  'targetconversationid',
  'target_conversation_id',
  'recipient',
  'recipientid',
  'recipient_id',
  'subagentid',
  'subagent_id',
]);

function isDict(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function hasLine(pattern, text) {
  if (typeof text !== 'string') return false;
  return text.split(/\r?\n/).some((line) => pattern.test(line));
}

function normalizeRoleHint(value) {
  const candidate = String(value || '').trim().toLowerCase();
  return candidate in ROLE_SIGNATURES ? candidate : null;
}

/**
 * Resolves the primary role for this Stop event.
 * Priority order:
 * 1. payload roleHint / agentName / identity keys (gated roles only)
 * 2. transcript structured identity keys / signature sentences
 * 3. first inbound task message (USER_INPUT or SYSTEM_MESSAGE)
 * 4. banner in first MODEL PLANNER_RESPONSE
 *
 * @param {any[]} records
 * @param {object} payload
 * @returns {string|null}
 */
export function detectPrimaryRole(records, payload) {
  if (!Array.isArray(records)) records = [];

  // Channel 1: payload roleHint / agentName / identity keys
  if (isDict(payload)) {
    const hint = normalizeRoleHint(payload.roleHint || payload.agentName);
    if (hint !== null) {
      return hint;
    }
    for (const [key, value] of Object.entries(payload)) {
      if (IDENTITY_KEYS.has(normalizeKey(key))) {
        const candidate = normalizeRoleHint(value);
        if (candidate !== null) {
          return candidate;
        }
      }
    }
  }

  // Channel 2: transcript structured identity keys & role signatures
  for (const record of records) {
    for (const node of iterDicts(record)) {
      for (const [key, value] of Object.entries(node)) {
        if (IDENTITY_KEYS.has(normalizeKey(key))) {
          const candidate = normalizeRoleHint(value);
          if (candidate !== null) {
            return candidate;
          }
        }
      }
    }
  }

  const fullText = textContent(records);
  for (const [role, signature] of Object.entries(ROLE_SIGNATURES)) {
    if (fullText.includes(signature)) {
      return role;
    }
  }

  // Channel 3: first inbound task message (USER_INPUT or SYSTEM_MESSAGE)
  const inbound = inboundRole(records);
  if (inbound !== null) {
    return inbound;
  }
  // Upstream regex compatibility for NTG_ROLE [:=] or ## Role heading
  const inboundText = firstInboundText(records);
  if (inboundText) {
    const marker = inboundText.match(/NTG_ROLE\s*[:=]\s*([a-zA-Z_-]+)/i);
    if (marker) {
      return marker[1].toLowerCase();
    }
    const roleHeading = inboundText.match(/^\s*#+\s*Role\s*\r?\n\s*([a-zA-Z_-]+)/m);
    if (roleHeading) {
      return roleHeading[1].toLowerCase();
    }
  }

  // Channel 4: banner in first MODEL PLANNER_RESPONSE
  const banner = bannerRole(records);
  if (banner !== null) {
    return banner;
  }

  return null;
}

export function extractAssistantTextFromRecord(record) {
  if (isDict(record)) {
    const source = String(record.source || '').trim().toUpperCase();
    const type = String(record.type || '').trim().toUpperCase();

    if (source === 'MODEL' && (type === 'PLANNER_RESPONSE' || type === 'GENERIC')) {
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

export function getLatestAssistantText(records) {
  if (!Array.isArray(records)) return null;
  for (let i = records.length - 1; i >= 0; i--) {
    const text = extractAssistantTextFromRecord(records[i]);
    if (text !== null) {
      return text;
    }
  }
  return null;
}

export function isZenInvocation(call) {
  if (toolName(call) !== 'invoke_subagent') {
    return false;
  }
  const args = parseArgs(call);
  let subagents = args.Subagents !== undefined ? args.Subagents : args.subagents;

  let items = [];
  if (typeof subagents === 'string') {
    try {
      const parsed = JSON.parse(subagents);
      if (Array.isArray(parsed)) items = parsed;
      else if (isDict(parsed)) items = [parsed];
    } catch {}
  } else if (Array.isArray(subagents)) {
    items = subagents;
  } else if (isDict(subagents)) {
    items = [subagents];
  } else {
    items = [args];
  }

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    for (const [key, value] of Object.entries(item)) {
      const k = normalizeKey(key);
      if (k === 'typename' || k === 'type_name') {
        if (String(value || '').trim().toLowerCase() === 'zen') {
          return true;
        }
      }
    }
  }
  return false;
}

export function extractCreatedSubagent(record) {
  if (!isDict(record)) {
    return null;
  }
  const content = String(record.content || '');
  if (!content.includes('Created the following subagents:') && !content.includes('conversationId')) {
    return null;
  }
  const match = content.match(/"conversationId":\s*"([^"]+)"/);
  return match ? match[1].trim() : null;
}

function getZenChildIdFromPair(pair) {
  const args = parseArgs(pair.call);
  let subagents = args.Subagents !== undefined ? args.Subagents : args.subagents;
  let items = [];
  if (typeof subagents === 'string') {
    try {
      const parsed = JSON.parse(subagents);
      if (Array.isArray(parsed)) items = parsed;
      else if (isDict(parsed)) items = [parsed];
    } catch {}
  } else if (Array.isArray(subagents)) {
    items = subagents;
  } else if (isDict(subagents)) {
    items = [subagents];
  } else {
    items = [args];
  }

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item || typeof item !== 'object') continue;
    for (const [key, value] of Object.entries(item)) {
      const k = normalizeKey(key);
      if (k === 'typename' || k === 'type_name') {
        if (String(value || '').trim().toLowerCase() === 'zen') {
          if (i < pair.childIds.length) {
            return pair.childIds[i];
          }
          return pair.childIds[0] || null;
        }
      }
    }
  }
  return null;
}

export function callTargetsConversation(call, conversationId) {
  if (toolName(call) !== 'send_message') {
    return false;
  }
  const args = parseArgs(call);
  if (!args || Object.keys(args).length === 0) {
    return false;
  }

  for (const [key, value] of Object.entries(args)) {
    if (
      PREFERRED_TARGET_KEYS.has(normalizeKey(key)) &&
      String(value || '').trim() === conversationId
    ) {
      return true;
    }
  }

  for (const value of Object.values(args)) {
    if (typeof value === 'string' && value.trim() === conversationId) {
      return true;
    }
  }

  return false;
}

export function isProviderSystemMessage(record) {
  if (!isDict(record)) {
    return { isSystem: false, sender: null, payload: '' };
  }

  const source = String(record.source || '').trim().toUpperCase();
  const role = String(record.role || '').trim().toLowerCase();
  if (source === 'MODEL' || role === 'assistant') {
    return { isSystem: false, sender: null, payload: '' };
  }

  for (const node of iterDicts(record)) {
    const nodeRole = String(node.role || '').trim().toLowerCase();
    const nodeSource = String(node.source || '').trim().toUpperCase();
    if (nodeRole === 'assistant' || nodeSource === 'MODEL') {
      return { isSystem: false, sender: null, payload: '' };
    }
  }

  const type = String(record.type || '').trim().toUpperCase();
  let content = typeof record.content === 'string' ? record.content : '';
  let isSystem = (source === 'SYSTEM' && type === 'SYSTEM_MESSAGE') || role === 'system';

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

  const match = content.match(
    /\[Message\][^\n]*\bsender=(?<sender>[^\s]+)[^\n]*\bcontent=(?<payload>[\s\S]*?)(?:<\/SYSTEM_MESSAGE>|$)/
  );
  if (match && match.groups) {
    const sender = (match.groups.sender || '').replace(/^['"]+|['"]+$/g, '').trim();
    const payload = (match.groups.payload || '').trim();
    return { isSystem: true, sender, payload };
  }

  return { isSystem: true, sender: null, payload: content };
}

export function extractVerdictFromText(text) {
  if (typeof text !== 'string') return null;
  const hasNoGo = text.includes('VERDICT: NO-GO');
  const hasGo = text.includes('VERDICT: GO');
  if (hasNoGo) {
    return 'NO-GO';
  }
  if (hasGo && !hasNoGo) {
    return 'GO';
  }
  return null;
}

export function reviewState(records) {
  if (!Array.isArray(records)) {
    return {
      zenStarted: false,
      verdict: null,
      requestIndex: -1,
      verdictIndex: -1,
    };
  }

  const paired = pairInvokeResults(records);
  const pairedZenMap = new Map();
  for (const p of paired) {
    const zenId = getZenChildIdFromPair(p);
    if (zenId) {
      pairedZenMap.set(p.recordIndex, zenId);
    }
  }

  let zenStarted = false;
  let activeZenConvId = null;
  let awaitingSubagentCreation = false;
  let latestRequestIndex = -1;
  let latestVerdict = null;
  let verdictIndex = -1;
  let latestInvokeRecordIndex = -1;

  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    const toolCalls = Array.from(iterToolCalls(record));
    const invokedHere = toolCalls.some((call) => isZenInvocation(call));

    if (invokedHere) {
      zenStarted = true;
      activeZenConvId = null;
      awaitingSubagentCreation = true;
      latestRequestIndex = index;
      latestVerdict = null;
      verdictIndex = -1;
      latestInvokeRecordIndex = index;
      continue;
    }

    if (zenStarted && awaitingSubagentCreation) {
      const convId = extractCreatedSubagent(record);
      if (convId) {
        activeZenConvId = pairedZenMap.get(latestInvokeRecordIndex) || convId;
        awaitingSubagentCreation = false;
      }
    }

    if (zenStarted && activeZenConvId) {
      const freshMessage = toolCalls.some((call) =>
        callTargetsConversation(call, activeZenConvId)
      );
      if (freshMessage) {
        latestRequestIndex = index;
        latestVerdict = null;
        verdictIndex = -1;
      }

      const { isSystem, sender, payload } = isProviderSystemMessage(record);
      if (isSystem && sender === activeZenConvId) {
        const v = extractVerdictFromText(payload);
        if (v) {
          latestVerdict = v;
          verdictIndex = index;
        }
      }
    }
  }

  return {
    zenStarted,
    verdict: latestVerdict,
    requestIndex: latestRequestIndex,
    verdictIndex,
  };
}

/**
 * Pure evaluation function for Stop events.
 * Fails open with { decision: 'stop' } on invalid inputs or unexpected errors.
 *
 * @param {object} payload
 * @returns {{decision: string, reason?: string}}
 */
export function evaluate(payload) {
  try {
    if (!isDict(payload)) {
      return { decision: 'stop' };
    }

    const terminationReason = String(payload.terminationReason || '').trim().toLowerCase();
    const error = String(payload.error || '').trim();
    if (error || !NORMAL_STOP_REASONS.has(terminationReason)) {
      return { decision: 'stop' };
    }

    const records = readTranscript(payload.transcriptPath);
    if (!records || records.length === 0) {
      return { decision: 'stop' };
    }

    const role = detectPrimaryRole(records, payload);
    if (role !== 'bulldozer' && role !== 'piledriver') {
      return { decision: 'stop' };
    }

    const latestText = getLatestAssistantText(records);
    if (latestText === null) {
      return { decision: 'stop' };
    }

    const { zenStarted, verdict, requestIndex, verdictIndex } = reviewState(records);
    const pendingReview = zenStarted && requestIndex > verdictIndex;
    if (pendingReview) {
      return { decision: 'continue', reason: REVIEW_PENDING };
    }

    if (role === 'bulldozer') {
      const ready = hasLine(READY_LINE, latestText) || hasLine(STATUS_READY_LINE, latestText);
      const blocked = hasLine(BLOCKED_LINE, latestText) || hasLine(STATUS_BLOCKED_LINE, latestText);

      if (ready && blocked) {
        return { decision: 'continue', reason: CONTRADICTORY };
      }
      if (blocked || !ready) {
        return { decision: 'stop' };
      }
      if (Boolean(payload.fullyIdle ?? true) === false) {
        return { decision: 'continue', reason: REVIEW_PENDING };
      }
      if (!zenStarted) {
        return { decision: 'continue', reason: REVIEW_REQUIRED_BULLDOZER };
      }
      if (verdict === 'NO-GO') {
        return { decision: 'continue', reason: REVIEW_NO_GO };
      }
      if (verdict !== 'GO') {
        return { decision: 'continue', reason: REVIEW_NO_VERDICT };
      }
      return { decision: 'stop' };
    }

    // role === 'piledriver'
    const planReady = hasLine(PLAN_READY_LINE, latestText);
    if (!planReady) {
      return { decision: 'stop' };
    }
    if (Boolean(payload.fullyIdle ?? true) === false) {
      return { decision: 'continue', reason: REVIEW_PENDING };
    }
    if (!zenStarted) {
      return { decision: 'continue', reason: REVIEW_REQUIRED_PILEDRIVER };
    }
    if (verdict === 'NO-GO') {
      return { decision: 'continue', reason: REVIEW_NO_GO };
    }
    if (verdict !== 'GO') {
      return { decision: 'continue', reason: REVIEW_NO_VERDICT };
    }
    return { decision: 'stop' };
  } catch {
    return { decision: 'stop' };
  }
}

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
  main();
}
