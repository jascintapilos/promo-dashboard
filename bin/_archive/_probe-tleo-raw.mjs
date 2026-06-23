#!/usr/bin/env node
// Capture raw promotion record + currency rows + name rows for each TLEO source code.
import fs from 'node:fs';
import path from 'node:path';
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const SOURCE_MAP = {
  'FT_REL_TLEO_LC_20PCT_20MX_BR':  451,
  'FT_REL_TLEO_LC_20PCT_300MX_BR': 468,
  'FT_REL_TLEO_LC_20PCT_400MX_BR': 469,
  'FT_REL_TLEO_20PCT_300MX_BR':    470,
  'FT_REL_TLEO_20PCT_400MX_BR':    471,
  'FT_REL_TLEO_LC_45PCT_138MX':    442, // source on QPRO2 is _BR variant — operator confirmed
  'FT_REL_TLEO_LC_45PCT_228MX_BR': 443,
  'FT_REL_TLEO_LC_45PCT_458MX_BR': 444,
  'FT_REL_TLEO_45PCT_688MX':       425,
  'FT_REL_TLEO_45PCT_888MX':       426,
};

const site = getSite('qpro2');
const out = {};
for (const [targetCode, srcId] of Object.entries(SOURCE_MAP)) {
  const [det, cur, nam] = await Promise.all([
    authedFetch(site, `/api/bo/promotion/${srcId}`),
    authedFetch(site, `/api/bo/promotioncurrency?promotion_id=${srcId}`),
    authedFetch(site, `/api/bo/promotionname?promotion_id=${srcId}`),
  ]);
  const main = det.data.rows;
  out[targetCode] = {
    src_code: main.code,
    src_id: srcId,
    main,
    currencies: cur.data.rows,
    names: nam.data.rows,
  };
  console.log(`${targetCode} ← src_id=${srcId} src_code=${main.code} mt=${main.message_template_id} dialog_link=${(main.dialog_popup_list||[]).length}`);
}
const outPath = path.resolve('tmp/tleo-raw.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(`\nWrote ${outPath} (${(fs.statSync(outPath).size/1024).toFixed(1)}KB)`);
