const PptxGenJS = require('pptxgenjs');
const prs = new PptxGenJS();

// Color palette
const colors = {
  navy: '1E3A5F',
  teal: '0E7C86',
  lightTeal: '14A697',
  accent: 'F97316',
  darkGray: '2F3C47',
  lightGray: 'F5F7FA',
  white: 'FFFFFF',
  textDark: '1F2937',
  textMuted: '6B7280'
};

// Slide 1: Title
function slide1() {
  let slide = prs.addSlide();
  slide.background = { color: colors.navy };

  slide.addText('IGMP Back Office Automation', {
    x: 0.5, y: 2.2, w: 9, h: 1,
    fontSize: 54, bold: true, color: colors.white, fontFace: 'Segoe UI'
  });

  slide.addText('How Claude Agent Automates Promotion Management', {
    x: 0.5, y: 3.3, w: 9, h: 0.6,
    fontSize: 24, color: colors.lightTeal, fontFace: 'Segoe UI'
  });

  slide.addText('IT Team Evaluation: MCP Integration Readiness', {
    x: 0.5, y: 5.0, w: 9, h: 0.4,
    fontSize: 14, color: colors.textMuted, fontFace: 'Segoe UI', italic: true
  });

  slide.addText('June 2026', {
    x: 0.5, y: 5.6, w: 9, h: 0.3,
    fontSize: 11, color: colors.lightGray, fontFace: 'Segoe UI'
  });
}

// Slide 2: Problem
function slide2() {
  let slide = prs.addSlide();
  slide.background = { color: colors.white };

  slide.addText('The Problem: Manual Promo Management', {
    x: 0.5, y: 0.4, w: 9, h: 0.5,
    fontSize: 36, bold: true, color: colors.navy, fontFace: 'Segoe UI'
  });

  slide.addShape(prs.ShapeType.line, {
    x: 0.5, y: 1.0, w: 2, h: 0,
    line: { color: colors.teal, width: 3 }
  });

  const problems = [
    { emoji: '⏱️', title: 'Time Consuming', desc: '30-60 mins per promotion' },
    { emoji: '👆', title: 'Manual Entry', desc: 'Copy-paste across multiple forms' },
    { emoji: '⚠️', title: 'Error-Prone', desc: 'Typos, missed fields, wrong dates' },
    { emoji: '🔗', title: 'Multi-Step', desc: '5+ different BO sections per promo' }
  ];

  problems.forEach((p, i) => {
    const y = 1.5 + i * 0.95;
    slide.addShape(prs.ShapeType.rect, {
      x: 0.5, y: y, w: 9, h: 0.85,
      fill: { color: colors.lightGray }, line: { type: 'none' }
    });

    slide.addText(p.emoji, {
      x: 0.7, y: y + 0.15, w: 0.5, h: 0.5,
      fontSize: 24, color: colors.teal
    });

    slide.addText(p.title, {
      x: 1.4, y: y + 0.1, w: 7, h: 0.3,
      fontSize: 14, bold: true, color: colors.textDark, fontFace: 'Segoe UI'
    });

    slide.addText(p.desc, {
      x: 1.4, y: y + 0.42, w: 7, h: 0.3,
      fontSize: 12, color: colors.textMuted, fontFace: 'Segoe UI'
    });
  });
}

// Slide 3: Solution
function slide3() {
  let slide = prs.addSlide();
  slide.background = { color: colors.white };

  slide.addText('The Solution: Claude Agent + API Automation', {
    x: 0.5, y: 0.4, w: 9, h: 0.5,
    fontSize: 36, bold: true, color: colors.navy, fontFace: 'Segoe UI'
  });

  slide.addShape(prs.ShapeType.line, {
    x: 0.5, y: 1.0, w: 2, h: 0,
    line: { color: colors.teal, width: 3 }
  });

  // What
  slide.addText('What We Built', {
    x: 0.5, y: 1.3, w: 4.3, h: 0.35,
    fontSize: 16, bold: true, color: colors.teal, fontFace: 'Segoe UI'
  });

  const what = ['✓ Extracted IGMP API calls', '✓ Built agent skill to use APIs', '✓ Automated 9 core operations', '✓ Added QC verification step', '✓ Integrated with Sheets API'];
  what.forEach((item, i) => {
    slide.addText(item, {
      x: 0.7, y: 1.8 + i * 0.4, w: 4, h: 0.35,
      fontSize: 12, color: colors.textDark, fontFace: 'Segoe UI'
    });
  });

  // Why
  slide.addText('Why It Works', {
    x: 5.2, y: 1.3, w: 4.3, h: 0.35,
    fontSize: 16, bold: true, color: colors.teal, fontFace: 'Segoe UI'
  });

  const why = ['⚡ Direct API calls (no browser)', '🔒 Session-based auth (secure)', '✅ Built-in verification', '📊 Spreadsheet integration', '🚀 30-second vs 30-minute'];
  why.forEach((item, i) => {
    slide.addText(item, {
      x: 5.4, y: 1.8 + i * 0.4, w: 4, h: 0.35,
      fontSize: 12, color: colors.textDark, fontFace: 'Segoe UI'
    });
  });
}

