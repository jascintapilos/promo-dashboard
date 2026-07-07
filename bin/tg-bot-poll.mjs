#!/usr/bin/env node
/**
 * Poll Telegram Bot API for new messages and capture them locally.
 *
 * Telegram's Bot API has no history endpoint — a bot only receives messages
 * from the moment it's added onward, via getUpdates. Telegram buffers
 * unfetched updates for ~24h server-side, so running this every 10-15 min
 * on a schedule (see bin/tg-poll-keepalive.bat) is safe against gaps as
 * long as the machine doesn't stay off longer than that.
 *
 * First run: the bot's chat_id is unknown until it receives a message from
 * the target group. This script auto-discovers and persists it — post any
 * message in the group after adding the bot, then run this once to capture
 * the chat_id before relying on the schedule.
 *
 * Usage:
 *   node bin/tg-bot-poll.mjs
 */
import { getBotConfig, setBotConfig, getPollState, setPollState, appendMessages } from '../src/tg-store.js';

const config = getBotConfig();
if (!config?.token) {
  console.error('No bot token configured. Create tg-bot-token.local.json with: { "token": "<BotFather token>" }');
  process.exit(1);
}

const API = `https://api.telegram.org/bot${config.token}`;

async function getUpdates(offset) {
  const url = `${API}/getUpdates?offset=${offset}&timeout=0&allowed_updates=["message"]`;
  const res = await fetch(url);
  const json = await res.json();
  if (!json.ok) throw new Error(`getUpdates failed: ${json.description || 'unknown error'}`);
  return json.result;
}

const { offset } = getPollState();
const updates = await getUpdates(offset);

if (!updates.length) {
  console.log('No new messages.');
  process.exit(0);
}

// Discover + persist the chat_id on first real message, if not already known.
if (!config.chatId) {
  const withChat = updates.find((u) => u.message?.chat?.id);
  if (withChat) {
    const chat = withChat.message.chat;
    setBotConfig({ chatId: chat.id, chatTitle: chat.title || chat.username || String(chat.id) });
    console.log(`Discovered chat: "${chat.title || chat.username}" (id: ${chat.id}) — captured going forward.`);
  }
}

const targetChatId = config.chatId || getBotConfig()?.chatId;

const messages = updates
  .map((u) => u.message)
  .filter(Boolean)
  .filter((m) => !targetChatId || m.chat.id === targetChatId) // ignore other chats if bot somehow added elsewhere
  .map((m) => ({
    message_id: m.message_id,
    chat_id: m.chat.id,
    chat_title: m.chat.title || m.chat.username || String(m.chat.id),
    date: new Date(m.date * 1000).toISOString(),
    from: m.from ? (m.from.username || `${m.from.first_name || ''} ${m.from.last_name || ''}`.trim()) : 'unknown',
    text: m.text || m.caption || '',
    // text_mention entities carry {user: {id, first_name, username}} for
    // mentions of users without a public @handle — plain "mention" entities
    // are just an offset/length into text, the @username is already in it.
    entities: (m.entities || m.caption_entities || [])
      .filter((e) => e.type === 'mention' || e.type === 'text_mention')
      .map((e) => e.type === 'text_mention'
        ? { type: e.type, username: e.user.username, name: `${e.user.first_name || ''} ${e.user.last_name || ''}`.trim() }
        : { type: e.type, text: (m.text || '').slice(e.offset, e.offset + e.length) }),
  }));

const added = appendMessages(messages);
console.log(`Fetched ${updates.length} update(s), captured ${added} new message(s).`);

// Advance the offset past the last update we saw, regardless of chat filter,
// so Telegram doesn't keep re-delivering updates we've already processed.
const lastUpdateId = updates[updates.length - 1].update_id;
setPollState({ offset: lastUpdateId + 1 });
