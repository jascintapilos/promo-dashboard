#!/usr/bin/env node
/**
 * Update message templates for P106-P121 with Column N (inbox_message_raw) content.
 *
 * TEMPLATE MAP
 *   QP2A (IBC22)  : P106→1065  P107→1066  P108→1067  P109→1068
 *                   P110→1069  P111→1070  P112→1071  P113→1072
 *                   P114→1073  P115→1074
 *   QPRO2         : P116→400 P117→401 P118→402 P119→403 P120→404 P121→405
 *   QPRO6         : P116→529 P117→530 P118→531 P119→532 P120→533 P121→534
 *   QPRO8         : P116→571 P117→572 P118→573 P119→574 P120→575 P121→576
 *
 * GROUPS
 *   A (P106-P109) — FS/FC: add "3 Days World Cup Warm Up Challenge Streak"
 *                   to subject + body intro. Full standard FS/FC T&C kept.
 *   B (P110-P111) — FC 50/100: custom intro paragraph + standard FC T&C.
 *   C (P112-P115) — Deposit "Pick Your Boost": full mechanics table + Loss
 *                   Rescue Bonus T&C (sourced from operator reference doc).
 *   D (P116-P121) — Same Pick Your Boost structure on QPRO2/6/8.
 *
 * Usage: node bin/fix-p106-p121-message-templates.mjs [--commit]
 */

import fs from 'node:fs';
import { authedFetch } from '../src/api-client.js';
import { renderBody, resolveBrand } from '../src/message-template-renderer.js';
import { getSite } from '../src/sites.js';

const commit = process.argv.includes('--commit');

// ─── Locale helpers ────────────────────────────────────────────────────────
const LOCALE_ID_TO_CODE = { 1: 'MY_EN', 3: 'MY_ZH', 6: 'SG_EN', 7: 'SG_ZH', 8: 'ID_EN', 9: 'ID_ID' };

function docKeyFromLocale(localeId) {
  const code = LOCALE_ID_TO_CODE[localeId] || '';
  if (code.endsWith('_EN')) return 'EN';
  if (code.endsWith('_ZH')) return 'ZH';
  if (code.startsWith('ID')) return 'ID';
  return 'EN';
}

function currencyFromLocale(localeId) {
  return (localeId === 6 || localeId === 7) ? 'SGD' : 'MYR';
}

// ─── "3 Days World Cup Warm Up Challenge Streak" helpers ───────────────────
const STREAK_EN = '3 Days World Cup Warm Up Challenge Streak';
const STREAK_ZH = '3天世界杯热身挑战连胜';

function prependStreakIntroFS(html, docKey) {
  const intro = docKey === 'ZH'
    ? `<p>⚽ 恭喜您完成我们的<strong>${STREAK_ZH}</strong>！您的奖励已就绪。</p>\n`
    : `<p>⚽ Congratulations on completing the <strong>${STREAK_EN}</strong>! Your reward is ready.</p>\n`;
  return intro + html;
}

const FC_STOCK_INTRO_EN = '<p>Congratulations! You have been rewarded with a free credit!</p>';
const FC_STOCK_INTRO_ZH = '<p>恭喜！您已获得了免费彩金！</p>';

function replaceStreakIntroFC(html, docKey) {
  const oldIntro = docKey === 'ZH' ? FC_STOCK_INTRO_ZH : FC_STOCK_INTRO_EN;
  const newIntro = docKey === 'ZH'
    ? `<p>⚽ 恭喜您完成我们的<strong>${STREAK_ZH}</strong>！您已获得了免费彩金！</p>`
    : `<p>⚽ Congratulations on completing the <strong>${STREAK_EN}</strong>! You have been rewarded with a free credit!</p>`;
  return html.includes(oldIntro) ? html.replace(oldIntro, newIntro) : newIntro + '\n' + html;
}

