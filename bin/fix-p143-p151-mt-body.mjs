#!/usr/bin/env node
/**
 * Patch QP2A (1208-1216) + QPRO8 (648-656) message templates for P143-P151.
 *
 * Problem: The FT_ campaign copy generator produced an urgency-style body
 * (no table, no bet value mention) with a misleading subject
 * "48 Claim Your Free Spins Before They're Gone" (reads like "48 hours").
 *
 * Fix: Replace with standard FS template — proper table (FS count / Bet Value /
 * Turnover), correct bet value (MYR/SGD 0.40), and clear subject
 * "Claim Your N Free Spins on Gates Of Olympus".
 *
 * Usage:
 *   node bin/fix-p143-p151-mt-body.mjs          # dry-run
 *   node bin/fix-p143-p151-mt-body.mjs --commit  # live write
 */

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const commit = process.argv.includes('--commit');

// ── Template inventory ────────────────────────────────────────────────────
// spin, minMYR, minSGD pulled from QC bundles + source fixtures.
// QPRO8 is MYR-only (no SGD row).
const TEMPLATES = [
  // QP2A (ibc22) — 4 locales: 1=MY_EN/MYR, 3=MY_ZH/MYR, 6=SG_EN/SGD, 7=SG_ZH/SGD
  { pId: 'P143', tplId: 1208, site: 'ibc22', platform: 'qp2',  spin: 48,  minMYR: 500, minSGD: 150 },
  { pId: 'P144', tplId: 1209, site: 'ibc22', platform: 'qp2',  spin: 68,  minMYR: 500, minSGD: 150 },
  { pId: 'P145', tplId: 1210, site: 'ibc22', platform: 'qp2',  spin: 138, minMYR: 500, minSGD: 150 },
  { pId: 'P146', tplId: 1211, site: 'ibc22', platform: 'qp2',  spin: 28,  minMYR: 300, minSGD: 100 },
  { pId: 'P147', tplId: 1212, site: 'ibc22', platform: 'qp2',  spin: 48,  minMYR: 300, minSGD: 100 },
  { pId: 'P148', tplId: 1213, site: 'ibc22', platform: 'qp2',  spin: 88,  minMYR: 300, minSGD: 100 },
  { pId: 'P149', tplId: 1214, site: 'ibc22', platform: 'qp2',  spin: 18,  minMYR: 100, minSGD: 50  },
  { pId: 'P150', tplId: 1215, site: 'ibc22', platform: 'qp2',  spin: 28,  minMYR: 100, minSGD: 50  },
  { pId: 'P151', tplId: 1216, site: 'ibc22', platform: 'qp2',  spin: 48,  minMYR: 100, minSGD: 50  },
  // QPRO8 — 2 locales: 1=EN/MYR, 3=ZH/MYR
  { pId: 'P143', tplId: 648,  site: 'qpro8', platform: 'qpro', spin: 48,  minMYR: 500, minSGD: null },
  { pId: 'P144', tplId: 649,  site: 'qpro8', platform: 'qpro', spin: 68,  minMYR: 500, minSGD: null },
  { pId: 'P145', tplId: 650,  site: 'qpro8', platform: 'qpro', spin: 138, minMYR: 500, minSGD: null },
  { pId: 'P146', tplId: 651,  site: 'qpro8', platform: 'qpro', spin: 28,  minMYR: 300, minSGD: null },
  { pId: 'P147', tplId: 652,  site: 'qpro8', platform: 'qpro', spin: 48,  minMYR: 300, minSGD: null },
  { pId: 'P148', tplId: 653,  site: 'qpro8', platform: 'qpro', spin: 88,  minMYR: 300, minSGD: null },
  { pId: 'P149', tplId: 654,  site: 'qpro8', platform: 'qpro', spin: 18,  minMYR: 100, minSGD: null },
  { pId: 'P150', tplId: 655,  site: 'qpro8', platform: 'qpro', spin: 28,  minMYR: 100, minSGD: null },
  { pId: 'P151', tplId: 656,  site: 'qpro8', platform: 'qpro', spin: 48,  minMYR: 100, minSGD: null },
];

// ── HTML body builders ────────────────────────────────────────────────────
// tnc: ':merchantname' (QP2) or ':brandname' (QPRO)

