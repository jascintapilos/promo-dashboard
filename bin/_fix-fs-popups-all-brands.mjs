// Fix 52 WRONG_FORMAT Free Spin popups across all brands.
// Each popup gets:
//   - New title: "CONGRATULATIONS, YOU HAVE <SPINS> FREE SPINS!" (EN)
//                "恭喜您，您获得了<SPINS>次免费旋转！" (ZH)
//   - New body: 3-step "How to Claim" from Rewards page (matches QPRO1 popup 5MXRY)
//   - CTAs left as-is (already CLAIM NOW → /member/reward from prior fix)
//
// Detects "wrong format" via "As a reward for joining us" + "Make a deposit and wait for it to be approved".
// Skips campaign-specific FS popups (Welcome, CNY, MG Coupon, etc.).
//
// Default = dry-run; pass --commit to send PUTs.

import fs from 'node:fs';
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const commit = process.argv.includes('--commit');

const scan = JSON.parse(fs.readFileSync('captures/api-runs/fs-popup-scan.json', 'utf8'));

const BRAND_TO_SITE = {
  QP2A: { site: 'ibc22', merchantId: 1 },
  QP2B: { site: 'ibc22', merchantId: 2 },
  QP2C: { site: 'ibc22', merchantId: 3 },
  QP2D: { site: 'ibc22', merchantId: 4 },
  QPRO1: { site: 'qpro1' }, QPRO2: { site: 'qpro2' }, QPRO3: { site: 'qpro3' },
  QPRO4: { site: 'qpro4' }, QPRO5: { site: 'qpro5' }, QPRO6: { site: 'qpro6' },
  QPRO7: { site: 'qpro7' }, QPRO8: { site: 'qpro8' }, QPRO9: { site: 'qpro9' },
  QPRO10: { site: 'qpro10' }, QPRO11: { site: 'qpro11' }, QPRO12: { site: 'qpro12' },
  QPRO13: { site: 'qpro13' }, QPRO14: { site: 'qpro14' }, QPRO15: { site: 'qpro15' },
  QPRO16: { site: 'qpro16' }, QPRO17: { site: 'qpro17' },
};

// Build flat list of targets
const targets = [];
for (const brandRes of scan.results) {
  for (const p of brandRes.popups) {
    if (p.verdict === 'WRONG_FORMAT') {
      targets.push({ brand: brandRes.brand, popup_id: p.popup_id, code: p.code, oldTitle: p.title });
    }
  }
}
console.log(`Targets: ${targets.length} wrong-format FS popups across ${[...new Set(targets.map(t => t.brand))].length} brands`);

const fmtDate = (iso) => iso ? String(iso).replace(/T/, ' ').replace(/\.\d+Z?$/, '').slice(0, 19) : null;
const LOCALE_IS_ZH = (id) => id === 3 || id === 7;

// Parse "22 Free Spins on Gate Of Olympus" → { spins:22, game:"Gate Of Olympus" }
function parseEnTitle(title) {
  const m = /(\d+)\s+Free\s+Spins?\s+on\s+(.+?)(?:\s*$)/i.exec(title || '');
  if (!m) return null;
  return { spins: Number(m[1]), game: m[2].trim() };
}

