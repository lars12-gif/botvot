import makeWASocket, {
  Browsers,
  DisconnectReason,
  useMultiFileAuthState
} from '@whiskeysockets/baileys';
import pino from 'pino';
import fs from 'node:fs/promises';
import { config } from './config.js';
import { normalizePhoneJid } from './utils.js';

const logger = pino({ level: config.logLevel, redact: ['*.key', '*.auth', '*.creds', '*.noiseKey', '*.signedIdentityKey'] });
let socket = null;
let generation = 0;
let reconnectTimer = null;
let reconnectAttempt = 0;
let startPromise = null;
let pairingRequestedForGeneration = -1;
let stopping = false;

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const statusCodeOf = error => error?.output?.statusCode ?? error?.statusCode ?? null;

function clearReconnectTimer() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function backoffDelay() {
  const exponential = Math.min(config.reconnectMaxMs, config.reconnectBaseMs * (2 ** Math.min(reconnectAttempt, 8)));
  const jitter = Math.floor(Math.random() * Math.min(1000, exponential * 0.2));
  reconnectAttempt += 1;
  return exponential + jitter;
}

function scheduleReconnect(reason, delay) {
  if (stopping || reconnectTimer) return;
  const waitMs = delay ?? backoffDelay();
  logger.warn({ reason, retryInMs: waitMs }, 'WhatsApp connection will retry');
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void startSocket();
  }, waitMs);
  // Keep this timer referenced: after Baileys closes the WebSocket (515),
  // it may be the only active handle keeping Node.js alive until reconnect.
}

async function verifyLinkedAccount(state) {
  const me = state?.creds?.me?.id;
  let linkedDigits = normalizePhoneJid(me);
  if (!linkedDigits && typeof me === 'string' && me.endsWith('@lid')) {
    const mappedPn = await socket?.signalRepository?.lidMapping?.getPNForLID(me).catch(() => null);
    linkedDigits = normalizePhoneJid(mappedPn);
  }
  if (!linkedDigits || linkedDigits !== config.ownerDigits) {
    logger.error('Could not verify that the linked WhatsApp account is the configured owner; refusing to run');
    return false;
  }
  return true;
}

async function issuePairingCode(sock, state, currentGeneration) {
  if (pairingRequestedForGeneration === currentGeneration || state.creds.registered) return;
  pairingRequestedForGeneration = currentGeneration;
  await wait(1200);
  if (currentGeneration !== generation || socket !== sock || state.creds.registered) return;
  if (!config.pairingCodeToConsole) {
    logger.error('Pairing code output is disabled. Enable PAIRING_CODE_TO_CONSOLE in the private environment to pair.');
    return;
  }
  try {
    const code = await sock.requestPairingCode(config.ownerDigits);
    if (currentGeneration !== generation || socket !== sock) return;
    // Intentionally the only place the pairing secret is printed. Protect
    // access to the hosting panel/console; never forward this log publicly.
    console.log('\n[PRIVATE PAIRING CODE] Enter this code in WhatsApp Linked devices.');
    console.log(code);
    console.log('[PRIVATE PAIRING CODE] The code is temporary; do not share it.\n');
  } catch (error) {
    pairingRequestedForGeneration = -1;
    const statusCode = statusCodeOf(error);
    logger.warn({ statusCode, message: error?.message }, 'Pairing code request failed; no code was issued');
    try { sock.end?.(new Error('Pairing request retry')); } catch {}
    scheduleReconnect('pairing-code-request-failed');
  }
}

export async function startSocket(onOpen) {
  if (startPromise) return startPromise;
  startPromise = (async () => {
    stopping = false;
    clearReconnectTimer();
    const currentGeneration = ++generation;
    const { state, saveCreds } = await useMultiFileAuthState(config.authDir);
    const sock = makeWASocket({
      auth: state,
      browser: Browsers.windows('Chrome'),
      logger,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      keepAliveIntervalMs: config.keepAliveIntervalMs,
      connectTimeoutMs: config.connectTimeoutMs,
      defaultQueryTimeoutMs: 30000
    });
    socket = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async update => {
      if (currentGeneration !== generation || socket !== sock) return;
      const { connection, lastDisconnect, qr } = update;
      // In Baileys pairing mode a qr update is the readiness signal for
      // requestPairingCode. QR rendering/printing remains explicitly disabled.
      if (qr && !state.creds.registered) await issuePairingCode(sock, state, currentGeneration);

      if (connection === 'open') {
        reconnectAttempt = 0;
        pairingRequestedForGeneration = -1;
        if (!(await verifyLinkedAccount(state))) {
          stopping = true;
          try { sock.end?.(new Error('Unexpected linked account')); } catch {}
          return;
        }
        logger.info('WhatsApp connection opened');
        if (typeof onOpen === 'function') await onOpen(sock);
        return;
      }

      if (connection !== 'close') return;
      if (socket === sock) socket = null;
      const statusCode = statusCodeOf(lastDisconnect?.error);
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      const restartRequired = statusCode === DisconnectReason.restartRequired;
      logger.warn({ statusCode, loggedOut, restartRequired }, 'WhatsApp connection closed');

      if (loggedOut) {
        logger.error('WhatsApp logged out. Re-link manually; auth files were preserved for diagnosis.');
        return;
      }
      // 401/403/408/428/440/500 are not blindly mapped to logout. Preserve auth
      // and retry with backoff unless Baileys explicitly reports loggedOut.
      scheduleReconnect(`connection-closed-${statusCode ?? 'unknown'}`, restartRequired ? 900 : undefined);
    });
    return sock;
  })();
  try { return await startPromise; }
  finally { startPromise = null; }
}

export async function stopSocket() {
  stopping = true;
  clearReconnectTimer();
  const current = socket;
  socket = null;
  if (current) {
    try { current.end?.(new Error('Process shutdown')); } catch {}
  }
  await fs.mkdir(config.authDir, { recursive: true, mode: 0o700 });
}
