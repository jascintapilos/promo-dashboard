const pptxgen = require("pptxgenjs");
const prs = new pptxgen();
prs.layout = "LAYOUT_16x9";

const NAVY = "1E2761";
const ICE = "CADCFC";
const WHITE = "FFFFFF";
const LIGHTBG = "EEF3FF";
const MUTED = "5A6478";
const BODYTEXT = "2B3A5C";

function bar(sl, color = NAVY) {
  sl.addShape(prs.ShapeType.rect, { x: 0, y: 0, w: 0.07, h: "100%", fill: { color }, line: { type: "none" } });
}

function ttl(sl, text, opts = {}) {
  sl.addText(text, {
    x: 0.35, y: opts.y || 0.15, w: opts.w || 9.3, h: opts.h || 0.72,
    fontSize: opts.fs || 36, bold: true, fontFace: "Arial Black",
    color: opts.color || NAVY, align: "left", valign: "middle", margin: 0,
  });
}

function sub(sl, text, opts = {}) {
  sl.addText(text, {
    x: 0.35, y: opts.y || 0.88, w: opts.w || 9.3, h: opts.h || 0.35,
    fontSize: opts.fs || 16, fontFace: "Calibri", italic: true,
    color: opts.color || MUTED, align: "left", margin: 0,
  });
}

// ─── Slide 1: Title ──────────────────────────────────────────────────────────
{
  const sl = prs.addSlide();
  sl.addShape(prs.ShapeType.rect, { x: 0, y: 0, w: "100%", h: "100%", fill: { color: NAVY }, line: { type: "none" } });
  sl.addShape(prs.ShapeType.rect, { x: 0, y: 0, w: 0.07, h: "100%", fill: { color: ICE }, line: { type: "none" } });
  sl.addText("Promo Team\nQC & QA Framework", {
    x: 0.6, y: 1.1, w: 8.8, h: 2.5,
    fontSize: 44, bold: true, fontFace: "Arial Black",
    color: WHITE, align: "left", valign: "top",
  });
  sl.addText("Effective 20 June 2026", {
    x: 0.6, y: 3.8, w: 8.8, h: 0.55,
    fontSize: 20, fontFace: "Calibri", color: ICE, align: "left",
  });
}

// ─── Slide 2: Why This Exists ────────────────────────────────────────────────
{
  const sl = prs.addSlide();
  bar(sl);
  ttl(sl, "Why This Exists");

  const pillars = ["Scalable", "Measurable", "Consistent", "Ownership-\ndriven"];
  const pW = 2.1, pH = 2.2, gap = 0.2;
  const total = pillars.length * pW + (pillars.length - 1) * gap;
  const sx = (10 - total) / 2;
  pillars.forEach((p, i) => {
    const x = sx + i * (pW + gap);
    sl.addShape(prs.ShapeType.rect, { x, y: 1.0, w: pW, h: pH, fill: { color: NAVY }, line: { type: "none" } });
    sl.addText(p, { x, y: 1.0, w: pW, h: pH, fontSize: 24, bold: true, fontFace: "Arial Black", color: ICE, align: "center", valign: "middle" });
  });
  sl.addShape(prs.ShapeType.rect, { x: 0.35, y: 3.4, w: 9.3, h: 0.05, fill: { color: ICE }, line: { type: "none" } });
  sl.addText("Less checking. More ownership.", {
    x: 0.35, y: 3.55, w: 9.3, h: 0.7,
    fontSize: 26, italic: true, fontFace: "Calibri", color: NAVY, align: "center",
  });
}

