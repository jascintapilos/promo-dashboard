#!/usr/bin/env node
// One-shot compression helper.
// Usage: node bin/compress-banners.mjs <src-folder> <dest-folder>
// Compresses all JPG/PNG in src-folder → dest-folder at high-quality JPEG / max PNG.
// Falls back to sharp if available, otherwise exits with guidance.

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
