#!/usr/bin/env node
// Deep QC of TLEO reward T&C on WS1 MY + SG (post fix-ws1-my-tleo-tnc.mjs).
// Read-only. For every TLEO promo (Bonus + FreeCredit), verifies the persisted
// PromotionRewardContents against the promo's own live configuration:
//
//   Bonus (reload):
//     T1  title rate matches live BonusPercentage ("45% Reload Bonus")
//     N1  stats numbers: RM minDep / RM cap / TOx present in EN and ZH
//     C1  clause-3 category matches code token:
//           _LC → "Live Casino only" + Blackjack exclusion (ZH 真人娱乐城)
//           _SL/_SLOT → "Slots only" + Arcade/Table exclusion (ZH 老虎机)
//           neither → "all game categories" + Blackjack/Virtual Sports (ZH 所有游戏)
//     V1  clause-1 validity days == ExpiryMinutes/1440 (WARN only)
//   FreeCredit:
//     F1  FixedBonusAmount + ROx turnover present in EN
//   All:
//     L1  locales en+zh both non-trivial
//     X1  currency: no SGD anywhere on MY; RM present (MY)
//     U1  T&C link: EN row → {domain}/en/info-center/tnc, ZH row → /zh/ (MY: mb8mys.com, SG: mb8sg.com); no cross-site domain
//     K1  name-vs-config: CAP<n>/MIN<n> tokens in PromotionName AND RewardName == live cap/minDep
//     O1  "only once" claim-limit clause present (Bonus EN)
//
// Writes evidence bundle to captures/qc-bundles/tleo-tnc-audit__<site>.json
// for the Sentinel sub-agent.
//
//   node bin/_deep-qc-ws1-tleo-tnc.mjs

import { igmpPost } from '../src/igmp-client.js';
import { writeFileSync, mkdirSync } from 'node:fs';

const SITES = [
  { siteId: 'ws1-v3-my', label: 'WS1 MY', domain: 'mb8mys.com', wrongDomain: 'mb8sg.com', ccy: 'RM', wrongCcy: 'SGD' },
  { siteId: 'ws1-v3-sg', label: 'WS1 SG', domain: 'mb8sg.com', wrongDomain: 'mb8mys.com', ccy: 'SGD', wrongCcy: null },
];