// ─── Slide 3: Core Principle ─────────────────────────────────────────────────
{
  const sl = prs.addSlide();
  sl.addShape(prs.ShapeType.rect, { x: 0, y: 0, w: "100%", h: "100%", fill: { color: LIGHTBG }, line: { type: "none" } });
  sl.addShape(prs.ShapeType.rect, { x: 0, y: 0, w: 0.07, h: "100%", fill: { color: ICE }, line: { type: "none" } });
  sl.addText([
    { text: "The person completing the task\n", options: {} },
    { text: "is responsible for the quality of the task.", options: {} },
  ], {
    x: 0.7, y: 0.9, w: 8.6, h: 2.1,
    fontSize: 32, bold: true, fontFace: "Arial Black",
    color: NAVY, align: "center", valign: "middle",
  });
  sl.addShape(prs.ShapeType.rect, { x: 2.0, y: 3.2, w: 6.0, h: 0.05, fill: { color: NAVY }, line: { type: "none" } });
  sl.addText("Self-QC is mandatory.  Peer QC is support — not responsibility transfer.", {
    x: 0.7, y: 3.38, w: 8.6, h: 0.85,
    fontSize: 20, fontFace: "Calibri", italic: true, color: MUTED, align: "center",
  });
}

// ─── Slide 4: Layer 1 – Operational QC ──────────────────────────────────────
{
  const sl = prs.addSlide();
  bar(sl);
  ttl(sl, "Layer 1 — Operational QC");
  sub(sl, "Every task. Every time. Done by the task owner.");

  const cols = [
    { h: "PROMO\nCODE",         items: ["Requirement matches", "Brand correct", "Bonus settings", "Game settings", "Activation dates"] },
    { h: "BANNER",              items: ["Dimensions", "Locale variants", "Folder structure", "File naming"] },
    { h: "CRM\nASSIGNMENT",     items: ["Segment assigned", "Code linked", "Broadcast queued"] },
    { h: "CONTENT /\nTRANSLATION", items: ["Language accuracy", "Links working", "Formatting preserved"] },
  ];
  const cW = 2.17, gap = 0.17, sx = 0.35;
  cols.forEach((col, i) => {
    const x = sx + i * (cW + gap);
    sl.addShape(prs.ShapeType.rect, { x, y: 1.32, w: cW, h: 0.65, fill: { color: NAVY }, line: { type: "none" } });
    sl.addText(col.h, { x, y: 1.32, w: cW, h: 0.65, fontSize: 13, bold: true, fontFace: "Arial Black", color: ICE, align: "center", valign: "middle" });
    sl.addShape(prs.ShapeType.rect, { x, y: 2.0, w: cW, h: 3.35, fill: { color: LIGHTBG }, line: { color: ICE, pt: 1 } });
    sl.addText(
      col.items.map((item, j) => ({ text: item, options: j < col.items.length - 1 ? { breakLine: true } : {} })),
      { x: x + 0.05, y: 2.0, w: cW - 0.1, h: 3.35, fontSize: 15, fontFace: "Calibri", color: BODYTEXT, align: "left", valign: "top", bullet: { type: "bullet", indent: 10 }, margin: [8, 6, 8, 6] }
    );
  });
}

// ─── Slide 5: When to Request Peer QC ───────────────────────────────────────
{
  const sl = prs.addSlide();
  bar(sl);
  ttl(sl, "When to Request Peer QC");

  const doItems    = ["New campaign type", "Complex setup", "New platform or website", "Requirement unclear", "Need second opinion"];
  const dontItems  = ["Routine tasks already on the checklist", "Standard day-to-day setups", "After skipping self-QC"];

  sl.addShape(prs.ShapeType.rect, { x: 0.5, y: 1.05, w: 4.1, h: 0.58, fill: { color: "2D6A4F" }, line: { type: "none" } });
  sl.addText("✓  DO", { x: 0.5, y: 1.05, w: 4.1, h: 0.58, fontSize: 20, bold: true, fontFace: "Arial Black", color: WHITE, align: "center", valign: "middle" });

  sl.addShape(prs.ShapeType.rect, { x: 5.2, y: 1.05, w: 4.1, h: 0.58, fill: { color: "C0392B" }, line: { type: "none" } });
  sl.addText("✗  DON'T", { x: 5.2, y: 1.05, w: 4.1, h: 0.58, fontSize: 20, bold: true, fontFace: "Arial Black", color: WHITE, align: "center", valign: "middle" });

  sl.addShape(prs.ShapeType.rect, { x: 0.5, y: 1.67, w: 4.1, h: 3.65, fill: { color: "F0FBF5" }, line: { color: "2D6A4F", pt: 1 } });
  sl.addText(
    doItems.map((item, j) => ({ text: item, options: j < doItems.length - 1 ? { breakLine: true } : {} })),
    { x: 0.5, y: 1.67, w: 4.1, h: 3.65, fontSize: 18, fontFace: "Calibri", color: "2D6A4F", align: "left", valign: "top", bullet: { type: "bullet" }, margin: [14, 16, 14, 16] }
  );

  sl.addShape(prs.ShapeType.rect, { x: 5.2, y: 1.67, w: 4.1, h: 3.65, fill: { color: "FDF3F2" }, line: { color: "C0392B", pt: 1 } });
  sl.addText(
    dontItems.map((item, j) => ({ text: item, options: j < dontItems.length - 1 ? { breakLine: true } : {} })),
    { x: 5.2, y: 1.67, w: 4.1, h: 3.65, fontSize: 18, fontFace: "Calibri", color: "C0392B", align: "left", valign: "top", bullet: { type: "bullet" }, margin: [14, 16, 14, 16] }
  );
}

