import { config } from './config.js';
import { getVerifiedSenderDigits, extractText } from './utils.js';

export function isOwnerMessage(message) {
  const digits = getVerifiedSenderDigits(message);
  return digits !== null && digits === config.ownerDigits;
}

export function getOwnerCommand(message) {
  if (!isOwnerMessage(message)) return null;
  const text = extractText(message?.message);
  if (typeof text !== 'string') return null;
  const command = text.trim();
  const controls = new Map([
    ['💜طك', { type: 'enable' }],
    ['🍃شلع', { type: 'disable' }],
    ['*كتابة', { type: 'mode', mode: 'writing' }],
    ['*تفكيك', { type: 'mode', mode: 'breaking' }],
    ['*عكس', { type: 'mode', mode: 'reverse' }],
    ['*أعلام', { type: 'mode', mode: 'flags' }]
  ]);
  return controls.get(command) ?? null;
}