// Slide 4: IGMP Platform
function slide4() {
  let slide = prs.addSlide();
  slide.background = { color: colors.white };

  slide.addText('IGMP Platform: WS1/WS2 Stack', {
    x: 0.5, y: 0.4, w: 9, h: 0.5,
    fontSize: 36, bold: true, color: colors.navy, fontFace: 'Segoe UI'
  });

  slide.addShape(prs.ShapeType.line, {
    x: 0.5, y: 1.0, w: 2, h: 0,
    line: { color: colors.teal, width: 3 }
  });

  // WS1 box
  slide.addShape(prs.ShapeType.rect, {
    x: 0.5, y: 1.5, w: 4.3, h: 1.6,
    fill: { color: colors.lightGray }, line: { color: colors.teal, width: 2 }
  });

  slide.addText('WS1', {
    x: 0.7, y: 1.65, w: 4, h: 0.3,
    fontSize: 18, bold: true, color: colors.navy, fontFace: 'Segoe UI'
  });

  slide.addText('Regions:', {
    x: 0.7, y: 2.05, w: 4, h: 0.25,
    fontSize: 11, bold: true, color: colors.textMuted, fontFace: 'Segoe UI'
  });

  slide.addText('6 per-country BOs\n(MY, SG, ID, TH, KH, AU)', {
    x: 0.7, y: 2.32, w: 3.8, h: 0.4,
    fontSize: 11, color: colors.textDark, fontFace: 'Segoe UI'
  });

  slide.addText('Support:', {
    x: 0.7, y: 2.72, w: 4, h: 0.25,
    fontSize: 11, bold: true, color: colors.textMuted, fontFace: 'Segoe UI'
  });

  slide.addText('Create, Edit, Activate', {
    x: 0.7, y: 2.98, w: 3.8, h: 0.25,
    fontSize: 11, color: colors.textDark, fontFace: 'Segoe UI'
  });

  // WS2 box
  slide.addShape(prs.ShapeType.rect, {
    x: 0.5, y: 3.3, w: 4.3, h: 1.6,
    fill: { color: colors.lightGray }, line: { color: colors.teal, width: 2 }
  });

  slide.addText('WS2', {
    x: 0.7, y: 3.45, w: 4, h: 0.3,
    fontSize: 18, bold: true, color: colors.navy, fontFace: 'Segoe UI'
  });

  slide.addText('Regions:', {
    x: 0.7, y: 3.85, w: 4, h: 0.25,
    fontSize: 11, bold: true, color: colors.textMuted, fontFace: 'Segoe UI'
  });

  slide.addText('1 shared BO', {
    x: 0.7, y: 4.12, w: 3.8, h: 0.4,
    fontSize: 11, color: colors.textDark, fontFace: 'Segoe UI'
  });

  slide.addText('Support:', {
    x: 0.7, y: 4.52, w: 4, h: 0.25,
    fontSize: 11, bold: true, color: colors.textMuted, fontFace: 'Segoe UI'
  });

  slide.addText('Create, Activate (no edit)', {
    x: 0.7, y: 4.78, w: 3.8, h: 0.25,
    fontSize: 11, color: colors.textDark, fontFace: 'Segoe UI'
  });

  // Auth box
  slide.addShape(prs.ShapeType.rect, {
    x: 5.2, y: 1.5, w: 4.3, h: 1.6,
    fill: { color: colors.lightGray }, line: { color: colors.accent, width: 2 }
  });

  slide.addText('Authentication', {
    x: 5.4, y: 1.65, w: 4, h: 0.3,
    fontSize: 18, bold: true, color: colors.navy, fontFace: 'Segoe UI'
  });

  slide.addText('Account: promo_testbot', {
    x: 5.4, y: 2.1, w: 4, h: 0.3,
    fontSize: 12, bold: true, color: colors.accent, fontFace: 'Courier New'
  });

  slide.addText('Duration: ~2 hours per session', {
    x: 5.4, y: 2.52, w: 4, h: 0.25,
    fontSize: 11, color: colors.textDark, fontFace: 'Segoe UI'
  });

  slide.addText('Host: best-in-asia.com', {
    x: 5.4, y: 3.0, w: 4, h: 0.3,
    fontSize: 11, color: colors.teal, italic: true, fontFace: 'Segoe UI'
  });
}