function buildEN(spin, ccy, minDep, tncPlaceholder) {
  return `<p>Spin to win! Claim your <strong>${spin} Free Spins</strong> on <strong>Gates Of Olympus</strong> with just <strong>${ccy} ${minDep}</strong> and chase those big wins!</p>

<p><strong>How to Apply:</strong></p>
<ol>
  <li>Make a deposit and wait for it to be approved.</li>
  <li>Once approved, head over to the <strong>Transfer</strong> page.</li>
  <li>On the Transfer page, fill up and submit the form with the following details:
    <ul>
      <li><strong>From:</strong> MAIN WALLET</li>
      <li><strong>To:</strong> PRAGMATIC PLAY</li>
      <li><strong>Amount:</strong> ${minDep} or more</li>
      <li><strong>Promotion:</strong> ${spin} Free Spins on Gates Of Olympus</li>
    </ul>
  </li>
  <li>After the wallet transfer is successful, go to <strong>Home &gt; Slots &gt; [PRAGMATIC PLAY]</strong> and launch the game <strong>Gates Of Olympus</strong>.</li>
  <li>Spin and enjoy!</li>
</ol>

<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%">
  <thead>
    <tr>
      <td><strong>Free Spins</strong></td>
      <td><strong>Bet Value</strong></td>
      <td><strong>Turnover</strong></td>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>${spin}</td>
      <td>${ccy} 0.40</td>
      <td>5x</td>
    </tr>
  </tbody>
</table>

<p><strong>Terms &amp; Conditions</strong></p>

<ol>
  <li>A minimum deposit of ${ccy} ${minDep} is required to claim this promotion.</li>
  <li>Each member can claim this promotion only once.</li>
  <li>This promotion applies exclusively to one game under [PRAGMATIC PLAY]. Your [PRAGMATIC PLAY] wallet will be locked until the turnover requirement is fulfilled.</li>
  <li>The turnover requirement for this promotion is five (5) times the sum of the transfer amount and any winnings from Free Spins.</li>
  <li>The promotion must be claimed within seven (7) days, and the bonus will expire seven (7) days after the claim.</li>
  <li>Promotion codes are time-limited and cannot be extended once expired.</li>
  <li>Members are advised to use the Refresh button on the Home page to get the latest promotion status before performing any transactions e.g. deposit or withdrawal.</li>
  <li>General ${tncPlaceholder} Terms and Conditions apply. :url/terms-conditions</li>
</ol>`;
}

function buildZH(spin, ccy, minDep, tncPlaceholder) {
  return `<p>赢取大奖！仅需 <strong>${ccy} ${minDep}</strong>，即可申领 <strong>${spin} 次免费旋转</strong>于 <strong>Gates Of Olympus</strong>，追逐丰厚奖励！</p>

<p><strong>申请方法：</strong></p>
<ol>
  <li>完成存款并等待审核通过。</li>
  <li>审核通过后，前往 <strong>转账</strong> 页面。</li>
  <li>在转账页面，填写并提交以下信息：
    <ul>
      <li><strong>从：</strong>主钱包</li>
      <li><strong>至：</strong>PRAGMATIC PLAY</li>
      <li><strong>金额：</strong>${minDep} 或以上</li>
      <li><strong>优惠：</strong>${spin} 次免费旋转 — Gates Of Olympus</li>
    </ul>
  </li>
  <li>钱包转账成功后，前往 <strong>首页 &gt; 老虎机 &gt; [PRAGMATIC PLAY]</strong>，启动 <strong>Gates Of Olympus</strong> 游戏。</li>
  <li>开始旋转，尽情享受！</li>
</ol>

<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%">
  <thead>
    <tr>
      <td><strong>免费旋转</strong></td>
      <td><strong>投注金额</strong></td>
      <td><strong>流水要求</strong></td>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>${spin}</td>
      <td>${ccy} 0.40</td>
      <td>5x</td>
    </tr>
  </tbody>
</table>

<p><strong>条款与条件（摘要）</strong></p>

<ol>
  <li>申请此优惠需最低存款 ${ccy} ${minDep}。</li>
  <li>每位会员仅限领取一次此优惠。</li>
  <li>本优惠仅适用于 [PRAGMATIC PLAY] 旗下指定的一款游戏。在完成流水要求前，您的 [PRAGMATIC PLAY] 钱包将被锁定。</li>
  <li>本优惠的流水要求为：（转入金额 + 免费旋转所产生的盈利）× 5 倍。</li>
  <li>优惠需在 7 天内领取，并将在领取后 7 天内过期。</li>
  <li>优惠码有时间限制，一旦过期将无法延长。</li>
  <li>会员在进行任何交易（如存款或提款）前，建议点击首页的刷新按钮以获取最新的优惠状态。</li>
  <li>适用 ${tncPlaceholder} 一般条款与条件。 :url/terms-conditions</li>
</ol>`;
}

