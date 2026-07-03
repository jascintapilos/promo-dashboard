#!/usr/bin/env node
/**
 * Playwright API-mode probe: verify Double 7.7 MT content is live on QP2A / QPRO6 / QPRO8.
 * Uses Playwright's request context (no browser UI) with the correct auth headers.
 *
 * Usage: node bin/_probe-mt-double77.mjs
 */

import { request } from 'playwright';
import { readFileSync } from 'fs';
import { getSite } from '../src/sites.js';

const TEMPLATES = [
  { siteId: 'ibc22',  label: 'QP2A',  tplId: 1235, handle: 'P001-r2' },
  { siteId: 'ibc22',  label: 'QP2A',  tplId: 1237, handle: 'P002-r3' },
  { siteId: 'qpro6',  label: 'QPRO6', tplId: 599,  handle: 'P001-r2' },
  { siteId: 'qpro6',  label: 'QPRO6', tplId: 600,  handle: 'P002-r3' },
  { siteId: 'qpro8',  label: 'QPRO8', tplId: 659,  handle: 'P001-r2' },
  { siteId: 'qpro8',  label: 'QPRO8', tplId: 660,  handle: 'P002-r3' },
];

function loadSession(siteId) {
  const raw = JSON.parse(readFileSync(`.session/${siteId}.json`, 'utf8'));
  return { accessToken: raw.accessToken, plaintextToken: raw.plaintextToken };
}

console.log('═'.repeat(60));
console.log('Playwright API probe — Double 7.7 MT verification');
console.log('QP2A / QPRO6 / QPRO8 · P001-r2 + P002-r3');
console.log('═'.repeat(60));

const results = [];

for (const t of TEMPLATES) {
  let session;
  try {
    session = loadSession(t.siteId);
  } catch {
    console.log(`\n[${t.label} tpl=${t.tplId}] ✗ no session file — skip`);
    continue;
  }
  if (!session.accessToken) {
    console.log(`\n[${t.label} tpl=${t.tplId}] ✗ no accessToken — skip`);
    continue;
  }

  const site = getSite(t.siteId);
  process.stdout.write(`\n[${t.label}] tpl=${t.tplId} (${t.handle}): `);

  const reqCtx = await request.newContext({
    baseURL: site.apiHost,
    extraHTTPHeaders: {
      'access-token': session.accessToken,
      'token-selector': session.plaintextToken,
      'accept': 'application/json, text/plain, */*',
    },
  });

  try {
    const res = await reqCtx.get(`/api/bo/messagetemplate/${t.tplId}`);
    const contentType = res.headers()['content-type'] || '';

    if (!contentType.includes('json')) {
      const txt = await res.text();
      console.log(`✗ FAIL — non-JSON response (${res.status()}): ${txt.substring(0, 80)}`);
      results.push({ ...t, status: 'FAIL', reason: `HTTP ${res.status()} non-JSON` });
      continue;
    }

    const data = await res.json();
    const details = data?.data?.message_details || {};
    const locales = {};

    for (const [lid, loc] of Object.entries(details)) {
      const msg = loc.message || '';
      locales[lid] = {
        has77:  msg.includes('Double 7.7') || msg.includes('双 7.7'),
        hasOpd: msg.includes('once per day') || msg.includes('每天可领取'),
        snippet: msg.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 110),
      };
    }

    const allOk = Object.values(locales).every(l => l.has77 && l.hasOpd);
    const summary = Object.entries(locales)
      .map(([lid, l]) => `L${lid}:77=${l.has77 ? '✓' : '✗'} opd=${l.hasOpd ? '✓' : '✗'}`)
      .join(' | ');

    console.log(allOk ? `✓ PASS — ${summary}` : `⚠ PARTIAL — ${summary}`);

    // Show intro snippet from first locale
    const first = Object.values(locales)[0];
    if (first) console.log(`  intro: "${first.snippet}"`);

    results.push({ ...t, status: allOk ? 'PASS' : 'PARTIAL', locales });
  } catch (e) {
    console.log(`✗ FAIL — ${String(e.message || e).split('\n')[0]}`);
    results.push({ ...t, status: 'FAIL', reason: String(e.message || e) });
  } finally {
    await reqCtx.dispose();
  }
}

console.log('\n' + '─'.repeat(40));
console.log('Summary');
console.log('─'.repeat(40));
const pass = results.filter(r => r.status === 'PASS').length;
const fail = results.filter(r => r.status !== 'PASS').length;
for (const r of results) {
  const icon = r.status === 'PASS' ? '✓' : r.status === 'PARTIAL' ? '⚠' : '✗';
  console.log(`${icon} ${r.label} tpl=${r.tplId} (${r.handle}): ${r.status}`);
}
console.log(`\n${pass}/${results.length} PASS, ${fail} non-PASS`);
