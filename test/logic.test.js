import test from 'node:test';
import assert from 'node:assert/strict';
import { transformContestText, parseContestPayload, graphemes, getVerifiedSenderDigits } from '../src/utils.js';
import { isOwnerMessage, getOwnerCommand } from '../src/ownerAuth.js';
import { initStorage, getGroupState, setGroupEnabled, setGroupMode } from '../src/storage.js';
import { loadFlags, transform } from '../src/contestModes.js';
import { handleMessage, resetDedupeForTests } from '../src/messageHandler.js';

const A = '120363000000000001@g.us';
const B = '120363000000000002@g.us';
const OWNER = '15879975734@s.whatsapp.net';
const MEMBER = '964700000000@s.whatsapp.net';
const msg = (jid, sender, text, id = Math.random().toString()) => ({
  key: { remoteJid: jid, participant: sender, id, fromMe: false },
  message: { conversation: text },
  messageTimestamp: Math.floor(Date.now() / 1000)
});

test('contest text parser removes only the first and last asterisk', () => {
  assert.equal(parseContestPayload('*  نص داخلي  *'), '  نص داخلي  ');
  assert.equal(parseContestPayload('نص'), null);
  assert.equal(parseContestPayload('**'), null);
});

test('writing preserves inner text exactly', () => {
  assert.equal(transformContestText('writing', '* هيسوكا 😀 *'), ' هيسوكا 😀 ');
});

test('breaking separates grapheme clusters, including joined emoji', () => {
  assert.equal(transformContestText('breaking', '*ماي*'), 'م ا ي');
  assert.equal(transformContestText('breaking', '*HELLO*'), 'H E L L O');
  assert.equal(graphemes('👨‍👩‍👧‍👦').length, 1);
  assert.equal(transformContestText('breaking', '*👨‍👩‍👧‍👦*'), '👨‍👩‍👧‍👦');
});

test('reverse reverses graphemes and preserves spaces', () => {
  assert.equal(transformContestText('reverse', '*هيسوكا*'), 'اكوسيه');
  assert.equal(transformContestText('reverse', '*HELLO*'), 'OLLEH');
  assert.equal(transformContestText('reverse', '*A 👨‍👩‍👧‍👦 B*'), 'B 👨‍👩‍👧‍👦 A');
});

test('owner identity requires a real phone JID and rejects LID-only identities', () => {
  assert.equal(getVerifiedSenderDigits(msg(A, OWNER, 'x')), '15879975734');
  assert.equal(getVerifiedSenderDigits({ key: { remoteJid: A, participant: '12345@lid' } }), null);
  assert.equal(isOwnerMessage(msg(A, OWNER, 'x')), true);
  assert.equal(isOwnerMessage(msg(A, MEMBER, 'x')), false);
  assert.equal(isOwnerMessage({ key: { remoteJid: A, participant: OWNER, fromMe: true }, message: { conversation: 'x' } }), false);
});

test('only owner commands are recognized and map to internal modes', () => {
  assert.deepEqual(getOwnerCommand(msg(A, OWNER, '*كتابة')), { type: 'mode', mode: 'writing' });
  assert.deepEqual(getOwnerCommand(msg(A, OWNER, '💜طك')), { type: 'enable' });
  assert.equal(getOwnerCommand(msg(A, MEMBER, '💜طك')), null);
});

test('groups have independent activation and mode state and persist as JSON', async () => {
  await initStorage();
  await setGroupEnabled(A, true);
  await setGroupMode(A, 'writing');
  await setGroupMode(B, 'flags');
  assert.deepEqual(getGroupState(A), { enabled: true, mode: 'writing' });
  assert.deepEqual(getGroupState(B), { enabled: false, mode: 'flags' });
  await setGroupEnabled(A, false);
  assert.deepEqual(getGroupState(A), { enabled: false, mode: 'writing' });
});

test('local flag database resolves common country flags without network', async () => {
  await loadFlags();
  assert.equal(transform('flags', '*🇯🇵*'), 'اليابان');
  assert.equal(transform('flags', '*🇮🇶*'), 'العراق');
  assert.equal(transform('flags', '*🇧🇷*'), 'البرازيل');
  assert.equal(transform('flags', '*🏴‍☠️*'), null);
});

test('message handling: owner controls are silent, member cannot control, private ignored', async () => {
  await initStorage();
  resetDedupeForTests();
  const sent = [];
  const sock = { sendMessage: async (...args) => sent.push(args) };
  await handleMessage(sock, msg(A, MEMBER, '💜طك', 'm1'));
  assert.equal(getGroupState(A).enabled, false);
  await handleMessage(sock, msg(A, OWNER, '💜طك', 'm2'));
  assert.equal(getGroupState(A).enabled, true);
  assert.equal(sent.length, 0);
  await handleMessage(sock, { ...msg('964700000000@s.whatsapp.net', OWNER, '*abc*', 'm3') });
  assert.equal(sent.length, 0);
});

test('message handling: transforms only valid payloads and prevents duplicate replies', async () => {
  await initStorage();
  await loadFlags();
  await setGroupEnabled(A, true);
  await setGroupMode(A, 'writing');
  resetDedupeForTests();
  const sent = [];
  const sock = { sendMessage: async (...args) => sent.push(args) };
  const first = msg(A, MEMBER, '*غون*', 'same-id');
  await handleMessage(sock, first);
  await handleMessage(sock, first);
  await handleMessage(sock, msg(A, MEMBER, 'غون', 'not-matching'));
  assert.equal(sent.length, 1);
  assert.equal(sent[0][1].text, 'غون');
});
