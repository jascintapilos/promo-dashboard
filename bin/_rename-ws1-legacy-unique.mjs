#!/usr/bin/env node
// Dedupe the remaining (non-TLEO) duplicate PromotionNames on WS1 MY —
// follow-up to bin/_rename-ws1-tleo-unique.mjs (TLEO family done 2026-07-04).
// Duplicate names break Manual Reward Assignment (team picks by name).
//
// New name = existing base name + " (<tokens>)" suffix derived from the
// promo's own code (MIN/CAP/TO/segment). Where tokens don't disambiguate
// (e.g. TEST iGMP ×13, INACTIVE VM_DEP* ×7), falls back to " [<CODE>]"
// which is unique by definition.
//
//   node bin/_rename-ws1-legacy-unique.mjs                 # dry-run, all dup groups
//   node bin/_rename-ws1-legacy-unique.mjs --active-only   # dry-run, IsActive rows only
//   node bin/_rename-ws1-legacy-unique.mjs --commit        # apply renames
//
// Playwright + cookies from igmp-sessions.local.json. Rename via
// /PM/UpdatePromotionDetails (GetBonusInfo passthrough for description+dates).

import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const SITE = 'ws1-v3-my';
const BASE = 'http://kioskmy.nougatsage.com';
const COMMIT = process.argv.includes('--commit');
const ACTIVE_ONLY = process.argv.includes('--active-only');

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

function toDateString(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{2})[/-](\d{2})[/-](\d{4})/);
  const d = m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toDateString();
}

function isActive(p) {
  const v = p.IsActive ?? p.Active ?? p.Status;
  return v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true' || String(v).toLowerCase() === 'active';
}

function partsFromCode(rawCode) {
  const code = (rawCode || '').trim();
  const parts = [];
  const add = (t) => { if (t && !parts.includes(t)) parts.push(t); };
  const seg = (t) => new RegExp(`(^|[ _])${t}([ _]|$)`, 'i').test(code);

  // channel / segment tokens
  if (seg('TEST')) add('TEST');
  if (seg('FT')) add('FT');
  if (seg('VM')) add('VM');
  if (seg('TSM')) add('TSM');
  if (seg('AFF') || seg('Aff')) add('AFF');
  if (seg('FB')) add('FB');
  if (seg('WELC') || seg('WEL')) add('WELC');
  if (seg('REL') || /(^|_)RELBONUS/i.test(code)) add('REL');
  if (seg('RET')) add('RET');
  if (seg('NODEP')) add('NODEP');
  else if (seg('DEP')) add('DEP');
  if (/CHURN/i.test(code)) add('CHURN');
  if (seg('LC')) add('LC');
  if (/_SLOTS?(_|$)/i.test(code)) add('SLOT');
  if (seg('OPS')) add('OPS');
  const fSeries = code.match(/^F(\d)_/i);
  if (fSeries) add(`F${fSeries[1]}`);
  // Optimove audience segments
  const om = code.match(/(New|NonDepositors)(\d+)hours/i);
  if (om) add(`${/^New$/i.test(om[1]) ? 'New' : 'ND'}${om[2]}h`);
  // tier tokens (only appear on legacy adhoc/Genting codes — flagged to operator)
  for (const tier of ['CLASSIC', 'SILVER', 'GOLD', 'PLATINUM', 'PLAT', 'DIAMOND']) {
    if (seg(tier)) { add(tier === 'PLAT' ? 'PLATINUM' : tier); break; }
  }
  // amounts
  const min = code.match(/MIN(\d+)/i);
  if (min) add(`MIN${min[1]}`);
  const dep = code.match(/DEP(\d+)/i);
  if (dep) add(`DEP${dep[1]}`);
  const get = code.match(/GET(\d+)/i);
  if (get) add(`GET${get[1]}`);
  const cap = code.match(/(\d+)MX/i) || code.match(/MAX(\d+)/i);
  if (cap) add(`CAP${cap[1]}`);
  const pctExtra = code.match(/PCT(\d{2,})/i);
  if (pctExtra) add(pctExtra[1]);
  // bare numeric segments (e.g. _188, _288, _100, _50) — legacy deposit tiers
  for (const m of code.matchAll(/_(\d{2,4})(?=[ _]|$)/g)) add(m[1]);
  // turnover
  const to = code.match(/(?:^|_)(\d+)X(?:[ _]|$)/i) || code.match(/(?:^|_)X(\d+)(?:[ _]|$)/i);
  if (to) add(`TO${to[1]}`);
  // day tier (_D2/_D3), version (_V2.._V13), date (2022-10), churn variant (1.1D/1C), x.y version
  const day = code.match(/_D(\d)(?:_|$)/i);
  if (day) add(`D${day[1]}`);
  const ver = code.match(/(?:^|_)V(\d+)(?:_|$)/i);
  if (ver) add(`V${ver[1]}`);
  const date = code.match(/(20\d{2}-\d{2})/);
  if (date) add(date[1]);
  const variant = code.match(/_(\d+(?:\.\d+)?[A-D])$/i);
  if (variant) add(variant[1]);
  const dotVer = code.match(/_(\d+\.\d+)$/);
  if (dotVer) add(dotVer[1]);
  if (/_BR(_|$)/i.test(code)) add('BR');
  return parts;
}

const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');

// Suffix = code tokens minus any already present as a word in the base name
// (avoids "Genting Exclusive Bonus (Platinum) (PLATINUM)").
function suffixFor(code, baseName) {
  const kept = partsFromCode(code).filter((t) => !new RegExp(`\\b${reEscape(t)}\\b`, 'i').test(baseName));
  return kept.length ? ` (${kept.join(' / ')})` : '';
}

