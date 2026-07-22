const PptxGenJS = require("pptxgenjs");

const prs = new PptxGenJS();

// Color scheme
const colors = {
  primary: "#667eea",
  secondary: "#764ba2",
  accent: "#f5f5f5",
  white: "#ffffff",
  tier1: "#28a745",
  tier2: "#ffc107",
  tier3: "#dc3545",
  text: "#333333",
  lightText: "#666666",
};

const fontSize = {
  title: 44,
  heading: 28,
  subheading: 20,
  body: 14,
  small: 12,
};

function addGradientBg(slide) {
  slide.background = { fill: colors.primary };
}

// SLIDE 1: COVER PAGE
const s1 = prs.addSlide();
addGradientBg(s1);
s1.addText("📋 Sales ↔ Promo Team\nEmpowerment", {
  x: 0.5,
  y: 2,
  w: 9,
  h: 1.5,
  fontSize: fontSize.title,
  bold: true,
  color: colors.white,
  align: "center",
  fontFace: "Segoe UI",
});
s1.addText("Complete Package to Reduce Bottlenecks & Enable Autonomy", {
  x: 0.5,
  y: 3.6,
  w: 9,
  h: 0.6,
  fontSize: fontSize.subheading,
  color: colors.white,
  align: "center",
  fontFace: "Segoe UI",
});
s1.addText(
  "Created: 2026-06-09 | For: Jascinta, Wai Yip, Sales Team Lead | Goal: 80% autonomy by Jul 9",
  {
    x: 0.5,
    y: 5,
    w: 9,
    h: 1.5,
    fontSize: fontSize.body,
    color: colors.white,
    align: "center",
    fontFace: "Segoe UI",
  }
);

// SLIDE 2: TABLE OF CONTENTS
const s2 = prs.addSlide();
s2.background = { fill: colors.white };
s2.addText("📖 What's Inside", {
  x: 0.5,
  y: 0.4,
  w: 9,
  h: 0.6,
  fontSize: fontSize.heading,
  bold: true,
  color: colors.primary,
  fontFace: "Segoe UI",
});
s2.addShape(prs.ShapeType.rect, {
  x: 0.5,
  y: 1.0,
  w: 9,
  h: 0.04,
  fill: { color: colors.primary },
  line: { type: "none" },
});
const tocItems = [
  "1. Gap Closure Summary",
  "2. Decision Framework (Tier 1/2/3)",
  "3. Routing Matrix",
  "4. Implementation Guide",
  "5. BO Training (5 detailed modules)",
  "6. Success Criteria",
];
let yPos = 1.5;
tocItems.forEach((item) => {
  s2.addText("→  " + item, {
    x: 1,
    y: yPos,
    w: 8.5,
    h: 0.5,
    fontSize: fontSize.body,
    color: colors.text,
    fontFace: "Segoe UI",
  });
  yPos += 0.65;
});

// SLIDE 3: GAP CLOSURE
const s3 = prs.addSlide();
s3.background = { fill: colors.white };
s3.addText("🎯 The Problem", {
  x: 0.5,
  y: 0.4,
  w: 9,
  h: 0.6,
  fontSize: fontSize.heading,
  bold: true,
  color: colors.primary,
  fontFace: "Segoe UI",
});
s3.addShape(prs.ShapeType.rect, {
  x: 0.5,
  y: 1.0,
  w: 9,
  h: 0.04,
  fill: { color: colors.primary },
  line: { type: "none" },
});
const problems = [
  "❌ No BO access or training",
  "❌ Makes 10+ decisions/day → escalates EVERYTHING",
  "⏳ 2–3 hour wait for yes/no decisions",
  "😰 Wai Yip spends 20–25 hrs/week on routine Qs",
  "🚧 No decision framework or playbook",
];
yPos = 1.5;
problems.forEach((item) => {
  s3.addText(item, {
    x: 1,
    y: yPos,
    w: 8.5,
    h: 0.45,
    fontSize: fontSize.body,
    color: colors.text,
    fontFace: "Segoe UI",
  });
  yPos += 0.7;
});
s3.addShape(prs.ShapeType.rect, {
  x: 0.5,
  y: 5.2,
  w: 9,
  h: 1.5,
  fill: { color: "#fff3cd" },
  line: { color: "#ffc107", width: 2 },
});
s3.addText(
  "✅ Solution: 4-week pilot to empower sales team lead with BO training + decision framework + weekly promo list",
  {
    x: 0.8,
    y: 5.4,
    w: 8.4,
    h: 1.1,
    fontSize: fontSize.body,
    bold: true,
    color: colors.text,
    fontFace: "Segoe UI",
  }
);

