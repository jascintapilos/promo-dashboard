#!/usr/bin/env node
// Make every TLEO-family PromotionName on WS1 MY unique (Slack
// C03LF5QH5F0 / p1783101685135169 follow-up): 42 TLEO-coded promos share
// 5 names, which breaks Manual Reward Assignment (team picks by name).
//
// New name = existing base name + " (<scope> / CAP<n> / BR)" suffix derived
// from the promo's own code, matching the mapper's parenthetical convention.
//
//   node bin/_rename-ws1-tleo-unique.mjs           # dry-run
//   node bin/_rename-ws1-tleo-unique.mjs --commit  # apply renames
//
// Uses Playwright with cookies from igmp-sessions.local.json (same session
// as _probe-ws1-tleo-name-match.mjs). Rename via /PM/UpdatePromotionDetails
// (GetBonusInfo passthrough for description + dates — trim-wc26 recipe).

import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const SITE = 'ws1-v3-my';
const BASE = 'https://kioskmy.best-in-asia.com';
const COMMIT = process.argv.includes('--commit');

const store = JSON.parse(readFileSync(path.resolve('igmp-sessions.local.json'), 'utf8'));
const saved = store.sessions?.[SITE];
if (!saved?.cookies?.length) {
  console.error(`no saved session for ${SITE} — run bin/igmp-session-capture.mjs first`);
  process.exit(2);
}

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const ctx = await browser.newContext();
await ctx.addCookies(saved.cookies.filter((c) => c.name && c.value && c.domain));

async function post(endpoint, body) {
  const res = await ctx.request.post(BASE + endpoint, {
    headers: { 'Content-Type': 'application/json; charset=utf-8', Accept: 'application/json, text/plain, */*' },
    data: body,
  });
  const text = await res.text();
  if (!res.ok()) throw new Error(`HTTP ${res.status()} ${endpoint}: ${text.slice(0, 200)}`);
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`non-JSON from ${endpoint} (stale session?): ${text.slice(0, 120)}`); }
  if (data?.success === false) throw new Error(`iGMP error ${endpoint}: ${JSON.stringify(data.message || data).slice(0, 200)}`);
  return data;
}

async function listAll() {
  const all = [];
  for (let pg = 1; pg <= 40; pg++) {
    const r = await post(`/PM/GetPromotionsList?pageNum=${pg}&rowPerPage=200`, {
      PromotionCode: '', PromotionName: '', PromotionType: 0, IsActive: '', IsPublished: '',
    });
    const rows = r?.data || [];
    if (!rows.length) break;
    all.push(...rows);
    if (rows.length < 200) break;
  }
  return all;
}

// "DD/MM/YYYY" | "DD-MM-YYYY[ HH:MM:SS]" | anything Date-parseable → toDateString()
function toDateString(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{2})[/-](\d{2})[/-](\d{4})/);
  const d = m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toDateString();
}

function suffixFromCode(code) {
  const parts = [];
  if (/(^|_)LC(_|$)/.test(code)) parts.push('LC');
  if (/_SL(_|$)|_SLOT(_|$)/.test(code)) parts.push('SLOT');
  const cap = code.match(/(\d+)MX/);
  if (cap) parts.push(`CAP${cap[1]}`);
  if (/_BR(_|$)/.test(code)) parts.push('BR');
  return parts.length ? ` (${parts.join(' / ')})` : '';
}

const all = await listAll();
console.error(`[rename] ${all.length} Type-0 promos on ${SITE}`);

const tleo = all.filter((p) => /TLEO/i.test(p.PromotionCode || ''));
console.error(`[rename] ${tleo.length} TLEO-coded promos in scope`);

// Build rename plan
const plan = [];
const problems = [];
for (const p of tleo) {
  const suffix = suffixFromCode(p.PromotionCode);
  if (!suffix) { problems.push(`${p.PromotionCode}: no distinguishing tokens found — skipped`); continue; }
  const base = (p.PromotionName || '').trim();
  if (base.endsWith(suffix.trim())) continue; // already renamed (rerun-safe)
  plan.push({ id: p.PromotionId, code: p.PromotionCode, oldName: base, newName: `${base}${suffix}` });
}