// ─── Group B custom intro builders (P110/P111) ─────────────────────────────
function buildP11xIntroEN(amount) {
  return (
    `<p>Congratulations on completing our <strong>${STREAK_EN}</strong>!</p>\n` +
    `<p>Your <strong>${amount} Free Credit</strong> is here! Get ready to witness the excitement and victory with us this World Cup season.</p>\n` +
    `<p>Stay tuned for our upcoming main World Cup campaign with even bigger rewards and activities!</p>`
  );
}
function buildP11xIntroZH(amount) {
  return (
    `<p>恭喜您完成我们的<strong>${STREAK_ZH}</strong>！</p>\n` +
    `<p>您的<strong>${amount} 免费彩金</strong>已到账！准备好与我们共同见证这个世界杯赛季的精彩与胜利吧。</p>\n` +
    `<p>敬请期待我们即将推出的世界杯主要活动，更丰厚的奖励与精彩体验等您参与！</p>`
  );
}

// ─── QPRO T&C hyperlink helper (mirrors renderer's hyperlinkQproTnc) ───────
const TNC_TERMS = { EN: 'Terms and Conditions', ZH: '条款与条件', ID: 'Syarat dan Ketentuan' };

function stripUrlSuffix(url) {
  if (!url) return null;
  return String(url)
    .replace(/\/+$/, '')
    .replace(/\/(?:landing|home|login)\/?$/i, '')
    .replace(/\/(?:en|zh|id|th|km|bm)(?:-[a-z]{2})?\/?(?:home|landing)?$/i, '');
}

function applyQproTncLink(html, docKey, tncBase) {
  if (!tncBase) return html;
  const term = TNC_TERMS[docKey] || TNC_TERMS.EN;
  const link = `<a href="${tncBase}/en-my/info-center/terms-and-conditions">${term}</a>`;
  return html.replace(/<li>([^<]*:url\/terms-conditions[^<]*)<\/li>/, (m, inner) => {
    const linked = inner.includes(term) ? inner.replace(term, link) : inner;
    const cleaned = linked.replace(/\s*:url\/terms-conditions\s*/, '');
    return `<li>${cleaned}</li>`;
  });
}

// ─── "Pick Your Boost" full-content body builders ──────────────────────────
// Option B constants sourced from operator reference document (Loss Rescue Bonus)
const OPT_B = { validBets: 300, netLoss: 100, cap: 200, to: 8 };

const PICK_SUBJECT_EN = 'World Cup Special – Pick Your Boost';
const PICK_SUBJECT_ZH = '世界杯特别活动 – 选择您的奖励加速';

function buildPickYourBoostEN(opt1Label, { minDep, maxBonus, pct, toA, currency: c, brand: bp }) {
  const opt1Type = opt1Label.includes('Welcome') ? 'Welcome Bonus' : 'Reload Bonus';
  return (
`<p>⚽ <strong>World Cup Special – Pick Your Boost</strong></p>
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
      <td><strong>Option A: ${opt1Label}</strong></td>
      <td>Min deposit ${c} ${minDep}</td>
      <td>${pct}% bonus</td>
      <td>${c} ${maxBonus}</td>
      <td>${toA}x bonus</td>
    </tr>
    <tr>
      <td><strong>Option B: Loss Rescue Bonus</strong></td>
      <td>Min ${c} ${OPT_B.validBets} valid bets + min ${c} ${OPT_B.netLoss} net loss</td>
      <td>100% net loss rebate</td>
      <td>${c} ${OPT_B.cap}</td>
      <td>${OPT_B.to}x bonus</td>
    </tr>
  </tbody>
</table>

<p><strong>Terms &amp; Conditions</strong></p>
<ol>
  <li>This promotion is available for selected ${bp} members only.</li>
  <li>Eligible members may choose <strong>one (1) reward option only</strong> during the promotion period: <strong>Option A: ${opt1Label}</strong> or <strong>Option B: Loss Rescue Bonus</strong>.</li>
  <li>Once a reward option has been selected, it <strong>cannot be changed, cancelled, transferred, or combined</strong> with another reward option.</li>
  <li><strong>Option A: ${opt1Type}</strong> — Members are required to make a minimum deposit of ${c} ${minDep} to receive a ${pct}% bonus, capped at ${c} ${maxBonus}. The ${opt1Type} is subject to ${toA}x turnover based on the bonus amount received before any withdrawal can be made.</li>
  <li><strong>Option B: Loss Rescue Bonus</strong> — Members are required to achieve a minimum of ${c} ${OPT_B.validBets} valid bets and a minimum ${c} ${OPT_B.netLoss} net loss during the promotion period to receive a 100% net loss rebate, capped at ${c} ${OPT_B.cap}. The Loss Rescue Bonus is subject to ${OPT_B.to}x turnover based on the bonus amount received before any withdrawal can be made.</li>
  <li>Net loss refers to the member's total valid settled losses minus total valid settled winnings during the promotion period.</li>
  <li><strong>Example for Loss Rescue Bonus:</strong> If a member records ${c} 150 net loss, the member will receive ${c} 150 bonus. Required turnover: ${c} 150 × ${OPT_B.to} = ${c} 1,200.</li>
  <li>Eligible games: All Games except Blackjack and Virtual Sports.</li>
  <li>The following games or situations are not eligible and will be excluded from the turnover calculation: Blackjack, Virtual Sports, void bets, cancelled bets, refunded bets, draw/no-action bets, cash out bets, opposite betting, hedging, arbitrage play, and any abnormal or low-risk betting activity.</li>
  <li>Only settled bets with a final result of win or loss will be counted as valid turnover.</li>
  <li>Members must complete the required turnover within the stated bonus validity period. Any incomplete turnover after the validity period will result in the bonus and winnings being forfeited.</li>
  <li>This promotion cannot be used together with any other ongoing promotion, bonus, rebate, cashback, or reward campaign unless stated otherwise by ${bp}.</li>
  <li>Each member, IP address, device, bank account, contact number, and household is allowed to participate once only. Duplicate or multiple accounts will be disqualified.</li>
  <li>${bp} reserves the right to reject, cancel, suspend, or void any bonus, winnings, or participation if any fraud, bonus abuse, multiple account abuse, suspicious betting pattern, or violation of the promotion terms is detected.</li>
  <li>${bp} reserves the right to amend, suspend, cancel, or terminate this promotion at any time without prior notice.</li>
  <li>${bp}'s decision on all matters relating to this promotion shall be final and conclusive.</li>
  <li>General ${bp} Terms and Conditions apply. :url/terms-conditions</li>
</ol>`
  );
}