// Slide 5: Workflow (clean two-row layout)
function slide5() {
  let slide = prs.addSlide();
  slide.background = { color: colors.white };

  slide.addText('Complete Automation Workflow', {
    x: 0.5, y: 0.3, w: 9, h: 0.5,
    fontSize: 36, bold: true, color: colors.navy, fontFace: 'Segoe UI'
  });

  slide.addShape(prs.ShapeType.line, {
    x: 0.5, y: 0.9, w: 2, h: 0,
    line: { color: colors.teal, width: 3 }
  });

  // ROW 1: Steps 1-3 (simple, no box needed)
  const simpleSteps = [
    { num: '1', title: 'Parse Request', desc: 'Analyze promo specs from sheet' },
    { num: '2', title: 'Generate Code', desc: 'Auto-name with FT_ prefix (e.g. FT_100SGD_MIN3X)' },
    { num: '3', title: 'Authenticate', desc: 'Login with promo_testbot (~2 hr session)' }
  ];

  simpleSteps.forEach((step, i) => {
    const y = 1.15 + i * 0.42;

    slide.addShape(prs.ShapeType.ellipse, {
      x: 0.5, y: y, w: 0.32, h: 0.32,
      fill: { color: colors.teal }
    });

    slide.addText(step.num, {
      x: 0.53, y: y + 0.04, w: 0.26, h: 0.24,
      fontSize: 13, bold: true, color: colors.white, align: 'center', fontFace: 'Segoe UI'
    });

    slide.addText(step.title, {
      x: 1.0, y: y + 0.0, w: 8, h: 0.18,
      fontSize: 12, bold: true, color: colors.navy, fontFace: 'Segoe UI'
    });

    slide.addText(step.desc, {
      x: 1.0, y: y + 0.18, w: 8, h: 0.18,
      fontSize: 10, color: colors.textMuted, fontFace: 'Segoe UI'
    });
  });

  // ROW 2: Steps 4-6 in boxes (the core API operations)
  const boxSteps = [
    { num: '4', title: 'Create Promo', api: 'POST /PM/AddBonus  |  /PM/AddFreeCredit  |  /PM/AddFreeSpin', detail: 'Payload: code, amount, turnover, dates, categories, status=0 (draft)' },
    { num: '5', title: 'Activate', api: 'POST /PM/UpdatePromotionStatus', detail: 'Change status: 0 (draft) → 1 (live)' },
    { num: '6', title: 'Verify (QC)', api: 'GET /PM/GetBonusInfo  |  /PM/GetFreeCreditInfo', detail: 'Read back all saved fields and compare against what was sent' }
  ];

  boxSteps.forEach((step, i) => {
    const y = 2.55 + i * 1.05;

    // Box background
    slide.addShape(prs.ShapeType.rect, {
      x: 0.5, y: y, w: 9, h: 0.9,
      fill: { color: colors.lightGray }, line: { color: colors.teal, width: 1 }
    });

    // Number circle
    slide.addShape(prs.ShapeType.ellipse, {
      x: 0.65, y: y + 0.28, w: 0.32, h: 0.32,
      fill: { color: colors.teal }
    });

    slide.addText(step.num, {
      x: 0.68, y: y + 0.32, w: 0.26, h: 0.24,
      fontSize: 13, bold: true, color: colors.white, align: 'center', fontFace: 'Segoe UI'
    });

    // Title
    slide.addText(step.title, {
      x: 1.15, y: y + 0.08, w: 3, h: 0.2,
      fontSize: 13, bold: true, color: colors.navy, fontFace: 'Segoe UI'
    });

    // API endpoint (orange monospace)
    slide.addText(step.api, {
      x: 1.15, y: y + 0.32, w: 8, h: 0.2,
      fontSize: 9, bold: true, color: colors.accent, fontFace: 'Courier New'
    });

    // Detail
    slide.addText(step.detail, {
      x: 1.15, y: y + 0.56, w: 8, h: 0.2,
      fontSize: 9, color: colors.textMuted, fontFace: 'Segoe UI'
    });
  });

  // ROW 3: Step 7 (simple)
  const y7 = 5.7;
  slide.addShape(prs.ShapeType.ellipse, {
    x: 0.5, y: y7, w: 0.32, h: 0.32,
    fill: { color: colors.teal }
  });

  slide.addText('7', {
    x: 0.53, y: y7 + 0.04, w: 0.26, h: 0.24,
    fontSize: 13, bold: true, color: colors.white, align: 'center', fontFace: 'Segoe UI'
  });

  slide.addText('Report', {
    x: 1.0, y: y7 + 0.0, w: 8, h: 0.18,
    fontSize: 12, bold: true, color: colors.navy, fontFace: 'Segoe UI'
  });

  slide.addText('Write results back to Google Sheets (Status, Promo ID, Timestamp)', {
    x: 1.0, y: y7 + 0.18, w: 8, h: 0.18,
    fontSize: 10, color: colors.textMuted, fontFace: 'Segoe UI'
  });
}

