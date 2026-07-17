// One-off: update inbox MT subject lines for P094-r96, P095-r97, P096-r98
// to "Deposit XX, Get XX" (EN) / "存款 XX 赠送 XX" (ZH) format.
//
//   node bin/patch-p094-p096-mt-subject.mjs            # dry-run
//   node bin/patch-p094-p096-mt-subject.mjs --commit   # live

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';
import { readFileSync } from 'fs';

const DRY_RUN = !process.argv.includes('--commit');
if (DRY_RUN) console.log('[DRY RUN] Pass --commit to execute\n');

const TARGETS = [
  // P094-r96: Deposit 200, Get 88
  { handle: 'P094-r96', brand: 'QP2C',   site: 'ibc22',  tid: 1348, enSubject: 'Exclusive Bonus — Deposit 200, Get 88', zhSubject: '专属奖励 — 存款 200 赠送 88' },
  { handle: 'P094-r96', brand: 'QPRO3',  site: 'qpro3',  tid: 592,  enSubject: 'Exclusive Bonus — Deposit 200, Get 88', zhSubject: '专属奖励 — 存款 200 赠送 88' },
  { handle: 'P094-r96', brand: 'QPRO4',  site: 'qpro4',  tid: 524,  enSubject: 'Exclusive Bonus — Deposit 200, Get 88', zhSubject: '专属奖励 — 存款 200 赠送 88' },
  { handle: 'P094-r96', brand: 'QPRO5',  site: 'qpro5',  tid: 426,  enSubject: 'Exclusive Bonus — Deposit 200, Get 88', zhSubject: '专属奖励 — 存款 200 赠送 88' },
  { handle: 'P094-r96', brand: 'QPRO7',  site: 'qpro7',  tid: 616,  enSubject: 'Exclusive Bonus — Deposit 200, Get 88', zhSubject: '专属奖励 — 存款 200 赠送 88' },
  { handle: 'P094-r96', brand: 'QPRO10', site: 'qpro10', tid: 608,  enSubject: 'Exclusive Bonus — Deposit 200, Get 88', zhSubject: '专属奖励 — 存款 200 赠送 88' },
  { handle: 'P094-r96', brand: 'QPRO15', site: 'qpro15', tid: 430,  enSubject: 'Exclusive Bonus — Deposit 200, Get 88', zhSubject: '专属奖励 — 存款 200 赠送 88' },
  { handle: 'P094-r96', brand: 'QPRO16', site: 'qpro16', tid: 407,  enSubject: 'Exclusive Bonus — Deposit 200, Get 88', zhSubject: '专属奖励 — 存款 200 赠送 88' },
  // P095-r97: Deposit 300, Get 150
  { handle: 'P095-r97', brand: 'QP2C',   site: 'ibc22',  tid: 1349, enSubject: 'Exclusive Bonus — Deposit 300, Get 150', zhSubject: '专属奖励 — 存款 300 赠送 150' },
  { handle: 'P095-r97', brand: 'QPRO3',  site: 'qpro3',  tid: 593,  enSubject: 'Exclusive Bonus — Deposit 300, Get 150', zhSubject: '专属奖励 — 存款 300 赠送 150' },
  { handle: 'P095-r97', brand: 'QPRO4',  site: 'qpro4',  tid: 525,  enSubject: 'Exclusive Bonus — Deposit 300, Get 150', zhSubject: '专属奖励 — 存款 300 赠送 150' },
  { handle: 'P095-r97', brand: 'QPRO5',  site: 'qpro5',  tid: 427,  enSubject: 'Exclusive Bonus — Deposit 300, Get 150', zhSubject: '专属奖励 — 存款 300 赠送 150' },
  { handle: 'P095-r97', brand: 'QPRO7',  site: 'qpro7',  tid: 617,  enSubject: 'Exclusive Bonus — Deposit 300, Get 150', zhSubject: '专属奖励 — 存款 300 赠送 150' },
  { handle: 'P095-r97', brand: 'QPRO10', site: 'qpro10', tid: 609,  enSubject: 'Exclusive Bonus — Deposit 300, Get 150', zhSubject: '专属奖励 — 存款 300 赠送 150' },
  { handle: 'P095-r97', brand: 'QPRO15', site: 'qpro15', tid: 431,  enSubject: 'Exclusive Bonus — Deposit 300, Get 150', zhSubject: '专属奖励 — 存款 300 赠送 150' },
  { handle: 'P095-r97', brand: 'QPRO16', site: 'qpro16', tid: 408,  enSubject: 'Exclusive Bonus — Deposit 300, Get 150', zhSubject: '专属奖励 — 存款 300 赠送 150' },
  // P096-r98: Deposit 600, Get 288
  { handle: 'P096-r98', brand: 'QP2C',   site: 'ibc22',  tid: 1350, enSubject: 'Exclusive Bonus — Deposit 600, Get 288', zhSubject: '专属奖励 — 存款 600 赠送 288' },
  { handle: 'P096-r98', brand: 'QPRO3',  site: 'qpro3',  tid: 594,  enSubject: 'Exclusive Bonus — Deposit 600, Get 288', zhSubject: '专属奖励 — 存款 600 赠送 288' },
  { handle: 'P096-r98', brand: 'QPRO4',  site: 'qpro4',  tid: 526,  enSubject: 'Exclusive Bonus — Deposit 600, Get 288', zhSubject: '专属奖励 — 存款 600 赠送 288' },
  { handle: 'P096-r98', brand: 'QPRO5',  site: 'qpro5',  tid: 428,  enSubject: 'Exclusive Bonus — Deposit 600, Get 288', zhSubject: '专属奖励 — 存款 600 赠送 288' },
  { handle: 'P096-r98', brand: 'QPRO7',  site: 'qpro7',  tid: 618,  enSubject: 'Exclusive Bonus — Deposit 600, Get 288', zhSubject: '专属奖励 — 存款 600 赠送 288' },
  { handle: 'P096-r98', brand: 'QPRO10', site: 'qpro10', tid: 610,  enSubject: 'Exclusive Bonus — Deposit 600, Get 288', zhSubject: '专属奖励 — 存款 600 赠送 288' },
  { handle: 'P096-r98', brand: 'QPRO15', site: 'qpro15', tid: 432,  enSubject: 'Exclusive Bonus — Deposit 600, Get 288', zhSubject: '专属奖励 — 存款 600 赠送 288' },
  { handle: 'P096-r98', brand: 'QPRO16', site: 'qpro16', tid: 409,  enSubject: 'Exclusive Bonus — Deposit 600, Get 288', zhSubject: '专属奖励 — 存款 600 赠送 288' },
];

