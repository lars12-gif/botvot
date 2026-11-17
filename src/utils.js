export const VALID_MODES = new Set(['writing', 'breaking', 'reverse', 'flags']);

export function extractText(message) {
  if (!message || typeof message !== 'object') return null;
  let content = message;
  // Unwrap WhatsApp's text-only ephemeral/view-once containers without
  // accepting captions or media as contest text.
  for (let i = 0; i < 4; i += 1) {
    const wrapped = content.ephemeralMessage?.message
      ?? content.viewOnceMessage?.message
      ?? content.viewOnceMessageV2?.message
      ?? content.viewOnceMessageV2Extension?.message;
    if (!wrapped) break;
    content = wrapped;
  }
  if (typeof content.conversation === 'string') return content.conversation;
  if (typeof content.extendedTextMessage?.text === 'string') return content.extendedTextMessage.text;
  return null;
}

export function normalizePhoneJid(jid) {
  if (typeof jid !== 'string' || !jid.endsWith('@s.whatsapp.net')) return null;
  const local = jid.slice(0, -'@s.whatsapp.net'.length).split(':', 1)[0];
  return /^\d{7,16}$/.test(local) ? local : null;
}

export function getVerifiedSenderDigits(message) {
  const key = message?.key;
  if (!key || key.fromMe === true) return null;
  // Baileys may expose PN JIDs directly or a LID plus a server-provided PN alt.
  // We accept only a syntactically valid PN JID; LID-only messages fail closed.
  const candidates = [key.participantAlt, key.participant, message.participantAlt, message.participant];
  for (const candidate of candidates) {
    const digits = normalizePhoneJid(candidate);
    if (digits) return digits;
  }
  return null;
}

export function graphemes(text) {
  if (typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });
    return [...segmenter.segment(text)].map(item => item.segment);
  }
  // Fallback keeps surrogate pairs intact, but Intl.Segmenter is available on
  // the supported Node 20+ runtime and is the preferred grapheme algorithm.
  return Array.from(text);
}

export function parseContestPayload(rawText) {
  if (typeof rawText !== 'string' || rawText.length < 3) return null;
  if (rawText[0] !== '*' || rawText.at(-1) !== '*') return null;
  const inner = rawText.slice(1, -1);
  return inner.length ? inner : null;
}

export function transformContestText(mode, rawText, flags) {
  const inner = parseContestPayload(rawText);
  if (inner === null) return null;
  switch (mode) {
    case 'writing': return inner;
    case 'breaking': return graphemes(inner).join(' ');
    case 'reverse': return graphemes(inner).reverse().join('');
    case 'flags': return flags?.[inner] ?? null;
    default: return null;
  }
}