// SLIDE 4: DECISION FRAMEWORK
const s4 = prs.addSlide();
s4.background = { fill: colors.white };
s4.addText("🎯 Decision Framework: 3 Tiers", {
  x: 0.5,
  y: 0.4,
  w: 9,
  h: 0.6,
  fontSize: fontSize.heading,
  bold: true,
  color: colors.primary,
  fontFace: "Segoe UI",
});
s4.addShape(prs.ShapeType.rect, {
  x: 0.5,
  y: 1.0,
  w: 9,
  h: 0.04,
  fill: { color: colors.primary },
  line: { type: "none" },
});

// Tier boxes
s4.addShape(prs.ShapeType.rect, {
  x: 0.5,
  y: 1.5,
  w: 2.8,
  h: 4.5,
  fill: { color: colors.tier1 },
  line: { type: "none" },
});
s4.addText("✅ TIER 1\nDecide Alone", {
  x: 0.7,
  y: 1.9,
  w: 2.4,
  h: 0.9,
  fontSize: 16,
  bold: true,
  color: colors.white,
  fontFace: "Segoe UI",
});
s4.addText("✓ Check promo\n✓ Verify tier\n✓ Check claims\n✓ Assign\n\n80%+ decisions", {
  x: 0.7,
  y: 3,
  w: 2.4,
  h: 2.7,
  fontSize: 11,
  color: colors.white,
  fontFace: "Segoe UI",
});

s4.addShape(prs.ShapeType.rect, {
  x: 3.6,
  y: 1.5,
  w: 2.8,
  h: 4.5,
  fill: { color: colors.tier2 },
  line: { type: "none" },
});
s4.addText("❓ TIER 2\nAsk #ba-promo", {
  x: 3.8,
  y: 1.9,
  w: 2.4,
  h: 0.9,
  fontSize: 16,
  bold: true,
  color: "#333",
  fontFace: "Segoe UI",
});
s4.addText("✓ Create promo\n✓ Exceptions\n✓ Bulk assign\n✓ Uncertain\n\n2–4 hrs", {
  x: 3.8,
  y: 3,
  w: 2.4,
  h: 2.7,
  fontSize: 11,
  color: "#333",
  fontFace: "Segoe UI",
});

s4.addShape(prs.ShapeType.rect, {
  x: 6.7,
  y: 1.5,
  w: 2.8,
  h: 4.5,
  fill: { color: colors.tier3 },
  line: { type: "none" },
});
s4.addText("🔴 TIER 3\nEscalate", {
  x: 6.9,
  y: 1.9,
  w: 2.4,
  h: 0.9,
  fontSize: 16,
  bold: true,
  color: colors.white,
  fontFace: "Segoe UI",
});
s4.addText("✓ Strategy\n✓ ROI / cost\n✓ Budget\n✓ High-level\n\nVERY RARE", {
  x: 6.9,
  y: 3,
  w: 2.4,
  h: 2.7,
  fontSize: 11,
  color: colors.white,
  fontFace: "Segoe UI",
});

// SLIDE 5: ROUTING MATRIX
const s5 = prs.addSlide();
s5.background = { fill: colors.white };
s5.addText("📊 Routing Matrix", {
  x: 0.5,
  y: 0.4,
  w: 9,
  h: 0.6,
  fontSize: fontSize.heading,
  bold: true,
  color: colors.primary,
  fontFace: "Segoe UI",
});
s5.addShape(prs.ShapeType.rect, {
  x: 0.5,
  y: 1.0,
  w: 9,
  h: 0.04,
  fill: { color: colors.primary },
  line: { type: "none" },
});

