#!/usr/bin/env node
// Fix QPRO1 P083 MT (id=1014): replace plain :url/terms-conditions text
// with a proper <a href=":url/terms-conditions"> hyperlink in all 4 locales.
// Rebuilds details from known inject content — only the last T&C line differs.

import { getSite } from '../src/sites.js';
import { authedFetch } from '../src/api-client.js';

const MT_ID = 1014;
const site = getSite('qpro1');

// ── Corrected locale bodies ───────────────────────────────────────────────────
// Same content as inject-p083-mt.mjs but with the last <li> fixed:
//   BEFORE: General :brandname Terms and Conditions apply. &nbsp;:url/terms-conditions
//   AFTER:  General :brandname <a href=":url/terms-conditions">Terms and Conditions</a> apply.
// ZH BEFORE: 适用 :brandname 一般条款与条件。 &nbsp;:url/terms-conditions
// ZH AFTER:  适用 :brandname 一般<a href=":url/terms-conditions">条款与条件</a>。

const details = {
  '1': {
    settings_locale_id: 1,
    subject: 'WORLD CUP 100% BONUS',
    message: [
      '<p><strong>Promo Details:</strong></p>',
      '<figure class="table" style="float:left;width:100%;"><table class="ck-table-resized">',
      '<colgroup><col style="width:49.68%;"><col style="width:50.32%;"></colgroup>',
      '<tbody>',
      '<tr><td style="border-style:solid;text-align:center;vertical-align:bottom;">Min Deposit</td>',
      '<td style="text-align:center;vertical-align:bottom;">Bonus Percentage</td></tr>',
      '<tr><td style="text-align:center;vertical-align:bottom;">MYR 50</td>',
      '<td style="text-align:center;vertical-align:bottom;">100%</td></tr>',
      '<tr><td style="text-align:center;" colspan="2"><i>Bonus play condition: 20x turnover</i></td></tr>',
      '</tbody></table></figure>',
      '<p>&nbsp;</p>',
      '<p><code>Bonus Condition Example</code></p>',
      '<ul>',
      '<li>Deposit [MYR 50 &amp; above]</li>',
      '<li>Bonus amount (100%) = MYR 50</li>',
      '<li>Total received amount [MYR 50 + MYR 50] = MYR 100</li>',
      '<li>Turnover requirement <strong>[MYR 100 x 20] = MYR 2000</strong></li>',
      '</ul>',
      '<hr>',
      '<p style="line-height:1.38;margin-bottom:12pt;margin-top:12pt;" dir="ltr">',
      '<span style="background-color:transparent;color:#000000;"><strong>Terms &amp; Conditions</strong></span></p>',
      '<ol>',
      '<li>A minimum deposit of MYR 50 is required to claim this promotion. Max bonus for this promotion is MYR 300.&nbsp;<br>&nbsp;</li>',
      '<li>A turnover requirement of twenty (20) times applies before any withdrawals can be made.&nbsp;<br>&nbsp;</li>',
      '<li>Sports and slots categories are eligible for this promotion except Virtual Sports, Number Games, Table games, and Arcade games.&nbsp;<br>&nbsp;</li>',
      '<li>The promotion must be claimed within fifteen (15) days, and the bonus will expire fifteen (15) day after the claim.<br>&nbsp;</li>',
      '<li>Promotion codes are time-limited and cannot be extended once expired.&nbsp;<br>&nbsp;</li>',
      '<li>Members are advised to use the Refresh button on the Home page to get the latest promotion status before performing any transactions e.g. deposit or withdrawal.&nbsp;<br>&nbsp;</li>',
      '<li>General :brandname <a href=":url/terms-conditions">Terms and Conditions</a> apply.</li>',
      '</ol>',
    ].join(''),
  },
  '3': {
    settings_locale_id: 3,
    subject: '世界杯 100% 红利',
    message: [
      '<p><strong>优惠详情:</strong></p>',
      '<figure class="table" style="float:left;width:100%;"><table class="ck-table-resized">',
      '<colgroup><col style="width:51.68%;"><col style="width:48.32%;"></colgroup>',
      '<tbody>',
      '<tr><td style="border-style:solid;text-align:center;vertical-align:bottom;">最低存款金额&nbsp;</td>',
      '<td style="text-align:center;vertical-align:bottom;">奖励</td></tr>',
      '<tr><td style="text-align:center;vertical-align:bottom;">MYR 50</td>',
      '<td style="text-align:center;vertical-align:bottom;">100%</td></tr>',
      '<tr><td style="text-align:center;" colspan="2"><i>奖金条件：20 倍流水</i></td></tr>',
      '</tbody></table></figure>',
      '<p>&nbsp;</p>',
      '<p><code>Bonus Condition Example</code></p>',
      '<ul>',
      '<li>存款 &nbsp;[MYR 50 或以上]</li>',
      '<li>奖金 (100%) = MYR 50</li>',
      '<li>存款 + 奖金 [MYR 50 + MYR 50] = MYR 100</li>',
      '<li>流水量需求 <strong>[MYR 100 x 20] = MYR 2000</strong></li>',
      '</ul>',
      '<hr>',
      '<p><span style="background-color:transparent;color:#000000;"><strong>条款与条件</strong></span></p>',
      '<ol>',
      '<li>申请此优惠需最低存款 MYR 50。此优惠最高红利金额为 MYR 300。&nbsp;<br>&nbsp;</li>',
      '<li>任何提款申请均需在完成 20 倍流水要求后方可进行。&nbsp;<br>&nbsp;</li>',
      '<li>本优惠适用于体育及老虎机游戏类别，惟虚拟体育、数字游戏、桌面游戏及街机除外。<br>&nbsp;</li>',
      '<li>该优惠必须在十五（15）天内领取，奖金将在领取后的十五（15）天后失效。<br>&nbsp;</li>',
      '<li>优惠码有时间限制，一旦过期将无法延长。&nbsp;<br>&nbsp;</li>',
      '<li>会员在进行任何交易（如存款或提款）前，建议点击首页的 刷新按钮 以获取最新的优惠状态。<br>&nbsp;</li>',
      '<li>适用 :brandname 一般<a href=":url/terms-conditions">条款与条件</a>。</li>',
      '</ol>',
    ].join(''),
  },
  '6': {
    settings_locale_id: 6,
    subject: 'WORLD CUP 100% BONUS',
    message: [
      '<p><strong>Promo Details:</strong></p>',
      '<figure class="table" style="float:left;width:100%;"><table class="ck-table-resized">',
      '<colgroup><col style="width:49.68%;"><col style="width:50.32%;"></colgroup>',
      '<tbody>',
      '<tr><td style="border-style:solid;text-align:center;vertical-align:bottom;">Min Deposit</td>',
      '<td style="text-align:center;vertical-align:bottom;">Bonus Percentage</td></tr>',
      '<tr><td style="text-align:center;vertical-align:bottom;">SGD 50</td>',
      '<td style="text-align:center;vertical-align:bottom;">100%</td></tr>',
      '<tr><td style="text-align:center;" colspan="2"><i>Bonus play condition: 20x turnover</i></td></tr>',
      '</tbody></table></figure>',
      '<p>&nbsp;</p>',
      '<p><code>Bonus Condition Example</code></p>',
      '<ul>',
      '<li>Deposit [SGD 50 &amp; above]</li>',
      '<li>Bonus amount (100%) = SGD 50</li>',
      '<li>Total received amount [SGD 50 + SGD 50] = SGD 100</li>',
      '<li>Turnover requirement <strong>[SGD 100 x 20] = SGD 2000</strong></li>',
      '</ul>',
      '<hr>',
      '<p style="line-height:1.38;margin-bottom:12pt;margin-top:12pt;" dir="ltr">',
      '<span style="background-color:transparent;color:#000000;"><strong>Terms &amp; Conditions</strong></span></p>',
      '<ol>',
      '<li>A minimum deposit of SGD 50 is required to claim this promotion. Max bonus for this promotion is SGD 300.&nbsp;<br>&nbsp;</li>',
      '<li>A turnover requirement of twenty (20) times applies before any withdrawals can be made.&nbsp;<br>&nbsp;</li>',
      '<li>Sports &amp; slots game categories are eligible for this promotion except Virtual Sports, Number Games, Table games, and Arcade games.&nbsp;<br>&nbsp;</li>',
      '<li>The promotion must be claimed within fifteen (15) days, and the bonus will expire fifteen (15) day after the claim.<br>&nbsp;</li>',
      '<li>Promotion codes are time-limited and cannot be extended once expired.&nbsp;<br>&nbsp;</li>',
      '<li>Members are advised to use the Refresh button on the Home page to get the latest promotion status before performing any transactions e.g. deposit or withdrawal.&nbsp;<br>&nbsp;</li>',
      '<li>General :brandname <a href=":url/terms-conditions">Terms and Conditions</a> apply.</li>',
      '</ol>',
    ].join(''),
  },
  '7': {
    settings_locale_id: 7,
    subject: '世界杯 100% 红利',
    message: [
      '<p><strong>优惠详情:</strong></p>',
      '<figure class="table" style="float:left;width:100%;"><table class="ck-table-resized">',
      '<colgroup><col style="width:51.34%;"><col style="width:48.66%;"></colgroup>',
      '<tbody>',
      '<tr><td style="border-style:solid;text-align:center;vertical-align:bottom;">最低存款金额&nbsp;</td>',
      '<td style="text-align:center;vertical-align:bottom;">奖励</td></tr>',
      '<tr><td style="text-align:center;vertical-align:bottom;">SGD 50</td>',
      '<td style="text-align:center;vertical-align:bottom;">100%</td></tr>',
      '<tr><td style="text-align:center;" colspan="2"><i>奖金条件：20 倍流水</i></td></tr>',
      '</tbody></table></figure>',
      '<p>&nbsp;</p>',
      '<p><code>Bonus Condition Example</code></p>',
      '<ul>',
      '<li>存款 &nbsp;[SGD 50 或以上]</li>',
      '<li>奖金 (100%) = SGD 50</li>',
      '<li>存款 + 奖金 [SGD 50 + SGD 50] = SGD 100</li>',
      '<li>流水量需求 <strong>[SGD 100 x 20] = SGD 2000</strong></li>',
      '</ul>',
      '<hr>',
      '<p><span style="background-color:transparent;color:#000000;"><strong>条款与条件</strong></span></p>',
      '<ol>',
      '<li>申请此优惠需最低存款 SGD 50。此优惠最高红利金额为 SGD 300。&nbsp;<br>&nbsp;</li>',
      '<li>任何提款申请均需在完成 20 倍流水要求后方可进行。&nbsp;<br>&nbsp;</li>',
      '<li>本优惠适用于体育及老虎机游戏类别，惟虚拟体育、数字游戏、桌面游戏及街机除外。<br>&nbsp;</li>',
      '<li>该优惠必须在十五（15）天内领取，奖金将在领取后的十五（15）天后失效。<br>&nbsp;</li>',
      '<li>优惠码有时间限制，一旦过期将无法延长。&nbsp;<br>&nbsp;</li>',
      '<li>会员在进行任何交易（如存款或提款）前，建议点击首页的 刷新按钮 以获取最新的优惠状态。<br>&nbsp;</li>',
      '<li>适用 :brandname 一般<a href=":url/terms-conditions">条款与条件</a>。</li>',
      '</ol>',
    ].join(''),
  },
};

// ── PUT the corrected MT ─────────────────────────────────────────────────────
console.log(`PUTting corrected MT to /api/bo/messagetemplate/${MT_ID}…`);
const result = await authedFetch(site, `/api/bo/messagetemplate/${MT_ID}`, {
  method: 'PUT',
  body: {
    name: 'WEL_WC26_100PCT_50_25x',
    section: 8,
    type: 1,
    status: 1,
    details,
    code: 'PROMOTIONS.MESSAGE.WEL_WC26_100PCT_50_25X',
  },
});
console.log('Response:', JSON.stringify(result).slice(0, 300));

// ── Verify locale 7 (fetchable) ───────────────────────────────────────────────
console.log('\nVerifying locale 7 tail…');
const verify = await authedFetch(site, `/api/bo/messagetemplate?code=WEL_WC26_100PCT_50_25x`);
const row = verify.data?.rows?.[0];
const tail = row?.message?.slice(-150);
console.log(' ', tail);
const ok = tail?.includes('<a href=":url/terms-conditions">');
console.log(ok ? '✓ hyperlink present' : '✗ hyperlink NOT found');
