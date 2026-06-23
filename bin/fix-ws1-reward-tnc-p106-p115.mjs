#!/usr/bin/env node
// fix-ws1-reward-tnc-p106-p115.mjs
// Amends WS1 PromotionRewardContents (reward tab T&C) for P106–P115
// to include the Column N (Inbox Message) requirements.
//
// Group A (P106-P109): inject "3 Days World Cup Warm Up Challenge Streak" note
// Group B (P110-P111): inject congratulations intro paragraph
// Group C (P112-P115): inject Pick Your Boost table + Loss Rescue T&C clauses
//
// Usage:
//   node bin/fix-ws1-reward-tnc-p106-p115.mjs           # dry-run
//   node bin/fix-ws1-reward-tnc-p106-p115.mjs --commit  # live save

import { parseArgs } from './_args.js';
import { igmpPost } from '../src/igmp-client.js';

const { flags } = parseArgs(process.argv.slice(2));
const commit = flags.commit === true;

// ─── Option B constants (Loss Rescue Bonus) ───────────────────────────────────
const OPT_B = { validBets: 300, netLoss: 100, cap: 200, to: 8 };

// ─── Currency by site ─────────────────────────────────────────────────────────
const CURRENCY = { 'ws1-v3-my': 'MYR', 'ws1-v3-sg': 'SGD' };
const CCY_SYM  = { 'ws1-v3-my': 'RM',  'ws1-v3-sg': 'SGD' };
const TNC_URL  = {
  'ws1-v3-my': { en: 'https://mb8mys.com/en/info-center/tnc', zh: 'https://mb8mys.com/zh/info-center/tnc' },
  'ws1-v3-sg': { en: 'https://mb8sg.com/en/info-center/tnc',  zh: 'https://mb8sg.com/zh/info-center/tnc' },
};