// Slide 6: API Endpoints
function slide6() {
  let slide = prs.addSlide();
  slide.background = { color: colors.white };

  slide.addText('IGMP API Endpoints: What Agent Calls', {
    x: 0.5, y: 0.4, w: 9, h: 0.5,
    fontSize: 36, bold: true, color: colors.navy, fontFace: 'Segoe UI'
  });

  slide.addShape(prs.ShapeType.line, {
    x: 0.5, y: 1.0, w: 2, h: 0,
    line: { color: colors.teal, width: 3 }
  });

  // Create
  slide.addText('Create Operations (POST)', {
    x: 0.5, y: 1.2, w: 9, h: 0.3,
    fontSize: 14, bold: true, color: colors.teal, fontFace: 'Segoe UI'
  });

  const create = [
    { endpoint: '/PM/AddBonus', purpose: 'Create deposit bonus' },
    { endpoint: '/PM/AddFreeCredit', purpose: 'Create free credit' },
    { endpoint: '/PM/AddFreeSpin', purpose: 'Create free spins' }
  ];

  create.forEach((ep, i) => {
    const y = 1.65 + i * 0.3;
    slide.addText(ep.endpoint + '  →  ' + ep.purpose, {
      x: 0.7, y: y, w: 8.6, h: 0.25,
      fontSize: 11, color: colors.textDark, fontFace: 'Segoe UI'
    });
  });

  // Update
  slide.addText('Update & Activate (POST - WS1 Only)', {
    x: 0.5, y: 2.8, w: 9, h: 0.3,
    fontSize: 14, bold: true, color: colors.teal, fontFace: 'Segoe UI'
  });

  const update = [
    { endpoint: '/PM/UpdateBonusDetails', purpose: 'Edit bonus (WS1)' },
    { endpoint: '/PM/UpdatePromotionStatus', purpose: 'Activate/deactivate' }
  ];

  update.forEach((ep, i) => {
    const y = 3.25 + i * 0.3;
    slide.addText(ep.endpoint + '  →  ' + ep.purpose, {
      x: 0.7, y: y, w: 8.6, h: 0.25,
      fontSize: 11, color: colors.textDark, fontFace: 'Segoe UI'
    });
  });

  // Read
  slide.addText('Read & Verify (GET)', {
    x: 0.5, y: 4.15, w: 9, h: 0.3,
    fontSize: 14, bold: true, color: colors.teal, fontFace: 'Segoe UI'
  });

  const read = [
    { endpoint: '/PM/GetBonusInfo', purpose: 'Read bonus details (QC)' },
    { endpoint: '/PM/GetPromotionsList', purpose: 'List all promos' }
  ];

  read.forEach((ep, i) => {
    const y = 4.6 + i * 0.3;
    slide.addText(ep.endpoint + '  →  ' + ep.purpose, {
      x: 0.7, y: y, w: 8.6, h: 0.25,
      fontSize: 11, color: colors.textDark, fontFace: 'Segoe UI'
    });
  });
}