const strip = (html) => (html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

// TLEO family convention (promo request sheet Apr/May 2026, col M):
// _LC token = Live Casino only; _SL/_SLOT = Slots only; reload with NO
// token = Slots only (NOT all-games); FC codes = Slots and LC only.
function categoryFromCode(code, isFc) {
  if (isFc) return 'SLOTLC';
  if (/_LC(_|$)/i.test(code)) return 'LC';
  return 'SLOT';
}

function clause(text, n) {
  const m = text.match(new RegExp(`${n}\\.\\s*([^]*?)(?=\\s*${n + 1}\\.\\s|$)`));
  return m ? m[1].trim() : '';
}

async function listTleo(siteId) {
  const all = [];
  for (let pg = 1; pg <= 60; pg++) {
    const r = await igmpPost(siteId, `/PM/GetPromotionsList?pageNum=${pg}&rowPerPage=200`, {
      PromotionCode: '', PromotionName: '', PromotionType: '', IsActive: '', IsPublished: '',
    });
    const rows = r?.data || [];
    if (!rows.length) break;
    all.push(...rows);
    if (rows.length < 200) break;
  }
  return all.filter((p) => /TLEO/i.test(p.PromotionCode || ''));
}

mkdirSync('captures/qc-bundles', { recursive: true });

for (const site of SITES) {
  const tleo = await listTleo(site.siteId);
  console.log(`\n${'━'.repeat(72)}\n  ${site.label} — deep QC on ${tleo.length} TLEO promos\n${'━'.repeat(72)}`);
  let pass = 0, fail = 0, warn = 0;
  const bundle = [];

  for (const p of tleo.sort((a, b) => (a.PromotionCode || '').localeCompare(b.PromotionCode || ''))) {
    const code = (p.PromotionCode || '').trim();
    const isFc = p.PromotionType === 'FreeCredit';
    const detailEndpoint = isFc ? '/PM/GetFreeCreditInfo' : '/PM/GetBonusInfo';
    const issues = [];
    const warns = [];

    try {
      const det = await igmpPost(site.siteId, detailEndpoint, { PromotionId: p.PromotionId });
      const promo = det?.data?.Promotion || det?.data;
      const rew = promo?.PromotionRewards?.[0];
      if (!rew?.RewardId) throw new Error('no PromotionRewards[0]');
      const ct = await igmpPost(site.siteId, '/PM/GetPromotionRewardContents', { RewardId: rew.RewardId });
      const rows = Array.isArray(ct?.data) ? ct.data : [];
      const en = rows.find((r) => r.Locale === 'en');
      const zh = rows.find((r) => r.Locale === 'zh');
      const enText = strip(en?.Content);
      const zhText = strip(zh?.Content);

      // L1 locales
      if (!en || enText.length < 40) issues.push('L1: EN content missing/trivial');
      if (!zh || zhText.length < 40) issues.push('L1: ZH content missing/trivial');

      const cap = Number(rew.CapBonusAmount);
      const minDep = Number(rew.MinimumActionAmount);
      const to = Number(rew.RolloverMultiplier);
      const pct = Number(rew.BonusPercentage);
      const fixed = Number(rew.FixedBonusAmount);

      if (!isFc && en) {
        // T1 title rate
        if (!new RegExp(`(^|- )${pct}% Reload Bonus`).test(enText)) issues.push(`T1: EN title ≠ "${pct}% Reload Bonus" (starts: "${enText.slice(0, 60)}")`);
        if (zh && !zhText.includes(`${pct}%`)) issues.push(`T1: ZH title missing "${pct}%"`);
        // N1 numbers
        for (const [label, val] of [['minDep', minDep], ['cap', cap]]) {
          if (val && !new RegExp(`${site.ccy}\\s*${val}\\b`).test(enText)) issues.push(`N1: EN missing ${site.ccy} ${val} (${label})`);
          if (val && zh && !new RegExp(`${site.ccy}\\s*${val}\\b`).test(zhText)) issues.push(`N1: ZH missing ${site.ccy} ${val} (${label})`);
        }
        if (to && !new RegExp(`\\b${to}x`).test(enText)) issues.push(`N1: EN missing ${to}x turnover`);
        if (to && zh && !new RegExp(`${to}x`).test(zhText)) issues.push(`N1: ZH missing ${to}x turnover`);
        // V1 validity (warn)
        const vm = clause(enText, 1).match(/valid for (\d+) day/);
        const expDays = rew.ExpiryMinutes ? Math.round(rew.ExpiryMinutes / 1440) : null;
        if (vm && expDays && Number(vm[1]) !== expDays) warns.push(`V1: clause-1 says ${vm[1]} day(s) but ExpiryMinutes=${rew.ExpiryMinutes} (${expDays}d)`);
        // O1 claim-once
        if (!/only once/i.test(enText)) warns.push('O1: no "only once" claim-limit clause in EN');
      }

      if (isFc && en) {
        // F1 FC amount + turnover
        if (fixed && !new RegExp(`\\b${fixed}\\b`).test(enText)) issues.push(`F1: EN missing FC amount ${fixed}`);
        if (to && !new RegExp(`\\b${to}x`).test(enText)) issues.push(`F1: EN missing ${to}x turnover`);
      }

      // C1 category restriction (all types) — legacy 5-clause format has it
      // at clause 3, newer 8-clause format at clause 4; scan the full text
      // and guard against the CONFLICTING scope also being present.
      if (en) {
        const catExp = categoryFromCode(code, isFc);
        const enOk = catExp === 'LC'
          ? /Live Casino/i.test(enText) && /Blackjack/i.test(enText) && !/all game categories/i.test(enText)
          : catExp === 'SLOTLC'
            ? /Slots and Live Casino only/i.test(enText) && !/all game categories/i.test(enText)
            : /(Slots only|are Slots)/i.test(enText) && !/all game categories/i.test(enText) && !/Live Casino/i.test(enText);
        const zhOk = !zh ? false : catExp === 'LC'
          ? /真人娱乐/.test(zhText) && !/所有游戏/.test(zhText)
          : catExp === 'SLOTLC'
            ? /老虎机游戏及真人娱乐场/.test(zhText) && !/所有游戏/.test(zhText)
            : /老虎机/.test(zhText) && !/所有游戏/.test(zhText) && !/真人娱乐/.test(zhText);
        if (!enOk) issues.push(`C1: EN category restriction ≠ ${catExp} — clause3="${clause(enText, 3).slice(0, 60)}" clause4="${clause(enText, 4).slice(0, 60)}"`);
        if (zh && !zhOk) issues.push(`C1: ZH category restriction ≠ ${catExp} — clause3="${clause(zhText, 3).slice(0, 40)}" clause4="${clause(zhText, 4).slice(0, 40)}"`);
      }

      // X1 currency
      const allHtml = (en?.Content || '') + (zh?.Content || '');
      if (site.wrongCcy && new RegExp(`\\b${site.wrongCcy}\\b`).test(strip(allHtml))) issues.push(`X1: wrong currency "${site.wrongCcy}" present`);
      // U1 links
      if (allHtml.includes(site.wrongDomain)) issues.push(`U1: wrong domain ${site.wrongDomain} present`);
      if (en && !en.Content.includes(`${site.domain}/en/info-center/tnc`)) issues.push('U1: EN row missing /en/ T&C link');
      if (zh && !zh.Content.includes(`${site.domain}/zh/info-center/tnc`)) issues.push('U1: ZH row missing /zh/ T&C link');

      // K1 name tokens vs live config (PromotionName + RewardName)
      for (const [field, name] of [['PromotionName', promo.PromotionName], ['RewardName', rew.RewardName]]) {
        const capTok = (name || '').match(/CAP(\d+)/);
        if (capTok && Number(capTok[1]) !== cap) issues.push(`K1: ${field} says CAP${capTok[1]} but live cap=${cap}`);
        const minTok = (name || '').match(/MIN(\d+)/);
        if (minTok && Number(minTok[1]) !== minDep) issues.push(`K1: ${field} says MIN${minTok[1]} but live minDep=${minDep}`);
        // K2: rate/amount in the display name must match live config
        const rateTok = (name || '').match(/(\d+)%/);
        if (rateTok && !isFc && pct && Number(rateTok[1]) !== pct) issues.push(`K2: ${field} "${name}" says ${rateTok[1]}% but live pct=${pct}`);
        const fcTok = (name || '').match(/(\d+)\s*Free Credit/i);
        if (fcTok && isFc && fixed && Number(fcTok[1]) !== fixed) issues.push(`K2: ${field} "${name}" says ${fcTok[1]} FC but live amount=${fixed}`);
      }
      // K1b code CAP/MX token vs live cap
      const codeCap = code.match(/(\d+)MX/);
      if (codeCap && Number(codeCap[1]) !== cap) issues.push(`K1: code says ${codeCap[1]}MX but live cap=${cap}`);
      const codeFc = code.match(/FC(\d+)_/);
      if (codeFc && fixed && Number(codeFc[1]) !== fixed) issues.push(`K1: code says FC${codeFc[1]} but live FixedBonusAmount=${fixed}`);
      const codePct = code.match(/(\d+)PCT/);
      if (codePct && !isFc && Number(codePct[1]) !== pct) issues.push(`K1: code says ${codePct[1]}PCT but live pct=${pct}`);

      bundle.push({
        code, pid: p.PromotionId, rid: rew.RewardId, type: p.PromotionType, active: p.IsActive,
        live: { minDep, cap, to, pct, fixed, expiryMinutes: rew.ExpiryMinutes },
        names: { promotionName: promo.PromotionName, rewardName: rew.RewardName },
        categoryExpected: isFc ? null : categoryFromCode(code),
        clause3: isFc ? null : { en: clause(enText, 3), zh: clause(zhText, 3) },
        titleStart: enText.slice(0, 80),
        issues, warns,
      });

      if (issues.length) { fail++; console.log(`  ✗ ${code}`); issues.forEach((i) => console.log(`      ${i}`)); }
      else if (warns.length) { warn++; console.log(`  ⚠ ${code}`); warns.forEach((i) => console.log(`      ${i}`)); }
      else pass++;
    } catch (e) {
      fail++;
      console.log(`  ✗ ${code}: ${(e.message || e).slice(0, 100)}`);
      bundle.push({ code, pid: p.PromotionId, error: String(e.message || e).slice(0, 200) });
    }
  }

  // D1: duplicate PromotionName / RewardName within the TLEO set (Manual
  // Reward dropdown is keyed on RewardName — feedback-ws1-ws2-unique-promo-name)
  for (const field of ['promotionName', 'rewardName']) {
    const byName = new Map();
    for (const b of bundle) {
      const n = (b.names?.[field] || '').trim();
      if (!n) continue;
      (byName.get(n) || byName.set(n, []).get(n)).push(b.code);
    }
    const dups = [...byName.entries()].filter(([, l]) => l.length > 1);
    if (dups.length) {
      console.log(`\n  D1: duplicate ${field}s within TLEO set:`);
      dups.forEach(([n, l]) => console.log(`     "${n}" ×${l.length}  [${l.join(', ')}]`));
      warn += dups.length;
      bundle.push({ code: `__dup_${field}__`, duplicates: Object.fromEntries(dups) });
    }
  }

  const outPath = `captures/qc-bundles/tleo-tnc-audit__${site.siteId}.json`;
  writeFileSync(outPath, JSON.stringify({ site: site.siteId, generatedAt: new Date().toISOString(), totals: { pass, warn, fail }, promos: bundle }, null, 2));
  console.log(`\n  ${site.label}: PASS=${pass}  WARN=${warn}  FAIL=${fail}  → ${outPath}`);
}
