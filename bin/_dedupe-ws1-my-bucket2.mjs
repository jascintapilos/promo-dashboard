#!/usr/bin/env node
// Bucket-2 dedupe on WS1 MY: ACTIVE FreeCredit/FreeSpin promos that share a
// PromotionName (Manual Reward dropdown risk). Campaign prize-pool types
// (LuckyWheel/ScratchCard/MysteryAngpow/Gashapon/LuckyDraw) and SmsRecovery
// are EXCLUDED (bucket 1 / on hold). TLEO codes are never renamed (family
// already unique 2026-07-06) but act as implicit keepers in their groups.
//
//   node bin/_dedupe-ws1-my-bucket2.mjs           # dry-run
//   node bin/_dedupe-ws1-my-bucket2.mjs --commit
//
// New name = base + " (<distinct tokens>)": tokens derived from the code,
// minus tokens common to the whole group, minus tokens already in the name.
// One clean-name keeper per group where possible. Renames update
// PromotionName + RewardName with T&C snapshot/restore across the
// reward-detail PUT (feedback-igmp-reward-details-put-wipes-tnc),
// fail-fast with per-promo live verification.

import { igmpPost } from '../src/igmp-client.js';

const SITE = 'ws1-v3-my';
const COMMIT = process.argv.includes('--commit');
const INCLUDE_TYPES = new Set(['FreeCredit', 'FreeSpin']);
const DETAIL = { FreeCredit: '/PM/GetFreeCreditInfo', FreeSpin: '/PM/GetFreeSpinPromotionInfo' };
// Flagged for manual decision, not renamed (near-identical codes = likely
// accidental double-creation; recommend deactivating one instead):
const FLAG_ONLY = new Set(['FT_VM_FC_1288_5XTO', 'FT_VM_FC_1288_5X']);

