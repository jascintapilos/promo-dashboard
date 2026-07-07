#!/usr/bin/env node
// Rework the 2026-07-06 WS1 MY dedupe renames (bin/_rename-ws1-legacy-unique.mjs,
// 57 promos) to the player-neutral convention established by the SG dedupe
// (bin/_rename-ws1-sg-legacy-unique.mjs). Jascinta ruled 2026-07-07 that
// PromotionName is PLAYER-VISIBLE, so the code-token suffixes the MY run
// produced — "(FT / REL / TO10)", "[VM_DEP100_...]" — must not carry internal
// channel tokens (FT/REL/VM/TSM/FB/RET/CHURN/OPS/...).
//
// Target detection (no log of the 07-06 run survives, so detect by signature):
//   • name ends in " (T1 / T2 / ...)" where EVERY token derives from the
//     promo's own code via the 07-06 script's partsFromCode() — that is
//     exactly how those suffixes were built — and at least one token is NOT
//     a pure mechanics token (MINn/CAPn/TOn[x]) or roman numeral; or
//   • name ends in " [<its own PromotionCode>]" (the 07-06 fallback).
// Pre-existing organic parens ("(Slots Only)", SG-style mechanics suffixes)
// don't match and are left untouched. TLEO codes excluded (separate
// convention, deduped + QC'd 2026-07-06).
//
// New name = stripped base + neutral mechanics suffix read from the SAVED BO
// reward config (GetBonusInfo → data.PromotionRewards[0]):
//   MinimumActionAmount → MIN100   CapBonusAmount → CAP188
//   RolloverMultiplier  → TO10x
// suffixing only the fields that DIFFER within the base-name group (group =
// reworked rows + any untouched site rows still holding the plain base name,
// e.g. the 07-06 "keeper" or inactive dups that were out of that run's
// active-only scope). Ambiguous members fall back to numerals (II, III, ...).
//
//   node bin/_rename-ws1-my-neutral-rework.mjs            # dry-run
//   node bin/_rename-ws1-my-neutral-rework.mjs --commit   # apply renames
//
// Cookies from igmp-sessions.local.json via src/igmp-client.js. Rename via
// /PM/UpdatePromotionDetails (GetBonusInfo passthrough for description+dates
// — safe endpoint, does NOT touch PromotionRewardContents).

import { igmpPost } from '../src/igmp-client.js';

const SITE = 'ws1-v3-my';
const COMMIT = process.argv.includes('--commit');

const post = (endpoint, body) => igmpPost(SITE, endpoint, body);

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