s5.addText("Self-Serve (4 Brands)", {
  x: 0.5,
  y: 1.3,
  w: 4.5,
  h: 0.4,
  fontSize: fontSize.subheading,
  bold: true,
  color: colors.tier1,
  fontFace: "Segoe UI",
});
s5.addShape(prs.ShapeType.rect, {
  x: 0.5,
  y: 1.8,
  w: 4.5,
  h: 2,
  fill: { color: colors.tier1 },
  line: { type: "none" },
});
s5.addText("✅ WS1\n✅ WS2\n✅ QPRO1\n✅ QP2A", {
  x: 0.7,
  y: 2,
  w: 4.1,
  h: 1.7,
  fontSize: 16,
  bold: true,
  color: colors.white,
  fontFace: "Segoe UI",
});

s5.addText("Promo Team (26 Brands)", {
  x: 5.2,
  y: 1.3,
  w: 4.3,
  h: 0.4,
  fontSize: fontSize.subheading,
  bold: true,
  color: colors.tier3,
  fontFace: "Segoe UI",
});
s5.addShape(prs.ShapeType.rect, {
  x: 5.2,
  y: 1.8,
  w: 4.3,
  h: 2,
  fill: { color: colors.tier3 },
  line: { type: "none" },
});
s5.addText("❌ QPRO2–19\n❌ QP2B/C/D\n\nPost in\n#ba-promo\n1–2 hrs", {
  x: 5.4,
  y: 2,
  w: 3.9,
  h: 1.7,
  fontSize: 12,
  bold: true,
  color: colors.white,
  fontFace: "Segoe UI",
});

s5.addText("Menu: QPRO 3.2 | QP2 2.1 | WS1/WS2 iGMP 3.1/3.3/3.15", {
  x: 0.5,
  y: 4.2,
  w: 9,
  h: 1.3,
  fontSize: fontSize.body,
  color: colors.white,
  fill: colors.primary,
  align: "center",
  valign: "middle",
  fontFace: "Segoe UI",
});

// SLIDE 6: IMPLEMENTATION TIMELINE
const s6 = prs.addSlide();
s6.background = { fill: colors.white };
s6.addText("🚀 4-Week Implementation", {
  x: 0.5,
  y: 0.4,
  w: 9,
  h: 0.6,
  fontSize: fontSize.heading,
  bold: true,
  color: colors.primary,
  fontFace: "Segoe UI",
});
s6.addShape(prs.ShapeType.rect, {
  x: 0.5,
  y: 1.0,
  w: 9,
  h: 0.04,
  fill: { color: colors.primary },
  line: { type: "none" },
});

const phases = [
  { week: "Week 1", title: "Training", items: ["Framework talk", "BO Training", "Live shadow"] },
  { week: "Week 2–3", title: "Supervised", items: ["Make decisions", "Spot-checks", "Coaching"] },
  { week: "Week 4", title: "Autonomous", items: ["Full autonomy", "Final check", "Success!"] },
];

let xPos = 0.5;
phases.forEach((phase, idx) => {
  const bgColor = idx === 0 ? "#e3f2fd" : idx === 1 ? "#f3e5f5" : "#e8f5e9";
  s6.addShape(prs.ShapeType.rect, {
    x: xPos,
    y: 1.5,
    w: 2.95,
    h: 4.5,
    fill: { color: bgColor },
    line: { color: colors.primary, width: 2 },
  });
  s6.addText(phase.week, {
    x: xPos + 0.2,
    y: 1.7,
    w: 2.55,
    h: 0.35,
    fontSize: 11,
    bold: true,
    color: colors.primary,
    fontFace: "Segoe UI",
  });
  s6.addText(phase.title, {
    x: xPos + 0.2,
    y: 2.15,
    w: 2.55,
    h: 0.4,
    fontSize: 13,
    bold: true,
    color: colors.text,
    fontFace: "Segoe UI",
  });
  let itemY = 2.7;
  phase.items.forEach((item) => {
    s6.addText("• " + item, {
      x: xPos + 0.2,
      y: itemY,
      w: 2.55,
      h: 0.55,
      fontSize: 10,
      color: colors.text,
      fontFace: "Segoe UI",
    });
    itemY += 0.65;
  });
  xPos += 3.15;
});

// SLIDE 7: BO TRAINING OVERVIEW
const s7 = prs.addSlide();
s7.background = { fill: colors.white };
s7.addText("📚 BO Training: 5 Modules (4–6 hrs)", {
  x: 0.5,
  y: 0.4,
  w: 9,
  h: 0.6,
  fontSize: fontSize.heading,
  bold: true,
  color: colors.primary,
  fontFace: "Segoe UI",
});
s7.addShape(prs.ShapeType.rect, {
  x: 0.5,
  y: 1.0,
  w: 9,
  h: 0.04,
  fill: { color: colors.primary },
  line: { type: "none" },
});