// ─── Complete reward map ───────────────────────────────────────────────────────
// { pId, group, site, code, rewardId, type, opt1Label?, opt1ZH?, pct?, minDepMY?, minDepSG?, maxBonus?, toA? }
const REWARD_MAP = [
  // ── Group A: FS (P106) ──
  { pId:'P106', group:'A', site:'ws1-v3-my', code:'FT_28FS_GOO_15X_020_WCCHURNED_D1', rewardId:14592 },
  { pId:'P106', group:'A', site:'ws1-v3-my', code:'FT_28FS_GOO_15X_020_WCCHURNED_D2', rewardId:14593 },
  { pId:'P106', group:'A', site:'ws1-v3-my', code:'FT_28FS_GOO_15X_020_WCCHURNED_D3', rewardId:14594 },
  { pId:'P106', group:'A', site:'ws1-v3-sg', code:'FT_28FS_GOO_15X_020_WCCHURNED_D1', rewardId:12440 },
  { pId:'P106', group:'A', site:'ws1-v3-sg', code:'FT_28FS_GOO_15X_020_WCCHURNED_D2', rewardId:12441 },
  { pId:'P106', group:'A', site:'ws1-v3-sg', code:'FT_28FS_GOO_15X_020_WCCHURNED_D3', rewardId:12442 },
  // ── Group A: FC (P107) ──
  { pId:'P107', group:'A', site:'ws1-v3-my', code:'FT_10FC_15X_WCCHURNED_D1', rewardId:14595 },
  { pId:'P107', group:'A', site:'ws1-v3-my', code:'FT_10FC_15X_WCCHURNED_D2', rewardId:14596 },
  { pId:'P107', group:'A', site:'ws1-v3-my', code:'FT_10FC_15X_WCCHURNED_D3', rewardId:14597 },
  { pId:'P107', group:'A', site:'ws1-v3-sg', code:'FT_10FC_15X_WCCHURNED_D1', rewardId:12443 },
  { pId:'P107', group:'A', site:'ws1-v3-sg', code:'FT_10FC_15X_WCCHURNED_D2', rewardId:12444 },
  { pId:'P107', group:'A', site:'ws1-v3-sg', code:'FT_10FC_15X_WCCHURNED_D3', rewardId:12445 },
  // ── Group A: FS (P108) ──
  { pId:'P108', group:'A', site:'ws1-v3-my', code:'FT_28FS_GOO_15X_040_WCCHURNED_D1', rewardId:14598 },
  { pId:'P108', group:'A', site:'ws1-v3-my', code:'FT_28FS_GOO_15X_040_WCCHURNED_D2', rewardId:14599 },
  { pId:'P108', group:'A', site:'ws1-v3-my', code:'FT_28FS_GOO_15X_040_WCCHURNED_D3', rewardId:14600 },
  { pId:'P108', group:'A', site:'ws1-v3-sg', code:'FT_28FS_GOO_15X_040_WCCHURNED_D1', rewardId:12446 },
  { pId:'P108', group:'A', site:'ws1-v3-sg', code:'FT_28FS_GOO_15X_040_WCCHURNED_D2', rewardId:12447 },
  { pId:'P108', group:'A', site:'ws1-v3-sg', code:'FT_28FS_GOO_15X_040_WCCHURNED_D3', rewardId:12448 },
  // ── Group A: FC (P109) ──
  { pId:'P109', group:'A', site:'ws1-v3-my', code:'FT_28FC_15X_WCCHURNED_D1', rewardId:14601 },
  { pId:'P109', group:'A', site:'ws1-v3-my', code:'FT_28FC_15X_WCCHURNED_D2', rewardId:14602 },
  { pId:'P109', group:'A', site:'ws1-v3-my', code:'FT_28FC_15X_WCCHURNED_D3', rewardId:14603 },
  { pId:'P109', group:'A', site:'ws1-v3-sg', code:'FT_28FC_15X_WCCHURNED_D1', rewardId:12449 },
  { pId:'P109', group:'A', site:'ws1-v3-sg', code:'FT_28FC_15X_WCCHURNED_D2', rewardId:12450 },
  { pId:'P109', group:'A', site:'ws1-v3-sg', code:'FT_28FC_15X_WCCHURNED_D3', rewardId:12451 },
  // ── Group B: FC (P110) ──
  { pId:'P110', group:'B', site:'ws1-v3-my', code:'FT_50FC_15X_WCCHURNED',  rewardId:14604 },
  { pId:'P110', group:'B', site:'ws1-v3-sg', code:'FT_50FC_15X_WCCHURNED',  rewardId:12452 },
  // ── Group B: FC (P111) ──
  { pId:'P111', group:'B', site:'ws1-v3-my', code:'FT_100FC_15X_WCCHURNED', rewardId:14605 },
  { pId:'P111', group:'B', site:'ws1-v3-sg', code:'FT_100FC_15X_WCCHURNED', rewardId:12453 },
  // ── Group C: Deposit (P112) — 120% Welcome Bonus (Sports only), MYR minDep=30 / SGD minDep=50 ──
  { pId:'P112', group:'C', site:'ws1-v3-my', code:'FT_WELC_120PCT_10X_WCRND', rewardId:14606,
    opt1Label:'120% Welcome Bonus (Sports only)', opt1ZH:'120% 欢迎红利（体育专属）',
    pct:120, minDepMY:30, minDepSG:50, maxBonus:300, toA:10 },
  { pId:'P112', group:'C', site:'ws1-v3-sg', code:'FT_WELC_120PCT_10X_WCRND', rewardId:12454,
    opt1Label:'120% Welcome Bonus (Sports only)', opt1ZH:'120% 欢迎红利（体育专属）',
    pct:120, minDepMY:30, minDepSG:50, maxBonus:300, toA:10 },
  // ── Group C: Deposit (P113) — 50% Reload Bonus (All Game), minDep=150 ──
  { pId:'P113', group:'C', site:'ws1-v3-my', code:'FT_REL_50PCT_15X_WCFTD', rewardId:14607,
    opt1Label:'50% Reload Bonus (All Game)', opt1ZH:'50% 续存红利（全游戏）',
    pct:50, minDepMY:150, minDepSG:150, maxBonus:150, toA:15 },
  { pId:'P113', group:'C', site:'ws1-v3-sg', code:'FT_REL_50PCT_15X_WCFTD', rewardId:12455,
    opt1Label:'50% Reload Bonus (All Game)', opt1ZH:'50% 续存红利（全游戏）',
    pct:50, minDepMY:150, minDepSG:150, maxBonus:150, toA:15 },
  // ── Group C: Deposit (P114) — 100% Reload Bonus (All Game), minDep=300 ──
  { pId:'P114', group:'C', site:'ws1-v3-my', code:'FT_REL_100PCT_22X_WCFTD', rewardId:14608,
    opt1Label:'100% Reload Bonus (All Game)', opt1ZH:'100% 续存红利（全游戏）',
    pct:100, minDepMY:300, minDepSG:300, maxBonus:300, toA:22 },
  { pId:'P114', group:'C', site:'ws1-v3-sg', code:'FT_REL_100PCT_22X_WCFTD', rewardId:12456,
    opt1Label:'100% Reload Bonus (All Game)', opt1ZH:'100% 续存红利（全游戏）',
    pct:100, minDepMY:300, minDepSG:300, maxBonus:300, toA:22 },
  // ── Group C: Deposit (P115) — 100% Reload Bonus (All Game), minDep=500 ──
  { pId:'P115', group:'C', site:'ws1-v3-my', code:'FT_REL_100PCT_25X_WCFTD', rewardId:14609,
    opt1Label:'100% Reload Bonus (All Game)', opt1ZH:'100% 续存红利（全游戏）',
    pct:100, minDepMY:500, minDepSG:500, maxBonus:500, toA:25 },
  { pId:'P115', group:'C', site:'ws1-v3-sg', code:'FT_REL_100PCT_25X_WCFTD', rewardId:12457,
    opt1Label:'100% Reload Bonus (All Game)', opt1ZH:'100% 续存红利（全游戏）',
    pct:100, minDepMY:500, minDepSG:500, maxBonus:500, toA:25 },
];