const NUMERALS = ['II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

// Verbatim copy of the 07-06 script's token derivation — used ONLY to
// recognise its suffixes, never to build new names.
function partsFromCode(rawCode) {
  const code = (rawCode || '').trim();
  const parts = [];
  const add = (t) => { if (t && !parts.includes(t)) parts.push(t); };
  const seg = (t) => new RegExp(`(^|[ _])${t}([ _]|$)`, 'i').test(code);

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
  const om = code.match(/(New|NonDepositors)(\d+)hours/i);
  if (om) add(`${/^New$/i.test(om[1]) ? 'New' : 'ND'}${om[2]}h`);
  for (const tier of ['CLASSIC', 'SILVER', 'GOLD', 'PLATINUM', 'PLAT', 'DIAMOND']) {
    if (seg(tier)) { add(tier === 'PLAT' ? 'PLATINUM' : tier); break; }
  }
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
  for (const m of code.matchAll(/_(\d{2,4})(?=[ _]|$)/g)) add(m[1]);
  const to = code.match(/(?:^|_)(\d+)X(?:[ _]|$)/i) || code.match(/(?:^|_)X(\d+)(?:[ _]|$)/i);
  if (to) add(`TO${to[1]}`);
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

const isNeutralToken = (t) =>
  /^(MIN\d+|CAP\d+|TO\d+x?)$/i.test(t) || NUMERALS.includes(t.toUpperCase());

// Classify one listing row. Returns { base, suffixKind, tokens } when the
// name carries a 07-06 rename suffix that needs reworking, else null.
function detectRework(p) {
  const name = (p.PromotionName || '').trim();
  const code = (p.PromotionCode || '').trim();
  if (/TLEO/i.test(code)) return null;

  const brack = name.match(/^(.*?) \[([^\][]+)\]$/);
  if (brack && brack[2].trim().toLowerCase() === code.toLowerCase()) {
    return { base: brack[1].trim(), suffixKind: 'code-fallback', tokens: [code] };
  }

  const paren = name.match(/^(.*?) \(([^()]+)\)$/);
  if (!paren) return null;
  const tokens = paren[2].split('/').map((t) => t.trim()).filter(Boolean);
  if (!tokens.length) return null;
  // CASE-SENSITIVE: the 07-06 script appended partsFromCode output verbatim
  // (uppercase tokens). Title-case parens like "(Platinum)" are pre-existing
  // organic names, not renames — must not match.
  const codeTokens = new Set(partsFromCode(code));
  const allFromCode = tokens.every((t) => codeTokens.has(t));
  if (!allFromCode) return null;               // organic parens — not ours
  if (tokens.every(isNeutralToken)) return null; // already player-neutral
  return { base: paren[1].trim(), suffixKind: 'tokens', tokens };
}

// Promos whose saved MIN contradicts their own code — don't advertise the
// suspect value in the name (none known on MY yet; SG had one).
const SUPPRESS_MIN = new Set([]);

const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');

// Player-neutral mechanics for one promo, from its saved BO reward config.
async function fetchMechanics(promotionId) {
  const det = await post('/PM/GetBonusInfo', { PromotionId: promotionId });
  const data = det?.data || {};
  const promo = data.Promotion || data;
  const rw = (data.PromotionRewards || promo.PromotionRewards || [])[0] || {};
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
  return {
    min: num(rw.MinimumActionAmount),
    cap: num(rw.CapBonusAmount),
    to: num(rw.RolloverMultiplier),
  };
}

function mechanicsSuffix(member, varying, baseName) {
  const tokens = [];
  if (varying.min && member.min && !SUPPRESS_MIN.has(member.p.PromotionId)) tokens.push(`MIN${member.min}`);
  if (varying.cap && member.cap) tokens.push(`CAP${member.cap}`);
  if (varying.to && member.to) tokens.push(`TO${member.to}x`);
  const kept = tokens.filter((t) => !new RegExp(`\\b${reEscape(t)}\\b`, 'i').test(baseName));
  return kept.length ? ` (${kept.join(' / ')})` : '';
}

const all = await listAll();
console.error(`[rework] ${all.length} Type-0 promos on ${SITE}`);

// Find rows carrying a 07-06 token suffix
const targets = [];
for (const p of all) {
  const hit = detectRework(p);
  if (hit) targets.push({ p, ...hit });
}
console.error(`[rework] ${targets.length} promos carry a non-neutral rename suffix (expected ≈57)`);

console.log('\nDetected 07-06 rename suffixes:\n');
for (const t of targets.sort((a, b) => a.base.localeCompare(b.base) || a.p.PromotionId - b.p.PromotionId)) {
  console.log(`  id=${String(t.p.PromotionId).padEnd(6)} active=${isActive(t.p) ? 'Y' : 'n'}  ${t.p.PromotionCode}`);
  console.log(`      "${(t.p.PromotionName || '').trim()}"  →  base "${t.base}"`);
}

// Group by base name; pull in untouched rows still holding the plain base
// name (07-06 keepers / inactive dups) so mechanics-differencing sees them.
const targetIds = new Set(targets.map((t) => t.p.PromotionId));
const byBase = new Map();
for (const t of targets) {
  const lst = byBase.get(t.base) || [];
  lst.push(t);
  byBase.set(t.base, lst);
}

console.error('[rework] fetching saved mechanics for group members…');
const plan = [];
for (const [base, lst] of byBase) {
  const keepers = all.filter((p) => !targetIds.has(p.PromotionId) && (p.PromotionName || '').trim() === base);
  const members = [];
  for (const t of lst) members.push({ p: t.p, rename: true, ...(await fetchMechanics(t.p.PromotionId)) });
  for (const k of keepers) members.push({ p: k, rename: false, ...(await fetchMechanics(k.PromotionId)) });
  const differs = (k) => new Set(members.map((m) => m[k])).size > 1;
  const varying = { min: differs('min'), cap: differs('cap'), to: differs('to') };
  for (const m of members) {
    if (!m.rename) continue;
    plan.push({
      id: m.p.PromotionId,
      code: (m.p.PromotionCode || '').trim(),
      active: isActive(m.p),
      oldName: (m.p.PromotionName || '').trim(),
      newName: base + mechanicsSuffix(m, varying, base),
      mech: `MIN${m.min ?? '-'} CAP${m.cap ?? '-'} TO${m.to ?? '-'}`,
    });
  }
}

// Collision pass: any planned name colliding within the plan or with an
// untouched site row gets a numeral appended (II, III, ... by ascending id;
// the lowest id keeps the un-numeraled name unless an untouched row owns it).
const plannedIds = new Set(plan.map((r) => r.id));
const untouchedNames = new Set(all.filter((p) => !plannedIds.has(p.PromotionId)).map((p) => (p.PromotionName || '').trim()));
for (let pass = 0; pass < 12; pass++) {
  const byNew = new Map();
  for (const r of plan) {
    const lst = byNew.get(r.newName) || [];
    lst.push(r);
    byNew.set(r.newName, lst);
  }
  let changed = false;
  for (const [name, rows] of byNew) {
    const external = untouchedNames.has(name);
    if (rows.length === 1 && !external) continue;
    rows.sort((a, b) => a.id - b.id);
    rows.forEach((r, i) => {
      const rank = external ? i : i - 1;
      if (rank >= 0) {
        r.newName = `${name} ${NUMERALS[Math.min(rank, NUMERALS.length - 1)]}`;
        changed = true;
      }
    });
  }
  if (!changed) break;
}

// Final safety: absolute uniqueness or abort
const finalCheck = new Map();
for (const r of plan) finalCheck.set(r.newName, (finalCheck.get(r.newName) || 0) + 1);
const stillDup = plan.filter((r) => finalCheck.get(r.newName) > 1 || untouchedNames.has(r.newName));

const effective = plan.filter((r) => r.newName !== r.oldName);

console.log(`\nRename plan — ${effective.length} promos:\n`);
for (const r of effective) {
  console.log(`  id=${r.id}  active=${r.active ? 'Y' : 'n'}  ${r.code}  [${r.mech}]`);
  console.log(`    old: "${r.oldName}"`);
  console.log(`    new: "${r.newName}"\n`);
}
if (stillDup.length) {
  console.log('✗ Plan still produces duplicate names:');
  stillDup.forEach((r) => console.log(`   ${r.code} → "${r.newName}"`));
}

if (!COMMIT) {
  console.log('\nDRY-RUN — no changes made. Re-run with --commit to apply.');
  process.exit(0);
}
if (stillDup.length) {
  console.error('\nABORT: plan produces duplicate names — fix suffix logic first.');
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

// Post-save QC: re-pull and verify site-wide uniqueness
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

process.exit(fail ? 1 : 0);
