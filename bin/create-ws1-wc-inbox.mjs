#!/usr/bin/env node
// Create WS1 NM inbox templates for P112-P115 (World Cup New Player — Pick Your Boost).
// Run:  node bin/create-ws1-wc-inbox.mjs          (dry-run)
//       node bin/create-ws1-wc-inbox.mjs --commit  (live)
//
// Creates on WS1 MY + SG, EN + ZH:
//   FT_WELC_120PCT_10X_WCRND  P112: 120% Welcome (Sports only)
//   FT_REL_50PCT_15X_WCFTD    P113: 50%  Reload (All Game)
//   FT_REL_100PCT_22X_WCFTD   P114: 100% Reload (All Game, dep 300)
//   FT_REL_100PCT_25X_WCFTD   P115: 100% Reload (All Game, dep 500)
//
// WS1 MTs keep the min 300 valid bets clause in Option B (QP2A does too).

import { readFileSync } from 'node:fs';

const commit = process.argv.includes('--commit');

const SESSIONS = JSON.parse(readFileSync('./igmp-sessions.local.json', 'utf8'));

const SITES = [
  { key: 'ws1-v3-my', origin: 'https://kioskmy.best-in-asia.com', ccy: 'MYR' },
  { key: 'ws1-v3-sg', origin: 'https://kiosksg.best-in-asia.com', ccy: 'SGD' },
];

const PROMOS = [
  {
    code: 'FT_WELC_120PCT_10X_WCRND',
    optionANameEN: '120% Welcome Bonus (Sports only)',
    optionANameZH: '120% 欢迎红利（仅限体育）',
    clause4Type: 'Welcome',
    bonusPct: 120,
    deps: { MYR: 30, SGD: 50 },
    maxBonus: 300,
    turnover: 10,
  },
  {
    code: 'FT_REL_50PCT_15X_WCFTD',
    optionANameEN: '50% Reload Bonus (All Game)',
    optionANameZH: '50% 续存红利（所有游戏）',
    clause4Type: 'Reload',
    bonusPct: 50,
    deps: { MYR: 150, SGD: 150 },
    maxBonus: 150,
    turnover: 15,
  },
  {
    code: 'FT_REL_100PCT_22X_WCFTD',
    optionANameEN: '100% Reload Bonus (All Game)',
    optionANameZH: '100% 续存红利（所有游戏）',
    clause4Type: 'Reload',
    bonusPct: 100,
    deps: { MYR: 300, SGD: 300 },
    maxBonus: 300,
    turnover: 22,
  },
  {
    code: 'FT_REL_100PCT_25X_WCFTD',
    optionANameEN: '100% Reload Bonus (All Game)',
    optionANameZH: '100% 续存红利（所有游戏）',
    clause4Type: 'Reload',
    bonusPct: 100,
    deps: { MYR: 500, SGD: 500 },
    maxBonus: 500,
    turnover: 25,
  },
];

const SUBJECT_EN = 'World Cup Special – Pick Your Boost';
const SUBJECT_ZH = '世界杯特别活动 – 选择您的奖励加速';