const modules = [
  { emoji: "🔓", num: "1", title: "Login & Navigation", time: "30–45 min" },
  { emoji: "🔍", num: "2", title: "Query Promos by Brand", time: "1–1.5 hrs" },
  { emoji: "📋", num: "3", title: "Check Promo Details", time: "1 hr" },
  { emoji: "📊", num: "4", title: "Check Player Claims", time: "45 min" },
  { emoji: "✅", num: "5", title: "Assign Promos in BO", time: "1–1.5 hrs" },
];

yPos = 1.5;
modules.forEach((mod) => {
  s7.addText(mod.emoji + " MOD " + mod.num, {
    x: 0.7,
    y: yPos,
    w: 1.5,
    h: 0.45,
    fontSize: 12,
    bold: true,
    color: colors.primary,
    fontFace: "Segoe UI",
  });
  s7.addText(mod.title, {
    x: 2.4,
    y: yPos,
    w: 5,
    h: 0.45,
    fontSize: 12,
    bold: true,
    color: colors.text,
    fontFace: "Segoe UI",
  });
  s7.addText(mod.time, {
    x: 7.6,
    y: yPos,
    w: 1.8,
    h: 0.45,
    fontSize: 11,
    color: colors.lightText,
    align: "right",
    fontFace: "Segoe UI",
  });
  yPos += 0.85;
});

// SLIDE 8: MODULE 1 - LOGIN
const s8 = prs.addSlide();
s8.background = { fill: colors.white };
s8.addText("🔓 Module 1: Login & Navigation", {
  x: 0.5,
  y: 0.4,
  w: 9,
  h: 0.6,
  fontSize: fontSize.heading,
  bold: true,
  color: colors.primary,
  fontFace: "Segoe UI",
});
s8.addShape(prs.ShapeType.rect, {
  x: 0.5,
  y: 1.0,
  w: 9,
  h: 0.04,
  fill: { color: colors.primary },
  line: { type: "none" },
});

const loginTable = [
  [
    { text: "Platform", options: { bold: true, color: colors.white, fill: colors.primary } },
    { text: "Credential", options: { bold: true, color: colors.white, fill: colors.primary } },
    { text: "Menu Path", options: { bold: true, color: colors.white, fill: colors.primary } },
  ],
  [
    { text: "QPRO", options: {} },
    { text: "promo_testbot", options: {} },
    { text: "Menu 3.2", options: {} },
  ],
  [
    { text: "QP2", options: {} },
    { text: "promo_testbot", options: {} },
    { text: "Menu 2.1", options: {} },
  ],
  [
    { text: "WS1/WS2", options: {} },
    { text: "FastTrack CRM", options: {} },
    { text: "Promos", options: {} },
  ],
];

s8.addTable(loginTable, {
  x: 0.7,
  y: 1.6,
  w: 8.6,
  h: 1.8,
  border: { pt: 1, color: colors.primary },
  rowH: [0.45, 0.45, 0.45, 0.45],
  align: "center",
  valign: "middle",
  fontSize: 11,
  fontFace: "Segoe UI",
});

s8.addText("✓ Get credentials from Jascinta", {
  x: 0.7,
  y: 3.8,
  w: 8.6,
  h: 0.35,
  fontSize: fontSize.body,
  bold: true,
  color: colors.tier1,
  fontFace: "Segoe UI",
});

s8.addText("Steps: Navigate URL → Enter credentials → Click Login → See Dashboard", {
  x: 0.7,
  y: 4.3,
  w: 8.6,
  h: 0.5,
  fontSize: fontSize.body,
  bold: true,
  color: colors.tier1,
  fontFace: "Segoe UI",
});

s8.addShape(prs.ShapeType.rect, {
  x: 0.5,
  y: 5.2,
  w: 9,
  h: 1.5,
  fill: { color: "#f0f7ff" },
  line: { color: colors.primary, width: 1 },
});
s8.addText("Practice: Log into QPRO BO, find Menu 3.2 (Promotion Codes), navigate the menu structure", {
  x: 0.7,
  y: 5.4,
  w: 8.6,
  h: 1.1,
  fontSize: fontSize.body,
  color: colors.text,
  fontFace: "Segoe UI",
});