function buildLocales(spin, minMYR, minSGD, platform) {
  const tnc = platform === 'qp2' ? ':merchantname' : ':brandname';
  const locales = {};

  // locale 1 — MY_EN / MYR English
  locales['1'] = {
    settings_locale_id: 1,
    subject: `Claim Your ${spin} Free Spins on Gates Of Olympus`,
    message: buildEN(spin, 'MYR', minMYR, tnc),
  };
  // locale 3 — MY_ZH / MYR Chinese
  locales['3'] = {
    settings_locale_id: 3,
    subject: `领取${spin}次免费旋转 – Gates Of Olympus`,
    message: buildZH(spin, 'MYR', minMYR, tnc),
  };

  if (platform === 'qp2' && minSGD != null) {
    // locale 6 — SG_EN / SGD English
    locales['6'] = {
      settings_locale_id: 6,
      subject: `Claim Your ${spin} Free Spins on Gates Of Olympus`,
      message: buildEN(spin, 'SGD', minSGD, tnc),
    };
    // locale 7 — SG_ZH / SGD Chinese
    locales['7'] = {
      settings_locale_id: 7,
      subject: `领取${spin}次免费旋转 – Gates Of Olympus`,
      message: buildZH(spin, 'SGD', minSGD, tnc),
    };
  }

  return locales;
}

// ── Main ──────────────────────────────────────────────────────────────────

console.log('═'.repeat(66));
console.log(`FIX P143-P151 MT body+subject — ${commit ? 'LIVE COMMIT' : 'DRY-RUN (add --commit to save)'}`);
console.log('Adds table (FS count / Bet Value 0.40 / Turnover 5x) to QP2A + QPRO8');
console.log('═'.repeat(66));

let totalPass = 0, totalFail = 0;

for (const t of TEMPLATES) {
  const siteObj = getSite(t.site);
  const platform = t.platform;
  const label = `${t.pId} ${platform === 'qp2' ? 'QP2A' : 'QPRO8'} tpl=${t.tplId}`;

  process.stdout.write(`\n${label}: GET … `);
  let meta, existing;
  try {
    const r = await authedFetch(siteObj, `/api/bo/messagetemplate/${t.tplId}`);
    meta = r.data?.message_template;
    existing = r.data?.message_details || {};
    if (!meta) throw new Error('template not found in response');
    process.stdout.write(`OK (${Object.keys(existing).length} locales)\n`);
  } catch (e) {
    console.log(`FAIL — ${String(e.message || e).split('\n')[0]}`);
    totalFail++;
    continue;
  }

  const newDetails = buildLocales(t.spin, t.minMYR, t.minSGD, platform);

  // Print diff summary
  for (const [lid, nd] of Object.entries(newDetails)) {
    const old = existing[lid];
    const subjectChanged = !old || old.subject !== nd.subject;
    const bodyChanged    = !old || old.message !== nd.message;
    console.log(`  locale ${lid}: subject ${subjectChanged ? '→ CHANGED' : '(same)'} | body ${bodyChanged ? '→ CHANGED' : '(same)'}`);
    if (!commit && subjectChanged) {
      console.log(`    old: ${(old?.subject || '').substring(0, 60)}`);
      console.log(`    new: ${nd.subject.substring(0, 60)}`);
    }
  }

  if (!commit) {
    console.log('  → dry-run — re-run with --commit to save');
    totalPass++;
    continue;
  }

  const putBody = {
    name:    meta.name,
    section: meta.section,
    type:    meta.type,
    status:  meta.status,
    details: newDetails,
  };

  try {
    const res = await authedFetch(siteObj, `/api/bo/messagetemplate/${t.tplId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(putBody),
    });
    const ok = res.success !== false;
    console.log(`  → ${ok ? '✓ saved' : '✗ FAIL'} ${res.message ? `(${Array.isArray(res.message) ? res.message[0] : res.message})` : ''}`);
    if (ok) totalPass++; else totalFail++;
  } catch (e) {
    console.log(`  → ✗ FAIL — ${String(e.message || e).split('\n')[0]}`);
    totalFail++;
  }
}

console.log('\n' + '─'.repeat(40));
console.log(`Summary: ${totalPass} passed, ${totalFail} failed`);
if (!commit) console.log('(dry-run — no BO writes made)');