function buildPickYourBoostZH(opt1ZH, { minDep, maxBonus, pct, toA, currency: c, brand: bp }) {
  const opt1TypeZH = opt1ZH.includes('欢迎') ? '欢迎红利' : '续存红利';
  return (
`<p>⚽ <strong>世界杯特别活动 – 选择您的奖励加速</strong></p>
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
      <td><strong>选项 A：${opt1ZH}</strong></td>
      <td>最低存款 ${c} ${minDep}</td>
      <td>${pct}% 红利</td>
      <td>${c} ${maxBonus}</td>
      <td>${toA} 倍红利</td>
    </tr>
    <tr>
      <td><strong>选项 B：损失救援红利</strong></td>
      <td>最低 ${c} ${OPT_B.validBets} 有效投注 + 最低 ${c} ${OPT_B.netLoss} 净亏损</td>
      <td>100% 净亏损返还</td>
      <td>${c} ${OPT_B.cap}</td>
      <td>${OPT_B.to} 倍红利</td>
    </tr>
  </tbody>
</table>

<p><strong>条款与条件</strong></p>
<ol>
  <li>此优惠仅开放给特定 ${bp} 会员。</li>
  <li>符合条件的会员在优惠期间只能选择<strong>一（1）项</strong>奖励选项：<strong>选项 A：${opt1ZH}</strong> 或 <strong>选项 B：损失救援红利</strong>。</li>
  <li>一旦选择了奖励选项，将<strong>不可更改、取消、转让或与其他奖励选项合并</strong>。</li>
  <li><strong>选项 A：${opt1TypeZH}</strong> — 会员需存款最低 ${c} ${minDep} 即可获得 ${pct}% 红利，最高 ${c} ${maxBonus}。${opt1TypeZH}需在提款前完成 ${toA} 倍流水要求（基于所获红利金额）。</li>
  <li><strong>选项 B：损失救援红利</strong> — 会员需在优惠期间达到最低 ${c} ${OPT_B.validBets} 有效投注额及最低 ${c} ${OPT_B.netLoss} 净亏损，即可获得 100% 净亏损返还，最高 ${c} ${OPT_B.cap}。损失救援红利需在提款前完成 ${OPT_B.to} 倍流水要求（基于所获红利金额）。</li>
  <li>净亏损是指会员在优惠期间的有效结算亏损总额减去有效结算盈利总额。</li>
  <li><strong>损失救援红利示例：</strong>若会员净亏损 ${c} 150，则可获得 ${c} 150 红利。所需流水：${c} 150 × ${OPT_B.to} = ${c} 1,200。</li>
  <li>符合条件的游戏类别：除二十一点（Blackjack）和虚拟体育外的所有游戏。</li>
  <li>以下游戏或情况不符合条件，将从流水计算中排除：二十一点、虚拟体育、作废投注、取消投注、退款投注、平局/无行动投注、套现投注、对冲投注、套利投注以及任何异常或低风险投注行为。</li>
  <li>仅最终结果为赢或输的已结算投注才计入有效流水。</li>
  <li>会员须在红利有效期内完成所需流水。若有效期届满后流水未完成，红利及盈利将予以没收。</li>
  <li>此优惠不可与任何其他进行中的优惠、红利、返水、回扣或奖励活动同时使用，除非 ${bp} 另有说明。</li>
  <li>每位会员、IP 地址、设备、银行账户、联系电话及住户仅限参与一次。重复或多账户将被取消资格。</li>
  <li>若检测到任何欺诈、滥用红利、多账户滥用、可疑投注模式或违反优惠条款的行为，${bp} 保留拒绝、取消、暂停或撤销任何红利、盈利或参与资格的权利。</li>
  <li>${bp} 保留随时修改、暂停、取消或终止此优惠的权利，恕不另行通知。</li>
  <li>${bp} 对本优惠所有事宜的决定均为最终决定。</li>
  <li>适用 ${bp} 一般条款与条件。 :url/terms-conditions</li>
</ol>`
  );
}