// ─── Slide 6: What the Team Said (2×2 with Gaby) ────────────────────────────
{
  const sl = prs.addSlide();
  bar(sl);
  ttl(sl, "What the Team Said");
  sub(sl, "QC Model Review — submitted EOD 17 June");

  const cards = [
    {
      name: "ALYSA",
      body: "Peer QC:  Promo code creation\nSelf QC:  Banner, CRM, ZH translation\nFlag:  \"Perform self-QC before requesting peer QC\"",
    },
    {
      name: "WEN",
      body: "Peer QC:  Guidance on complex setups; second opinion for Gaby & Bangun\nSelf QC:  Smartico CRM configs, banner uploads\nNote:  \"On-demand peer QC only — trust the team\"",
    },
    {
      name: "BANGUN",
      body: "Peer QC:  Complex campaign setups on ID website\nSelf QC:  Banner upload, promo code creation\nNote:  Supports on-demand approach",
    },
    {
      name: "GABY",
      body: "Peer QC:  Promo code (bot + ID web); Gaby & Bangun peer QC each other\nSelf QC:  Banner uploads, CRM assignment, ID translation\nNote:  \"Current QC workflow effective for new members\"",
    },
  ];

  const cW = 4.55, cH = 2.1, gap = 0.2;
  const col1X = 0.35, col2X = 0.35 + cW + gap;
  const row1Y = 1.28, row2Y = 1.28 + cH + 0.18;

  cards.forEach((card, i) => {
    const x = i % 2 === 0 ? col1X : col2X;
    const y = i < 2 ? row1Y : row2Y;
    sl.addShape(prs.ShapeType.rect, { x, y, w: cW, h: cH, fill: { color: LIGHTBG }, line: { color: ICE, pt: 1.5 } });
    sl.addShape(prs.ShapeType.rect, { x, y, w: cW, h: 0.46, fill: { color: NAVY }, line: { type: "none" } });
    sl.addText(card.name, { x, y, w: cW, h: 0.46, fontSize: 18, bold: true, fontFace: "Arial Black", color: ICE, align: "center", valign: "middle" });
    sl.addText(card.body, {
      x: x + 0.12, y: y + 0.5, w: cW - 0.24, h: cH - 0.6,
      fontSize: 14, fontFace: "Calibri", color: BODYTEXT,
      align: "left", valign: "top", wrap: true, margin: 0,
    });
  });
}