// SLIDE 9: MODULE 2 - QUERY
const s9 = prs.addSlide();
s9.background = { fill: colors.white };
s9.addText("🔍 Module 2: Query Promos by Brand", {
  x: 0.5,
  y: 0.4,
  w: 9,
  h: 0.6,
  fontSize: fontSize.heading,
  bold: true,
  color: colors.primary,
  fontFace: "Segoe UI",
});
s9.addShape(prs.ShapeType.rect, {
  x: 0.5,
  y: 1.0,
  w: 9,
  h: 0.04,
  fill: { color: colors.primary },
  line: { type: "none" },
});

const querySteps = [
  "1. Navigate to Menu 3.2 (QPRO) or 2.1 (QP2)",
  "2. Filter by Brand or Platform",
  "3. Look for Status = ACTIVE (not Inactive/Archived)",
  "4. Read: Code, Name, Type, Status, Valid Until",
  "5. Note down codes you can offer",
];

yPos = 1.7;
querySteps.forEach((step) => {
  s9.addText(step, {
    x: 0.8,
    y: yPos,
    w: 8.4,
    h: 0.42,
    fontSize: fontSize.body,
    color: colors.text,
    fontFace: "Segoe UI",
  });
  yPos += 0.55;
});

s9.addShape(prs.ShapeType.rect, {
  x: 0.5,
  y: 4.5,
  w: 9,
  h: 2,
  fill: { color: "#f0f7ff" },
  line: { color: colors.primary, width: 1 },
});
s9.addText("Practice: Query QPRO1 for Deposit bonuses. Find 3 active codes. Write them down.", {
  x: 0.7,
  y: 4.7,
  w: 8.6,
  h: 1.6,
  fontSize: fontSize.body,
  bold: true,
  color: colors.text,
  fontFace: "Segoe UI",
});

// SLIDE 10: MODULE 3 - DETAILS
const s10 = prs.addSlide();
s10.background = { fill: colors.white };
s10.addText("📋 Module 3: Check Promo Details", {
  x: 0.5,
  y: 0.4,
  w: 9,
  h: 0.6,
  fontSize: fontSize.heading,
  bold: true,
  color: colors.primary,
  fontFace: "Segoe UI",
});
s10.addShape(prs.ShapeType.rect, {
  x: 0.5,
  y: 1.0,
  w: 9,
  h: 0.04,
  fill: { color: colors.primary },
  line: { type: "none" },
});

const detailItems = [
  "💰 Amount: 100% match up to MYR 500",
  "🎮 Turnover: 8x (wager 8× bonus)",
  "👥 Eligible Tier: Gold, Platinum, Diamond",
  "📅 Valid Until: 2026-06-30",
  "📊 Remaining Quota: 27 claims left",
];

yPos = 1.7;
detailItems.forEach((item) => {
  s10.addText(item, {
    x: 0.8,
    y: yPos,
    w: 8.4,
    h: 0.42,
    fontSize: fontSize.body,
    color: colors.text,
    fontFace: "Segoe UI",
  });
  yPos += 0.55;
});

s10.addText("Red Flags:", {
  x: 0.5,
  y: 4.5,
  w: 9,
  h: 0.3,
  fontSize: fontSize.body,
  bold: true,
  color: colors.tier3,
  fontFace: "Segoe UI",
});

const redFlags = [
  "⚠️ Turnover >20x? → Ask #ba-promo",
  "⚠️ Expired date? → Don't offer",
  "⚠️ No quota left? → Archive, offer alternative",
];

yPos = 4.9;
redFlags.forEach((flag) => {
  s10.addText(flag, {
    x: 0.8,
    y: yPos,
    w: 8.4,
    h: 0.4,
    fontSize: fontSize.body,
    color: colors.tier3,
    fontFace: "Segoe UI",
  });
  yPos += 0.5;
});

// SLIDE 11: MODULE 4 - CLAIMS
const s11 = prs.addSlide();
s11.background = { fill: colors.white };
s11.addText("📊 Module 4: Check Player Claim History", {
  x: 0.5,
  y: 0.4,
  w: 9,
  h: 0.6,
  fontSize: fontSize.heading,
  bold: true,
  color: colors.primary,
  fontFace: "Segoe UI",
});
s11.addShape(prs.ShapeType.rect, {
  x: 0.5,
  y: 1.0,
  w: 9,
  h: 0.04,
  fill: { color: colors.primary },
  line: { type: "none" },
});

