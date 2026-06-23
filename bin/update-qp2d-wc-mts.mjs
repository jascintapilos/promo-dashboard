#!/usr/bin/env node
// Replace QP2D P085-P088 MTs (IDs 1183-1186) with the World Cup dual-option
// format (Option A = deposit bonus, Option B = Loss Rescue — NO min 300 valid bets).
// Run:  node bin/update-qp2d-wc-mts.mjs          (dry-run)
//       node bin/update-qp2d-wc-mts.mjs --commit  (live)

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const commit = process.argv.includes('--commit');
const site = getSite('qp2a');  // QP2A BO = shared ibc22 backend

const SUBJECT_EN = 'World Cup Special – Pick Your Boost';
const SUBJECT_ZH = '世界杯特别活动 – 选择您的奖励加速';

// P085-P088 on QP2D: `:merchantname` placeholder stays (QP2 substitutes per brand)
// Option B: Min net loss only — no min 300 valid bets

const PROMOS = [
  {
    mtId: 1183,
    code: 'WELC_120PCT_10X_WCRND',
    optionANameEN: '120% Welcome Bonus (Sports only)',
    optionANameZH: '120% 欢迎红利（仅限体育）',
    clause4Type: 'Welcome',
    bonusPct: 120,
    deps: { MY: 30, SG: 50 },
    maxBonus: 300,
    turnover: 10,
  },
  {
    mtId: 1184,
    code: 'REL_50PCT_15X_WCFTD',
    optionANameEN: '50% Reload Bonus (All Game)',
    optionANameZH: '50% 续存红利（所有游戏）',
    clause4Type: 'Reload',
    bonusPct: 50,
    deps: { MY: 150, SG: 150 },
    maxBonus: 150,
    turnover: 15,
  },
  {
    mtId: 1185,
    code: 'REL_100PCT_22X_WCFTD',
    optionANameEN: '100% Reload Bonus (All Game)',
    optionANameZH: '100% 续存红利（所有游戏）',
    clause4Type: 'Reload',
    bonusPct: 100,
    deps: { MY: 300, SG: 300 },
    maxBonus: 300,
    turnover: 22,
  },
  {
    mtId: 1186,
    code: 'REL_100PCT_25X_WCFTD',
    optionANameEN: '100% Reload Bonus (All Game)',
    optionANameZH: '100% 续存红利（所有游戏）',
    clause4Type: 'Reload',
    bonusPct: 100,
    deps: { MY: 500, SG: 500 },
    maxBonus: 500,
    turnover: 25,
  },
];

// Locale config: settingsId, currency/symbol, lang suffix for T&C URL
const LOCALES = [
  { id: 1, region: 'MY', ccy: 'MYR', sym: 'RM',  lang: 'en', docKey: 'EN' },
  { id: 3, region: 'MY', ccy: 'MYR', sym: 'RM',  lang: 'zh', docKey: 'ZH' },
  { id: 6, region: 'SG', ccy: 'SGD', sym: 'S$',  lang: 'en', docKey: 'EN' },
  { id: 7, region: 'SG', ccy: 'SGD', sym: 'S$',  lang: 'zh', docKey: 'ZH' },
];