function buildEN(p, ccy) {
  const dep = p.deps[ccy];
  const isWelcome = p.clause4Type === 'Welcome';
  const clause4 = isWelcome
    ? `<strong>Option A: Welcome Bonus</strong> — Members are required to make a minimum deposit of ${ccy} ${dep} to receive a ${p.bonusPct}% bonus, capped at ${ccy} ${p.maxBonus}. The Welcome Bonus is subject to ${p.turnover}x turnover based on the bonus amount received before any withdrawal can be made.`
    : `<strong>Option A: Reload Bonus</strong> — Members are required to make a minimum deposit of ${ccy} ${dep} to receive a ${p.bonusPct}% bonus, capped at ${ccy} ${p.maxBonus}. The Reload Bonus is subject to ${p.turnover}x turnover based on the bonus amount received before any withdrawal can be made.`;

  return `<p>⚽ <strong>World Cup Special – Pick Your Boost</strong></p>
<p>Choose <strong>ONE</strong> reward option only — you may claim 1 option per account during the promotion period.</p>

<table style="width:100%;">
  <thead>
    <tr>
      <th><strong>Reward Option</strong></th>
      <th><strong>Requirement</strong></th>
      <th><strong>Reward</strong></th>
      <th><strong>Max Bonus</strong></th>
      <th><strong>Turnover</strong></th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><strong>Option A: ${p.optionANameEN}</strong></td>
      <td>Min deposit ${ccy} ${dep}</td>
      <td>${p.bonusPct}% bonus</td>
      <td>${ccy} ${p.maxBonus}</td>
      <td>${p.turnover}x bonus</td>
    </tr>
    <tr>
      <td><strong>Option B: Loss Rescue Bonus</strong></td>
      <td>Min ${ccy} 300 valid bets + min ${ccy} 100 net loss</td>
      <td>100% net loss rebate</td>
      <td>${ccy} 200</td>
      <td>8x bonus</td>
    </tr>
  </tbody>
</table>

<p><strong>Terms &amp; Conditions</strong></p>
<ol>
  <li>This promotion is available for selected MB8 members only.</li>
  <li>Eligible members may choose <strong>one (1) reward option only</strong> during the promotion period: <strong>Option A: ${p.optionANameEN}</strong> or <strong>Option B: Loss Rescue Bonus</strong>.</li>
  <li>Once a reward option has been selected, it <strong>cannot be changed, cancelled, transferred, or combined</strong> with another reward option.</li>
  <li>${clause4}</li>
  <li><strong>Option B: Loss Rescue Bonus</strong> — Members are required to achieve a minimum of ${ccy} 300 valid bets and a minimum ${ccy} 100 net loss during the promotion period to receive a 100% net loss rebate, capped at ${ccy} 200. The Loss Rescue Bonus is subject to 8x turnover based on the bonus amount received before any withdrawal can be made.</li>
  <li>Net loss refers to the member’s total valid settled losses minus total valid settled winnings during the promotion period.</li>
  <li><strong>Example for Loss Rescue Bonus:</strong> If a member records ${ccy} 150 net loss, the member will receive ${ccy} 150 bonus. Required turnover: ${ccy} 150 × 8 = ${ccy} 1,200.</li>
  <li>Eligible games: All Games except Blackjack and Virtual Sports.</li>
  <li>The following games or situations are not eligible and will be excluded from the turnover calculation: Blackjack, Virtual Sports, void bets, cancelled bets, refunded bets, draw/no-action bets, cash out bets, opposite betting, hedging, arbitrage play, and any abnormal or low-risk betting activity.</li>
  <li>Only settled bets with a final result of win or loss will be counted as valid turnover.</li>
  <li>Members must complete the required turnover within the stated bonus validity period. Any incomplete turnover after the validity period will result in the bonus and winnings being forfeited.</li>
  <li>This promotion cannot be used together with any other ongoing promotion, bonus, rebate, cashback, or reward campaign unless stated otherwise by MB8.</li>
  <li>Each member, IP address, device, bank account, contact number, and household is allowed to participate once only. Duplicate or multiple accounts will be disqualified.</li>
  <li>MB8 reserves the right to reject, cancel, suspend, or void any bonus, winnings, or participation if any fraud, bonus abuse, multiple account abuse, suspicious betting pattern, or violation of the promotion terms is detected.</li>
  <li>MB8 reserves the right to amend, suspend, cancel, or terminate this promotion at any time without prior notice.</li>
  <li>MB8’s decision on all matters relating to this promotion shall be final and conclusive.</li>
  <li><a href="https://mb8.gg/terms-conditions">General MB8 Terms and Conditions apply.</a></li>
</ol>`;
}

