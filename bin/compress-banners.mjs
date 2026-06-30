#!/usr/bin/env node
// Banner compression — Step 3.5 in the WS1/MB8 banner upload pipeline.
// Run AFTER /banner-pre-qc gives PASS/WARNING, BEFORE upload-ws1-banners-api.mjs --commit.
//
// Usage:
//   node bin/compress-banners.mjs Banner/mb8-{campaign} Banner/mb8-{campaign}-min
//
// IMPORTANT: dest-folder MUST end in "-min".
// upload-ws1-banners-api.mjs auto-prefers any subfolder ending in "-min" over the raw folder.
// If you use a different suffix, the upload script silently falls back to the raw uncompressed folder.
//
// Tool: Sharp (local, unlimited). For cloud-quality compression on high-profile campaigns,
// use src/tinify.js directly — but note the 500/month free-tier cap.

import sharp from 'sharp';
import { readdirSync, mkdirSync, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';

const [,, srcDir, destDir] = process.argv;
if (!srcDir || !destDir) {
  console.error('Usage: node bin/compress-banners.mjs <src-folder> <dest-folder>');
  process.exit(1);
}

if (!existsSync(srcDir)) {
  console.error('Source folder not found:', srcDir);
  process.exit(1);
}

mkdirSync(destDir, { recursive: true });

const files = readdirSync(srcDir).filter((f) => /\.(jpe?g|png)$/i.test(f));
if (!files.length) {
  console.log('No JPG/PNG files found in', srcDir);
  process.exit(0);
}

for (const file of files) {
  const src  = path.join(srcDir, file);
  const dest = path.join(destDir, file);
  const ext  = path.extname(file).toLowerCase();
  const img  = sharp(src);

  if (ext === '.jpg' || ext === '.jpeg') {
    await img.jpeg({ quality: 82, mozjpeg: true }).toFile(dest);
  } else {
    await img.png({ compressionLevel: 9, effort: 10 }).toFile(dest);
  }

  const srcStat  = await stat(src);
  const destStat = await stat(dest);
  const pct = Math.round((1 - destStat.size / srcStat.size) * 100);
  console.log(
    `  ${file}: ${Math.round(srcStat.size / 1024)}KB → ${Math.round(destStat.size / 1024)}KB  (-${pct}%)`
  );
}

console.log(`\n✅ ${files.length} file(s) compressed → ${destDir}`);
