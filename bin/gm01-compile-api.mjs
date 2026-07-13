#!/usr/bin/env node
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const session = JSON.parse(readFileSync('gm01-session.local.json', 'utf8'));
const BASE = 'https://utn.bo5w.com';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
await ctx.addCookies(session.cookies.map(c => ({ ...c, domain: 'utn.bo5w.com' })));
const page = await ctx.newPage();

async function getFormValues(accId) {
  await page.goto(`${BASE}/secure/promotion/update/bonus.setting.update.xhtml?selectAccID=${accId}`,
    { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(1500);
  return page.evaluate(() => {
    const vals = {};
    document.querySelectorAll('input, select').forEach(el => {
      if (el.name) vals[el.name] = el.type === 'checkbox' ? el.checked : el.value;
    });
    return vals;
  });
}

const existingPromos = {};
for (const [label, id] of [['FT_REL_5PCT', 13660], ['WELC_ACQ100PCT', 13656], ['promo_13658', 13658]]) {
  try {
    const v = await getFormValues(id);
    existingPromos[label] = v;
    console.log(`captured: ${label} (${id}) code=${v.code} reqBonusType=${v.reqBonusType}`);
  } catch (e) { console.log(`skip ${label}: ${e.message}`); }
}

// Get all select options from create form
await page.goto(`${BASE}/secure/promotion/create/bonus.setting.create.xhtml?searchEntity=-1`,
  { waitUntil: 'networkidle', timeout: 15000 });
const selectOpts = await page.evaluate(() => {
  const result = {};
  document.querySelectorAll('select').forEach(s => {
    if (s.name) result[s.name] = [...s.options].map(o => ({ val: o.value, label: o.text.trim() }));
  });
  return result;
});
console.log('select options captured for:', Object.keys(selectOpts).join(', '));

await browser.close();

const gameProviders = {
  17072: 'I Sport Suite', 17073: 'AB Suite', 17074: 'GP Suite', 17075: 'AG Suite',
  17076: 'PlayStar', 17077: 'BTI', 17078: 'Tangkas', 17079: 'EVO', 17081: 'Pragmatic',
  17082: 'Joker', 17083: 'KA Gaming', 17084: 'ION Casino', 17085: 'SA Gaming',
  17086: 'Oriental Gaming', 17087: 'DreamGaming', 17088: 'VivoGaming', 17089: 'WMCasino',
  17090: 'CockFight', 17091: '93Connect', 17092: 'Wbet', 17093: 'Spade Gaming',
  17094: 'GiocoPlus', 17095: 'Habanero', 17096: 'MGPlus', 17097: 'vPower',
  17098: 'SBOBET', 17099: 'Sexy Bacarrat', 17100: 'CQ9', 17101: 'Luckydraw',
  17102: 'Live22', 17103: 'Playtech', 17104: 'CMD Sport', 17105: 'ION Slot',
  17106: 'PGSoft', 17107: 'Big Time Gaming', 17108: 'No Limit City',
  17109: 'Netent', 17110: 'Red Tiger',
};

const apiRef = {
  capturedAt: new Date().toISOString(),
  entityId: 1578,
  brand: 'UNTUNG28',
  platform: 'GM01 (CMM ACE)',
  boUrl: BASE,
  session: {
    method: 'JSESSIONID cookie',
    captureScript: 'bin/gm01-session-capture.mjs',
    sessionFile: 'gm01-session.local.json',
  },
  endpoints: {
    login: {
      method: 'POST',
      path: '/j_spring_security_check',
      fields: ['j_username', 'j_password', 'j_code'],
      note: 'CAPTCHA (j_code) required — manual entry via Playwright',
    },
    promoList: { method: 'GET', path: '/secure/promotion/promo.setting.list.xhtml' },
    promoCreate: {
      method: 'POST',
      path: '/secure/promotion/create/action/bonus.setting.create.xhtml',
      note: 'form-urlencoded, all fields below',
    },
    promoUpdate: {
      method: 'POST',
      path: '/secure/promotion/update/action/bonus.setting.update.xhtml',
      note: 'same fields as create + selectAccID (promo ID)',
    },
    promoDelete: {
      method: 'GET',
      path: '/secure/promotion/action/bonus.setting.delete.xhtml',
      params: 'selectAccID=<id>',
    },
    promoEditPage: {
      method: 'GET',
      path: '/secure/promotion/update/bonus.setting.update.xhtml',
      params: 'selectAccID=<id>',
      note: 'Server-side rendered; JS fills form from hidden inputs',
    },
    couponList: { method: 'GET', path: '/secure/coupon/coupon.setting.list.xhtml' },
    couponCreate: {
      method: 'POST',
      path: '/secure/coupon/create/action/coupon.setting.create.xhtml',
      fields: ['code','name','bonusAmt','startDate','expireDate','conditionType','validType','validPeriod','wdLimit','depoFlag','reqSecPromo','countFlag','chk_*'],
    },
    couponCodeList: { method: 'GET', path: '/secure/coupon/coupon.code.list.xhtml' },
    bonusInProgress: { method: 'GET', path: '/secure/coupon/coupon.inprogress.list.xhtml' },
    cmsPromoList: {
      method: 'POST', path: '/ajax/cms/getEntityPromotionList',
      body: 'entityId=1578',
      response: '[{id, imageUrl, title, menu, seq, status, category}]',
    },
    cmsPromoCreate: {
      method: 'POST', path: '/ajax/cms/createEntityPromotionMenu',
      fields: ['filename','imageUrl','title','menu','seq','status','pageContent','entityId'],
    },
    fileUpload: { method: 'POST', path: '/ajax/file/uploadFile.shtml' },
    imageStream: { method: 'GET', path: '/stream/id', params: 'attachId=<id>' },
    topNotification: {
      method: 'GET', path: '/ajax/common2/getTopNotification',
      response: '{data:{totalCountPendingRegister,totalCountPendingDeposit,totalCountPendingWithdraw,...}}',
    },
    promotionSummary: { method: 'GET', path: '/secure/report/player.bonus.xhtml' },
    freespinSummary: { method: 'GET', path: '/secure/report/player.game.freespin.summary.xhtml' },
  },
  promoFormFields: {
    selectAccID: 'int — promo record ID (required for update only)',
    walletType: { observed: 10, note: 'always 10 in this BO' },
    reqBonusType: { observed: 80, note: 'deposit bonus type' },
    reqFlag: { values: ['true','false'], default: 'false' },
    code: 'string — promo code (e.g. FT_REL_5PCT, WELC_ACQ100PCT)',
    name: 'string — promo display name (Indonesian)',
    durationType: selectOpts.durationType || [
      { val: '5', label: 'Once' }, { val: '10', label: 'Daily' },
      { val: '20', label: 'Weekly' }, { val: '30', label: 'Monthly' },
      { val: '40', label: 'Yearly' }, { val: '45', label: 'Unlimited' },
    ],
    value: 'decimal — bonus value (percentage or fixed IDR)',
    valType: selectOpts.valType || [{ val: '10', label: 'Percent' }, { val: '20', label: 'Fix (IDR)' }],
    minDepo: 'decimal — minimum deposit in IDR',
    maxBonus: 'decimal — maximum bonus cap',
    validPeriod: 'int — reward validity number',
    validType: selectOpts.validType || [{ val: '5', label: 'Day' }, { val: '10', label: 'Hour' }],
    promoType: selectOpts.promoType || [{ val: '30', label: 'Depo' }],
    pymtType: selectOpts.pymtType || [{ val: '10', label: 'Upon Completion' }, { val: '20', label: 'Upfront' }],
    conditionType: selectOpts.conditionType || [{ val: '10', label: 'None' }, { val: '20', label: 'Win' }, { val: '30', label: 'Turnover' }],
    wdLimit: 'decimal — turnover/win multiplier',
    formulaType: selectOpts.formulaType || [
      { val: '10', label: '(Deposit + Bonus) x TO/Win' },
      { val: '20', label: 'Deposit + (Bonus x TO/Win)' },
    ],
    validStatus: selectOpts.validStatus || [{ val: '10', label: 'Active' }, { val: '0', label: 'Inactive' }],
    depoType: selectOpts.depoType || [
      { val: '', label: 'All' }, { val: '10', label: 'Bank' },
      { val: '20', label: 'Pulsa' }, { val: '30', label: 'Ewallet' },
    ],
    startDate: 'string — format DD-MM-YYYY',
    expireDate: 'string — format DD-MM-YYYY',
    depoFlag: 'checkbox bool',
    reqSecPromo: 'checkbox bool',
    reqAutoWith: 'checkbox bool',
    reqMinWithValue: 'decimal',
    reqAutoDone: 'checkbox bool',
    countFlag: 'checkbox bool — limit once per player',
    reqPromoGroupId: 'int — player group restriction (0 = all)',
    'chk_<providerId>': 'checkbox — game providers allowed (see gameProviders map)',
    'group_<groupId>': 'checkbox — player groups (see playerGroups map)',
    'day_<N>': 'checkbox — allowed days (day_1=Mon ... day_7=Sun)',
  },
  gameProviders,
  playerGroups: {
    2407: 'Group 2407',
    2408: 'Group 2408',
    2409: 'Group 2409',
    2410: 'Group 2410',
    2411: 'Group 2411',
  },
  existingPromos,
  notes: [
    'Platform: CMM ACE (Spring Security + JSF/PrimeFaces hybrid)',
    'Session: single JSESSIONID cookie; ~8h TTL typical',
    'Entity ID 1578 = UNTUNG28 (only entity in this BO)',
    'Promo records identified by selectAccID (int), not by code',
    'Form values are server-rendered; JS reads hidden inputs to fill visible fields',
    'Game provider checkboxes use sequential IDs (chk_17072..chk_17110)',
    'Date format is DD-MM-YYYY (NOT YYYY-MM-DD)',
    'No JSON API for promo list — data is in HTML table only',
    'CMS promotions are separate from bonus settings (front-end display vs. reward config)',
  ],
};

mkdirSync('captures', { recursive: true });
writeFileSync('captures/gm01-api-map.json', JSON.stringify(apiRef, null, 2));
console.log('\n✓ Full GM01 API reference saved → captures/gm01-api-map.json');

// Print summary
console.log('\n════════════════════════════════════════');
console.log('GM01 (CMM ACE / UNTUNG28) — API SUMMARY');
console.log('════════════════════════════════════════');
console.log('Entity ID:', apiRef.entityId);
console.log('\nPromo endpoints:');
Object.entries(apiRef.endpoints).forEach(([k, v]) => {
  console.log(`  ${k.padEnd(20)} ${v.method.padEnd(5)} ${v.path}`);
});
console.log('\nExisting promos found:');
Object.entries(existingPromos).forEach(([label, v]) => {
  console.log(`  ${label.padEnd(20)} code=${v.code || '?'}  reqBonusType=${v.reqBonusType}  durationType=${v.durationType}  valType=${v.valType}  conditionType=${v.conditionType}`);
});
console.log('\nGame providers (', Object.keys(gameProviders).length, 'total):');
Object.entries(gameProviders).forEach(([id, name]) => process.stdout.write(`  [${id}]${name}  `));
console.log();