// Slide 7: Components
function slide7() {
  let slide = prs.addSlide();
  slide.background = { color: colors.white };

  slide.addText('9 Core Agent Components', {
    x: 0.5, y: 0.4, w: 9, h: 0.5,
    fontSize: 36, bold: true, color: colors.navy, fontFace: 'Segoe UI'
  });

  slide.addShape(prs.ShapeType.line, {
    x: 0.5, y: 1.0, w: 2, h: 0,
    line: { color: colors.teal, width: 3 }
  });

  const components = [
    { num: 1, name: 'Request Matcher', role: 'Parse requirements' },
    { num: 2, name: 'Auto-Namer', role: 'Generate codes (FT_)' },
    { num: 3, name: 'BO Config', role: 'Lookup currencies' },
    { num: 4, name: 'Code Creator', role: 'POST /PM/Add*' },
    { num: 5, name: 'Code Updater', role: 'Edit (WS1 only)' },
    { num: 6, name: 'Activator', role: 'Update status' },
    { num: 7, name: 'Verifier', role: 'GET /PM/Get*' },
    { num: 8, name: 'QC Engine', role: 'Compare data' },
    { num: 9, name: 'Auth Manager', role: 'Session mgmt' }
  ];

  components.forEach((comp, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = 0.5 + col * 3.2;
    const y = 1.3 + row * 1.2;

    slide.addShape(prs.ShapeType.rect, {
      x: x, y: y, w: 3.0, h: 1.0,
      fill: { color: colors.lightGray }, line: { color: colors.teal, width: 1 }
    });

    slide.addText(comp.num.toString(), {
      x: x + 0.08, y: y + 0.12, w: 0.3, h: 0.25,
      fontSize: 18, bold: true, color: colors.white, align: 'center', fontFace: 'Segoe UI',
      fill: { color: colors.teal }
    });

    slide.addText(comp.name, {
      x: x + 0.45, y: y + 0.08, w: 2.5, h: 0.25,
      fontSize: 12, bold: true, color: colors.navy, fontFace: 'Segoe UI'
    });

    slide.addText(comp.role, {
      x: x + 0.45, y: y + 0.35, w: 2.5, h: 0.3,
      fontSize: 10, color: colors.textMuted, fontFace: 'Segoe UI'
    });
  });
}

// Slide 8: Before/After
function slide8() {
  let slide = prs.addSlide();
  slide.background = { color: colors.white };

  slide.addText('Impact: Before vs After Automation', {
    x: 0.5, y: 0.4, w: 9, h: 0.5,
    fontSize: 36, bold: true, color: colors.navy, fontFace: 'Segoe UI'
  });

  slide.addShape(prs.ShapeType.line, {
    x: 0.5, y: 1.0, w: 2, h: 0,
    line: { color: colors.teal, width: 3 }
  });

  const metrics = [
    { emoji: '⏱️', metric: 'Time per Promo', before: '30-60 mins', after: '~1 min' },
    { emoji: '👆', metric: 'Manual Clicks', before: '50+ per promo', after: 'Zero' },
    { emoji: '✓', metric: 'Error Rate', before: '5-10%', after: '<0.1%' },
    { emoji: '🔍', metric: 'Verification', before: 'Manual review', after: 'Auto QC' }
  ];

  metrics.forEach((m, i) => {
    const y = 1.3 + i * 0.95;

    slide.addText(m.emoji + ' ' + m.metric, {
      x: 0.5, y: y, w: 2.0, h: 0.35,
      fontSize: 13, bold: true, color: colors.navy, fontFace: 'Segoe UI'
    });

    slide.addShape(prs.ShapeType.rect, {
      x: 2.7, y: y, w: 2.8, h: 0.35,
      fill: { color: '#FFE5E5' }
    });

    slide.addText('Before: ' + m.before, {
      x: 2.85, y: y + 0.05, w: 2.5, h: 0.25,
      fontSize: 11, bold: true, color: '#BB2020', fontFace: 'Segoe UI'
    });

    slide.addShape(prs.ShapeType.rect, {
      x: 5.7, y: y, w: 2.8, h: 0.35,
      fill: { color: '#E5F9F0' }
    });

    slide.addText('After: ' + m.after, {
      x: 5.85, y: y + 0.05, w: 2.5, h: 0.25,
      fontSize: 11, bold: true, color: colors.teal, fontFace: 'Segoe UI'
    });
  });

  // Summary
  slide.addShape(prs.ShapeType.rect, {
    x: 0.5, y: 5.0, w: 9, h: 0.6,
    fill: { color: colors.navy }
  });

  slide.addText('Live Production: 100+ promos created | 0 data corruption | 100% activation rate', {
    x: 0.7, y: 5.1, w: 8.6, h: 0.4,
    fontSize: 12, bold: true, color: colors.white, fontFace: 'Segoe UI'
  });
}

