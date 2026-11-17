import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { VALID_MODES } from './utils.js';

const groups = new Map();
let writeChain = Promise.resolve();
let initialized = false;

async function atomicWriteJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const handle = await fs.open(temp, 'w', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temp, filePath);
}

function snapshot() {
  return Object.fromEntries([...groups.entries()].map(([jid, state]) => [jid, { ...state }]));
}

function persist() {
  const data = snapshot();
  writeChain = writeChain.catch(() => {}).then(() => atomicWriteJson(config.groupsFile, data));
  return writeChain;
}

export async function initStorage() {
  if (initialized) return;
  await fs.mkdir(config.dataDir, { recursive: true, mode: 0o700 });
  await fs.mkdir(config.authDir, { recursive: true, mode: 0o700 });
  try {
    const parsed = JSON.parse(await fs.readFile(config.groupsFile, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [jid, value] of Object.entries(parsed)) {
        if (!jid.endsWith('@g.us') || !value || typeof value !== 'object') continue;
        const mode = VALID_MODES.has(value.mode) ? value.mode : null;
        groups.set(jid, { enabled: value.enabled === true, mode });
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`Cannot read groups database: ${error.message}`);
  }
  initialized = true;
}

export function getGroupState(jid) {
  const state = groups.get(jid);
  return state ? { ...state } : { enabled: false, mode: null };
}

export async function setGroupEnabled(jid, enabled) {
  if (!jid?.endsWith('@g.us')) return false;
  const previous = groups.get(jid) ?? { enabled: false, mode: null };
  groups.set(jid, { ...previous, enabled: Boolean(enabled) });
  await persist();
  return true;
}

export async function setGroupMode(jid, mode) {
  if (!jid?.endsWith('@g.us') || !VALID_MODES.has(mode)) return false;
  const previous = groups.get(jid) ?? { enabled: false, mode: null };
  groups.set(jid, { ...previous, mode });
  await persist();
  return true;
}

export async function flushStorage() {
  await writeChain;
}
