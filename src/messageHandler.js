import { getGroupState, setGroupEnabled, setGroupMode } from './storage.js';
import { getOwnerCommand, isOwnerMessage } from './ownerAuth.js';
import { transform } from './contestModes.js';
import { extractText } from './utils.js';

const seen = new Map();
const DEDUPE_TTL_MS = 5 * 60 * 1000;
const DEDUPE_MAX = 12000;

function isStale(message, nowSeconds = Math.floor(Date.now() / 1000)) {
  let timestamp = message?.messageTimestamp;
  if (timestamp && typeof timestamp === 'object' && typeof timestamp.toNumber === 'function') timestamp = timestamp.toNumber();
  const seconds = Number(timestamp);
  return Number.isFinite(seconds) && seconds > 0 && seconds < nowSeconds - 10 * 60;
}

function markOnce(id, now = Date.now()) {
  if (!id) return false;
  for (const [key, timestamp] of seen) {
    if (now - timestamp > DEDUPE_TTL_MS) seen.delete(key);
    else break;
  }
  if (seen.has(id)) return false;
  seen.set(id, now);
  if (seen.size > DEDUPE_MAX) seen.delete(seen.keys().next().value);
  return true;
}

export async function handleMessage(sock, message) {
  const jid = message?.key?.remoteJid;
  if (typeof jid !== 'string' || !jid.endsWith('@g.us')) return;
  if (!message?.message || isStale(message)) return;
  if (message.key?.id && !markOnce(`${jid}:${message.key.id}`)) return;

  const rawText = extractText(message.message);
  if (rawText === null) return;

  // Secret controls are examined before enabled-state checks so the owner can
  // enable a currently disabled group. Unauthorized senders are ignored.
  const command = getOwnerCommand(message);
  if (command) {
    if (command.type === 'enable') await setGroupEnabled(jid, true);
    else if (command.type === 'disable') await setGroupEnabled(jid, false);
    else if (command.type === 'mode') await setGroupMode(jid, command.mode);
    return;
  }

  // Ignore ordinary messages sent by the linked bot account, but allow its
  // verified owner-only group commands above.
  if (message.key?.fromMe === true) return;

  // A non-owner using a secret-looking command never receives a response.
  if (/^(?:💜طك|🍃شلع|\*(?:كتابة|تفكيك|عكس|أعلام))$/.test(rawText.trim())) {
    if (!isOwnerMessage(message)) return;
  }

  const state = getGroupState(jid);
  if (!state.enabled || !state.mode) return;
  const output = transform(state.mode, rawText);
  if (typeof output !== 'string' || output.length === 0) return;

  await sock.sendMessage(jid, { text: output }, { quoted: message });
}

export function resetDedupeForTests() { seen.clear(); }
