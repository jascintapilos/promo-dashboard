#!/usr/bin/env node
// Dedupe duplicate PromotionNames on WS1 SG — SG counterpart of
// bin/_rename-ws1-legacy-unique.mjs (MY done 2026-07-06, 57 renamed).
// Triggered by the 2026-07-07 brand-watch baseline: active Bonus-type
// promos share PromotionNames (20 dup groups). Duplicate names break
// Manual Reward Assignment (team picks by name).
//
// PromotionName is PLAYER-VISIBLE on WS1, so suffixes must stay neutral —
// no internal channel tokens (FT/REL/VM/CHURN...). Instead each group
// member gets a suffix built from the mechanics that actually DIFFER
// within its group, read from the saved BO reward config (GetBonusInfo):
//   MinimumActionAmount → MIN100   CapBonusAmount → CAP188
//   RolloverMultiplier  → TO10x
// matching the style already live in player-facing names on this site
// ("188% Exclusive World Cup Bonus (MIN100 / CAP188 / TO20x)").
// Members whose mechanics are identical (e.g. FT_/non-FT twin codes) fall
// back to a plain numeral: "Name II", "Name III", ...
//
//   node bin/_rename-ws1-sg-legacy-unique.mjs                 # dry-run, all dup groups
//   node bin/_rename-ws1-sg-legacy-unique.mjs --active-only   # dry-run, IsActive rows only
//   node bin/_rename-ws1-sg-legacy-unique.mjs --commit        # apply renames
//   node bin/_rename-ws1-sg-legacy-unique.mjs --site=ws2 ...  # run against another IGMP site
//
// Cookies from igmp-sessions.local.json via src/igmp-client.js. Rename via
// /PM/UpdatePromotionDetails (GetBonusInfo passthrough for description+dates).

import { igmpPost } from '../src/igmp-client.js';

const SITE = (process.argv.find((a) => a.startsWith('--site=')) || '--site=ws1-v3-sg').slice('--site='.length);
const COMMIT = process.argv.includes('--commit');
const ACTIVE_ONLY = process.argv.includes('--active-only');

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

// Numeral fallback when mechanics don't disambiguate: II, III, IV, ...
const NUMERALS = ['II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

// Promos whose saved min deposit contradicts their own code (config under
// investigation) — don't advertise the suspect MIN value in the name.
// PromotionIds are per-site, so the list is keyed by site.
// ws1-v3-sg 2898 = FT_REL_70PCT_18X_MIN100_V1: BO has MIN18, code says MIN100.
// RESOLVED 2026-07-07: intended min = 100 (reward T&C table says SGD 100;
// siblings 2897/2895 match their codes). Name manually set to
// "(MIN100 / CAP888)" by bin/_fix-2898-min100.mjs. The config field itself
// is CREATE-ONLY on WS1 (no edit endpoint) — entry kept so a rerun never
// derives a suffix from the still-wrong live value 18.
const SUPPRESS_MIN = new Set({ 'ws1-v3-sg': [2898] }[SITE] || []);

const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');

// Player-neutral mechanics for one promo, from its saved BO reward config.
async function fetchMechanics(promotionId) {
  const det = await post('/PM/GetBonusInfo', { PromotionId: promotionId });
  const data = det?.data || {};
  const promo = data.Promotion || data;
  const rw = (data.PromotionRewards || promo.PromotionRewards || [])[0] || {};
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
  return {
    detail: promo,
    min: num(rw.MinimumActionAmount),
    cap: num(rw.CapBonusAmount),
    to: num(rw.RolloverMultiplier),
  };
}

// Suffix from the mechanics fields that differ within the group, in the
// site's established player-facing style: (MIN100 / CAP188 / TO10x).
// Tokens already present verbatim in the base name are dropped.
function mechanicsSuffix(member, varying, baseName) {
  const tokens = [];
  if (varying.min && member.min && !SUPPRESS_MIN.has(member.p.PromotionId)) tokens.push(`MIN${member.min}`);
  if (varying.cap && member.cap) tokens.push(`CAP${member.cap}`);
  if (varying.to && member.to) tokens.push(`TO${member.to}x`);
  const kept = tokens.filter((t) => !new RegExp(`\\b${reEscape(t)}\\b`, 'i').test(baseName));
  return kept.length ? ` (${kept.join(' / ')})` : '';
}

const all = await listAll();
console.error(`[rename] ${all.length} Type-0 promos on ${SITE}`);

// Duplicate-name groups among non-TLEO codes (TLEO family deduped 2026-07-06)
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

// Build rename plan. Fetch saved mechanics for every group member, suffix
// with only the fields that differ within the group. Members that stay
// ambiguous keep the first (lowest id) on the clean/suffixed name and
// numeral the rest — handled by the collision pass below.
console.error('[rename] fetching saved mechanics for group members…');
const plan = [];
for (const [, lst] of groups) {
  const members = [];
  for (const p of lst) {
    const mech = await fetchMechanics(p.PromotionId);
    members.push({ p, ...mech });
  }
  const differs = (k) => new Set(members.map((m) => m[k])).size > 1;
  const varying = { min: differs('min'), cap: differs('cap'), to: differs('to') };
  for (const m of members) {
    const base = (m.p.PromotionName || '').trim();
    plan.push({
      id: m.p.PromotionId,
      code: (m.p.PromotionCode || '').trim(),
      active: isActive(m.p),
      oldName: base,
      newName: base + mechanicsSuffix(m, varying, base),
      mech: `MIN${m.min ?? '-'} CAP${m.cap ?? '-'} TO${m.to ?? '-'}`,
    });
  }
}

// Collision pass: any planned name colliding within the plan or with an
// untouched site row gets a numeral appended (II, III, ...). The promo with
// a plain code keeps the un-numeraled name ahead of channel variants
// (Aff/FT/VM/...), then lowest id. Repeat until unique.
const isChannelCode = (code) => /(^|[ _])(AFF|FT|VM|TSM|FB|OPS|TEST)([ _]|$)/i.test(code);
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
    rows.sort((a, b) => (isChannelCode(a.code) - isChannelCode(b.code)) || (a.id - b.id));
    rows.forEach((r, i) => {
      const rank = external ? i : i - 1; // keep lowest id clean unless an untouched row owns the name
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

// Skip rows already renamed (rerun-safe)
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

process.exit(fail ? 1 : 0);