const all = await listAll();
console.error(`[rename] ${all.length} Type-0 promos on ${SITE}`);

// Duplicate-name groups among non-TLEO codes
const byName = new Map();
for (const p of all) {
  const name = (p.PromotionName || '').trim();
  const lst = byName.get(name) || [];
  lst.push(p);
  byName.set(name, lst);
}
let groups = Array.from(byName.entries())
  .filter(([, lst]) => lst.length > 1)
  .map(([name, lst]) => [name, lst.filter((p) => !/TLEO/i.test(p.PromotionCode || ''))])
  .filter(([, lst]) => lst.length > 1);

console.error(`[rename] ${groups.length} duplicate name groups (non-TLEO)`);

// Group inventory with status — printed so the operator can decide scope
console.log('\nDuplicate groups (non-TLEO):\n');
for (const [name, lst] of groups.sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  "${name}" ×${lst.length}`);
  for (const p of lst.sort((a, b) => (a.PromotionCode || '').localeCompare(b.PromotionCode || ''))) {
    console.log(`      id=${String(p.PromotionId).padEnd(6)} active=${isActive(p) ? 'Y' : 'n'} pub=${p.IsPublished ?? '?'}  ${p.PromotionCode}`);
  }
}

if (ACTIVE_ONLY) {
  groups = groups
    .map(([name, lst]) => [name, lst.filter(isActive)])
    .filter(([, lst]) => lst.length > 1);
  console.error(`[rename] --active-only: ${groups.length} groups still duplicated among active rows`);
}

// Build rename plan. Within each group, members with a derivable token
// suffix get renamed; if some members have NO tokens, exactly one of them
// (prefer active, then newest) keeps the clean base name — the rest fall
// back to " [<CODE>]".
const plan = [];
for (const [, lst] of groups) {
  const withSuffix = lst.map((p) => ({ p, suffix: suffixFor(p.PromotionCode, (p.PromotionName || '').trim()) }));
  const empty = withSuffix.filter((x) => !x.suffix)
    .sort((a, b) => (isActive(b.p) - isActive(a.p)) || (b.p.PromotionId - a.p.PromotionId));
  const keeper = empty[0]?.p;
  for (const { p, suffix } of withSuffix) {
    const base = (p.PromotionName || '').trim();
    const code = (p.PromotionCode || '').trim();
    let newName;
    if (suffix) newName = `${base}${suffix}`;
    else if (p === keeper) newName = base; // keeps clean name, filtered out below
    else newName = `${base} [${code}]`;
    plan.push({ id: p.PromotionId, code, active: isActive(p), oldName: base, newName });
  }
}

// Resolve collisions: any planned name that still collides (within plan or
// against untouched site rows) falls back to the code-based suffix.
const plannedIds = new Set(plan.map((r) => r.id));
const untouchedNames = new Set(all.filter((p) => !plannedIds.has(p.PromotionId)).map((p) => (p.PromotionName || '').trim()));
const seen = new Map();
for (const r of plan) {
  seen.set(r.newName, (seen.get(r.newName) || 0) + 1);
}
for (const r of plan) {
  if (seen.get(r.newName) > 1 || untouchedNames.has(r.newName)) {
    r.newName = `${r.oldName} [${r.code}]`;
  }
}
// Final safety: absolute uniqueness or abort
const finalCheck = new Map();
for (const r of plan) finalCheck.set(r.newName, (finalCheck.get(r.newName) || 0) + 1);
const stillDup = plan.filter((r) => finalCheck.get(r.newName) > 1 || untouchedNames.has(r.newName));

// Skip rows already renamed (rerun-safe)
const effective = plan.filter((r) => r.newName !== r.oldName);

console.log(`\nRename plan — ${effective.length} promos:\n`);
for (const r of effective) {
  console.log(`  id=${r.id}  active=${r.active ? 'Y' : 'n'}  ${r.code}`);
  console.log(`    old: "${r.oldName}"`);
  console.log(`    new: "${r.newName}"\n`);
}
if (stillDup.length) {
  console.log('✗ Plan still produces duplicate names:');
  stillDup.forEach((r) => console.log(`   ${r.code} → "${r.newName}"`));
}

if (!COMMIT) {
  console.log('\nDRY-RUN — no changes made. Re-run with --commit to apply.');
  await browser.close();
  process.exit(0);
}
if (stillDup.length) {
  console.error('\nABORT: plan produces duplicate names — fix suffix logic first.');
  await browser.close();
  process.exit(3);
}

console.log('\nApplying renames…\n');
let ok = 0, fail = 0;
for (const r of effective) {
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

// Post-save QC: re-pull and verify
console.log('\nPost-save verification…');
const after = await listAll();
const counts = new Map();
after.forEach((p) => {
  const n = (p.PromotionName || '').trim();
  counts.set(n, (counts.get(n) || 0) + 1);
});
const dupsAfter = Array.from(counts.entries()).filter(([, c]) => c > 1);
console.log(`  renames applied: ${ok} ok / ${fail} failed`);
if (dupsAfter.length) {
  console.log(`  ✗ ${dupsAfter.length} duplicate name(s) remain site-wide:`);
  dupsAfter.forEach(([n, c]) => console.log(`     "${n}" ×${c}`));
} else {
  console.log('  ✓ All promo names on the site are now unique.');
}

await browser.close();
process.exit(fail ? 1 : 0);
