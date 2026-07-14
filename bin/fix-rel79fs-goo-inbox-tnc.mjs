#!/usr/bin/env node
// Replace the Terms & Conditions clause list in the REL_79FS_GOO_100425 INBOX
// message template (id=292, PROMOTIONS.MESSAGE) on ibc22 (QP2, shared across
// IBC22/KING333/ACE66/SPADE66) with the latest standard FS 8-clause T&C.
//
// Only the final <ol>…</ol> (the T&C list) is swapped — intro + How-to-Apply
// (Reward-page claim flow) are preserved. Dry-run by default; pass --commit.
//
// Live config (BO promo id=360): spins 79, TO 20x, validity 30d claim /
// 7d after-claim, game Gates of Olympus (PP2), Slots. Min deposit MYR 50 / SGD 100.

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const COMMIT = process.argv.includes('--commit');
const site = getSite('ibc22');
const TEMPLATE_ID = 292;

// Per-locale min deposit (region → currency amount).
const MIN_DEP = { 1: 'MYR 50', 3: 'MYR 50', 6: 'SGD 100', 7: 'SGD 100' };
const LANG = { 1: 'EN', 3: 'ZH', 6: 'EN', 7: 'ZH' };

function tncOl(localeId) {
  const min = MIN_DEP[localeId];
  if (LANG[localeId] === 'ZH') {
    return [
      '<ol>',
      `<li>申请此优惠需最低存款 ${min}。</li>`,
      '<li>每位会员仅限领取一次此优惠。</li>',
      '<li>本优惠仅适用于 [Pragmatic Play] 旗下指定的一款游戏。在完成流水要求前，您的 [Pragmatic Play] 钱包将被锁定。</li>',
      '<li>本优惠的流水要求为：（转入金额 + 免费旋转所产生的盈利）× 20 倍。</li>',
      '<li>优惠需在 30 天内领取，并将在领取后 7 天内过期。</li>',
      '<li>优惠码有时间限制，一旦过期将无法延长。</li>',
      '<li>会员在进行任何交易（如存款或提款）前，建议点击首页的刷新按钮以获取最新的优惠状态。</li>',
      '<li>适用 :merchantname 一般条款与条件。 :url/terms-conditions</li>',
      '</ol>',
    ].join('');
  }
  return [
    '<ol>',
    `<li>A minimum deposit of ${min} is required to claim this promotion.</li>`,
    '<li>Each member can claim this promotion only once.</li>',
    '<li>This promotion applies exclusively to one game under [Pragmatic Play]. Your [Pragmatic Play] wallet will be locked until the turnover requirement is fulfilled.</li>',
    '<li>The turnover requirement for this promotion is twenty (20) times the sum of the transfer amount and any winnings from Free Spins.</li>',
    '<li>The promotion must be claimed within thirty (30) days, and the bonus will expire seven (7) days after the claim.</li>',
    '<li>Promotion codes are time-limited and cannot be extended once expired.</li>',
    '<li>Members are advised to use the Refresh button on the Home page to get the latest promotion status before performing any transactions e.g. deposit or withdrawal.</li>',
    '<li>General :merchantname Terms and Conditions apply. :url/terms-conditions</li>',
    '</ol>',
  ].join('');
}

// Replace the LAST <ol>…</ol> block in the body.
function swapTnc(html, localeId) {
  const lastOpen = html.lastIndexOf('<ol>');
  const lastClose = html.lastIndexOf('</ol>');
  if (lastOpen === -1 || lastClose === -1 || lastClose < lastOpen) return { html, changed: false };
  const before = html.slice(0, lastOpen);
  const after = html.slice(lastClose + '</ol>'.length);
  return { html: before + tncOl(localeId) + after, changed: true };
}

const det = await authedFetch(site, `/api/bo/messagetemplate/${TEMPLATE_ID}?edit=1`);
const tmpl = det?.data?.message_template;
const md = det?.data?.message_details || {};
if (!tmpl) { console.error('could not fetch template'); process.exit(1); }

const details = {};
for (const [locId, e] of Object.entries(md)) {
  if (!e.message) continue;
  const { html: newMsg, changed } = swapTnc(e.message, Number(locId));
  details[locId] = { settings_locale_id: e.settings_locale_id, subject: e.subject || '', message: changed ? newMsg : e.message };
  console.log(`\n── locale ${locId} (${e.settings_locales_code}) ${changed ? 'T&C swapped' : 'NO <ol> found'} ──`);
  console.log('NEW T&C block:');
  console.log('  ' + tncOl(Number(locId)).replace(/<\/li>/g, '</li>\n  '));
}

if (!COMMIT) {
  console.log('\n[dry-run] no PUT sent. Re-run with --commit to apply.');
  process.exit(0);
}

const putBody = { name: tmpl.name, section: tmpl.section, type: tmpl.type, status: tmpl.status, details };
// QP2: OMIT code (validator 422s "already taken").
const res = await authedFetch(site, `/api/bo/messagetemplate/${TEMPLATE_ID}`, { method: 'PUT', body: putBody });
const ok = res?.success === true || res?.data != null;
console.log(`\nPUT ${ok ? '✓ success' : '✗ failed'}`);
if (!ok) console.log(JSON.stringify(res).slice(0, 400));