// ─── WS1 HTML helpers ─────────────────────────────────────────────────────────
const P = (text) =>
  `<p style="text-align: left;"><font color="#555555">${text}</font></p>`;

const STRONG = (text) => `<span style="font-weight: 600;">${text}</span>`;

// Table cell — blue header
const TH = (text) =>
  `<td style="vertical-align: middle; text-align: center; background-color: rgb(42, 50, 142);">` +
  `<font color="#ffffff">${STRONG(text)}</font><br></td>`;

// Table cell — data
const TD = (text) =>
  `<td style="vertical-align: middle; text-align: center; background-color: transparent; color: rgb(85, 85, 85);">${text}</td>`;

const TABLE = (headerCells, dataRows) =>
  `<table class="table table-promo-top-row-header" style="width: 709px; background-color: white; color: rgb(121, 121, 121); font-size: 14px; margin-top: 0px;">` +
  `<tbody><tr>${headerCells.map(TH).join('')}</tr>` +
  dataRows.map(cells => `<tr>${cells.map(TD).join('')}</tr>`).join('') +
  `</tbody></table>`;

// ─── Injection builders ───────────────────────────────────────────────────────

// Group A: streak phrase
function injectStreakEN() {
  return `<p style="margin-top:8pt; font-family: Roboto, sans-serif; color: rgb(85, 85, 85);">` +
    `⚽ This promotion is part of the ${STRONG('3 Days World Cup Warm Up Challenge Streak')}.` +
    `</p>`;
}
function injectStreakZH() {
  return `<p style="margin-top:8pt; font-family: Roboto, sans-serif; color: rgb(85, 85, 85);">` +
    `⚽ 此促销活动是${STRONG('3天世界杯热身挑战连胜')}的一部分。` +
    `</p>`;
}

