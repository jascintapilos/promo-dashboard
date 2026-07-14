import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';
const site = getSite('ibc22');
const det = await authedFetch(site, `/api/bo/messagetemplate/292?edit=1`);
const md = det?.data?.message_details || {};
const checks = [];
for (const [locId, e] of Object.entries(md)) {
  const m = e.message || '';
  const tnc = m.slice(m.lastIndexOf('<ol>'));
  const clauses = (tnc.match(/<li>/g) || []).length;
  const c = {
    locale: e.settings_locales_code,
    clauses,
    hasFooterLink: /:url\/terms-conditions/.test(m),
    hasMerchantname: /:merchantname/.test(tnc),
    noWelcomeLeak: !/Welcome Bonus type|欢迎红利类型/.test(tnc),
    noMultiAcct: !/multiple accounts|多个帐户|多个账户/.test(tnc),
    noDupOnce_EN: e.settings_locales_code.endsWith('EN') ? (tnc.match(/claim this promotion only once|claimed once/gi)||[]).length === 1 : true,
    hasRefresh: /Refresh button|刷新按钮/.test(tnc),
    hasTimeLimited: /time-limited|时间限制/.test(tnc),
    correctValidity: /thirty \(30\) days.*seven \(7\) days|30 天内领取.*7 天内过期/s.test(tnc),
  };
  // min deposit region check
  if (e.settings_locales_code.startsWith('MY')) c.minDep = /MYR 50/.test(tnc);
  if (e.settings_locales_code.startsWith('SG')) c.minDep = /SGD 100/.test(tnc);
  checks.push(c);
}
console.table(checks);
