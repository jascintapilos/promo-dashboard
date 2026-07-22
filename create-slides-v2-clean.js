const PptxGenJS = require("pptxgenjs");

const prs = new PptxGenJS();

// Clean color palette
const colors = {
  primary: "#667eea",
  secondary: "#764ba2",
  white: "#ffffff",
  lightGray: "#f8f9fa",
  darkGray: "#2c3e50",
  tier1: "#27ae60",
  tier2: "#f39c12",
  tier3: "#e74c3c",
  border: "#ddd",
};

const fonts = {
  title: { size: 40, bold: true, color: colors.white },
  heading: { size: 28, bold: true, color: colors.primary },
  subheading: { size: 18, bold: true, color: colors.darkGray },
  body: { size: 13, color: colors.darkGray },
  small: { size: 11, color: "#666" },
};

function header(slide, title) {
  slide.background = { fill: colors.lightGray };
  const headerBox = slide.addShape(prs.ShapeType.rect, {
    x: 0, y: 0, w: "100%", h: 0.9,
    fill: { color: colors.primary },
    line: { type: "none" },
  });
  slide.addText(title, {
    x: 0.4, y: 0.25, w: 9.2, h: 0.5,
    fontSize: 28, bold: true, color: colors.white,
    fontFace: "Segoe UI", align: "left",
  });
}

// ===== SLIDE 1: COVER =====
const s1 = prs.addSlide();
s1.background = { fill: colors.primary };
s1.addShape(prs.ShapeType.rect, {
  x: 0, y: 2.5, w: "100%", h: 2.5,
  fill: { color: colors.secondary }, line: { type: "none" },
});
s1.addText("📋\nSales ↔ Promo Team\nEmpowerment", {
  x: 0.5, y: 1.5, w: 9, h: 1.8,
  fontSize: 44, bold: true, color: colors.white,
  fontFace: "Segoe UI", align: "center",
});
s1.addText("Complete Package to Reduce Bottlenecks & Enable Autonomy", {
  x: 0.5, y: 3.5, w: 9, h: 0.6,
  fontSize: 20, color: colors.white,
  fontFace: "Segoe UI", align: "center",
});
s1.addText("Created: 2026-06-09 | For: Jascinta, Wai Yip, Sales Team Lead", {
  x: 0.5, y: 4.3, w: 9, h: 0.8,
  fontSize: 13, color: colors.lightGray,
  fontFace: "Segoe UI", align: "center",
});

// ===== SLIDE 2: TOC =====
const s2 = prs.addSlide();
header(s2, "📖 What's Inside");
const tocItems = [
  "Gap Closure Summary",
  "Decision Framework (Tier 1/2/3)",
  "Routing Matrix",
  "Implementation Guide",
  "BO Training (5 Detailed Modules)",
  "Success Criteria",
];
let y = 1.3;
tocItems.forEach((item, idx) => {
  s2.addText(`${idx + 1}.  ${item}`, {
    x: 0.8, y: y, w: 8.5, h: 0.45,
    fontSize: 14, color: colors.darkGray,
    fontFace: "Segoe UI",
  });
  y += 0.75;
});

// ===== SLIDE 3: THE PROBLEM =====
const s3 = prs.addSlide();
header(s3, "🎯 The Problem");
s3.addShape(prs.ShapeType.rect, {
  x: 0.5, y: 1.2, w: 9, h: 0.05,
  fill: { color: colors.primary }, line: { type: "none" },
});

const problems = [
  { icon: "❌", text: "No BO access or training" },
  { icon: "❌", text: "Makes 10+ decisions/day → escalates everything" },
  { icon: "⏳", text: "2–3 hour wait for yes/no decisions" },
  { icon: "😰", text: "Wai Yip spends 20–25 hrs/week on routine Qs" },
  { icon: "🚧", text: "No decision framework or playbook" },
];

y = 1.6;
problems.forEach((p) => {
  s3.addText(p.icon, {
    x: 0.7, y: y, w: 0.4, h: 0.4,
    fontSize: 16, align: "center", valign: "middle",
  });
  s3.addText(p.text, {
    x: 1.3, y: y, w: 8.2, h: 0.4,
    fontSize: 13, color: colors.darkGray,
    fontFace: "Segoe UI",
  });
  y += 0.6;
});

