#!/usr/bin/env node
// One-off: scan WS1 MY + SG for Free Spin promos to reveal historical
// naming patterns + cross-check P143-P151 candidate names for collisions.
//
// Output: per-site list of FS-style names, plus collision verdict for
// each candidate.

import { igmpPost } from '../src/igmp-client.js';

const SITES = ['ws1-v3-my', 'ws1-v3-sg'];

// After api-mapper-igmp.js patch (2026-06-23): MIN<localCcyAmount> suffix
// appended to FS names. We probe both MY and SG candidate names per handle.
const CANDIDATES = [
  { handle: 'P143', myName: '48 Free Spins on Gates Of Olympus (FS48 / 0.40/spin / TO5x / MIN500)', sgName: '48 Free Spins on Gates Of Olympus (FS48 / 0.40/spin / TO5x / MIN150)' },
  { handle: 'P144', myName: '68 Free Spins on Gates Of Olympus (FS68 / 0.40/spin / TO5x / MIN500)', sgName: '68 Free Spins on Gates Of Olympus (FS68 / 0.40/spin / TO5x / MIN150)' },
  { handle: 'P145', myName: '138 Free Spins on Gates Of Olympus (FS138 / 0.40/spin / TO5x / MIN500)', sgName: '138 Free Spins on Gates Of Olympus (FS138 / 0.40/spin / TO5x / MIN150)' },
  { handle: 'P146', myName: '28 Free Spins on Gates Of Olympus (FS28 / 0.40/spin / TO5x / MIN300)', sgName: '28 Free Spins on Gates Of Olympus (FS28 / 0.40/spin / TO5x / MIN100)' },
  { handle: 'P147', myName: '48 Free Spins on Gates Of Olympus (FS48 / 0.40/spin / TO5x / MIN300)', sgName: '48 Free Spins on Gates Of Olympus (FS48 / 0.40/spin / TO5x / MIN100)' },
  { handle: 'P148', myName: '88 Free Spins on Gates Of Olympus (FS88 / 0.40/spin / TO5x / MIN300)', sgName: '88 Free Spins on Gates Of Olympus (FS88 / 0.40/spin / TO5x / MIN100)' },
  { handle: 'P149', myName: '18 Free Spins on Gates Of Olympus (FS18 / 0.40/spin / TO5x / MIN100)', sgName: '18 Free Spins on Gates Of Olympus (FS18 / 0.40/spin / TO5x / MIN50)' },
  { handle: 'P150', myName: '28 Free Spins on Gates Of Olympus (FS28 / 0.40/spin / TO5x / MIN100)', sgName: '28 Free Spins on Gates Of Olympus (FS28 / 0.40/spin / TO5x / MIN50)' },
  { handle: 'P151', myName: '48 Free Spins on Gates Of Olympus (FS48 / 0.40/spin / TO5x / MIN100)', sgName: '48 Free Spins on Gates Of Olympus (FS48 / 0.40/spin / TO5x / MIN50)' },
];

async function listAll(siteId) {
  const all = [];
  for (let pg = 1; pg <= 40; pg++) {
    const r = await igmpPost(siteId, `/PM/GetPromotionsList?pageNum=${pg}&rowPerPage=200`, {
      PromotionCode: '',
      PromotionName: '',
      PromotionType: 0,
      IsActive: '',
      IsPublished: '',
    });
    const rows = r?.data || [];
    if (!rows.length) break;
    all.push(...rows);
    if (rows.length < 200) break;
  }
  return all;
}

function isFsName(name) {
  if (!name) return false;
  return /free\s*spin|FS\s*\d|^\d+\s*FS\b|\d+\s*Free\s*Spins/i.test(name);
}

async function main() {
  for (const siteId of SITES) {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`SITE: ${siteId}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    let all = [];
    try {
      all = await listAll(siteId);
    } catch (e) {
      console.log(`  fetch error: ${e.message || e}`);
      continue;
    }
    console.log(`  Total promos on site: ${all.length}`);
    const fsRows = all.filter((p) => isFsName(p.PromotionName || p.PromotionCode));
    console.log(`  Free-Spin-like names: ${fsRows.length}`);
    if (fsRows.length) {
      const seen = new Map();
      fsRows.forEach((p) => {
        const k = p.PromotionName || '(no name)';
        const lst = seen.get(k) || [];
        lst.push({ code: p.PromotionCode, active: p.IsActive, id: p.PromotionId });
        seen.set(k, lst);
      });
      console.log(`  Unique names (${seen.size}):`);
      Array.from(seen.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .forEach(([name, lst]) => {
          const tag = lst.length > 1 ? ` [${lst.length}× dup]` : '';
          console.log(`    • "${name}"${tag}`);
          lst.forEach((r) => {
            console.log(`        id=${r.id} code=${r.code} active=${r.active}`);
          });
        });
    }
    console.log(`\n  Candidate collision check for ${siteId}:`);
    const isMY = siteId.endsWith('-my');
    for (const c of CANDIDATES) {
      const candidateName = isMY ? c.myName : c.sgName;
      const matches = all.filter((p) => (p.PromotionName || '') === candidateName);
      const verdict = matches.length === 0 ? '✓ UNIQUE' : `✗ ${matches.length}× COLLISION`;
      console.log(`    ${c.handle.padEnd(5)}  ${verdict}  "${candidateName}"`);
      if (matches.length) {
        matches.forEach((m) => console.log(`        existing id=${m.PromotionId} code=${m.PromotionCode} active=${m.IsActive}`));
      }
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
