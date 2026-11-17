import fs from 'node:fs/promises';
import { config } from './config.js';
import { transformContestText } from './utils.js';

let flags = Object.freeze({});
export async function loadFlags() {
  const parsed = JSON.parse(await fs.readFile(config.flagsFile, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid flags-ar.json');
  flags = Object.freeze(parsed);
  return flags;
}
export function transform(mode, text) {
  return transformContestText(mode, text, flags);
}