// Uniqueness check across the WHOLE site post-rename
const finalNames = new Map();
for (const p of all) {
  const planned = plan.find((x) => x.id === p.PromotionId);
  const name = planned ? planned.newName : (p.PromotionName || '').trim();
  const lst = finalNames.get(name) || [];
  lst.push(p.PromotionCode);
  finalNames.set(name, lst);
}
const stillDup = Array.from(finalNames.entries()).filter(([, lst]) => lst.length > 1);

console.log(`\nRename plan — ${plan.length} promos:\n`);
for (const r of plan) {
  console.log(`  id=${r.id}  ${r.code}`);
  console.log(`    old: "${r.oldName}"`);
  console.log(`    new: "${r.newName}"\n`);
}
if (problems.length) { console.log('Problems:'); problems.forEach((x) => console.log(`  ! ${x}`)); }
if (stillDup.length) {
  console.log('\nNames still duplicated site-wide AFTER this plan:');
  stillDup.forEach(([name, lst]) => console.log(`  ✗ "${name}" ×${lst.length}  [${lst.join(', ')}]`));
} else {
  console.log('\n✓ Post-rename check: all promo names on the site will be unique.');
}

if (!COMMIT) {
  console.log('\nDRY-RUN — no changes made. Re-run with --commit to apply.');
  await browser.close();
  process.exit(0);
}
if (stillDup.some(([name]) => plan.some((r) => r.newName === name))) {
  console.error('\nABORT: plan itself produces duplicate names — fix suffix logic first.');
  await browser.close();
  process.exit(3);
}

console.log('\nApplying renames…\n');
let ok = 0, fail = 0;
for (const r of plan) {
  try {
    const det = await post('/PM/GetBonusInfo', { PromotionId: r.id });
    const promo = det?.data?.Promotion || det?.data;
    if (!promo?.PromotionId) throw new Error('detail fetch returned no Promotion');
    const start = toDateString(promo.PromotionStartDate);
    const end = toDateString(promo.PromotionEndDate);
    if (!start || !end) throw new Error(`unparseable dates start=${promo.PromotionStartDate} end=${promo.PromotionEndDate}`);
    await post('/PM/UpdatePromotionDetails', {
      PromotionId: promo.PromotionId,
      PromotionName: r.newName,
      PromotionDescription: promo.PromotionDescription || '',
      PromotionStartDate: start,
      PromotionEndDate: end,
    });
    ok++;
    console.log(`  ✓ ${r.code} → "${r.newName}"`);
  } catch (e) {
    fail++;
    console.log(`  ✗ ${r.code}: ${e.message || e}`);
  }
}

// Post-save QC: re-pull the full list and verify
console.log('\nPost-save verification…');
const after = await listAll();
const counts = new Map();
after.forEach((p) => {
  const n = (p.PromotionName || '').trim();
  counts.set(n, (counts.get(n) || 0) + 1);
});
const dupsAfter = Array.from(counts.entries()).filter(([, c]) => c > 1);
const tleoAfter = after.filter((p) => /TLEO/i.test(p.PromotionCode || ''));
console.log(`  renames applied: ${ok} ok / ${fail} failed`);
console.log(`  TLEO promos now:`);
tleoAfter
  .sort((a, b) => (a.PromotionCode || '').localeCompare(b.PromotionCode || ''))
  .forEach((p) => console.log(`    ${String(p.PromotionId).padEnd(6)} ${p.PromotionCode.padEnd(34)} "${p.PromotionName}"`));
if (dupsAfter.length) {
  console.log(`\n  ✗ ${dupsAfter.length} duplicate name(s) remain site-wide:`);
  dupsAfter.forEach(([n, c]) => console.log(`     "${n}" ×${c}`));
} else {
  console.log('\n  ✓ All promo names on the site are now unique.');
}

await browser.close();
process.exit(fail ? 1 : 0);
