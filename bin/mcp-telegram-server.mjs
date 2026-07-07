#!/usr/bin/env node
/**
 * MCP server exposing read access to Telegram messages captured by
 * bin/tg-bot-poll.mjs (scheduled every 10-15 min via bin/tg-poll-keepalive.bat).
 *
 * Read-only by design, mirroring how the connected Slack MCP tools are used
 * in this workflow — search and read, never send. Scoped to whatever single
 * group the configured bot has been added to (see tg-bot-token.local.json).
 *
 * Registered via .mcp.json at the project root; Claude Code launches this
 * over stdio automatically when the project loads.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { searchMessages, getBotConfig } from '../src/tg-store.js';

const server = new McpServer({ name: 'telegram-morning-chain', version: '1.0.0' });

server.tool(
  'tg_search_messages',
  'Search captured Telegram messages from the configured group. Only covers messages sent since the bot was added — Telegram has no API for retroactive history. Returns most recent first.',
  {
    query: z.string().optional().describe('Case-insensitive substring to search for in message text. Omit to return recent messages unfiltered.'),
    since: z.string().optional().describe('ISO date (YYYY-MM-DD) — only messages on/after this date.'),
    until: z.string().optional().describe('ISO date (YYYY-MM-DD) — only messages on/before this date.'),
    limit: z.number().int().positive().max(500).optional().describe('Max results, default 100.'),
  },
  async ({ query, since, until, limit }) => {
    const results = searchMessages({ query, since, until, limit });
    return {
      content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
    };
  }
);

server.tool(
  'tg_read_recent',
  'Get the N most recently captured Telegram messages from the configured group, newest first.',
  { limit: z.number().int().positive().max(500).optional().describe('Default 20.') },
  async ({ limit }) => {
    const results = searchMessages({ limit: limit || 20 });
    return {
      content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
    };
  }
);

server.tool(
  'tg_list_chats',
  'Show which Telegram chat this server is currently configured to capture, and basic setup status.',
  {},
  async () => {
    const config = getBotConfig();
    const status = !config?.token
      ? 'No bot token configured (tg-bot-token.local.json missing).'
      : !config.chatId
      ? 'Bot token set, but no chat discovered yet — post a message in the target group, then run bin/tg-bot-poll.mjs once.'
      : `Capturing chat: "${config.chatTitle}" (id: ${config.chatId})`;
    return { content: [{ type: 'text', text: status }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