// ─── Target definitions ─────────────────────────────────────────────────────
const TARGETS = [
  // Group A: FS
  { handle: 'P106-r107.json', pId: 'P106', group: 'A', bonusType: 'Free Spin',   qp2aTemplate: 1065 },
  { handle: 'P108-r109.json', pId: 'P108', group: 'A', bonusType: 'Free Spin',   qp2aTemplate: 1067 },
  // Group A: FC
  { handle: 'P107-r108.json', pId: 'P107', group: 'A', bonusType: 'Free Credit', qp2aTemplate: 1066 },
  { handle: 'P109-r110.json', pId: 'P109', group: 'A', bonusType: 'Free Credit', qp2aTemplate: 1068 },
  // Group B: FC 50/100
  { handle: 'P110-r111.json', pId: 'P110', group: 'B', bonusType: 'Free Credit', qp2aTemplate: 1069, amountEN: '50', amountZH: '50' },
  { handle: 'P111-r112.json', pId: 'P111', group: 'B', bonusType: 'Free Credit', qp2aTemplate: 1070, amountEN: '100', amountZH: '100' },
  // Group C: QP2A Pick Your Boost (full Loss Rescue T&C)
  { pId: 'P112', group: 'C', qp2aTemplate: 1071, option1EN: '120% Welcome Bonus (Sports only)',  option1ZH: '120% 欢迎红利（仅限体育）' },
  { pId: 'P113', group: 'C', qp2aTemplate: 1072, option1EN: '50% Reload Bonus (All Game)',       option1ZH: '50% 续存红利（所有游戏）' },
  { pId: 'P114', group: 'C', qp2aTemplate: 1073, option1EN: '100% Reload Bonus (All Game)',      option1ZH: '100% 续存红利（所有游戏）' },
  { pId: 'P115', group: 'C', qp2aTemplate: 1074, option1EN: '100% Reload Bonus (All Game)',      option1ZH: '100% 续存红利（所有游戏）' },
  // Group D: QPRO Pick Your Boost (full Loss Rescue T&C)
  { pId: 'P116', group: 'D', qproTemplates: { qpro2: 400, qpro6: 529, qpro8: 571 }, option1EN: '50% Reload Bonus (All Game)',  option1ZH: '50% 续存红利（所有游戏）' },
  { pId: 'P117', group: 'D', qproTemplates: { qpro2: 401, qpro6: 530, qpro8: 572 }, option1EN: '25% Reload Bonus (All Game)',  option1ZH: '25% 续存红利（所有游戏）' },
  { pId: 'P118', group: 'D', qproTemplates: { qpro2: 402, qpro6: 531, qpro8: 573 }, option1EN: '50% Reload Bonus (All Game)',  option1ZH: '50% 续存红利（所有游戏）' },
  { pId: 'P119', group: 'D', qproTemplates: { qpro2: 403, qpro6: 532, qpro8: 574 }, option1EN: '25% Reload Bonus (All Game)',  option1ZH: '25% 续存红利（所有游戏）' },
  { pId: 'P120', group: 'D', qproTemplates: { qpro2: 404, qpro6: 533, qpro8: 575 }, option1EN: '50% Reload Bonus (All Game)',  option1ZH: '50% 续存红利（所有游戏）' },
  { pId: 'P121', group: 'D', qproTemplates: { qpro2: 405, qpro6: 534, qpro8: 576 }, option1EN: '25% Reload Bonus (All Game)',  option1ZH: '25% 续存红利（所有游戏）' },
];