const isActive = (p) => { const v = p.IsActive ?? p.Active; return v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true'; };
const stripLen = (h) => (h || '').replace(/<[^>]+>/g, '').trim().length;
const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');

function toDateString(s) {
  const m = String(s).match(/^(\d{2})[/-](\d{2})[/-](\d{4})/);
  const d = m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toDateString();
}

async function listAll() {
  const all = [];
  for (let pg = 1; pg <= 60; pg++) {
    const r = await igmpPost(SITE, `/PM/GetPromotionsList?pageNum=${pg}&rowPerPage=200`, {
      PromotionCode: '', PromotionName: '', PromotionType: '', IsActive: '', IsPublished: '',
    });
    const rows = r?.data || [];
    if (!rows.length) break;
    all.push(...rows);
    if (rows.length < 200) break;
  }
  return all;
}

function partsFromCode(rawCode) {
  const code = (rawCode || '').trim();
  const parts = [];
  const add = (t) => { if (t && !parts.includes(t)) parts.push(t); };
  const seg = (t) => new RegExp(`(^|[ _-])${t}([ _-]|$)`, 'i').test(code);

  const stream = code.match(/STREAM(\d*)/i);
  if (stream) add(`STREAM${stream[1] || ''}`.trim() || 'STREAM');
  if (seg('CNY')) add('CNY');
  if (seg('VM')) add('VM');
  if (seg('PP')) add('PP');
  if (seg('SIL')) add('SIL');
  if (seg('BR')) add('BR');
  if (seg('WEL') || seg('WELC')) add('WELC');
  if (seg('REL')) add('REL');
  if (seg('RET')) add('RET');
  if (seg('LV')) add('LV');
  if (/WCCHURNED|CHURN/i.test(code)) add('CHURN');
  if (seg('BUMP')) add('BUMP');
  if (seg('GENERIC')) add('GENERIC');
  if (seg('CROSS')) add('CROSS');
  if (seg('FREE')) add('FREE');
  if (seg('GOO')) add('GOO');
  if (seg('FOO')) add('FOO');
  const set = code.match(/SET-([A-Z]+)/i);
  if (set) add(`SET-${set[1].toUpperCase()}`);
  const dep = code.match(/DEP(\d+)/i);
  if (dep) add(`DEP${dep[1]}`);
  const max = code.match(/MAX(\d+)/i);
  if (max) add(`CAP${max[1]}`);
  const min = code.match(/MIN(\d+)/i);
  if (min) add(`MIN${min[1]}`);
  const fc = code.match(/(\d+)FC(?:_|$)/i) || code.match(/FC(\d+)/i);
  if (fc) add(fc[1]);
  const fs = code.match(/(\d+)FS/i);
  if (fs) add(fs[1]);
  // spin value: _020_/_040_ or trailing _0.4/_0.6
  const sv = code.match(/_0(\d{2})(?:_|$)/);
  if (sv) add(`0.${sv[1]}/spin`);
  const svDot = code.match(/_0\.(\d)(?:_|$)/);
  if (svDot) add(`0.${svDot[1]}0/spin`);
  // DY day-tiers; a code carrying multiple DY values is a range (DY2-DY9)
  const dys = [...code.matchAll(/DY(\d+)/gi)].map((m) => m[1]);
  if (dys.length > 1) add(`DY${dys[0]}-DY${dys[dys.length - 1]}`);
  else if (dys.length === 1) add(`DY${dys[0]}`);
  const day = code.match(/(?:^|_)D(\d)(?:_|$)/i);
  if (day) add(`D${day[1]}`);
  const ver = code.match(/(?:^|_)V(\d+)(?:_|$)/i);
  if (ver) add(`V${ver[1]}`);
  const date = code.match(/_(\d{6})(?:_|$)/);
  if (date) add(date[1]);
  // trailing single-letter variant (_B, _C) — skip when a SET-x token
  // already carries the same info
  const variant = code.match(/[_-]([A-Z]{1,2})$/);
  if (variant && !set && !['BR', 'LC', 'SL'].includes(variant[1])) add(variant[1]);
  return parts;
}

const all = await listAll();
const activeNames = new Map(); // for collision check: all OTHER promos' names
const targets = all.filter((p) => INCLUDE_TYPES.has(p.PromotionType) && isActive(p));

// duplicate groups among the included set
const byName = new Map();
for (const p of targets) {
  const n = (p.PromotionName || '').trim();
  (byName.get(n) || byName.set(n, []).get(n)).push(p);
}
const groups = [...byName.entries()].filter(([, l]) => l.length > 1);
console.log(`[bucket2] ${all.length} promos | ${targets.length} active FC/FS | ${groups.length} duplicate-name groups`);

const plan = [];
const flagged = [];
let blocked = 0;

for (const [base, members] of groups.sort((a, b) => b[1].length - a[1].length)) {
  const flagOnly = members.filter((m) => FLAG_ONLY.has((m.PromotionCode || '').trim()));
  if (flagOnly.length === members.length) {
    flagged.push(`"${base}" ×${members.length} [${members.map((m) => m.PromotionCode.trim()).join(', ')}] — near-identical codes; recommend deactivating one, not renaming`);
    continue;
  }
  const parts = members.map((m) => ({ m, tokens: partsFromCode(m.PromotionCode) }));
  // drop tokens common to ALL members (they don't disambiguate)
  const common = parts[0].tokens.filter((t) => parts.every((x) => x.tokens.includes(t)));
  console.log(`\n"${base}" ×${members.length}`);
  const emptyOnes = [];
  for (const { m, tokens } of parts) {
    const code = (m.PromotionCode || '').trim();
    const isTleo = /TLEO/i.test(code);
    const distinct = tokens.filter((t) => !common.includes(t))
      .filter((t) => !new RegExp(`\\b${reEscape(t)}\\b`, 'i').test(base));
    if (isTleo) { console.log(`   = ${code}: TLEO — keeper (name stays)`); continue; }
    if (!distinct.length) { emptyOnes.push(m); continue; }
    plan.push({ pid: m.PromotionId, code, type: m.PromotionType, oldName: base, newName: `${base} (${distinct.join(' / ')})` });
  }
  const hasTleoKeeper = members.some((m) => /TLEO/i.test(m.PromotionCode || ''));
  emptyOnes.forEach((m, i) => {
    const code = (m.PromotionCode || '').trim();
    if (i === 0 && !hasTleoKeeper) console.log(`   = ${code}: keeper (name stays)`);
    else plan.push({ pid: m.PromotionId, code, type: m.PromotionType, oldName: base, newName: `${base} [${code}]` });
  });
  plan.filter((r) => r.oldName === base).forEach((r) => console.log(`   ${r.code}  →  "${r.newName}"`));
}

// global uniqueness: planned names vs each other and vs every untouched promo
const plannedIds = new Set(plan.map((r) => r.pid));
all.filter((p) => !plannedIds.has(p.PromotionId)).forEach((p) => activeNames.set((p.PromotionName || '').trim(), (p.PromotionCode || '').trim()));
const seen = new Map();
plan.forEach((r) => seen.set(r.newName, (seen.get(r.newName) || 0) + 1));
for (const r of plan) {
  if (seen.get(r.newName) > 1 || activeNames.has(r.newName)) {
    r.newName = `${r.oldName} [${r.code}]`;
  }
}
const finalSeen = new Map();
plan.forEach((r) => finalSeen.set(r.newName, (finalSeen.get(r.newName) || 0) + 1));
const stillDup = plan.filter((r) => finalSeen.get(r.newName) > 1 || activeNames.has(r.newName));

// validate reward existence + snapshot T&C availability (dry-run too)
for (const r of plan) {
  try {
    const det = await igmpPost(SITE, DETAIL[r.type], { PromotionId: r.pid });
    const promo = det?.data?.Promotion || det?.data;
    const rew = promo?.PromotionRewards?.[0];
    if (!rew?.RewardId) throw new Error('no PromotionRewards[0]');
    const ct = await igmpPost(SITE, '/PM/GetPromotionRewardContents', { RewardId: rew.RewardId });
    const tncRows = (Array.isArray(ct?.data) ? ct.data : [])
      .filter((x) => stripLen(x.Content) > 0)
      .map((x) => ({ Locale: x.Locale, PromotionRewardName: x.PromotionRewardName || '', Content: x.Content }));
    Object.assign(r, { promo, rew, tncRows, tncNote: tncRows.length ? tncRows.map((x) => x.Locale).join(',') : 'NONE' });
  } catch (e) {
    r.error = String(e.message || e).slice(0, 100);
    blocked++;
  }
}

console.log(`\n${'═'.repeat(66)}\nRename plan — ${plan.length} promos:`);
for (const r of plan) {
  console.log(`  ${r.error ? '✗' : '✓'} ${r.code.padEnd(34)} pid=${String(r.pid).padEnd(5)} [${r.type}] T&C:${r.tncNote || '?'}`);
  console.log(`      "${r.oldName}" → "${r.newName}"${r.error ? `\n      ⚠ ${r.error}` : ''}`);
}
if (flagged.length) { console.log('\nFlagged (NOT renamed — needs your decision):'); flagged.forEach((f) => console.log(`  ! ${f}`)); }
if (stillDup.length) { console.log('\n✗ names still colliding after plan:'); stillDup.forEach((r) => console.log(`   ${r.code} → "${r.newName}"`)); }

if (!COMMIT) {
  console.log(`\nDRY-RUN — ${plan.length} would be renamed (${blocked} errored). Re-run with --commit.`);
  process.exit(blocked || stillDup.length ? 1 : 0);
}
if (blocked || stillDup.length) { console.error('ABORT: errors/collisions above.'); process.exit(3); }

console.log('\nApplying (fail-fast; first FreeSpin promo doubles as FS-type canary)…\n');
let done = 0;
for (const r of plan) {
  try {
    await igmpPost(SITE, '/PM/UpdatePromotionDetails', {
      PromotionId: r.pid,
      PromotionName: r.newName,
      PromotionDescription: r.promo.PromotionDescription || '',
      PromotionStartDate: toDateString(r.promo.PromotionStartDate),
      PromotionEndDate: toDateString(r.promo.PromotionEndDate),
    });
    await igmpPost(SITE, '/PM/UpdatePromotionRewardDetails', {
      RewardId: String(r.rew.RewardId),
      RewardName: r.newName,
      RedeemableQuantity: String(r.rew.RedeemableQuantity ?? 0),
      CapBonusAmount: String(r.rew.CapBonusAmount ?? 0),
      RedeemableKYCStatus: Array.isArray(r.rew.RedeemableKYCStatus)
        ? r.rew.RedeemableKYCStatus.join(',')
        : String(r.rew.RedeemableKYCStatus ?? ''),
      WithdrawalCap: String(r.rew.WithdrawalCap ?? 0),
      MaximumBalance: String(r.rew.MaximumBalance ?? 0),
    });
    if (r.tncRows.length) {
      await igmpPost(SITE, '/PM/BulkAddorUpdatePromotionRewardContents', {
        RewardId: r.rew.RewardId,
        PromotionRewardContents: r.tncRows,
      });
    }
    // verify
    const det = await igmpPost(SITE, DETAIL[r.type], { PromotionId: r.pid });
    const promo = det?.data?.Promotion || det?.data;
    const rew = promo?.PromotionRewards?.[0];
    const ct = await igmpPost(SITE, '/PM/GetPromotionRewardContents', { RewardId: r.rew.RewardId });
    const rows = Array.isArray(ct?.data) ? ct.data : [];
    const tncOk = r.tncRows.every((t) => rows.some((x) => x.Locale === t.Locale && stripLen(x.Content) > 40));
    const econOk = Number(rew.FixedBonusAmount ?? 0) === Number(r.rew.FixedBonusAmount ?? 0)
      && Number(rew.RolloverMultiplier ?? 0) === Number(r.rew.RolloverMultiplier ?? 0);
    const nameOk = promo.PromotionName === r.newName && rew.RewardName === r.newName;
    if (!nameOk || !tncOk || !econOk) {
      console.log(`  ✗ ${r.code}: VERIFY FAILED (name=${nameOk} tnc=${tncOk} econ=${econOk}) — ABORTING`);
      process.exit(1);
    }
    done++;
    console.log(`  ✓ ${r.code} → "${r.newName}"`);
  } catch (e) {
    console.log(`  ✗ ${r.code}: ${(e.message || e).slice(0, 120)} — ABORTING`);
    process.exit(1);
  }
}

// post-save: recount duplicates among active FC/FS
const after = (await listAll()).filter((p) => INCLUDE_TYPES.has(p.PromotionType) && isActive(p));
const counts = new Map();
after.forEach((p) => { const n = (p.PromotionName || '').trim(); counts.set(n, (counts.get(n) || 0) + 1); });
const dupsAfter = [...counts.entries()].filter(([, c]) => c > 1)
  .filter(([n]) => !flagged.some((f) => f.startsWith(`"${n}"`)));
console.log(`\n${done}/${plan.length} renamed with T&C preserved.`);
if (dupsAfter.length) { console.log('✗ duplicate active FC/FS names remain:'); dupsAfter.forEach(([n, c]) => console.log(`   "${n}" ×${c}`)); }
else console.log('✓ no duplicate names remain among active FC/FS promos (excluding flagged).');
process.exit(dupsAfter.length ? 1 : 0);