// EN locales: 1 (MY_EN), 6 (SG_EN) — ZH locales: 3 (MY_ZH), 7 (SG_ZH)
const EN_LOCALES = new Set([1, 6]);
const ZH_LOCALES = new Set([3, 7]);

let ok = 0, fail = 0;

for (const t of TARGETS) {
  const site = getSite(t.site);
  console.log(`\n── ${t.handle} ${t.brand} (tid=${t.tid}) ──`);

  // Load existing messages from bundle (avoids re-render)
  let bundleMts;
  try {
    const bundle = JSON.parse(readFileSync(`captures/qc-bundles/${t.handle}__${t.brand}.json`, 'utf8'));
    bundleMts = bundle.live_state?.list_row?.message_templates;
    if (!bundleMts?.length) throw new Error('no message_templates in bundle');
  } catch (e) {
    console.log(`  ✗ bundle read failed: ${e.message}`);
    fail++;
    continue;
  }

  // GET MT metadata (name/section/type/status/code)
  let tmpl;
  if (!DRY_RUN) {
    const gr = await authedFetch(site, `/api/bo/messagetemplate/${t.tid}`);
    tmpl = gr?.data?.message_template ?? gr?.data?.rows;
    if (!tmpl?.name) {
      console.log(`  ✗ GET failed or no name: ${JSON.stringify(gr)?.slice(0, 120)}`);
      fail++;
      continue;
    }
  }

  // Build details — keep existing message HTML, update subject only
  const details = {};
  for (const mt of bundleMts) {
    const lid = mt.settings_locale_id;
    const newSubject = EN_LOCALES.has(lid) ? t.enSubject
                     : ZH_LOCALES.has(lid) ? t.zhSubject
                     : mt.subject;
    console.log(`  locale ${lid}: "${mt.subject}" → "${newSubject}"`);
    details[String(lid)] = {
      settings_locale_id: lid,
      subject: newSubject,
      message: mt.message,
    };
  }

  if (DRY_RUN) { console.log('  [DRY RUN]'); continue; }

  const putBody = {
    name: tmpl.name,
    section: tmpl.section,
    type: tmpl.type,
    status: tmpl.status,
    code: tmpl.code ?? undefined,
    details,
  };

  const res = await authedFetch(site, `/api/bo/messagetemplate/${t.tid}`, { method: 'PUT', body: putBody });
  const succeeded = res?.success === true || res?.status === 0 || res?.data?.message_template?.id > 0 || res?.data?.rows?.id > 0;
  if (succeeded) {
    console.log(`  ✓ subject updated`);
    ok++;
  } else {
    console.log(`  ✗ PUT failed: ${JSON.stringify(res)?.slice(0, 200)}`);
    fail++;
  }
}

if (DRY_RUN) {
  console.log('\n[DRY RUN complete] Re-run with --commit to apply.');
} else {
  console.log(`\n${ok} updated, ${fail} failed`);
}