// Group B: congratulations intro
function injectCongratEN() {
  return `<p style="margin-top:8pt; font-family: Roboto, sans-serif; color: rgb(85, 85, 85);">` +
    `${STRONG('Congratulations on completing our 3 Days World Cup Warm Up Challenge Streak!')} ` +
    `Your Free Credit is here. Get ready to witness the excitement and victory with us this World Cup season. ` +
    `Stay tuned for our upcoming main World Cup campaign with even bigger rewards!` +
    `</p>`;
}
function injectCongratZH() {
  return `<p style="margin-top:8pt; font-family: Roboto, sans-serif; color: rgb(85, 85, 85);">` +
    `${STRONG('恭喜您完成我们的3天世界杯热身挑战连胜！')}` +
    `您的免费体验金已准备好。准备好与我们一起见证这个世界杯赛季的精彩与胜利。` +
    `敬请关注我们即将推出的世界杯主活动，更多丰厚奖励等您来！` +
    `</p>`;
}

// Group C: Pick Your Boost table + Loss Rescue T&C clauses
function injectPickBoostEN(entry, site) {
  const c = CURRENCY[site];
  const minDep = site === 'ws1-v3-sg' ? entry.minDepSG : entry.minDepMY;
  const { pct, maxBonus, toA, opt1Label } = entry;
  const opt1Type = opt1Label.includes('Welcome') ? 'Welcome Bonus' : 'Reload Bonus';

  const boostTable = TABLE(
    ['Reward Option', 'Requirement', 'Reward', 'Max Bonus', 'Turnover'],
    [
      [
        `${STRONG(`Option A: ${opt1Label}`)}`,
        `Min deposit ${c} ${minDep}`,
        `${pct}% bonus`,
        `${c} ${maxBonus}`,
        `${toA}x bonus`,
      ],
      [
        `${STRONG('Option B: Loss Rescue Bonus')}`,
        `Min ${c} ${OPT_B.validBets} valid bets + min ${c} ${OPT_B.netLoss} net loss`,
        `100% net loss rebate`,
        `${c} ${OPT_B.cap}`,
        `${OPT_B.to}x bonus`,
      ],
    ]
  );

  const clauses = [
    `Choose ${STRONG('ONE (1) reward option only')}: ${STRONG(`Option A: ${opt1Label}`)} or ${STRONG('Option B: Loss Rescue Bonus')}.`,
    `Once a reward option is selected, it ${STRONG('cannot be changed, cancelled, transferred, or combined')} with another option.`,
    `${STRONG(`Option A: ${opt1Type}`)} — Minimum deposit ${c} ${minDep} to receive a ${pct}% bonus, capped at ${c} ${maxBonus}. Subject to ${toA}x turnover based on the bonus amount received.`,
    `${STRONG('Option B: Loss Rescue Bonus')} — Achieve a minimum of ${c} ${OPT_B.validBets} valid bets and a minimum ${c} ${OPT_B.netLoss} net loss during the promotion period to receive a 100% net loss rebate, capped at ${c} ${OPT_B.cap}. Subject to ${OPT_B.to}x turnover based on the bonus amount received.`,
    `Net loss = total valid settled losses minus total valid settled winnings during the promotion period.`,
    `${STRONG('Example:')} If a member records ${c} 150 net loss, the member will receive ${c} 150 bonus. Required turnover: ${c} 150 × ${OPT_B.to} = ${c} 1,200.`,
  ].map((text, i) => P(`${i+1}. ${text}`)).join('');

  return (
    `<div style="margin-top:12pt; font-family: Roboto, sans-serif;">` +
    `<p style="color: rgb(85, 85, 85);">${STRONG('⚽ World Cup Special – Pick Your Boost')}</p>` +
    `<p style="color: rgb(85, 85, 85);">Choose ${STRONG('ONE')} reward option only — you may claim 1 option per account during the promotion period.</p>` +
    boostTable +
    `<p style="color: rgb(85, 85, 85); margin-top:8pt;">${STRONG('Pick Your Boost – Additional Terms &amp; Conditions:')}</p>` +
    clauses +
    `</div>`
  );
}