// ─── Content builder ────────────────────────────────────────────────────────
async function buildContent(t, localeId, resolved, platform, brand) {
  const docKey = docKeyFromLocale(localeId);
  if (docKey !== 'EN' && docKey !== 'ZH') return null;
  const isEN = docKey === 'EN';

  // ── Group A ──────────────────────────────────────────────────────────────
  if (t.group === 'A') {
    const rendered = await renderBody({
      bonusType: t.bonusType,
      locale: LOCALE_ID_TO_CODE[localeId] || 'MY_EN',
      brand,
      platform,
      resolved,
    });
    if (rendered.skipped) return null;

    const streakPrefix = isEN ? `${STREAK_EN} – ` : `${STREAK_ZH} – `;
    const subject = streakPrefix + rendered.subject;
    const message = t.bonusType === 'Free Spin'
      ? prependStreakIntroFS(rendered.html, docKey)
      : replaceStreakIntroFC(rendered.html, docKey);
    return { subject, message };
  }

  // ── Group B ──────────────────────────────────────────────────────────────
  if (t.group === 'B') {
    const rendered = await renderBody({
      bonusType: 'Free Credit',
      locale: LOCALE_ID_TO_CODE[localeId] || 'MY_EN',
      brand,
      platform,
      resolved,
    });
    if (rendered.skipped) return null;

    const streakPrefix = isEN ? `${STREAK_EN} – ` : `${STREAK_ZH} – `;
    const subject = streakPrefix + rendered.subject;

    const customIntro = isEN
      ? buildP11xIntroEN(t.amountEN)
      : buildP11xIntroZH(t.amountZH);
    const oldIntro = isEN ? FC_STOCK_INTRO_EN : FC_STOCK_INTRO_ZH;
    const message = rendered.html.includes(oldIntro)
      ? rendered.html.replace(oldIntro, customIntro)
      : customIntro + '\n' + rendered.html;
    return { subject, message };
  }

  // ── Group C + D: Pick Your Boost — full mechanics + Loss Rescue T&C ──────
  if (t.group === 'C' || t.group === 'D') {
    const currency = currencyFromLocale(localeId);
    const brandPlaceholder = platform === 'qp2' ? ':merchantname' : ':brandname';

    // Option A params from fixture
    const ccyOverride = resolved.per_currency_overrides?.[currency] || {};
    const minDep  = ccyOverride.min_deposit  ?? resolved.parsed?.min_deposit  ?? 0;
    const maxBonus = resolved.parsed?.max_bonus    ?? 0;
    const pct      = resolved.parsed?.bonus_rate_pct ?? 0;
    const toA      = resolved.parsed?.to_multiplier  ?? 0;

    const subject = isEN ? PICK_SUBJECT_EN : PICK_SUBJECT_ZH;

    const params = { minDep, maxBonus, pct, toA, currency, brand: brandPlaceholder };
    let message = isEN
      ? buildPickYourBoostEN(t.option1EN, params)
      : buildPickYourBoostZH(t.option1ZH, params);

    // QPRO: resolve T&C hyperlink from brand directory (mirrors renderBody's behaviour)
    if (platform === 'qpro') {
      const brandInfo = resolveBrand({ platform, brand });
      const tncBase = stripUrlSuffix(brandInfo?.tncDomain || brandInfo?.website);
      if (tncBase) message = applyQproTncLink(message, docKey, tncBase);
    }
    // QP2: :url/terms-conditions stays literal; BO substitutes :url at display time.
    // :merchantname is already baked in by buildPickYourBoostEN/ZH via brandPlaceholder.

    return { subject, message };
  }

  return null;
}