s3.addShape(prs.ShapeType.rect, {
  x: 0.5, y: 4.8, w: 9, h: 1.8,
  fill: { color: "#fffbea" }, line: { color: "#f39c12", width: 2 },
});
s3.addText("✅ Solution: 4-week pilot to empower sales team lead with BO training + decision framework + weekly promo list", {
  x: 0.8, y: 5.0, w: 8.4, h: 1.4,
  fontSize: 13, bold: true, color: colors.darkGray,
  fontFace: "Segoe UI",
});

// ===== SLIDE 4: DECISION FRAMEWORK =====
const s4 = prs.addSlide();
header(s4, "🎯 Decision Framework: 3 Tiers");
s4.addShape(prs.ShapeType.rect, {
  x: 0.5, y: 1.2, w: 9, h: 0.05,
  fill: { color: colors.primary }, line: { type: "none" },
});

const tiers = [
  { title: "✅ TIER 1\nDecide Alone", color: colors.tier1, items: ["✓ Check promo", "✓ Verify tier", "✓ Check claims", "✓ Assign", "→ 80%+ decisions"], x: 0.5 },
  { title: "❓ TIER 2\nAsk #ba-promo", color: colors.tier2, items: ["✓ Create promo", "✓ Exceptions", "✓ Bulk assign", "✓ Uncertain", "→ 2–4 hrs"], x: 3.45 },
  { title: "🔴 TIER 3\nEscalate", color: colors.tier3, items: ["✓ Strategy", "✓ ROI/cost", "✓ Budget", "✓ High-level", "→ VERY RARE"], x: 6.4 },
];

tiers.forEach((tier) => {
  s4.addShape(prs.ShapeType.rect, {
    x: tier.x, y: 1.6, w: 2.95, h: 4.2,
    fill: { color: tier.color }, line: { type: "none" },
  });
  s4.addText(tier.title, {
    x: tier.x + 0.15, y: 1.85, w: 2.65, h: 0.7,
    fontSize: 13, bold: true, color: colors.white,
    fontFace: "Segoe UI", align: "center",
  });
  let itemY = 2.7;
  tier.items.forEach((item) => {
    s4.addText(item, {
      x: tier.x + 0.15, y: itemY, w: 2.65, h: 0.35,
      fontSize: 11, color: colors.white,
      fontFace: "Segoe UI", align: "center",
    });
    itemY += 0.48;
  });
});

// ===== SLIDE 5: ROUTING MATRIX =====
const s5 = prs.addSlide();
header(s5, "📊 Routing Matrix");
s5.addShape(prs.ShapeType.rect, {
  x: 0.5, y: 1.2, w: 9, h: 0.05,
  fill: { color: colors.primary }, line: { type: "none" },
});

// Self-serve box
s5.addShape(prs.ShapeType.rect, {
  x: 0.5, y: 1.5, w: 4.3, h: 0.4,
  fill: { color: colors.tier1 }, line: { type: "none" },
});
s5.addText("✅ SELF-SERVE (4 Brands)", {
  x: 0.65, y: 1.55, w: 4, h: 0.3,
  fontSize: 12, bold: true, color: colors.white,
  fontFace: "Segoe UI",
});
s5.addShape(prs.ShapeType.rect, {
  x: 0.5, y: 1.95, w: 4.3, h: 2.8,
  fill: { color: "#ecf0f1" }, line: { color: colors.tier1, width: 1.5 },
});
s5.addText("✅ WS1\n✅ WS2\n✅ QPRO1\n✅ QP2A\n\nDirect assignment\nImmediate", {
  x: 0.8, y: 2.2, w: 3.7, h: 2.3,
  fontSize: 13, bold: true, color: colors.darkGray,
  fontFace: "Segoe UI", align: "center",
});

// Promo team box
s5.addShape(prs.ShapeType.rect, {
  x: 5.2, y: 1.5, w: 4.3, h: 0.4,
  fill: { color: colors.tier3 }, line: { type: "none" },
});
s5.addText("❌ PROMO TEAM (26 Brands)", {
  x: 5.35, y: 1.55, w: 4, h: 0.3,
  fontSize: 12, bold: true, color: colors.white,
  fontFace: "Segoe UI",
});
s5.addShape(prs.ShapeType.rect, {
  x: 5.2, y: 1.95, w: 4.3, h: 2.8,
  fill: { color: "#ecf0f1" }, line: { color: colors.tier3, width: 1.5 },
});
s5.addText("❌ QPRO2–19\n❌ QP2B/C/D\n\nPost in\n#ba-promo\n1–2 hours", {
  x: 5.5, y: 2.2, w: 3.7, h: 2.3,
  fontSize: 13, bold: true, color: colors.darkGray,
  fontFace: "Segoe UI", align: "center",
});

