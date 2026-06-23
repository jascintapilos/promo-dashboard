#!/usr/bin/env node
/**
 * Save a manually-copied FT portaltoken to the session file.
 *
 * When to use:
 *   Session has expired and auto-capture isn't working. Log in via Chrome,
 *   press F12 → Application → Cookies → copy the "portaltoken" value, then run:
 *
 *   node bin/save-ft-token.mjs --instance=ws1   --token=<value>
 *   node bin/save-ft-token.mjs --instance=qpro1 --token=<value>
 *   node bin/save-ft-token.mjs --instance=qp2   --token=<value>
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from './_args.js';

const { flags } = parseArgs(process.argv.slice(2));
const INSTANCE = flags.instance;
const TOKEN    = flags.token;

const INSTANCES = {
  ws1:   { url: 'https://mb8.ft-crm.com/',               domain: 'mb8.ft-crm.com',               label: 'WS1/WS2' },
  qpro1: { url: 'https://alpha-iota-qp1.ft-crm.com/',    domain: 'alpha-iota-qp1.ft-crm.com',    label: 'QPRO1' },
  qp2:   { url: 'https://alpha-iota-qp2.ft-crm.com/v2/', domain: 'alpha-iota-qp2.ft-crm.com',    label: 'QP2A-D' },
};

if (!INSTANCE || !INSTANCES[INSTANCE]) {
  console.error('Usage: node bin/save-ft-token.mjs --instance=<ws1|qpro1|qp2> --token=<portaltoken>');
  process.exit(1);
}
if (!TOKEN) {
  console.error('Missing --token value. Copy the portaltoken from F12 → Application → Cookies.');
  process.exit(1);
}

const { url, domain, label } = INSTANCES[INSTANCE];
const SESSION_FILE = path.resolve(`ft-session-${INSTANCE}.local.json`);

// Preserve any existing fields (localStorage etc.) but update token + cookies
const existing = existsSync(SESSION_FILE) ? JSON.parse(readFileSync(SESSION_FILE, 'utf8')) : {};

const store = {
  ...existing,
  instance:   INSTANCE,
  label,
  loginUrl:   url,
  tokenKey:   'cookie:portaltoken',
  token:      TOKEN,
  cookies: [{ name: 'portaltoken', value: TOKEN, domain, path: '/' }],
  capturedAt: new Date().toISOString(),
};

writeFileSync(SESSION_FILE, JSON.stringify(store, null, 2));
console.log(`✅  Saved portaltoken for ${label} → ${SESSION_FILE}`);
console.log(`    Token: ${TOKEN.slice(0, 4)}****`);