function injectPickBoostZH(entry, site) {
  const c = CURRENCY[site];
  const minDep = site === 'ws1-v3-sg' ? entry.minDepSG : entry.minDepMY;
  const { pct, maxBonus, toA, opt1ZH } = entry;
  const opt1TypeZH = opt1ZH.includes('欢迎') ? '欢迎红利' : '续存红利';

  const boostTable = TABLE(
    ['奖励选项', '条件', '奖励', '最高奖金', '流水要求'],
    [
      [
        `${STRONG(`选项 A：${opt1ZH}`)}`,
        `最低存款 ${c} ${minDep}`,
        `${pct}% 红利`,
        `${c} ${maxBonus}`,
        `${toA} 倍红利`,
      ],
      [
        `${STRONG('选项 B：损失救援红利')}`,
        `最低 ${c} ${OPT_B.validBets} 有效投注 + 最低 ${c} ${OPT_B.netLoss} 净亏损`,
        `100% 净亏损返还`,
        `${c} ${OPT_B.cap}`,
        `${OPT_B.to} 倍红利`,
      ],
    ]
  );

  const clauses = [
    `每位会员在优惠期间只能选择${STRONG('一（1）项')}奖励选项：${STRONG(`选项 A：${opt1ZH}`)} 或 ${STRONG('选项 B：损失救援红利')}。`,
    `一旦选择了奖励选项，将${STRONG('不可更改、取消、转让或与其他选项合并')}。`,
    `${STRONG(`选项 A：${opt1TypeZH}`)} — 最低存款 ${c} ${minDep} 即可获得 ${pct}% 红利，最高 ${c} ${maxBonus}。提款前须完成 ${toA} 倍流水要求（基于所获红利金额）。`,
    `${STRONG('选项 B：损失救援红利')} — 需在优惠期间达到最低 ${c} ${OPT_B.validBets} 有效投注额及最低 ${c} ${OPT_B.netLoss} 净亏损，即可获得 100% 净亏损返还，最高 ${c} ${OPT_B.cap}。提款前须完成 ${OPT_B.to} 倍流水要求（基于所获红利金额）。`,
    `净亏损 = 优惠期间有效结算亏损总额减去有效结算盈利总额。`,
    `${STRONG('示例：')}若会员净亏损 ${c} 150，则可获得 ${c} 150 红利。所需流水：${c} 150 × ${OPT_B.to} = ${c} 1,200。`,
  ].map((text, i) => P(`${i+1}. ${text}`)).join('');

  return (
    `<div style="margin-top:12pt; font-family: Roboto, sans-serif;">` +
    `<p style="color: rgb(85, 85, 85);">${STRONG('⚽ 世界杯特别活动 – 选择您的奖励加速')}</p>` +
    `<p style="color: rgb(85, 85, 85);">在优惠期间只能选择${STRONG('一（1）项')}奖励选项，每个账户仅限一次。</p>` +
    boostTable +
    `<p style="color: rgb(85, 85, 85); margin-top:8pt;">${STRONG('选择奖励加速 – 附加条款与条件：')}</p>` +
    clauses +
    `</div>`
  );
}

// ─── Inject into existing HTML (between the two <h4> blocks) ─────────────────
function injectBetweenH4s(existingHtml, injection) {
  // The existing content is: <h4>...summary...</h4><h4>...T&C...</h4>
  // Insert the injection between the closing </h4> of the first block and the opening <h4 of the second
  const SPLIT = '</h4><h4';
  const idx = existingHtml.indexOf(SPLIT);
  if (idx === -1) {
    // fallback: prepend to whole content
    return injection + existingHtml;
  }
  return existingHtml.slice(0, idx + 5) + injection + '<h4' + existingHtml.slice(idx + SPLIT.length);
}