s5.addShape(prs.ShapeType.rect, {
  x: 0.5, y: 4.9, w: 9, h: 0.6,
  fill: { color: colors.primary }, line: { type: "none" },
});
s5.addText("Menu Paths: QPRO 3.2 | QP2 2.1 | WS1/WS2 iGMP 3.1/3.3/3.15", {
  x: 0.7, y: 5.05, w: 8.6, h: 0.3,
  fontSize: 12, bold: true, color: colors.white,
  fontFace: "Segoe UI", align: "center",
});

// ===== SLIDE 6: TIMELINE =====
const s6 = prs.addSlide();
header(s6, "🚀 4-Week Implementation");
s6.addShape(prs.ShapeType.rect, {
  x: 0.5, y: 1.2, w: 9, h: 0.05,
  fill: { color: colors.primary }, line: { type: "none" },
});

const phases = [
  { week: "Week 1", title: "Training", items: ["Framework talk", "BO Training (4–6h)", "Live shadow"] },
  { week: "Week 2–3", title: "Supervised", items: ["Make decisions", "Weekly spot-checks", "Coaching"] },
  { week: "Week 4", title: "Autonomous", items: ["Full autonomy", "Final assessment", "Success!"] },
];

let xPos = 0.5;
phases.forEach((phase) => {
  s6.addShape(prs.ShapeType.rect, {
    x: xPos, y: 1.6, w: 2.95, h: 3.6,
    fill: { color: "#f8f9fa" }, line: { color: colors.primary, width: 2 },
  });
  s6.addText(phase.week, {
    x: xPos + 0.15, y: 1.8, w: 2.65, h: 0.35,
    fontSize: 11, bold: true, color: colors.primary,
    fontFace: "Segoe UI",
  });
  s6.addText(phase.title, {
    x: xPos + 0.15, y: 2.2, w: 2.65, h: 0.35,
    fontSize: 14, bold: true, color: colors.darkGray,
    fontFace: "Segoe UI",
  });
  let itemY = 2.7;
  phase.items.forEach((item) => {
    s6.addText("• " + item, {
      x: xPos + 0.25, y: itemY, w: 2.45, h: 0.45,
      fontSize: 11, color: colors.darkGray,
      fontFace: "Segoe UI",
    });
    itemY += 0.55;
  });
  xPos += 3.15;
});

// ===== SLIDE 7: MODULE OVERVIEW =====
const s7 = prs.addSlide();
header(s7, "📚 BO Training: 5 Modules");
s7.addShape(prs.ShapeType.rect, {
  x: 0.5, y: 1.2, w: 9, h: 0.05,
  fill: { color: colors.primary }, line: { type: "none" },
});

const modules = [
  { n: "1", emoji: "🔓", name: "Login & Navigation", time: "30–45 min" },
  { n: "2", emoji: "🔍", name: "Query Promos by Brand", time: "1–1.5 hrs" },
  { n: "3", emoji: "📋", name: "Check Promo Details", time: "1 hr" },
  { n: "4", emoji: "📊", name: "Check Player Claims", time: "45 min" },
  { n: "5", emoji: "✅", name: "Assign Promos in BO", time: "1–1.5 hrs" },
];

y = 1.6;
modules.forEach((mod) => {
  s7.addShape(prs.ShapeType.rect, {
    x: 0.5, y: y, w: 9, h: 0.5,
    fill: { color: y === 1.6 ? colors.primary : "#f8f9fa" },
    line: { color: colors.primary, width: y === 1.6 ? 0 : 1 },
  });
  s7.addText(mod.emoji + " Module " + mod.n, {
    x: 0.75, y: y + 0.08, w: 2, h: 0.35,
    fontSize: 12, bold: true, color: y === 1.6 ? colors.white : colors.primary,
    fontFace: "Segoe UI",
  });
  s7.addText(mod.name, {
    x: 2.95, y: y + 0.08, w: 4.3, h: 0.35,
    fontSize: 12, bold: true, color: y === 1.6 ? colors.white : colors.darkGray,
    fontFace: "Segoe UI",
  });
  s7.addText(mod.time, {
    x: 7.5, y: y + 0.08, w: 1.95, h: 0.35,
    fontSize: 11, color: y === 1.6 ? colors.white : colors.darkGray,
    fontFace: "Segoe UI", align: "right",
  });
  y += 0.65;
});

