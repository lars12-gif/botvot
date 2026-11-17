import { VALID_MODES } from './utils.js';

// Runtime-only group settings. Nothing is read from or written to disk.
const groups = new Map();

export async function initStorage() {
  // Kept as a no-op for startup compatibility.
}

export function getGroupState(jid) {
  const state = groups.get(jid);
  return state ? { ...state } : { enabled: false, mode: null };
}

export async function setGroupEnabled(jid, enabled) {
  if (!jid?.endsWith('@g.us')) return false;
  const previous = groups.get(jid) ?? { enabled: false, mode: null };
  groups.set(jid, { ...previous, enabled: Boolean(enabled) });
  return true;
}

export async function setGroupMode(jid, mode) {
  if (!jid?.endsWith('@g.us') || !VALID_MODES.has(mode)) return false;
  const previous = groups.get(jid) ?? { enabled: false, mode: null };
  groups.set(jid, { ...previous, mode });
  return true;
}

export async function flushStorage() {
  // No persistent storage is used.
}