// ─── Check if already patched ─────────────────────────────────────────────────
function alreadyPatched(html, group) {
  if (group === 'A') return html.includes('World Cup Warm Up Challenge Streak');
  if (group === 'B') return html.includes('Congratulations on completing');
  if (group === 'C') return html.includes('Pick Your Boost');
  return false;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
console.log('═'.repeat(66));
console.log(`FIX WS1 Reward T&C P106-P115 — ${commit ? 'LIVE COMMIT' : 'DRY-RUN (add --commit to save)'}`);
console.log('═'.repeat(66));
console.log();

let passed = 0, skipped = 0, failed = 0;

for (const entry of REWARD_MAP) {
  const { pId, group, site, code, rewardId } = entry;

  // 1. Fetch existing content
  let existing;
  try {
    const res = await igmpPost(site, '/PM/GetPromotionRewardContents', { RewardId: rewardId });
    existing = res?.data || [];
  } catch(e) {
    console.log(`❌ ${pId} ${site} ${code} rewardId=${rewardId}: fetch ERROR ${e.message.slice(0,60)}`);
    failed++;
    continue;
  }

  const en = existing.find(d => d.Locale === 'en');
  const zh = existing.find(d => d.Locale === 'zh');

  if (!en) {
    console.log(`❌ ${pId} ${site} ${code}: no EN locale content found`);
    failed++;
    continue;
  }

  // 2. Check if already patched
  if (alreadyPatched(en.Content, group)) {
    console.log(`⏭  ${pId} ${site} ${code} (rewardId=${rewardId}): already patched — skip`);
    skipped++;
    continue;
  }

  // 3. Build injections
  let enInjection, zhInjection;
  if (group === 'A') {
    enInjection = injectStreakEN();
    zhInjection = injectStreakZH();
  } else if (group === 'B') {
    enInjection = injectCongratEN();
    zhInjection = injectCongratZH();
  } else {
    enInjection = injectPickBoostEN(entry, site);
    zhInjection = injectPickBoostZH(entry, site);
  }

  const newEnContent = injectBetweenH4s(en.Content, enInjection);
  const newZhContent = zh ? injectBetweenH4s(zh.Content, zhInjection) : null;

  // 4. Build payload
  const contents = [
    { RewardId: rewardId, Locale: 'en', Content: newEnContent },
    ...(newZhContent ? [{ RewardId: rewardId, Locale: 'zh', Content: newZhContent }] : []),
  ];

  // 5. Verify injection worked
  const enHasContent = newEnContent.includes(
    group === 'A' ? 'World Cup Warm Up Challenge Streak' :
    group === 'B' ? 'Congratulations on completing' :
    'Pick Your Boost'
  );

  console.log(`${enHasContent ? (commit ? '✅' : '🔵') : '❌'} ${pId} ${site} ${code} (rewardId=${rewardId}) group=${group} locales=${contents.length}`);

  if (!enHasContent) {
    console.log(`   ⚠  injection verification FAILED — skipping`);
    failed++;
    continue;
  }

  if (!commit) {
    // dry-run: show a snippet of what would be injected
    const snippet = enInjection.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
    console.log(`   inject preview: "${snippet}..."`);
    passed++;
    continue;
  }

  // 6. POST update
  try {
    await igmpPost(site, '/PM/BulkAddorUpdatePromotionRewardContents', {
      RewardId: rewardId,
      PromotionRewardContents: contents,
    });
    passed++;
  } catch(e) {
    console.log(`   ERROR saving: ${e.message.slice(0, 80)}`);
    failed++;
  }
}

console.log();
console.log('─'.repeat(42));
console.log(`Summary: ${passed} updated, ${skipped} already-patched, ${failed} failed`);
if (!commit) console.log('(dry-run — re-run with --commit to save)');
