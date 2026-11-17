import { initStorage, flushStorage } from './storage.js';
import { loadFlags } from './contestModes.js';
import { startSocket, stopSocket } from './connection.js';
import { handleMessage } from './messageHandler.js';

await initStorage();
await loadFlags();

let wiredSocket = null;
async function onOpen(sock) {
  if (wiredSocket === sock) return;
  wiredSocket = sock;
  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const message of messages ?? []) {
      void handleMessage(sock, message).catch(error => {
        // Never log message contents, phone numbers, auth material or pairing codes.
        console.error('[MESSAGE] Processing failed:', error?.message ?? 'unknown error');
      });
    }
  });
}

let bootRetry = null;
async function boot() {
  try {
    await startSocket(onOpen);
  } catch (error) {
    console.error('[STARTUP] Could not start WhatsApp socket:', error?.message ?? 'unknown error');
    bootRetry = setTimeout(() => void boot(), 5000);
    bootRetry.unref?.();
  }
}

process.on('SIGINT', async () => {
  if (bootRetry) clearTimeout(bootRetry);
  await stopSocket();
  await flushStorage();
  process.exit(0);
});
process.on('SIGTERM', async () => {
  if (bootRetry) clearTimeout(bootRetry);
  await stopSocket();
  await flushStorage();
  process.exit(0);
});
process.on('unhandledRejection', error => console.error('[ASYNC]', error?.message ?? 'unhandled rejection'));

await boot();