// ─── Slide 7: Layer 2 – Weekly QA Audit (Wen as owner) ──────────────────────
{
  const sl = prs.addSlide();
  bar(sl);
  ttl(sl, "Layer 2 — Weekly QA Audit", { w: 6.8 });
  sub(sl, "Process review. Not performance review.");

  // Owner badge (top-right, stays within title row)
  sl.addShape(prs.ShapeType.rect, { x: 7.25, y: 0.15, w: 2.4, h: 0.46, fill: { color: ICE }, line: { type: "none" } });
  sl.addText("AUDIT OWNER: WEN", {
    x: 7.25, y: 0.15, w: 2.4, h: 0.46,
    fontSize: 13, bold: true, fontFace: "Arial Black", color: NAVY, align: "center", valign: "middle",
  });

  // Two sample boxes
  const boxes = [
    { label: "Promo Code", pct: "15%", eg: "e.g. 4–5 codes from 30" },
    { label: "Banner Upload", pct: "25%", eg: "e.g. 3 banners from 12" },
  ];
  boxes.forEach((b, i) => {
    const x = 0.35 + i * 4.8;
    sl.addShape(prs.ShapeType.rect, { x, y: 1.28, w: 4.4, h: 2.05, fill: { color: LIGHTBG }, line: { color: ICE, pt: 1 } });
    sl.addShape(prs.ShapeType.rect, { x, y: 1.28, w: 4.4, h: 0.5, fill: { color: NAVY }, line: { type: "none" } });
    sl.addText(b.label, { x, y: 1.28, w: 4.4, h: 0.5, fontSize: 18, bold: true, fontFace: "Arial Black", color: ICE, align: "center", valign: "middle" });
    sl.addText(b.pct, { x, y: 1.82, w: 4.4, h: 0.85, fontSize: 52, bold: true, fontFace: "Arial Black", color: NAVY, align: "center", valign: "middle" });
    sl.addText(b.eg, { x, y: 2.7, w: 4.4, h: 0.5, fontSize: 16, fontFace: "Calibri", italic: true, color: MUTED, align: "center" });
  });

  // Purpose row
  const purposes = ["Verify QC", "Detect patterns", "Improve process", "Track trends"];
  const pW = 2.13, gp = 0.17;
  purposes.forEach((p, i) => {
    const x = 0.35 + i * (pW + gp);
    sl.addShape(prs.ShapeType.rect, { x, y: 3.45, w: pW, h: 1.85, fill: { color: LIGHTBG }, line: { color: ICE, pt: 1 } });
    sl.addShape(prs.ShapeType.rect, { x, y: 3.45, w: pW, h: 0.38, fill: { color: ICE }, line: { type: "none" } });
    sl.addText(p, { x, y: 3.45, w: pW, h: 1.85, fontSize: 18, bold: true, fontFace: "Calibri", color: NAVY, align: "center", valign: "middle" });
  });
}

// ─── Slide 8: QA Audit Process ───────────────────────────────────────────────
{
  const sl = prs.addSlide();
  bar(sl);
  ttl(sl, "QA Audit Process");

  const cols2 = [
    { h: "PROMO CODES",    items: ["Request vs configuration", "Settings", "Games", "Activation dates", "Locales"] },
    { h: "BANNER UPLOADS", items: ["Dimensions", "Naming", "Upload structure"] },
  ];
  cols2.forEach((col, i) => {
    const x = 0.35 + i * 4.75;
    sl.addShape(prs.ShapeType.rect, { x, y: 1.0, w: 4.3, h: 0.58, fill: { color: NAVY }, line: { type: "none" } });
    sl.addText(col.h, { x, y: 1.0, w: 4.3, h: 0.58, fontSize: 18, bold: true, fontFace: "Arial Black", color: ICE, align: "center", valign: "middle" });
    sl.addShape(prs.ShapeType.rect, { x, y: 1.62, w: 4.3, h: 1.85, fill: { color: LIGHTBG }, line: { color: ICE, pt: 1 } });
    sl.addText(
      col.items.map((item, j) => ({ text: item, options: j < col.items.length - 1 ? { breakLine: true } : {} })),
      { x: x + 0.1, y: 1.62, w: 4.1, h: 1.85, fontSize: 16, fontFace: "Calibri", color: BODYTEXT, align: "left", valign: "top", bullet: { type: "bullet" }, margin: [10, 12, 10, 12] }
    );
  });

  const outcomes = [
    { icon: "✓", label: "PASS", desc: "No issue. Recorded. No action required.", bg: "2D6A4F", light: "F0FBF5" },
    { icon: "✗", label: "FAIL", desc: "Root cause identified: Human error / Checklist gap / Process issue / Automation issue → Corrective action assigned.", bg: "C0392B", light: "FDF3F2" },
  ];
  outcomes.forEach((o, i) => {
    const x = 0.35 + i * 4.75;
    sl.addShape(prs.ShapeType.rect, { x, y: 3.6, w: 4.3, h: 0.5, fill: { color: o.bg }, line: { type: "none" } });
    sl.addText(`${o.icon}  ${o.label}`, { x, y: 3.6, w: 4.3, h: 0.5, fontSize: 18, bold: true, fontFace: "Arial Black", color: WHITE, align: "center", valign: "middle" });
    sl.addShape(prs.ShapeType.rect, { x, y: 4.14, w: 4.3, h: 1.18, fill: { color: o.light }, line: { color: o.bg, pt: 1 } });
    sl.addText(o.desc, { x: x + 0.1, y: 4.14, w: 4.1, h: 1.18, fontSize: 15, fontFace: "Calibri", color: BODYTEXT, align: "left", valign: "top", margin: [8, 10, 8, 10], wrap: true });
  });
}

