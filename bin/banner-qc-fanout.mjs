#!/usr/bin/env node
// Lists banner QC plan or bundle files for a B-ID range.
// Used by /banner-pre-qc and /banner-deep-qc skills.
//
// Usage:
//   node bin/banner-qc-fanout.mjs B16 --plans --pretty
//   node bin/banner-qc-fanout.mjs B13-B25 --bundles --pretty
//   node bin/banner-qc-fanout.mjs B16 --plans             (JSON array output)

import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const [,, rangeArg, ...flags] = process.argv;
const pretty  = flags.includes('--pretty');
const mode    = flags.includes('--bundles') ? 'bundles' : 'plans';
const dir     = join(ROOT, 'captures', mode === 'bundles' ? 'banner-qc-bundles' : 'banner-qc-plans');

if (!rangeArg) {
  console.error('Usage: node bin/banner-qc-fanout.mjs <B##|B##-B##> [--plans|--bundles] [--pretty]');
  process.exit(1);
}

// Parse B-ID range: "B16", "B13-B25", "B01,B03,B07"
function parseBIds(raw) {
  if (raw.includes(',')) return raw.split(',').map(s => s.trim().toUpperCase());
  const m = raw.match(/^(B\d+)-(B\d+)$/i);
  if (m) {
    const from = parseInt(m[1].slice(1));
    const to   = parseInt(m[2].slice(1));
    return Array.from({ length: to - from + 1 }, (_, i) => `B${String(from + i).padStart(2, '0')}`);
  }
  return [raw.toUpperCase()];
}

const bIds = parseBIds(rangeArg);

if (!existsSync(dir)) {
  if (pretty) {
    console.log(`No ${mode} found. Run upload-promo.js ${mode === 'plans' ? '--dry-run' : '--commit'} first.`);
  } else {
    console.log('[]');
  }
  process.exit(0);
}

const allFiles = readdirSync(dir).filter(f => f.endsWith('.json'));
const matched  = allFiles.filter(f => bIds.some(id => f.startsWith(`${id}__`)));

if (!matched.length) {
  if (pretty) {
    console.log(`No ${mode} found for: ${bIds.join(', ')}`);
    console.log(`Available: ${allFiles.map(f => f.replace('.json','')).join(', ') || 'none'}`);
  } else {
    console.log('[]');
  }
  process.exit(0);
}

if (pretty) {
  console.log(`\nBanner QC ${mode.toUpperCase()} — ${rangeArg}\n`);
  for (const f of matched) {
    const bundle = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    const info = mode === 'bundles'
      ? `banner_id=${bundle.banner_id}  content_id=${bundle.content_id}  code=${bundle.promo_code}`
      : `promo_code=${bundle.promo_code}  images=${bundle.staged_images?.length || 0} locale(s)`;
    console.log(`  ▸ ${bundle.b_id} (${bundle.site_id})  ${info}`);
    console.log(`    file: captures/${mode === 'bundles' ? 'banner-qc-bundles' : 'banner-qc-plans'}/${f}`);
  }
  console.log('');
} else {
  const bundles = matched.map(f => JSON.parse(readFileSync(join(dir, f), 'utf8')));
  console.log(JSON.stringify(bundles, null, 2));
}