const claimTable = [
  [
    {
      text: "Player",
      options: { bold: true, color: colors.white, fill: colors.primary },
    },
    {
      text: "Date Claimed",
      options: { bold: true, color: colors.white, fill: colors.primary },
    },
    {
      text: "Decision",
      options: { bold: true, color: colors.white, fill: colors.primary },
    },
  ],
  [
    { text: "John", options: {} },
    { text: "2026-06-05 (4 days ago)", options: {} },
    { text: "❌ Too recent", options: { color: colors.tier3, bold: true } },
  ],
  [
    { text: "Jane", options: {} },
    { text: "Never claimed", options: {} },
    { text: "✅ Offer it", options: { color: colors.tier1, bold: true } },
  ],
  [
    { text: "Bob", options: {} },
    { text: "2026-05-05 (35 days)", options: {} },
    { text: "✅ Old enough", options: { color: colors.tier1, bold: true } },
  ],
];

s11.addTable(claimTable, {
  x: 0.7,
  y: 1.6,
  w: 8.6,
  h: 2,
  border: { pt: 1, color: colors.primary },
  rowH: [0.45, 0.48, 0.48, 0.48],
  align: "center",
  valign: "middle",
  fontSize: 11,
  fontFace: "Segoe UI",
});

s11.addText("Rule: If claimed <30 days ago → Ask #ba-promo before offering", {
  x: 0.7,
  y: 3.9,
  w: 8.6,
  h: 0.5,
  fontSize: fontSize.body,
  bold: true,
  color: colors.tier3,
  fontFace: "Segoe UI",
});

s11.addShape(prs.ShapeType.rect, {
  x: 0.5,
  y: 4.7,
  w: 9,
  h: 2,
  fill: { color: "#f0f7ff" },
  line: { color: colors.primary, width: 1 },
});
s11.addText("Practice: Check claim history for 3 players. Determine if they can claim a promo.", {
  x: 0.7,
  y: 4.9,
  w: 8.6,
  h: 1.6,
  fontSize: fontSize.body,
  bold: true,
  color: colors.text,
  fontFace: "Segoe UI",
});

// SLIDE 12: MODULE 5 - ASSIGN
const s12 = prs.addSlide();
s12.background = { fill: colors.white };
s12.addText("✅ Module 5: Assign Promos in BO", {
  x: 0.5,
  y: 0.4,
  w: 9,
  h: 0.6,
  fontSize: fontSize.heading,
  bold: true,
  color: colors.primary,
  fontFace: "Segoe UI",
});
s12.addShape(prs.ShapeType.rect, {
  x: 0.5,
  y: 1.0,
  w: 9,
  h: 0.04,
  fill: { color: colors.primary },
  line: { type: "none" },
});

s12.addText("Self-Serve Brands (You can assign):", {
  x: 0.5,
  y: 1.3,
  w: 9,
  h: 0.3,
  fontSize: fontSize.body,
  bold: true,
  color: colors.tier1,
  fontFace: "Segoe UI",
});
s12.addText("✅ WS1/WS2 (FastTrack)  |  ✅ QPRO1 (BO)  |  ✅ QP2A (BO)", {
  x: 0.8,
  y: 1.7,
  w: 8.4,
  h: 0.35,
  fontSize: fontSize.body,
  color: colors.text,
  fontFace: "Segoe UI",
});

const assignSteps = [
  "1. Navigate to promo → Click 'Assign to Player'",
  "2. Fill form: Player Name/ID, Promo Code, Amount",
  "3. Review ALL fields (no typos!)",
  "4. Click ASSIGN → Wait for confirmation",
  "5. Screenshot confirmation for records",
];

yPos = 2.3;
assignSteps.forEach((step) => {
  s12.addText(step, {
    x: 0.8,
    y: yPos,
    w: 8.4,
    h: 0.42,
    fontSize: fontSize.body,
    color: colors.text,
    fontFace: "Segoe UI",
  });
  yPos += 0.55;
});