function buildZH(p, ccy) {
  const dep = p.deps[ccy];
  const isWelcome = p.clause4Type === 'Welcome';
  const clause2NameA = isWelcome ? `选项 A：${p.bonusPct}% 欢迎红利（仅限体育）` : `选项 A：${p.bonusPct}% 续存红利（所有游戏）`;
  const clause4 = isWelcome
    ? `<strong>选项 A：欢迎红利</strong> — 会员需存款最低 ${ccy} ${dep} 即可获得 ${p.bonusPct}% 红利，最高 ${ccy} ${p.maxBonus}。欢迎红利需在提款前完成 ${p.turnover} 倍流水要求（基于所获红利金额）。`
    : `<strong>选项 A：续存红利</strong> — 会员需存款最低 ${ccy} ${dep} 即可获得 ${p.bonusPct}% 红利，最高 ${ccy} ${p.maxBonus}。续存红利需在提款前完成 ${p.turnover} 倍流水要求（基于所获红利金额）。`;

  return `<p>⚽ <strong>世界杯特别活动 – 选择您的奖励加速</strong></p>
<p>在优惠期间只能选择<strong>一（1）项</strong>奖励选项，每个账户仅限一次。</p>

<table style="width:100%;">
  <thead>
    <tr>
      <th><strong>奖励选项</strong></th>
      <th><strong>条件</strong></th>
      <th><strong>奖励</strong></th>
      <th><strong>最高奖金</strong></th>
      <th><strong>流水要求</strong></th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><strong>选项 A：${p.optionANameZH}</strong></td>
      <td>最低存款 ${ccy} ${dep}</td>
      <td>${p.bonusPct}% 红利</td>
      <td>${ccy} ${p.maxBonus}</td>
      <td>${p.turnover} 倍红利</td>
    </tr>
    <tr>
      <td><strong>选项 B：损失救援红利</strong></td>
      <td>最低 ${ccy} 300 有效投注 + 最低 ${ccy} 100 净亏损</td>
      <td>100% 净亏损返还</td>
      <td>${ccy} 200</td>
      <td>8 倍红利</td>
    </tr>
  </tbody>
</table>

<p><strong>条款与条件</strong></p>
<ol>
  <li>此优惠仅开放给特定 MB8 会员。</li>
  <li>符合条件的会员在优惠期间只能选择<strong>一（1）项</strong>奖励选项：<strong>${clause2NameA}</strong> 或 <strong>选项 B：损失救援红利</strong>。</li>
  <li>一旦选择了奖励选项，将<strong>不可更改、取消、转让或与其他奖励选项合并</strong>。</li>
  <li>${clause4}</li>
  <li><strong>选项 B：损失救援红利</strong> — 会员需在优惠期间达到最低 ${ccy} 300 有效投注额及最低 ${ccy} 100 净亏损，即可获得 100% 净亏损返还，最高 ${ccy} 200。损失救援红利需在提款前完成 8 倍流水要求（基于所获红利金额）。</li>
  <li>净亏损是指会员在优惠期间的有效结算亏损总额减去有效结算盈利总额。</li>
  <li><strong>损失救援红利示例：</strong>若会员净亏损 ${ccy} 150，则可获得 ${ccy} 150 红利。所需流水：${ccy} 150 × 8 = ${ccy} 1,200。</li>
  <li>符合条件的游戏类别：除二十一点（Blackjack）和虚拟体育外的所有游戏。</li>
  <li>以下游戏或情况不符合条件，将从流水计算中排除：二十一点、虚拟体育、作废投注、取消投注、退款投注、平局/无行动投注、套现投注、对冲投注、套利投注以及任何异常或低风险投注行为。</li>
  <li>仅最终结果为赢或输的已结算投注才计入有效流水。</li>
  <li>会员须在红利有效期内完成所需流水。若有效期届满后流水未完成，红利及盈利将予以没收。</li>
  <li>此优惠不可与任何其他进行中的优惠、红利、返水、回扣或奖励活动同时使用，除非 MB8 另有说明。</li>
  <li>每位会员、IP 地址、设备、银行账户、联系电话及住户仅限参与一次。重复或多账户将被取消资格。</li>
  <li>若检测到任何欺诈、滥用红利、多账户滥用、可疑投注模式或违反优惠条款的行为，MB8 保留拒绝、取消、暂停或撤销任何红利、盈利或参与资格的权利。</li>
  <li>MB8 保留随时修改、暂停、取消或终止此优惠的权利，恕不另行通知。</li>
  <li>MB8 对本优惠所有事宜的决定均为最终决定。</li>
  <li><a href="https://mb8.gg/terms-conditions">适用 MB8 一般条款与条件。</a></li>
</ol>`;
}

async function addTemplate(origin, cookies, templateCode, message, locale, subject) {
  const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
  const r = await fetch(`${origin}/NM/AddTemplate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Requested-With': 'XMLHttpRequest',
      Cookie: cookieHeader,
    },
    body: JSON.stringify({
      TemplateCode: templateCode,
      EmailSubject: subject,
      Message: message,
      Locale: locale,
      TemplateType: 'html',
      IsActive: true,
    }),
  });
  return r.json();
}

console.log(`Mode: ${commit ? 'COMMIT' : 'DRY-RUN'}`);
console.log(`Sites: ${SITES.map(s => s.key).join(', ')}`);
console.log(`Templates: ${PROMOS.length} promos × 2 sites × 2 locales = ${PROMOS.length * 2 * 2} total\n`);

const results = [];
for (const site of SITES) {
  const session = SESSIONS.sessions?.[site.key];
  if (!session?.cookies) {
    console.error(`⚠ No session for ${site.key} — skipping`);
    continue;
  }

  console.log(`━━━ ${site.key} (${site.ccy}) ━━━`);
  for (const p of PROMOS) {
    for (const { locale, bodyFn, subject } of [
      { locale: 'en', bodyFn: buildEN, subject: SUBJECT_EN },
      { locale: 'zh', bodyFn: buildZH, subject: SUBJECT_ZH },
    ]) {
      const message = bodyFn(p, site.ccy);
      if (commit) {
        const res = await addTemplate(site.origin, session.cookies, p.code, message, locale, subject);
        const ok = res.success === true;
        console.log(`  ${ok ? '✅' : '❌'} ${p.code} | ${locale} ${ok ? '' : JSON.stringify(res).slice(0, 200)}`);
        results.push({ site: site.key, code: p.code, locale, ok, error: ok ? null : res.message });
      } else {
        console.log(`  [DRY] ${p.code} | ${locale} | ${message.length} chars`);
        results.push({ site: site.key, code: p.code, locale, ok: null });
      }
    }
  }
  console.log('');
}

if (commit) {
  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => r.ok === false);
  console.log(`\nDone: ${passed}/${results.length} created`);
  if (failed.length) {
    console.log('Failures:');
    for (const f of failed) console.log(`  ${f.site} ${f.code} ${f.locale}: ${f.error}`);
  }
}
