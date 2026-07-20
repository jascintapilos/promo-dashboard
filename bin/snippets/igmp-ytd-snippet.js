/**
 * IGMP YTD 2026 promo count — paste into BO console on each kiosk.
 *
 * Usage:
 *   1. Log into the iGMP kiosk in Chrome
 *      (kioskmy/kiosksg/kioskid/kioskth/kioskkh.nougatsage.com
 *       or ws2-kioskmy.nougatsage.com)
 *   2. Open DevTools → Console
 *   3. Paste this whole file + press Enter
 *   4. Wait ~10-30 sec, results print to console
 *
 * Handles two promo types: Bonus + FreeSpin.
 * Walks GetPromotionsList sorted by Id desc, calls type-specific detail
 * endpoint for LogTimeStamp, stops at the 2025/2026 boundary.
 */
(async () => {
  const YEAR_START = new Date('2026-01-01T00:00:00Z').getTime();
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const parseTs = s => {
    const m = s?.match(/(\d{2})-(\d{2})-(\d{4})/);
    return m ? new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00Z`).getTime() : null;
  };

  // Type configs: list filter + detail endpoint (3.1 / 3.4 / 3.15)
  const TYPES = [
    { name: 'Bonus',      detail: '/PM/GetBonusInfo' },              // 3.1
    { name: 'FreeCredit', detail: '/PM/GetFreeCreditInfo' },         // 3.4
    { name: 'FreeSpin',   detail: '/PM/GetFreeSpinPromotionInfo' },  // 3.15
  ];

  async function listAll(promoType) {
    const out = [];
    for (let page = 1; page <= 30; page++) {
      const r = await fetch(`/PM/GetPromotionsList?pageNum=${page}&rowPerPage=100`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ PromotionType: promoType }),
      });
      const j = await r.json();
      if (!j.data?.length) break;
      out.push(...j.data.map(p => ({
        id: p.PromotionId,
        code: p.PromotionCode,
        name: p.PromotionName,
        type: p.PromotionType,
      })));
      if (j.data.length < 100) break;
    }
    out.sort((a, b) => b.id - a.id);
    return out;
  }

  async function walkForYtd(list, detailUrl) {
    const results = [];
    let crossed = false;
    for (let i = 0; i < list.length && !crossed; i += 5) {
      const chunk = list.slice(i, Math.min(i + 5, list.length));
      const dets = await Promise.all(chunk.map(p =>
        fetch(detailUrl, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ PromotionId: p.id }),
        }).then(r => r.json()).catch(() => null)
      ));
      for (let k = 0; k < chunk.length; k++) {
        const promo = dets[k]?.data?.Promotion || dets[k]?.data;
        if (!promo) continue;
        const ts = parseTs(promo.LogTimeStamp);
        if (ts >= YEAR_START) {
          results.push({
            id: chunk[k].id,
            code: chunk[k].code,
            name: chunk[k].name,
            type: promo.PromotionType,
            logTime: promo.LogTimeStamp,
            createdBy: promo.CreatedBy?.ActorLogin || '',
          });
        } else if (ts != null) { crossed = true; break; }
      }
      await sleep(40);
    }
    return results;
  }

  console.log(`[igmp-ytd] starting on ${location.hostname} …`);
  const t0 = Date.now();
  const all = [];
  for (const t of TYPES) {
    const list = await listAll(t.name);
    console.log(`  ${t.name}: ${list.length} lifetime, walking for 2026 …`);
    const ytd = await walkForYtd(list, t.detail);
    console.log(`  ${t.name}: ${ytd.length} in 2026`);
    all.push(...ytd);
  }

  // Summary table
  const byType = {}, byMonth = {}, byCreator = {};
  for (const r of all) {
    byType[r.type] = (byType[r.type] || 0) + 1;
    const m = r.logTime?.substring(3, 5);
    byMonth[m] = (byMonth[m] || 0) + 1;
    byCreator[r.createdBy || '?'] = (byCreator[r.createdBy || '?'] || 0) + 1;
  }
  console.log('\n══════════════════════════════════════════════');
  console.log(`IGMP YTD 2026 — ${location.hostname}`);
  console.log('══════════════════════════════════════════════');
  console.log(`Total promos:  ${all.length}`);
  console.log('By type:    ', byType);
  console.log('By month:   ', byMonth);
  console.log('By creator: ', byCreator);
  console.log(`Elapsed:    ${((Date.now() - t0)/1000).toFixed(1)}s`);

  // Make rows available for export
  window.__ytd = all;
  // Build a TSV for paste-into-sheet
  const tsv = ['Date\tCode\tName\tType\tCreated By'].concat(
    all.map(r => `${r.logTime?.substring(0,10) || ''}\t${r.code}\t${r.name}\t${r.type}\t${r.createdBy}`)
  ).join('\n');
  window.__ytdTsv = tsv;
  console.log('\nFull row list:        window.__ytd  (array of objects)');
  console.log('TSV for sheet paste:  copy(window.__ytdTsv)  ← run that to clipboard');
})();