s12.addText("Other Brands? → POST IN #ba-promo (Promo team assigns in 1–2 hrs)", {
  x: 0.5,
  y: 5.3,
  w: 9,
  h: 0.6,
  fontSize: fontSize.body,
  bold: true,
  color: colors.white,
  fill: colors.tier2,
  align: "center",
  valign: "middle",
  fontFace: "Segoe UI",
});

// SLIDE 13: SUCCESS CRITERIA
const s13 = prs.addSlide();
s13.background = { fill: colors.white };
s13.addText("🎯 Success Criteria (Jul 9)", {
  x: 0.5,
  y: 0.4,
  w: 9,
  h: 0.6,
  fontSize: fontSize.heading,
  bold: true,
  color: colors.primary,
  fontFace: "Segoe UI",
});
s13.addShape(prs.ShapeType.rect, {
  x: 0.5,
  y: 1.0,
  w: 9,
  h: 0.04,
  fill: { color: colors.primary },
  line: { type: "none" },
});

const criteria = [
  "☑️ Sales lead makes Tier 1 decisions (≥80%)",
  "☑️ Zero Tier 1/2 escalated to Wai Yip",
  "☑️ Wai Yip gets <2 Tier 3 escalations/week",
  "☑️ Weekly Promo List used consistently",
  "☑️ Sales lead explains 5 Principles from memory",
  "☑️ #ba-promo is default Q&A channel",
];

yPos = 1.6;
criteria.forEach((crit) => {
  s13.addText(crit, {
    x: 0.8,
    y: yPos,
    w: 8.4,
    h: 0.5,
    fontSize: fontSize.body,
    color: colors.text,
    fontFace: "Segoe UI",
  });
  yPos += 0.68;
});

// SLIDE 14: QUICK START
const s14 = prs.addSlide();
addGradientBg(s14);
s14.addText("⚡ Quick Start", {
  x: 0.5,
  y: 0.5,
  w: 9,
  h: 0.6,
  fontSize: fontSize.heading,
  bold: true,
  color: colors.white,
  fontFace: "Segoe UI",
});

const quickSteps = [
  { num: "1", label: "TODAY", desc: "Share Gap Summary → Get Wai Yip's buy-in" },
  { num: "2", label: "JUN 10–11", desc: "Prep training + Decision Framework" },
  { num: "3", label: "JUN 12", desc: "Kickoff: Framework talk + BO Training (1 day)" },
  { num: "4", label: "JUN 13–JUL 9", desc: "4-week pilot: Autonomy → Success!" },
];

yPos = 1.5;
quickSteps.forEach((step) => {
  s14.addShape(prs.ShapeType.ellipse, {
    x: 0.7,
    y: yPos - 0.08,
    w: 0.35,
    h: 0.35,
    fill: { color: colors.white },
    line: { type: "none" },
  });
  s14.addText(step.num, {
    x: 0.7,
    y: yPos - 0.08,
    w: 0.35,
    h: 0.35,
    fontSize: 14,
    bold: true,
    color: colors.primary,
    align: "center",
    valign: "middle",
    fontFace: "Segoe UI",
  });
  s14.addText(step.label, {
    x: 1.2,
    y: yPos - 0.05,
    w: 1.2,
    h: 0.25,
    fontSize: 10,
    bold: true,
    color: colors.white,
    fontFace: "Segoe UI",
  });
  s14.addText(step.desc, {
    x: 2.6,
    y: yPos - 0.05,
    w: 6.7,
    h: 0.25,
    fontSize: 10,
    color: colors.white,
    fontFace: "Segoe UI",
  });
  yPos += 0.68;
});

s14.addText("Questions? Slack: Jascinta | Sales ↔ Promo Team Empowerment v1.0", {
  x: 0.5,
  y: 6.8,
  w: 9,
  h: 0.5,
  fontSize: fontSize.small,
  color: colors.white,
  align: "center",
  fontFace: "Segoe UI",
});

// Save
prs.writeFile({
  fileName:
    "C:\\Users\\vdiuser\\Downloads\\promo-automation\\empowerment-package-slides.pptx",
});

console.log("✅ 15-Slide Presentation Created!");
console.log("📁 empowerment-package-slides.pptx");
console.log("\n📊 Includes:");
console.log("   • Slides 8–12: Detailed BO Training (all 5 modules)");
console.log("   • Slide 7: Module overview");
console.log("   • Total: 15 professional slides");