function buildEN(p, ccy) {
  const dep = p.deps[ccy === 'MYR' ? 'MY' : 'SG'];
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
      <td>Min ${ccy} 100 net loss</td>
      <td>100% net loss rebate</td>
      <td>${ccy} 200</td>
      <td>8x bonus</td>
    </tr>
  </tbody>
</table>

<p><strong>Terms &amp; Conditions</strong></p>
<ol>
  <li>This promotion is available for selected :merchantname members only.</li>
  <li>Eligible members may choose <strong>one (1) reward option only</strong> during the promotion period: <strong>Option A: ${p.optionANameEN}</strong> or <strong>Option B: Loss Rescue Bonus</strong>.</li>
  <li>Once a reward option has been selected, it <strong>cannot be changed, cancelled, transferred, or combined</strong> with another reward option.</li>
  <li>${clause4}</li>
  <li><strong>Option B: Loss Rescue Bonus</strong> — Members are required to achieve a minimum ${ccy} 100 net loss during the promotion period to receive a 100% net loss rebate, capped at ${ccy} 200. The Loss Rescue Bonus is subject to 8x turnover based on the bonus amount received before any withdrawal can be made.</li>
  <li>Net loss refers to the member's total valid settled losses minus total valid settled winnings during the promotion period.</li>
  <li><strong>Example for Loss Rescue Bonus:</strong> If a member records ${ccy} 150 net loss, the member will receive ${ccy} 150 bonus. Required turnover: ${ccy} 150 × 8 = ${ccy} 1,200.</li>
  <li>Eligible games: All Games except Blackjack and Virtual Sports.</li>
  <li>The following games or situations are not eligible and will be excluded from the turnover calculation: Blackjack, Virtual Sports, void bets, cancelled bets, refunded bets, draw/no-action bets, cash out bets, opposite betting, hedging, arbitrage play, and any abnormal or low-risk betting activity.</li>
  <li>Only settled bets with a final result of win or loss will be counted as valid turnover.</li>
  <li>Members must complete the required turnover within the stated bonus validity period. Any incomplete turnover after the validity period will result in the bonus and winnings being forfeited.</li>
  <li>This promotion cannot be used together with any other ongoing promotion, bonus, rebate, cashback, or reward campaign unless stated otherwise by :merchantname.</li>
  <li>Each member, IP address, device, bank account, contact number, and household is allowed to participate once only. Duplicate or multiple accounts will be disqualified.</li>
  <li>:merchantname reserves the right to reject, cancel, suspend, or void any bonus, winnings, or participation if any fraud, bonus abuse, multiple account abuse, suspicious betting pattern, or violation of the promotion terms is detected.</li>
  <li>:merchantname reserves the right to amend, suspend, cancel, or terminate this promotion at any time without prior notice.</li>
  <li>:merchantname's decision on all matters relating to this promotion shall be final and conclusive.</li>
  <li>General <a href=":url/terms-conditions" target="_blank">:merchantname Terms and Conditions</a> apply.</li>
</ol>`;
}

function buildZH(p, ccy) {
  const dep = p.deps[ccy === 'MYR' ? 'MY' : 'SG'];
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
      <td>最低 ${ccy} 100 净亏损</td>
      <td>100% 净亏损返还</td>
      <td>${ccy} 200</td>
      <td>8 倍红利</td>
    </tr>
  </tbody>
</table>

<p><strong>条款与条件</strong></p>
<ol>
  <li>此优惠仅开放给特定 :merchantname 会员。</li>
  <li>符合条件的会员在优惠期间只能选择<strong>一（1）项</strong>奖励选项：<strong>${clause2NameA}</strong> 或 <strong>选项 B：损失救援红利</strong>。</li>
  <li>一旦选择了奖励选项，将<strong>不可更改、取消、转让或与其他奖励选项合并</strong>。</li>
  <li>${clause4}</li>
  <li><strong>选项 B：损失救援红利</strong> — 会员需在优惠期间达到最低 ${ccy} 100 净亏损，即可获得 100% 净亏损返还，最高 ${ccy} 200。损失救援红利需在提款前完成 8 倍流水要求（基于所获红利金额）。</li>
  <li>净亏损是指会员在优惠期间的有效结算亏损总额减去有效结算盈利总额。</li>
  <li><strong>损失救援红利示例：</strong>若会员净亏损 ${ccy} 150，则可获得 ${ccy} 150 红利。所需流水：${ccy} 150 × 8 = ${ccy} 1,200。</li>
  <li>符合条件的游戏类别：除二十一点（Blackjack）和虚拟体育外的所有游戏。</li>
  <li>以下游戏或情况不符合条件，将从流水计算中排除：二十一点、虚拟体育、作废投注、取消投注、退款投注、平局/无行动投注、套现投注、对冲投注、套利投注以及任何异常或低风险投注行为。</li>
  <li>仅最终结果为赢或输的已结算投注才计入有效流水。</li>
  <li>会员须在红利有效期内完成所需流水。若有效期届满后流水未完成，红利及盈利将予以没收。</li>
  <li>此优惠不可与任何其他进行中的优惠、红利、返水、回扣或奖励活动同时使用，除非 :merchantname 另有说明。</li>
  <li>每位会员、IP 地址、设备、银行账户、联系电话及住户仅限参与一次。重复或多账户将被取消资格。</li>
  <li>若检测到任何欺诈、滥用红利、多账户滥用、可疑投注模式或违反优惠条款的行为，:merchantname 保留拒绝、取消、暂停或撤销任何红利、盈利或参与资格的权利。</li>
  <li>:merchantname 保留随时修改、暂停、取消或终止此优惠的权利，恕不另行通知。</li>
  <li>:merchantname 对本优惠所有事宜的决定均为最终决定。</li>
  <li>适用 <a href=":url/terms-conditions" target="_blank">:merchantname 一般条款与条件</a>。</li>
</ol>`;
}

console.log(`Mode: ${commit ? 'COMMIT' : 'DRY-RUN'}\n`);

for (const p of PROMOS) {
  console.log(`━━━ MT ${p.mtId} — ${p.code} ━━━`);

  const details = {};
  for (const loc of LOCALES) {
    const message = loc.docKey === 'EN' ? buildEN(p, loc.ccy) : buildZH(p, loc.ccy);
    const subject = loc.docKey === 'EN' ? SUBJECT_EN : SUBJECT_ZH;
    details[String(loc.id)] = { settings_locale_id: loc.id, subject, message };
    console.log(`  [${loc.id}] ${loc.region}_${loc.docKey}: ${message.length} chars`);
  }

  if (commit) {
    const r = await authedFetch(site, `/api/bo/messagetemplate/${p.mtId}`, {
      method: 'PUT',
      body: {
        name: p.code,
        section: '8',
        type: '1',
        status: 1,
        // omit `code` — server does naive uniqueness check that rejects self
        details,
      },
    });
    const ok = r?.data != null || r?.message === 'Success';
    console.log(`  → PUT ${p.mtId}: ${ok ? '✅ OK' : '❌ ' + JSON.stringify(r).slice(0, 200)}`);

    // QC — verify Option B text is correct (no "300 valid bets")
    const verify = await authedFetch(site, `/api/bo/messagetemplate/${p.mtId}`);
    const myEn = Object.values(verify.data?.message_details || {}).find(d => d.settings_locale_id === 1);
    const has300 = (myEn?.message || '').includes('300 valid bets');
    console.log(`  QC option B: ${has300 ? '❌ still has "300 valid bets"' : '✅ no "300 valid bets"'}`);
  }
  console.log('');
}

if (!commit) console.log('Dry-run — add --commit to apply.');