// ===== SLIDE 8: MODULE 1 =====
const s8 = prs.addSlide();
header(s8, "🔓 Module 1: Login & Navigation");
s8.addShape(prs.ShapeType.rect, {
  x: 0.5, y: 1.2, w: 9, h: 0.05,
  fill: { color: colors.primary }, line: { type: "none" },
});

const loginData = [
  [{ text: "Platform", options: { bold: true, color: colors.white, fill: colors.primary } },
   { text: "Credential", options: { bold: true, color: colors.white, fill: colors.primary } },
   { text: "Menu Path", options: { bold: true, color: colors.white, fill: colors.primary } }],
  [{ text: "QPRO" }, { text: "promo_testbot" }, { text: "Menu 3.2" }],
  [{ text: "QP2" }, { text: "promo_testbot" }, { text: "Menu 2.1" }],
  [{ text: "WS1/WS2" }, { text: "FastTrack CRM" }, { text: "Promos" }],
];

s8.addTable(loginData, {
  x: 0.7, y: 1.5, w: 8.6, h: 1.6,
  border: { pt: 1, color: colors.border },
  rowH: [0.4, 0.4, 0.4, 0.4],
  align: "center", valign: "middle",
  fontSize: 12, fontFace: "Segoe UI",
});

s8.addShape(prs.ShapeType.rect, {
  x: 0.5, y: 3.3, w: 9, h: 2.2,
  fill: { color: "#ecf7ff" }, line: { color: colors.primary, width: 1 },
});
s8.addText("✓ Get credentials from Jascinta before starting\n\nSteps:\n1. Navigate to the URL\n2. Enter credentials (promo_testbot)\n3. Click Login\n4. See Dashboard\n\nPractice: Log in to QPRO BO, find Menu 3.2, navigate structure", {
  x: 0.8, y: 3.5, w: 8.4, h: 1.9,
  fontSize: 12, color: colors.darkGray,
  fontFace: "Segoe UI",
});

// ===== SLIDE 9: MODULE 2 =====
const s9 = prs.addSlide();
header(s9, "🔍 Module 2: Query Promos by Brand");
s9.addShape(prs.ShapeType.rect, {
  x: 0.5, y: 1.2, w: 9, h: 0.05,
  fill: { color: colors.primary }, line: { type: "none" },
});

const querySteps = [
  "1. Navigate to Menu 3.2 (QPRO) or 2.1 (QP2)",
  "2. Filter by Brand or Platform",
  "3. Look for Status = ACTIVE (not Inactive/Archived)",
  "4. Read columns: Code, Name, Type, Status, Valid Until",
  "5. Note down codes you can offer to players",
];

y = 1.5;
querySteps.forEach((step) => {
  s9.addText(step, {
    x: 0.8, y: y, w: 8.4, h: 0.4,
    fontSize: 12, color: colors.darkGray,
    fontFace: "Segoe UI",
  });
  y += 0.55;
});

s9.addShape(prs.ShapeType.rect, {
  x: 0.5, y: 4.3, w: 9, h: 1.5,
  fill: { color: "#ecf7ff" }, line: { color: colors.primary, width: 1 },
});
s9.addText("✓ Practice: Query QPRO1 for Deposit bonuses. Find 3 active codes and write them down.", {
  x: 0.8, y: 4.5, w: 8.4, h: 1.1,
  fontSize: 12, bold: true, color: colors.darkGray,
  fontFace: "Segoe UI",
});

// ===== SLIDE 10: MODULE 3 =====
const s10 = prs.addSlide();
header(s10, "📋 Module 3: Check Promo Details");
s10.addShape(prs.ShapeType.rect, {
  x: 0.5, y: 1.2, w: 9, h: 0.05,
  fill: { color: colors.primary }, line: { type: "none" },
});

