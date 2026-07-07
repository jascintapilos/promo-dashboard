// Shared store for captured Telegram messages — used by both the poller
// (bin/tg-bot-poll.mjs) and the MCP server (bin/mcp-telegram-server.mjs).
//
// Telegram's Bot API has no history endpoint (unlike Slack's
// conversations.history) — a bot only ever sees messages from the moment
// it's added onward, delivered via getUpdates polling. This store is the
// durable record of everything the poller has captured, so MCP tool calls
// have something to search against instead of querying Telegram live.

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const CAPTURE_DIR = path.resolve('captures/telegram');
const MESSAGES_FILE = path.join(CAPTURE_DIR, 'messages.jsonl');
const CONFIG_FILE = path.resolve('tg-bot-token.local.json');
const POLL_STATE_FILE = path.resolve('tg-poll-state.local.json');

function ensureDir() {
  if (!existsSync(CAPTURE_DIR)) mkdirSync(CAPTURE_DIR, { recursive: true });
}

export function getBotConfig() {
  if (!existsSync(CONFIG_FILE)) return null;
  return JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
}

export function setBotConfig(config) {
  const prev = getBotConfig() || {};
  writeFileSync(CONFIG_FILE, JSON.stringify({ ...prev, ...config }, null, 2));
}

export function getPollState() {
  if (!existsSync(POLL_STATE_FILE)) return { offset: 0 };
  return JSON.parse(readFileSync(POLL_STATE_FILE, 'utf8'));
}

export function setPollState(state) {
  writeFileSync(POLL_STATE_FILE, JSON.stringify(state, null, 2));
}

// Append new messages, deduped by message_id. Each stored record:
// { message_id, chat_id, chat_title, date (ISO), from, text }
export function appendMessages(messages) {
  if (!messages.length) return 0;
  ensureDir();
  const existingIds = existsSync(MESSAGES_FILE)
    ? new Set(readAllMessages().map((m) => m.message_id))
    : new Set();
  const fresh = messages.filter((m) => !existingIds.has(m.message_id));
  if (!fresh.length) return 0;
  const lines = fresh.map((m) => JSON.stringify(m)).join('\n') + '\n';
  appendFileSync(MESSAGES_FILE, lines);
  return fresh.length;
}

export function readAllMessages() {
  if (!existsSync(MESSAGES_FILE)) return [];
  const raw = readFileSync(MESSAGES_FILE, 'utf8');
  return raw.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

// query: case-insensitive substring match against text.
// since/until: ISO date strings (inclusive), optional.
// limit: max results, most recent first. Default 100.
export function searchMessages({ query, since, until, limit = 100 } = {}) {
  let msgs = readAllMessages();
  if (since) msgs = msgs.filter((m) => m.date >= since);
  if (until) msgs = msgs.filter((m) => m.date <= until);
  if (query) {
    const q = query.toLowerCase();
    msgs = msgs.filter((m) => (m.text || '').toLowerCase().includes(q));
  }
  msgs.sort((a, b) => b.date.localeCompare(a.date));
  return msgs.slice(0, limit);
}