// ─── Generic template updater ───────────────────────────────────────────────
async function updateTemplate(site, tplId, t, resolved, platform, brand) {
  const r = await authedFetch(site, `/api/bo/messagetemplate/${tplId}`);
  const m1 = r.data?.message_template;
  const existing = r.data?.message_details || {};
  if (!m1) return { ok: false, reason: 'template not found' };

  console.log(`    Current: name="${m1.name}" locales=[${Object.keys(existing).join(',')}]`);

  const newDetails = {};
  for (const [localeIdStr, row] of Object.entries(existing)) {
    const localeId = Number(localeIdStr);
    const content = await buildContent(t, localeId, resolved, platform, brand);
    if (!content) {
      console.log(`      locale=${localeId} — skipped (no builder for this locale)`);
      newDetails[localeIdStr] = { settings_locale_id: localeId, subject: row.subject, message: row.message };
    } else {
      const changed = content.subject !== row.subject || content.message !== row.message;
      console.log(`      locale=${localeId} — ${changed ? 'UPDATING' : 'no change'} subject="${content.subject.slice(0, 60)}"`);
      newDetails[localeIdStr] = { settings_locale_id: localeId, subject: content.subject, message: content.message };
    }
  }

  const isQp2 = platform === 'qp2';
  const putBody = { name: m1.name, section: m1.section, type: m1.type, status: m1.status, details: newDetails };
  if (!isQp2) putBody.code = m1.code;

  if (!commit) return { ok: true, dryRun: true, localesUpdated: Object.keys(newDetails).length };

  try {
    const res = await authedFetch(site, `/api/bo/messagetemplate/${tplId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(putBody),
    });
    return { ok: res.success !== false, message: res.message?.[0], localesUpdated: Object.keys(newDetails).length };
  } catch (e) {
    return { ok: false, reason: e.message.split('\n').slice(0, 2).join(' | ').slice(0, 250) };
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────
const qp2Site  = getSite('ibc22');
const qproSites = { qpro2: getSite('qpro2'), qpro6: getSite('qpro6'), qpro8: getSite('qpro8') };

console.log('═'.repeat(62));
console.log(`FIX P106-P121 message templates — ${commit ? 'LIVE COMMIT' : 'DRY-RUN (add --commit to save)'}`);
console.log('═'.repeat(62));

let pass = 0, fail = 0;

for (const t of TARGETS) {
  let resolved = {};
  const handle = t.handle || (fs.readdirSync('captures/requests').find(f => f.startsWith(t.pId + '-')) || '');
  if (handle) {
    const path = `captures/requests/${handle}`;
    if (fs.existsSync(path)) resolved = JSON.parse(fs.readFileSync(path, 'utf8'));
  }

  console.log(`\n${t.pId} — Group ${t.group} (${t.bonusType || 'Deposit'})`);

  if (t.qp2aTemplate) {
    console.log(`  QP2A (IBC22) template ${t.qp2aTemplate}:`);
    const result = await updateTemplate(qp2Site, t.qp2aTemplate, t, resolved, 'qp2', 'IBC22');
    if (result.ok) { console.log(`    → OK${result.dryRun ? ' (dry-run)' : ''} — ${result.localesUpdated} locales`); pass++; }
    else           { console.log(`    → FAIL: ${result.reason || result.message}`); fail++; }
  }

  if (t.qproTemplates) {
    for (const [siteId, tplId] of Object.entries(t.qproTemplates)) {
      console.log(`  ${siteId.toUpperCase()} template ${tplId}:`);
      const result = await updateTemplate(qproSites[siteId], tplId, t, resolved, 'qpro', siteId.toUpperCase());
      if (result.ok) { console.log(`    → OK${result.dryRun ? ' (dry-run)' : ''} — ${result.localesUpdated} locales`); pass++; }
      else           { console.log(`    → FAIL: ${result.reason || result.message}`); fail++; }
    }
  }
}

console.log('\n' + '─'.repeat(40));
console.log(`Summary: ${pass} passed, ${fail} failed`);
if (!commit) console.log('(dry-run — re-run with --commit to save)');