const details = [
  "💰 Amount: 100% match up to MYR 500",
  "🎮 Turnover: 8x (must wager 8× bonus amount)",
  "👥 Eligible Tier: Gold, Platinum, Diamond",
  "📅 Valid Until: 2026-06-30",
  "📊 Remaining Quota: 27 claims left",
];

y = 1.5;
details.forEach((d) => {
  s10.addText(d, {
    x: 0.8, y: y, w: 8.4, h: 0.35,
    fontSize: 12, color: colors.darkGray,
    fontFace: "Segoe UI",
  });
  y += 0.48;
});

s10.addShape(prs.ShapeType.rect, {
  x: 0.5, y: 3.8, w: 9, h: 1.9,
  fill: { color: "#ffe8e8" }, line: { color: colors.tier3, width: 1 },
});
s10.addText("⚠️ Red Flags to Watch:\n• Turnover >20x? → Ask in #ba-promo\n• Expired date? → Don't offer\n• No quota left? → Offer alternative promo", {
  x: 0.8, y: 3.95, w: 8.4, h: 1.6,
  fontSize: 11, color: colors.darkGray,
  fontFace: "Segoe UI",
});

// ===== SLIDE 11: MODULE 4 =====
const s11 = prs.addSlide();
header(s11, "📊 Module 4: Check Player Claim History");
s11.addShape(prs.ShapeType.rect, {
  x: 0.5, y: 1.2, w: 9, h: 0.05,
  fill: { color: colors.primary }, line: { type: "none" },
});

const claimData = [
  [{ text: "Player", options: { bold: true, color: colors.white, fill: colors.primary } },
   { text: "Date Claimed", options: { bold: true, color: colors.white, fill: colors.primary } },
   { text: "Decision", options: { bold: true, color: colors.white, fill: colors.primary } }],
  [{ text: "John" }, { text: "2026-06-05 (4 days ago)" }, { text: "❌ Too recent" }],
  [{ text: "Jane" }, { text: "Never claimed" }, { text: "✅ Offer it" }],
  [{ text: "Bob" }, { text: "2026-05-05 (35 days)" }, { text: "✅ Old enough" }],
];

s11.addTable(claimData, {
  x: 0.7, y: 1.5, w: 8.6, h: 1.5,
  border: { pt: 1, color: colors.border },
  rowH: [0.4, 0.38, 0.38, 0.38],
  align: "center", valign: "middle",
  fontSize: 12, fontFace: "Segoe UI",
});

s11.addShape(prs.ShapeType.rect, {
  x: 0.5, y: 3.2, w: 9, h: 2.4,
  fill: { color: "#ecf7ff" }, line: { color: colors.primary, width: 1 },
});
s11.addText("Rule: If player claimed <30 days ago → Ask in #ba-promo before offering again\n\nHow to check:\n1. Click on the promo in BO\n2. Scroll to 'Claim History' section\n3. Search for player name/ID\n4. See when they last claimed\n\nPractice: Check history for 3 players. Determine if they can claim.", {
  x: 0.8, y: 3.35, w: 8.4, h: 2.15,
  fontSize: 11, color: colors.darkGray,
  fontFace: "Segoe UI",
});

// ===== SLIDE 12: MODULE 5 =====
const s12 = prs.addSlide();
header(s12, "✅ Module 5: Assign Promos in BO");
s12.addShape(prs.ShapeType.rect, {
  x: 0.5, y: 1.2, w: 9, h: 0.05,
  fill: { color: colors.primary }, line: { type: "none" },
});

s12.addShape(prs.ShapeType.rect, {
  x: 0.5, y: 1.4, w: 9, h: 0.4,
  fill: { color: colors.tier1 }, line: { type: "none" },
});
s12.addText("✅ Self-Serve Brands (You can assign): WS1/WS2 (FastTrack) | QPRO1 (BO) | QP2A (BO)", {
  x: 0.8, y: 1.47, w: 8.4, h: 0.25,
  fontSize: 11, bold: true, color: colors.white,
  fontFace: "Segoe UI",
});

const assignSteps = [
  "1. Navigate to promo → Click 'Assign to Player'",
  "2. Fill form: Player Name/ID, Promo Code, Bonus Amount",
  "3. Review ALL fields before submitting (no typos!)",
  "4. Click ASSIGN → Wait for confirmation message",
  "5. Screenshot confirmation for your records",
];