// Heuristic: extract provider from old body (look for "To: PROVIDER" or "Slots > [PROVIDER]")
function parseProvider(body) {
  const m = /To:\s*<\/strong>\s*([A-Z][A-Z\s]+?)\s*<\/li>/i.exec(body || '') ||
            /Slots\s*&gt;\s*\[<strong>([A-Z][A-Z\s]+?)<\/strong>/i.exec(body || '') ||
            /Slots\s*>\s*\[?([A-Z][A-Z\s]+?)\]?\s*<\/li>/i.exec(body || '');
  return m ? m[1].trim() : 'Pragmatic Play';
}

function newEnTitle(spins) { return `CONGRATULATIONS, YOU HAVE ${spins} FREE SPINS!`; }
function newZhTitle(spins) { return `恭喜您，您获得了${spins}次免费旋转！`; }
function newEnBody(spins, game, provider) {
  const rewardName = `${spins} Free Spins - ${game}`;
  return `<p><span style="color:hsl(0,75%,60%);">How to Claim:</span></p><p>1. Go to Account &gt; Rewards and claim the reward <strong>[</strong>${rewardName}<strong>]</strong><br>2. After successfully claiming the reward, go to Home &gt; Game &gt; Slots &gt; <strong>${provider}</strong> and select the game <strong>[${game}]</strong><br>3. Redeem all your ${spins} free spins!</p><p><span style="color:hsl(0,75%,60%);">*For full promotion terms &amp; conditions, check your Inbox.</span></p>`;
}
function newZhBody(spins, game, provider) {
  const rewardName = `${spins} 次免费旋转 - ${game}`;
  return `<p><span style="color:hsl(0,75%,60%);">如何领取：</span><br><br>1. 前往帐户 &gt; 奖励并领取奖励 <strong>[${rewardName}]</strong><br>2. 成功领取奖励后，进入首页&gt;游戏&gt;老虎机&gt;<strong>${provider}</strong>，选择游戏<strong>【${game}】</strong><br>3. 兑换 ${spins} 次免费旋转！</p><p><span style="color:hsl(0,75%,60%);">*有关完整促销条款和条件，请查看您的收件箱。</span></p>`;
}

const popupLookupBySite = new Map();
async function getPopupLookup(siteObj, siteId, merchantId) {
  const key = `${siteId}:${merchantId ?? 'none'}`;
  if (popupLookupBySite.has(key)) return popupLookupBySite.get(key);
  const map = new Map();
  for (let page = 1; page <= 30; page++) {
    const params = new URLSearchParams({ perPage: '100', page: String(page) });
    if (merchantId != null) params.set('site_id', String(merchantId));
    const r = await authedFetch(siteObj, `/api/bo/popups?${params}`);
    const rows = r?.data?.rows || [];
    for (const p of rows) map.set(p.id, p);
    if (rows.length < 100) break;
  }
  popupLookupBySite.set(key, map);
  return map;
}

async function fixOne(target) {
  const cfg = BRAND_TO_SITE[target.brand];
  if (!cfg) return { ...target, action: 'SKIP_UNKNOWN_BRAND' };
  const site = getSite(cfg.site);
  try {
    const lookup = await getPopupLookup(site, cfg.site, cfg.merchantId);
    const popup = lookup.get(target.popup_id);
    if (!popup) return { ...target, action: 'POPUP_NOT_FOUND' };

    // Extract metadata from EN locale's old title + body
    const enExisting = Object.values(popup.contents || {}).find(c => c.locale_id === 1 || c.locale_id === 6);
    if (!enExisting) return { ...target, action: 'NO_EN_LOCALE' };
    const parsed = parseEnTitle(enExisting.title);
    if (!parsed) return { ...target, action: 'TITLE_UNPARSEABLE', oldTitle: enExisting.title };
    const provider = parseProvider(enExisting.content);
    const { spins, game } = parsed;

    // Build new contents per locale
    const newContents = {};
    for (const [k, c] of Object.entries(popup.contents || {})) {
      const isZh = LOCALE_IS_ZH(c.locale_id);
      newContents[k] = {
        ...c,
        title: isZh ? newZhTitle(spins) : newEnTitle(spins),
        content: isZh ? newZhBody(spins, game, provider) : newEnBody(spins, game, provider),
      };
    }

    const newLabel = newEnTitle(spins);
    const body = {
      id: popup.id, code: popup.code, status: popup.status, platform: popup.platform,
      position: popup.position, session: popup.session,
      start_date: fmtDate(popup.start_date), end_date: fmtDate(popup.end_date),
      location: popup.location, affiliates_visibility: popup.affiliates_visibility,
      always_pop: popup.always_pop, label: newLabel,
      contents: newContents,
    };
    if (cfg.merchantId != null) body.site_id = cfg.merchantId;

    if (!commit) return { ...target, action: 'DRY_RUN_PUT', spins, game, provider, new_title: newEnTitle(spins) };
    const res = await authedFetch(site, `/api/bo/popups/${popup.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return { ...target, action: 'UPDATED', spins, game, provider };
  } catch (e) {
    return { ...target, action: 'FAILED', error: e.message.slice(0, 250) };
  }
}

async function runBatched(items, fn, concurrency = 10) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++; if (i >= items.length) break;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

console.log(`Mode: ${commit ? 'LIVE (--commit)' : 'DRY-RUN'}`);
const t0 = Date.now();
const results = await runBatched(targets, fixOne, 10);
console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

const tally = {};
for (const r of results) tally[r.action] = (tally[r.action] || 0) + 1;
console.log('Tally:', JSON.stringify(tally));

// Sample preview
if (!commit) {
  console.log('\nSample previews (first 3 DRY_RUN_PUT):');
  results.filter(r => r.action === 'DRY_RUN_PUT').slice(0, 3).forEach(r => {
    console.log(`  ${r.brand} popup=${r.popup_id} code=${r.code}`);
    console.log(`     ${r.oldTitle}  →  ${r.new_title}`);
    console.log(`     spins=${r.spins} game="${r.game}" provider="${r.provider}"`);
  });
}

const fails = results.filter(r => r.action === 'FAILED' || r.action === 'TITLE_UNPARSEABLE');
if (fails.length) {
  console.log('\nFailures (first 5):');
  fails.slice(0, 5).forEach(r => console.log(`  ${r.brand} popup=${r.popup_id} ${r.action} — ${r.error || r.oldTitle}`));
}

fs.writeFileSync(`captures/api-runs/fs-fix-${commit ? 'commit' : 'dryrun'}.json`,
  JSON.stringify({ generated: new Date().toISOString(), results, tally }, null, 2));
