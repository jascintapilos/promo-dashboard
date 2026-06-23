#!/usr/bin/env node
// Inspect and manage cached BO sessions.
//
//   node bin/sessions.js list
//   node bin/sessions.js clear [--site=<id>]
//   node bin/sessions.js refresh [--site=<id>]

import { parseArgs } from './_args.js';
import { listSites, getSite } from '../src/sites.js';
import { listCachedSessions, clearSession } from '../src/session-cache.js';
import { getSession } from '../src/api-client.js';

const { flags, positional } = parseArgs(process.argv.slice(2));
const action = positional[0] || 'list';

async function listAction() {
  const sites = listSites();
  const cached = await listCachedSessions();
  const byId = new Map(cached.map((c) => [c.id, c]));
  console.log(['SITE', 'CONFIGURED', 'CACHED', 'FRESH', 'EXPIRES', 'USERNAME'].join('\t'));
  for (const s of sites) {
    const c = byId.get(s.id);
    const expires = c?.session?.expiresAt ?? '-';
    console.log([s.id, 'yes', c ? 'yes' : 'no', c ? (c.fresh ? 'yes' : 'no') : '-', expires, s.username].join('\t'));
  }
  // Orphans — sessions on disk without a matching configured site
  for (const c of cached) {
    if (!sites.find((s) => s.id === c.id)) {
      console.log([c.id, 'no', 'yes', c.fresh ? 'yes' : 'no', c.session.expiresAt ?? '-', c.session.username ?? '-'].join('\t'));
    }
  }
}

async function clearAction() {
  const targets = flags.site ? [getSite(flags.site)] : listSites();
  for (const s of targets) {
    await clearSession(s.id);
    console.log(`cleared ${s.id}`);
  }
}

async function refreshAction() {
  const targets = flags.site ? [getSite(flags.site)] : listSites();
  for (const s of targets) {
    const fresh = await getSession(s, { force: true });
    console.log(`refreshed ${s.id} — expires ${fresh.expiresAt}`);
  }
}

switch (action) {
  case 'list': await listAction(); break;
  case 'clear': await clearAction(); break;
  case 'refresh': await refreshAction(); break;
  default:
    console.error('usage: sessions.js <list|clear|refresh> [--site=<id>]');
    process.exit(2);
}
