#!/usr/bin/env node
/**
 * Fix the 29 brand-watch Wave 3 MT domain findings (2026-07-07) —
 * foreign-tnc-domain (5 QPRO promos) + qp2-literal-domain (24 QP2 findings,
 * deduping to 9 shared-BO templates). Players currently receive inbox
 * messages linking to a DIFFERENT brand's website.
 *
 * Three treatments, chosen from live probes (tmp/probe-mt-domains.mjs):
 *
 *   host-swap  QPRO10 + QPRO7 — the foreign domain sits in a proper T&C
 *              anchor (<a href="https://<foreign>/en-my/info-center/...">).
 *              Swap the host to the brand's own tncDomain, keep the path
 *              (feedback_cross_brand_mt_swap_tncdomain).
 *
 *   unwrap     QPRO8 — the foreign domain is a cross-PLATFORM campaign link
 *              to king333mys.com/promotion?code=EVEXMASSTREAKB (QP2B's
 *              Christmas page). QPRO8's own copy of that content
 *              (EVEXMASSTREAK) is status=0 — any re-pointed link would be
 *              dead. Unwrap the anchor, keep the inner text, drop empty
 *              anchors.
 *
 *   unwrap-qp2 QP2 shared BO — same Christmas campaign anchor hardcoding
 *              king333mys.com. The shared 4-merchant BO must never carry a
 *              literal merchant domain, and :url must stay OUT of href
 *              attributes (plain text only — verified 2026-06-25,
 *              src/qc-mt-tnc.js). Campaign is over, so: unwrap the anchor
 *              to plain text; any residual bare-URL occurrences become :url.
 *              Also covers ibc22mys.com — the EN/SG locales of tpl 557/555
 *              link the SAME campaign via that host (EVEXMASSTREAKA). The
 *              scanner missed it only because ibc22mys.com is not a
 *              brand-directory host; same defect, same templates.
 *
 * MT ids resolved live from the promotion listing (message_templates[]
 * .message_template_id). PUT shape per project_message_template_put_api:
 * name+section+type+status+details, full details re-sent, `code` omitted
 * (QP2 PUT 422s on it).
 *
 * Usage:
 *   node bin/fix-brand-watch-mt-domains.mjs            # dry-run + diff preview
 *   node bin/fix-brand-watch-mt-domains.mjs --commit   # live write
 *
 * After committing: node bin/brand-watch.mjs --commit --dashboard
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { authedFetch, findPromotionByCode } from '../src/api-client.js';

const commit = process.argv.includes('--commit');

const QP2_CODES = [
  'FT_FC68_CTC_5X', 'FT_FC38_CTC_5X', 'FT_FC18_CTC_5X', 'FT_FC_188_CTC_5X',
  'FT_REL_98FS_SC_5X', 'FT_REL_98FS_CBS_5X',
  'FT_REL_88FS_SC_5X', 'FT_REL_88FS_CBBB_5X', 'FT_REL_88FS_CBS_5X',
];

const TARGETS = [
  { siteId: 'qpro10', brand: 'QPRO10', code: 'REL_188FS_GOO_RET_190225', mode: 'host-swap', foreign: 'bp9mys.com', own: 'uo8my.com' },
  { siteId: 'qpro7',  brand: 'QPRO7',  code: 'FT_REL128FS_FOO',          mode: 'host-swap', foreign: 'u388my.net', own: 'mbs66.com' },
  { siteId: 'qpro8',  brand: 'QPRO8',  code: 'FT_REL_98FS_SC_5X',   mode: 'unwrap', foreign: 'king333mys.com' },
  { siteId: 'qpro8',  brand: 'QPRO8',  code: 'FT_REL_98FS_CBBB_5X', mode: 'unwrap', foreign: 'king333mys.com' },
  { siteId: 'qpro8',  brand: 'QPRO8',  code: 'FT_REL_98FS_CBS_5X',  mode: 'unwrap', foreign: 'king333mys.com' },
  ...QP2_CODES.map((code) => ({ siteId: 'qp2', brand: 'QP2 shared', code, mode: 'unwrap-qp2', foreign: ['king333mys.com', 'ibc22mys.com'] })),
];

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Replace every occurrence of the foreign host (with optional www.) keeping
// protocol + path — the QPRO T&C-anchor treatment.
function hostSwap(text, foreign, own) {
  let count = 0;
  const out = text.replace(new RegExp(`(www\\.)?${escRe(foreign)}`, 'gi'), () => { count++; return own; });
  return { out, count };
}

// Unwrap every <a> whose href contains one of the foreign hosts: keep inner
// text, drop anchors that wrap only whitespace/&nbsp;. Then handle any
// residual bare URLs on those hosts: ':url' on QP2, counted as residue on
// QPRO (none observed live — a nonzero residue blocks the commit for safety).
function unwrapAnchors(text, foreign, { residualToUrl }) {
  const hosts = Array.isArray(foreign) ? foreign : [foreign];
  const hostAlt = hosts.map(escRe).join('|');
  let count = 0;
  const anchorRe = new RegExp(`<a\\b[^>]*href="[^"]*(?:${hostAlt})[^"]*"[^>]*>([\\s\\S]*?)</a>`, 'gi');
  let out = text.replace(anchorRe, (_, inner) => {
    count++;
    return inner.replace(/&nbsp;|\s/g, '') === '' ? '' : inner;
  });
  let residue = 0;
  const bareRe = new RegExp(`https?://(www\\.)?(?:${hostAlt})`, 'gi');
  if (residualToUrl) {
    out = out.replace(bareRe, () => { count++; return ':url'; });
  } else {
    residue = (out.match(bareRe) || []).length;
  }
  // Anything left mentioning the host at all is a blocker, not a silent pass.
  residue += (out.match(new RegExp(hostAlt, 'gi')) || []).length;
  return { out, count, residue };
}

function transform(text, t) {
  if (t.mode === 'host-swap') return { residue: 0, ...hostSwap(text, t.foreign, t.own) };
  return unwrapAnchors(text, t.foreign, { residualToUrl: t.mode === 'unwrap-qp2' });
}

// Context windows around each change for the dry-run preview.
function diffSnippets(oldText, newText, foreign) {
  const hosts = Array.isArray(foreign) ? foreign : [foreign];
  const snippets = [];
  const re = new RegExp(hosts.map(escRe).join('|'), 'gi');
  let m;
  while ((m = re.exec(oldText)) && snippets.length < 4) {
    snippets.push(oldText.slice(Math.max(0, m.index - 90), m.index + m[0].length + 70).replace(/\s+/g, ' '));
  }
  return { before: snippets, afterLen: newText.length, beforeLen: oldText.length };
}

console.log('═'.repeat(70));
console.log(`FIX brand-watch MT domains — ${commit ? 'LIVE COMMIT' : 'DRY-RUN (add --commit to save)'}`);
console.log(`${TARGETS.length} promo codes → templates resolved live from the listing`);
console.log('═'.repeat(70));

const preview = [];
let ok = 0, failed = 0, skipped = 0;
const seenTpl = new Set(); // shared-BO safety: never PUT the same template twice

for (const t of TARGETS) {
  const label = `${t.brand} ${t.code} [${t.mode}]`;
  let row;
  try {
    row = await findPromotionByCode(t.siteId, t.code);
  } catch (e) {
    console.log(`\n${label}: ✗ listing lookup failed — ${e.message.split('\n')[0]}`);
    failed++;
    continue;
  }
  if (!row) { console.log(`\n${label}: ✗ promo not found on ${t.siteId}`); failed++; continue; }

  const tplIds = [...new Set((row.message_templates || []).map((m) => m.message_template_id).filter(Boolean))];
  if (!tplIds.length) { console.log(`\n${label}: ✗ no message_template_id on listing row`); failed++; continue; }

  for (const tplId of tplIds) {
    const key = `${t.siteId}::${tplId}`;
    if (seenTpl.has(key)) { console.log(`\n${label}: tpl ${tplId} already handled (shared) — skip`); continue; }
    seenTpl.add(key);

    let meta, details;
    try {
      const r = await authedFetch(t.siteId, `/api/bo/messagetemplate/${tplId}`);
      meta = r.data?.message_template;
      details = r.data?.message_details || {};
      if (!meta) throw new Error('template meta missing in response');
    } catch (e) {
      console.log(`\n${label} tpl ${tplId}: ✗ GET failed — ${e.message.split('\n')[0]}`);
      failed++;
      continue;
    }

    console.log(`\n${label} — tpl ${tplId} "${meta.name}" (${Object.keys(details).length} locales)`);
    const newDetails = {};
    let changes = 0, residue = 0;
    for (const [lid, entry] of Object.entries(details)) {
      const subj = transform(entry.subject || '', t);
      const body = transform(entry.message || '', t);
      residue += subj.residue + body.residue;
      newDetails[lid] = {
        settings_locale_id: entry.settings_locale_id ?? Number(lid),
        subject: subj.out,
        message: body.out,
      };
      const n = subj.count + body.count;
      if (n) {
        changes += n;
        console.log(`  locale ${lid}: ${n} replacement(s)${subj.count ? ` (${subj.count} in subject)` : ''}`);
        const d = diffSnippets(`${entry.subject || ''}\n${entry.message || ''}`, body.out, t.foreign);
        for (const s of d.before) console.log(`    was: …${s}…`);
      }
    }

    if (!changes) { console.log('  → no occurrences found — nothing to do (already clean?)'); skipped++; continue; }
    if (residue) {
      console.log(`  → ✗ BLOCKED: ${residue} occurrence(s) of ${t.foreign} would survive the transform — needs manual review`);
      failed++;
      continue;
    }

    preview.push({ site: t.siteId, brand: t.brand, code: t.code, tplId, name: meta.name, mode: t.mode, changes,
      locales: Object.fromEntries(Object.entries(newDetails).map(([lid, v]) => [lid, { old: details[lid], new: v }])) });

    if (!commit) { console.log(`  → dry-run: ${changes} replacement(s) staged`); ok++; continue; }

    // PUT — full details re-sent, `code` omitted (QP2 422s on it).
    const putBody = { name: meta.name, section: meta.section, type: meta.type, status: meta.status, details: newDetails };
    try {
      const res = await authedFetch(t.siteId, `/api/bo/messagetemplate/${tplId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(putBody),
      });
      const good = res.success !== false;
      console.log(`  → ${good ? '✓ saved' : `✗ PUT rejected${res.message ? ` (${Array.isArray(res.message) ? res.message[0] : res.message})` : ''}`}`);
      good ? ok++ : failed++;
    } catch (e) {
      console.log(`  → ✗ PUT failed — ${e.message.split('\n')[0]}`);
      failed++;
    }
  }
}

mkdirSync('tmp', { recursive: true });
writeFileSync('tmp/mt-domain-fix-preview.json', JSON.stringify({ generatedAt: new Date().toISOString(), commit, preview }, null, 2));

console.log('\n' + '─'.repeat(50));
console.log(`Summary: ${ok} template(s) ${commit ? 'saved' : 'staged'}, ${failed} failed, ${skipped} already clean`);
console.log('Full old/new bodies → tmp/mt-domain-fix-preview.json');
if (!commit) console.log('(dry-run — no BO writes made)');
