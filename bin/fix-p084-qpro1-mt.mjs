#!/usr/bin/env node
// Fix QPRO1 P084 MT (id=1015): two issues in auto-rendered content:
//   1. Clause 4 was "Slots only" — needs Sports+Slots with correct exclusions
//   2. T&C link had hardcoded https://bp9mys.com URL — needs :url/terms-conditions placeholder

import { getSite } from '../src/sites.js';
import { authedFetch } from '../src/api-client.js';

const MT_ID = 1015;
const site = getSite('qpro1');

const details = {
  '1': {
    settings_locale_id: 1,
    subject: 'Your Welcome Bonus Is Ready — 188% Bonus',
    message: `<p>Welcome aboard! We're thrilled to have you with us. Your welcome bonus is ready to claim — top up now and start your winning journey.</p>
<p><strong>Promo Details:</strong></p>

<table style="width:100%;">
  <thead>
    <tr>
      <th style="text-align:center;"><strong>Min Deposit</strong></th>
      <th style="text-align:center;"><strong>Max Bonus</strong></th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td style="text-align:center;">MYR 100</td>
      <td style="text-align:center;">MYR 188</td>
    </tr>
  </tbody>
</table>

<p>Bonus play condition: <strong>20x turnover</strong></p>

<p><strong>Bonus Condition Example</strong></p>

<ul>
  <li>Deposit [MYR 100 &amp; above]</li>
  <li>Bonus amount = MYR 188</li>
  <li>Total received amount [MYR 100 + MYR 188] = MYR 288</li>
  <li>Turnover requirement [MYR 288 x 20] = MYR 5,760</li>
</ul>

<p><strong>Terms &amp; Conditions</strong></p>

<ol>
  <li>A minimum deposit of MYR 100 is required to claim this promotion. Max bonus for this promotion is MYR 188.</li>
  <li>A turnover requirement of twenty (20) times applies before any withdrawals can be made.</li>
  <li>Each member can claim this promotion only once.</li>
  <li>Sports and slots categories are eligible for this promotion except Virtual Sports, Number Games, Table games, and Arcade games.</li>
  <li>The promotion must be claimed within fifteen (15) days, and the bonus will expire fifteen (15) days after the claim.</li>
  <li>Promotion codes are time-limited and cannot be extended once expired.</li>
  <li>Members are advised to use the Refresh button on the Home page to get the latest promotion status before performing any transactions e.g. deposit or withdrawal.</li>
  <li>General :brandname <a href=":url/terms-conditions">Terms and Conditions</a> apply.</li>
</ol>
`,
  },
  '3': {
    settings_locale_id: 3,
    subject: '欢迎奖励已就绪，立即领取 — 188% 奖励',
    message: `<p>欢迎加入我们的大家庭！为庆祝您的到来，我们为您准备了专属欢迎奖励——立即充值，开启精彩赢利旅程！</p>
<p><strong>优惠详情：</strong></p>

<table style="width:100%;">
  <thead>
    <tr>
      <th style="text-align:center;"><strong>最低存款金额</strong></th>
      <th style="text-align:center;"><strong>最高奖金</strong></th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td style="text-align:center;">MYR 100</td>
      <td style="text-align:center;">MYR 188</td>
    </tr>
  </tbody>
</table>

<p>奖金条件：<strong>20 倍流水</strong></p>

<p><strong>奖金计算示例</strong></p>

<ul>
  <li>存款 [MYR 100 或以上]</li>
  <li>奖金 = MYR 188</li>
  <li>存款 + 奖金 [MYR 100 + MYR 188] = MYR 288</li>
  <li>流水量需求 [MYR 288 x 20] = MYR 5,760</li>
</ul>

<p><strong>条款与条件（摘要）</strong></p>

<ol>
  <li>申请此优惠需最低存款 MYR 100。本次优惠的最高奖金为 MYR 188。</li>
  <li>在进行任何提款前，需完成 20 倍流水要求。</li>
  <li>每位会员仅限领取一次此优惠。</li>
  <li>本优惠适用于体育及老虎机游戏类别，惟虚拟体育、数字游戏、桌面游戏及街机除外。</li>
  <li>优惠需在 15 天内领取，并将在领取后 15 天内过期。</li>
  <li>优惠码有时间限制，一旦过期将无法延长。</li>
  <li>会员在进行任何交易（如存款或提款）前，建议点击首页的刷新按钮以获取最新的优惠状态。</li>
  <li>适用 :brandname 一般<a href=":url/terms-conditions">条款与条件</a>。</li>
</ol>
`,
  },
  '6': {
    settings_locale_id: 6,
    subject: 'Your Welcome Bonus Is Ready — 188% Bonus',
    message: `<p>Welcome aboard! We're thrilled to have you with us. Your welcome bonus is ready to claim — top up now and start your winning journey.</p>
<p><strong>Promo Details:</strong></p>

<table style="width:100%;">
  <thead>
    <tr>
      <th style="text-align:center;"><strong>Min Deposit</strong></th>
      <th style="text-align:center;"><strong>Max Bonus</strong></th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td style="text-align:center;">SGD 100</td>
      <td style="text-align:center;">SGD 188</td>
    </tr>
  </tbody>
</table>

<p>Bonus play condition: <strong>20x turnover</strong></p>

<p><strong>Bonus Condition Example</strong></p>

<ul>
  <li>Deposit [SGD 100 &amp; above]</li>
  <li>Bonus amount = SGD 188</li>
  <li>Total received amount [SGD 100 + SGD 188] = SGD 288</li>
  <li>Turnover requirement [SGD 288 x 20] = SGD 5,760</li>
</ul>

<p><strong>Terms &amp; Conditions</strong></p>

<ol>
  <li>A minimum deposit of SGD 100 is required to claim this promotion. Max bonus for this promotion is SGD 188.</li>
  <li>A turnover requirement of twenty (20) times applies before any withdrawals can be made.</li>
  <li>Each member can claim this promotion only once.</li>
  <li>Sports and slots categories are eligible for this promotion except Virtual Sports, Number Games, Table games, and Arcade games.</li>
  <li>The promotion must be claimed within fifteen (15) days, and the bonus will expire fifteen (15) days after the claim.</li>
  <li>Promotion codes are time-limited and cannot be extended once expired.</li>
  <li>Members are advised to use the Refresh button on the Home page to get the latest promotion status before performing any transactions e.g. deposit or withdrawal.</li>
  <li>General :brandname <a href=":url/terms-conditions">Terms and Conditions</a> apply.</li>
</ol>
`,
  },
  '7': {
    settings_locale_id: 7,
    subject: '欢迎奖励已就绪，立即领取 — 188% 奖励',
    message: `<p>欢迎加入我们的大家庭！为庆祝您的到来，我们为您准备了专属欢迎奖励——立即充值，开启精彩赢利旅程！</p>
<p><strong>优惠详情：</strong></p>

<table style="width:100%;">
  <thead>
    <tr>
      <th style="text-align:center;"><strong>最低存款金额</strong></th>
      <th style="text-align:center;"><strong>最高奖金</strong></th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td style="text-align:center;">SGD 100</td>
      <td style="text-align:center;">SGD 188</td>
    </tr>
  </tbody>
</table>

<p>奖金条件：<strong>20 倍流水</strong></p>

<p><strong>奖金计算示例</strong></p>

<ul>
  <li>存款 [SGD 100 或以上]</li>
  <li>奖金 = SGD 188</li>
  <li>存款 + 奖金 [SGD 100 + SGD 188] = SGD 288</li>
  <li>流水量需求 [SGD 288 x 20] = SGD 5,760</li>
</ul>

<p><strong>条款与条件（摘要）</strong></p>

<ol>
  <li>申请此优惠需最低存款 SGD 100。本次优惠的最高奖金为 SGD 188。</li>
  <li>在进行任何提款前，需完成 20 倍流水要求。</li>
  <li>每位会员仅限领取一次此优惠。</li>
  <li>本优惠适用于体育及老虎机游戏类别，惟虚拟体育、数字游戏、桌面游戏及街机除外。</li>
  <li>优惠需在 15 天内领取，并将在领取后 15 天内过期。</li>
  <li>优惠码有时间限制，一旦过期将无法延长。</li>
  <li>会员在进行任何交易（如存款或提款）前，建议点击首页的刷新按钮以获取最新的优惠状态。</li>
  <li>适用 :brandname 一般<a href=":url/terms-conditions">条款与条件</a>。</li>
</ol>
`,
  },
};

console.log(`PUTting corrected MT to /api/bo/messagetemplate/${MT_ID}…`);
const result = await authedFetch(site, `/api/bo/messagetemplate/${MT_ID}`, {
  method: 'PUT',
  body: {
    name: 'WELC_188PCT_25X',
    section: 8,
    type: 1,
    status: 1,
    details,
    code: 'PROMOTIONS.MESSAGE.WELC_188PCT_25X',
  },
});
console.log('Response:', JSON.stringify(result).slice(0, 300));

console.log('\nVerifying locale 7 tail…');
const verify = await authedFetch(site, `/api/bo/messagetemplate?code=WELC_188PCT_25X`);
const row = verify.data?.rows?.[0];
const tail = row?.message?.slice(-350);
console.log(' ', tail);
const hasCategories = tail?.includes('体育及老虎机');
const hasPlaceholder = tail?.includes(':url/terms-conditions');
console.log(hasCategories ? '✓ Sports+Slots category clause present' : '✗ category clause NOT fixed');
console.log(hasPlaceholder ? '✓ :url placeholder present' : '✗ hardcoded URL still present');
