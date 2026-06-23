/**
 * Fix clause 4 in Sports promo MTs — correct Virtual Sports exclusion wording.
 *
 * Wrong (EN): "Sports categories are eligible for this promotion except Virtual Sports and Number Games."
 * Wrong (ZH): "本优惠适用于体育游戏类别，惟虚拟体育及数字游戏除外。"
 *
 * Correct (EN): "This promotion is redeemable on Sports game providers only.
 *                Turnover will only be calculated for games played under the Sports category, except Virtual Sports."
 * Correct (ZH): "此优惠仅可在体育游戏提供商兑换。流水仅计算在体育类别下进行的游戏，<strong>虚拟体育</strong>除外。"
 */
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

// Sports MT ids per site (P103 = Base, P104 = Booster)
const SPORTS_MTS = [
  { siteId: 'qpro1', mtIds: [1018, 1019] },
  { siteId: 'qpro2', mtIds: [420,  421]  },
  { siteId: 'qpro3', mtIds: [480,  481]  },
  // qpro4 shares qpro2's MTs (same ids 420/421) — skip duplicate
  { siteId: 'ibc22', mtIds: [1189, 1190] },
];

const OLD_EN = `Sports categories are eligible for this promotion except Virtual Sports and Number Games.`;
const NEW_EN = `This promotion is redeemable on Sports game providers only. Turnover will only be calculated for games played under the Sports category, except Virtual Sports.`;

const OLD_ZH = `本优惠适用于体育游戏类别，惟虚拟体育及数字游戏除外。`;
const NEW_ZH = `此优惠仅可在体育游戏提供商兑换。流水仅计算在体育类别下进行的游戏，<strong>虚拟体育</strong>除外。`;

let totalFail = 0;

for (const { siteId, mtIds } of SPORTS_MTS) {
  const site = getSite(siteId);
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`${siteId.toUpperCase()}`);

  for (const mtId of mtIds) {
    console.log(`\n  MT ${mtId}`);

    // 1. Fetch current
    const cur = await authedFetch(site, `/api/bo/messagetemplate/${mtId}`).catch(e => { console.log(`    ✖ fetch failed: ${e.message}`); return null; });
    if (!cur) { totalFail++; continue; }

    const tmpl = cur.data.message_template;
    const details = cur.data.message_details; // { "6": {...}, "7": {...} }

    // 2. Patch messages
    const patchedDetails = {};
    let enFixed = false, zhFixed = false;

    for (const [localeId, d] of Object.entries(details)) {
      let msg = d.message;
      if (d.settings_locales_code === 'SG_EN') {
        if (msg.includes(OLD_EN)) {
          msg = msg.replace(OLD_EN, NEW_EN);
          enFixed = true;
        } else {
          console.log(`    ⚠  SG_EN — old text not found, checking raw snippet:`);
          // Show the clause 4 area for diagnosis
          const li4match = msg.match(/<li>[^<]*(?:Sports|sport)[^<]*<\/li>/gi);
          console.log(`    Sports <li> candidates:`, li4match);
        }
      }
      if (d.settings_locales_code === 'SG_ZH') {
        if (msg.includes(OLD_ZH)) {
          msg = msg.replace(OLD_ZH, NEW_ZH);
          zhFixed = true;
        } else {
          console.log(`    ⚠  SG_ZH — old text not found, checking raw snippet:`);
          const li4match = msg.match(/<li>[^<]*(?:体育|虚拟)[^<]*<\/li>/gi);
          console.log(`    体育 <li> candidates:`, li4match);
        }
      }
      patchedDetails[localeId] = {
        settings_locale_id: d.settings_locale_id,
        subject: d.subject,
        message: msg,
      };
    }

    // 3. PUT back
    // QP2 rejects `code` on PUT (unique constraint) — omit it; only QPRO needs it.
    const putBody = {
      name:    tmpl.name,
      section: tmpl.section,
      type:    tmpl.type,
      status:  tmpl.status,
      details: patchedDetails,
    };

    const resp = await authedFetch(site, `/api/bo/messagetemplate/${mtId}`, { method: 'PUT', body: putBody }).catch(e => { console.log(`    ✖ PUT failed: ${e.message}`); return null; });

    if (resp) {
      console.log(`    ${enFixed?'✅':'⚠ '} SG_EN patched=${enFixed}   ${zhFixed?'✅':'⚠ '} SG_ZH patched=${zhFixed}`);
      if (!enFixed || !zhFixed) totalFail++;
    } else {
      totalFail++;
    }
  }
}

console.log(`\n${'─'.repeat(60)}`);
console.log(`TOTAL FAILURES: ${totalFail}`);
