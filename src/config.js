import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Tiny built-in .env reader avoids an extra runtime dependency. Existing process
// environment values always take precedence.
try {
  const envText = fs.readFileSync(path.join(rootDir, '.env'), 'utf8');
  for (const line of envText.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && process.env[match[1]] == null) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
} catch {}
const resolveFromRoot = (value, fallback) => path.resolve(rootDir, value || fallback);
const intEnv = (name, fallback, min, max) => {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
};
const boolEnv = (name, fallback) => {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).toLowerCase());
};

export const config = Object.freeze({
  appName: 'Contest WhatsApp Bot',
  // Single source of truth for the only account allowed to control the bot.
  ownerPhone: '+15879975734',
  ownerDigits: '15879975734',
  flagsFile: path.join(rootDir, 'data', 'flags-ar.json'),
  logLevel: process.env.LOG_LEVEL || 'info',
  pairingCodeToConsole: boolEnv('PAIRING_CODE_TO_CONSOLE', true),
  reconnectBaseMs: intEnv('RECONNECT_BASE_MS', 1500, 500, 120000),
  reconnectMaxMs: intEnv('RECONNECT_MAX_MS', 60000, 2000, 300000),
  connectTimeoutMs: intEnv('CONNECT_TIMEOUT_MS', 60000, 10000, 120000),
  keepAliveIntervalMs: intEnv('KEEPALIVE_INTERVAL_MS', 20000, 10000, 60000)
});