// Slide 9: Rules
function slide9() {
  let slide = prs.addSlide();
  slide.background = { color: colors.white };

  slide.addText('Technical Rules & Constraints', {
    x: 0.5, y: 0.4, w: 9, h: 0.5,
    fontSize: 36, bold: true, color: colors.navy, fontFace: 'Segoe UI'
  });

  slide.addShape(prs.ShapeType.line, {
    x: 0.5, y: 1.0, w: 2, h: 0,
    line: { color: colors.teal, width: 3 }
  });

  const rules = [
    { icon: '🔑', title: 'FT_ Prefix', desc: 'Every IGMP promo code MUST start with FT_' },
    { icon: '2️⃣', title: 'Two-Step Activation', desc: 'Create (status=0) then UpdatePromotionStatus (status=1)' },
    { icon: '🚫', title: 'WS1 Edit Only', desc: 'UpdateBonusDetails works on WS1 only, not WS2' },
    { icon: '⏳', title: 'Session Timeout', desc: 'Cookies expire ~2 hours, agent re-auths automatically' },
    { icon: '✅', title: 'Always Verify', desc: 'GET /PM/GetBonusInfo confirms data saved correctly' },
    { icon: '🔍', title: 'Never Publish Directly', desc: 'Always detail-first, then activate' }
  ];

  rules.forEach((rule, i) => {
    const y = 1.3 + i * 0.65;

    slide.addText(rule.icon + ' ' + rule.title, {
      x: 0.9, y: y, w: 3.5, h: 0.3,
      fontSize: 12, bold: true, color: colors.navy, fontFace: 'Segoe UI'
    });

    slide.addText(rule.desc, {
      x: 0.9, y: y + 0.3, w: 8.1, h: 0.25,
      fontSize: 10, color: colors.textMuted, fontFace: 'Segoe UI'
    });
  });
}

// Slide 10: Summary
function slide10() {
  let slide = prs.addSlide();
  slide.background = { color: colors.navy };

  slide.addText('Summary & Next Steps', {
    x: 0.5, y: 0.5, w: 9, h: 0.6,
    fontSize: 40, bold: true, color: colors.white, fontFace: 'Segoe UI'
  });

  slide.addText('✓ 9 core components operational\n✓ 7 API endpoints automated\n✓ 100+ promos created (0 corruption)\n✓ Ready for MCP framework', {
    x: 0.5, y: 1.4, w: 9, h: 1.2,
    fontSize: 18, color: colors.lightTeal, fontFace: 'Segoe UI'
  });

  slide.addShape(prs.ShapeType.line, {
    x: 0.5, y: 2.8, w: 9, h: 0,
    line: { color: colors.lightTeal, width: 1 }
  });

  slide.addText('IT Team Next Steps', {
    x: 0.5, y: 3.1, w: 9, h: 0.4,
    fontSize: 18, bold: true, color: colors.white, fontFace: 'Segoe UI'
  });

  slide.addText('1. Review IGMP API documentation\n2. Evaluate MCP schema design\n3. Plan authentication module\n4. Schedule dev environment testing', {
    x: 0.7, y: 3.6, w: 8.6, h: 1.2,
    fontSize: 14, color: colors.lightGray, fontFace: 'Segoe UI'
  });
}

// Generate all slides
slide1();
slide2();
slide3();
slide4();
slide5();
slide6();
slide7();
slide8();
slide9();
slide10();

// Save
prs.writeFile({ fileName: 'IGMP_BO_Automation.pptx' });
console.log('✅ Presentation saved: IGMP_BO_Automation.pptx');
