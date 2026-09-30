import fs from 'node:fs';
import path from 'node:path';
import { paths } from './config.js';
import { childLogger } from './logger.js';

const log = childLogger('store');

const STATE_FILE = path.join(paths.data, 'state.json');
const MESSAGES_FILE = path.join(paths.data, 'messages.jsonl');
const MAX_SEEN = 5000;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { seen: [], stats: {} };
  }
}

let state = loadState();
const seenSet = new Set(state.seen || []);

function persist() {
  ensureDir(paths.data);
  state.seen = [...seenSet].slice(-MAX_SEEN);
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

export function hasSeen(id) {
  return seenSet.has(id);
}

export function markSeen(id) {
  seenSet.add(id);
  if (seenSet.size % 25 === 0) persist();
}

export function bump(stat, by = 1) {
  state.stats = state.stats || {};
  state.stats[stat] = (state.stats[stat] || 0) + by;
}

export function flush() {
  persist();
}

/** Log append-only di tutti i messaggi processati. */
export function appendMessage(record) {
  ensureDir(paths.data);
  fs.appendFileSync(MESSAGES_FILE, JSON.stringify(record) + '\n');
}

export function appendJsonl(file, record) {
  const target = path.isAbsolute(file) ? file : path.join(paths.root, file);
  ensureDir(path.dirname(target));
  fs.appendFileSync(target, JSON.stringify(record) + '\n');
  log.debug({ file: target }, 'jsonl append');
  return target;
}

export function getStats() {
  return state.stats || {};
}