y = 2.0;
assignSteps.forEach((step) => {
  s12.addText(step, {
    x: 0.8, y: y, w: 8.4, h: 0.4,
    fontSize: 12, color: colors.darkGray,
    fontFace: "Segoe UI",
  });
  y += 0.52;
});

s12.addShape(prs.ShapeType.rect, {
  x: 0.5, y: 4.8, w: 9, h: 0.7,
  fill: { color: colors.tier2 }, line: { type: "none" },
});
s12.addText("Other Brands? → POST IN #ba-promo (Promo team assigns in 1–2 hours)", {
  x: 0.8, y: 4.95, w: 8.4, h: 0.4,
  fontSize: 12, bold: true, color: colors.white,
  fontFace: "Segoe UI", align: "center",
});

// ===== SLIDE 13: SUCCESS =====
const s13 = prs.addSlide();
header(s13, "🎯 Success Criteria (Jul 9)");
s13.addShape(prs.ShapeType.rect, {
  x: 0.5, y: 1.2, w: 9, h: 0.05,
  fill: { color: colors.primary }, line: { type: "none" },
});

const criteria = [
  "☑️ Sales lead makes Tier 1 decisions (≥80% of routine questions)",
  "☑️ Zero Tier 1/2 questions escalated to Wai Yip",
  "☑️ Wai Yip receives <2 Tier 3 escalations per week",
  "☑️ Weekly Active Promo List used consistently by sales team",
  "☑️ Sales lead explains 5 Shared Principles from memory",
  "☑️ #ba-promo becomes default Q&A channel (not DMs to Wai Yip)",
];

y = 1.6;
criteria.forEach((c) => {
  s13.addText(c, {
    x: 0.8, y: y, w: 8.4, h: 0.48,
    fontSize: 12, color: colors.darkGray,
    fontFace: "Segoe UI",
  });
  y += 0.65;
});

// ===== SLIDE 14: QUICK START =====
const s14 = prs.addSlide();
s14.background = { fill: colors.primary };
s14.addText("⚡ Quick Start", {
  x: 0.4, y: 0.4, w: 9.2, h: 0.5,
  fontSize: 32, bold: true, color: colors.white,
  fontFace: "Segoe UI",
});

const qs = [
  { n: "1", l: "TODAY", d: "Share Gap Summary → Get Wai Yip's buy-in" },
  { n: "2", l: "JUN 10–11", d: "Prep training schedule + Decision Framework" },
  { n: "3", l: "JUN 12", d: "Kickoff: Framework talk + BO Training (1 day)" },
  { n: "4", l: "JUN 13–JUL 9", d: "4-week pilot: Autonomy → Success!" },
];

y = 1.3;
qs.forEach((q) => {
  s14.addShape(prs.ShapeType.ellipse, {
    x: 0.6, y: y - 0.08, w: 0.35, h: 0.35,
    fill: { color: colors.white }, line: { type: "none" },
  });
  s14.addText(q.n, {
    x: 0.6, y: y - 0.08, w: 0.35, h: 0.35,
    fontSize: 14, bold: true, color: colors.primary,
    align: "center", valign: "middle",
  });
  s14.addText(q.l, {
    x: 1.15, y: y - 0.05, w: 1.2, h: 0.25,
    fontSize: 10, bold: true, color: colors.white,
    fontFace: "Segoe UI",
  });
  s14.addText(q.d, {
    x: 2.5, y: y - 0.05, w: 6.9, h: 0.25,
    fontSize: 10, color: colors.white,
    fontFace: "Segoe UI",
  });
  y += 0.75;
});

s14.addText("Questions? Slack: Jascinta | v1.0", {
  x: 0.4, y: 6.7, w: 9.2, h: 0.4,
  fontSize: 11, color: colors.lightGray,
  align: "center",
  fontFace: "Segoe UI",
});

// Save
prs.writeFile({
  fileName: "C:\\Users\\vdiuser\\Downloads\\promo-automation\\empowerment-package-v2-clean.pptx",
});

console.log("✅ Clean, Professional Presentation Created!");
console.log("📁 empowerment-package-v2-clean.pptx");
console.log("\n✨ Improvements:");
console.log("   • Better spacing & padding");
console.log("   • Proper text alignment");
console.log("   • Clean box styling with borders");
console.log("   • Improved color contrast");
console.log("   • Professional hierarchy");
console.log("   • Aligned tables & content");
