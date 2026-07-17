#!/usr/bin/env node
// Create WS1 NM inbox templates for the Churn - Reactivation "Day 1 Streak" FC promos.
//   node tmp-create-churn-inbox.mjs           (dry-run)
//   node tmp-create-churn-inbox.mjs --commit   (live)
//
// P097 FT_RET_CRM_CHURN_18FC_15X_SIL_V1  18FC Silver (churned 30-89d)
// P103 FT_RET_CRM_CHURN_18FC_15X_SIL_V2  18FC Silver (churned 90d+)
// P109 FT_RET_CRM_CHURN_38FC_15X_GLD_V1  38FC Gold+  (churned 30-89d)
// P115 FT_RET_CRM_CHURN_38FC_15X_GLD_V2  38FC Gold+  (churned 90d+)
// All: TO 15x, min dep 0 (no deposit), no max transfer out, Live Casino only
// (except Blackjack), reward valid 1 day, one claim per member, Day 1 streak.

import { readFileSync } from 'node:fs';

const commit = process.argv.includes('--commit');
const SESSIONS = JSON.parse(readFileSync('./igmp-sessions.local.json', 'utf8'));

const SITES = [
  { key: 'ws1-v3-my', origin: 'https://kioskmy.best-in-asia.com', tnc: 'https://mb8mys.com' },
  { key: 'ws1-v3-sg', origin: 'https://kiosksg.best-in-asia.com', tnc: 'https://mb8sg.com' },
];

const TO = 15;
const PROMOS = [
  { code: 'FT_RET_CRM_CHURN_18FC_15X_SIL_V1', amount: 18, rewardEN: 'Exclusive Offer - 18 Free Credit', rewardZH: '独家优惠 - 18 免费体验金' },
  { code: 'FT_RET_CRM_CHURN_18FC_15X_SIL_V2', amount: 18, rewardEN: 'Exclusive Offer - 18 Free Credit', rewardZH: '独家优惠 - 18 免费体验金' },
  { code: 'FT_RET_CRM_CHURN_38FC_15X_GLD_V1', amount: 38, rewardEN: 'Exclusive Offer - 38 Free Credit', rewardZH: '独家优惠 - 38 免费体验金' },
  { code: 'FT_RET_CRM_CHURN_38FC_15X_GLD_V2', amount: 38, rewardEN: 'Exclusive Offer - 38 Free Credit', rewardZH: '独家优惠 - 38 免费体验金' },
];

const subjectEN = (p) => `Exclusive Offer - ${p.amount} Free Credit`;
const subjectZH = (p) => `独家优惠 - ${p.amount} 免费体验金`;

function buildEN(p, site) {
  return `<p>🔥 <strong>Day 1 Streak Reward Unlocked!</strong></p>
<p>Congratulations! This is your <strong>Day 1</strong> streak reward — enjoy <strong>${p.amount} Free Credit</strong> with no deposit required. Claim it now and keep your streak going!</p>

<p><strong>How to Redeem</strong></p>
<ol>
  <li>Head over to the <strong>Reward</strong> page.</li>
  <li>Search for the <strong>${p.rewardEN}</strong> reward and click <strong>CLAIM</strong>.</li>
</ol>

<p><strong>Terms &amp; Conditions</strong></p>
<ol>
  <li>There is no maximum transfer out from the game wallet.</li>
  <li>This bonus is subject to ${TO}x turnover based on the free credit amount received before any withdrawal can be made.</li>
  <li>The bonus is valid for one (1) day upon issuance, unless otherwise stated.</li>
  <li>Promo codes are time-limited and cannot be extended once expired.</li>
  <li>This promotion is applicable to Live Casino only, excluding Blackjack.</li>
  <li>Each member can claim this promotion only once.</li>
  <li>If the reward does not appear, please tap the refresh button on the Reward page.</li>
  <li><a href="${site.tnc}/en/info-center/tnc">General MB8 Terms and Conditions apply.</a></li>
</ol>`;
}

function buildZH(p, site) {
  return `<p>🔥 <strong>第 1 天连续奖励已解锁！</strong></p>
<p>恭喜您！这是您的<strong>第 1 天</strong>连续奖励 — 尊享 <strong>${p.amount} 免费体验金</strong>，无需存款。立即领取，延续您的连胜！</p>

<p><strong>如何领取</strong></p>
<ol>
  <li>前往<strong>奖励</strong>页面。</li>
  <li>搜索 <strong>${p.rewardZH}</strong> 奖励并点击<strong>领取</strong>。</li>
</ol>

<p><strong>条款与条件</strong></p>
<ol>
  <li>游戏钱包没有最高转出限制。</li>
  <li>此红利需在提款前完成 ${TO} 倍流水要求（基于所获免费体验金金额）。</li>
  <li>红利自发放之日起 1 天内有效，除非另有说明。</li>
  <li>优惠码有时间限制，一旦过期将无法延长。</li>
  <li>本优惠仅适用于真人娱乐场（二十一点除外）。</li>
  <li>每位会员仅限领取一次此优惠。</li>
  <li>如奖励未显示，请点击奖励页面的刷新按钮。</li>
  <li><a href="${site.tnc}/zh/info-center/tnc">适用 MB8 一般条款与条件。</a></li>
</ol>`;
}

async function addTemplate(origin, cookies, templateCode, message, locale, subject) {
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  const r = await fetch(`${origin}/NM/AddTemplate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Requested-With': 'XMLHttpRequest', Cookie: cookieHeader },
    body: JSON.stringify({ TemplateCode: templateCode, EmailSubject: subject, Message: message, Locale: locale, TemplateType: 'html', IsActive: true }),
  });
  return r.json();
}

console.log(`Mode: ${commit ? 'COMMIT' : 'DRY-RUN'}`);
console.log(`Templates: ${PROMOS.length} promos × ${SITES.length} sites × 2 locales = ${PROMOS.length * SITES.length * 2}\n`);

const results = [];
for (const site of SITES) {
  const session = SESSIONS.sessions?.[site.key];
  if (!session?.cookies) { console.error(`⚠ No session for ${site.key} — skipping`); continue; }
  console.log(`━━━ ${site.key} ━━━`);
  for (const p of PROMOS) {
    for (const { locale, bodyFn, subjFn } of [
      { locale: 'en', bodyFn: buildEN, subjFn: subjectEN },
      { locale: 'zh', bodyFn: buildZH, subjFn: subjectZH },
    ]) {
      const message = bodyFn(p, site);
      const subject = subjFn(p);
      if (commit) {
        const res = await addTemplate(site.origin, session.cookies, p.code, message, locale, subject);
        const ok = res.success === true;
        console.log(`  ${ok ? '✅' : '❌'} ${p.code} | ${locale} | "${subject}" ${ok ? '' : JSON.stringify(res).slice(0, 200)}`);
        results.push({ site: site.key, code: p.code, locale, ok, error: ok ? null : res.message });
      } else {
        console.log(`  [DRY] ${p.code} | ${locale} | "${subject}" | ${message.length} chars`);
        results.push({ site: site.key, code: p.code, locale, ok: null });
      }
    }
  }
  console.log('');
}

if (commit) {
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => r.ok === false);
  console.log(`Done: ${passed}/${results.length} created`);
  for (const f of failed) console.log(`  FAIL ${f.site} ${f.code} ${f.locale}: ${f.error}`);
}