// ─── Slide 9: What Success Looks Like ───────────────────────────────────────
{
  const sl = prs.addSlide();
  bar(sl);
  ttl(sl, "What Success Looks Like");

  const stats = [
    { big: "95%+", sub: "Weekly Pass Rate" },
    { big: "↓ Trend", sub: "Recurring Issues" },
    { big: "Every gap\n→ a control", sub: "Checklist-driven improvement" },
  ];
  const bW = 2.8, bH = 2.6, gp = 0.3;
  const total = stats.length * bW + (stats.length - 1) * gp;
  const sx = (10 - total) / 2;
  stats.forEach((s, i) => {
    const x = sx + i * (bW + gp);
    sl.addShape(prs.ShapeType.rect, { x, y: 1.1, w: bW, h: bH, fill: { color: LIGHTBG }, line: { color: ICE, pt: 1.5 } });
    sl.addShape(prs.ShapeType.rect, { x, y: 1.1, w: bW, h: 0.07, fill: { color: NAVY }, line: { type: "none" } });
    sl.addText(s.big, { x, y: 1.2, w: bW, h: 1.6, fontSize: 44, bold: true, fontFace: "Arial Black", color: NAVY, align: "center", valign: "middle" });
    sl.addShape(prs.ShapeType.rect, { x, y: 2.85, w: bW, h: 0.05, fill: { color: ICE }, line: { type: "none" } });
    sl.addText(s.sub, { x, y: 2.95, w: bW, h: 0.55, fontSize: 18, fontFace: "Calibri", color: MUTED, align: "center" });
  });
}

// ─── Slide 10: Closing ───────────────────────────────────────────────────────
{
  const sl = prs.addSlide();
  sl.addShape(prs.ShapeType.rect, { x: 0, y: 0, w: "100%", h: "100%", fill: { color: NAVY }, line: { type: "none" } });
  sl.addShape(prs.ShapeType.rect, { x: 0, y: 0, w: 0.07, h: "100%", fill: { color: ICE }, line: { type: "none" } });
  sl.addText("Stronger ownership.\nLess unnecessary peer QC.\nConsistent quality. Measurable results.", {
    x: 0.6, y: 0.8, w: 8.8, h: 3.5,
    fontSize: 32, bold: true, fontFace: "Arial Black", color: WHITE, align: "left", valign: "top",
  });
  sl.addShape(prs.ShapeType.rect, { x: 0.6, y: 4.35, w: 2.8, h: 0.07, fill: { color: ICE }, line: { type: "none" } });
  sl.addText("Questions?", {
    x: 0.6, y: 4.55, w: 8.8, h: 0.65,
    fontSize: 24, fontFace: "Calibri", italic: true, color: ICE, align: "left",
  });
}

prs.writeFile({ fileName: "C:/Users/vdiuser/Downloads/QC_QA_Framework.pptx" })
  .then(() => console.log("Done: QC_QA_Framework.pptx"))
  .catch(e => { console.error(e); process.exit(1); });
