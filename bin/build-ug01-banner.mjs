import sharp from 'sharp';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '../Banner/ug01-checkin-anti-zonk/src');
const OUT = path.resolve(__dirname, '../Banner/ug01-checkin-anti-zonk');

const W = 847, H = 382;

// ---- helper: trim white border, resize to target height, return {buf,w,h} ----
async function product(file, targetH) {
  const trimmed = await sharp(path.join(SRC, file))
    .flatten({ background: '#ffffff' })   // webp may have alpha; lay on white first
    .trim({ threshold: 12 })
    .toBuffer();
  const m = await sharp(trimmed).metadata();
  const targetW = Math.round((m.width / m.height) * targetH);
  const buf = await sharp(trimmed).resize(targetW, targetH, { fit: 'inside' }).png().toBuffer();
  return { buf, w: targetW, h: targetH };
}

async function logo(targetH) {
  const buf = await sharp(path.join(SRC, 'logo.png'))
    .resize({ height: targetH })
    .png().toBuffer();
  const m = await sharp(buf).metadata();
  return { buf, w: m.width, h: m.height };
}

// ---- background + text overlay as SVG ----
function bgSvg() {
  return Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0"  stop-color="#3a0a0d"/>
      <stop offset="0.5" stop-color="#5c0e13"/>
      <stop offset="1"  stop-color="#1a0406"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.62" cy="0.5" r="0.6">
      <stop offset="0"   stop-color="#e9b24a" stop-opacity="0.35"/>
      <stop offset="0.6" stop-color="#e9b24a" stop-opacity="0.05"/>
      <stop offset="1"   stop-color="#e9b24a" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
</svg>`);
}

function cardSvg(cx, cy, cw, ch, r) {
  return Buffer.from(`<svg width="${cw}" height="${ch}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="card" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#ffffff"/>
        <stop offset="1" stop-color="#e9edf2"/>
      </linearGradient>
    </defs>
    <rect x="3" y="3" width="${cw-6}" height="${ch-6}" rx="${r}" ry="${r}" fill="url(#card)" stroke="#e9b24a" stroke-width="3"/>
  </svg>`);
}

function textSvg() {
  return Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="goldtext" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff6cf"/>
      <stop offset="0.55" stop-color="#f2c14b"/>
      <stop offset="1" stop-color="#c8881e"/>
    </linearGradient>
    <filter id="sh" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#000000" flood-opacity="0.6"/>
    </filter>
  </defs>
  <style>
    .h  { font-family: 'Arial Black','Arial',sans-serif; font-weight: 900; }
    .b  { font-family: 'Arial','sans-serif'; }
  </style>

  <!-- headline -->
  <text x="34" y="146" class="h" font-size="33" fill="#ffffff" filter="url(#sh)">CHECK IN</text>
  <text x="34" y="184" class="h" font-size="33" fill="#ffffff" filter="url(#sh)">DAPATKAN</text>
  <text x="34" y="222" class="h" font-size="33" fill="url(#goldtext)" filter="url(#sh)">HADIAH</text>

  <!-- ANTI ZONK pill -->
  <rect x="34" y="244" width="186" height="42" rx="21" fill="#d8262b" stroke="#f2c14b" stroke-width="2"/>
  <text x="127" y="273" class="h" font-size="24" fill="#ffffff" text-anchor="middle">ANTI ZONK</text>

  <!-- prize list tagline -->
  <text x="34" y="322" class="b" font-size="14" fill="#f3d9a0" font-weight="bold">iPhone &#8226; Samsung &#8226; Smart TV</text>
</svg>`);
}

(async () => {
  const base = sharp(bgSvg());

  const lg = await logo(40);
  const tv = await product('tcl.png', 168);
  const ip = await product('iphone.webp', 150);
  const sm = await product('samsung.webp', 150);

  // right showcase card
  const CX = 408, CY = 36, CW = W - CX - 22, CH = H - CY - 32, R = 18;

  // product placement inside card
  const cardCenterX = CX + CW / 2;
  const tvX = Math.round(cardCenterX - tv.w / 2);
  const tvY = CY + 14;
  const ipX = CX + 16;
  const smX = CX + CW - sm.w - 16;
  const phoneY = CY + CH - sm.h - 12;

  const composites = [
    { input: cardSvg(CX, CY, CW, CH, R), left: CX, top: CY },
    { input: tv.buf, left: tvX, top: tvY },
    { input: ip.buf, left: ipX, top: phoneY },
    { input: sm.buf, left: smX, top: phoneY },
    { input: lg.buf, left: 30, top: 26 },
    { input: textSvg(), left: 0, top: 0 },
  ];

  await base.composite(composites).png().toFile(path.join(OUT, 'ug01-checkin-anti-zonk-847x382.png'));
  console.log('written', path.join(OUT, 'ug01-checkin-anti-zonk-847x382.png'));
  console.log('logo', lg.w + 'x' + lg.h, '| tv', tv.w + 'x' + tv.h, '| iphone', ip.w + 'x' + ip.h, '| samsung', sm.w + 'x' + sm.h);
})();
