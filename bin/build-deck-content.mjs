#!/usr/bin/env node
/**
 * Build April + May 2026 Promotions Team report slides.
 *
 * What it does:
 *   1. Deletes the 12 image-based slides (3–14) from the April deck
 *   2. Creates new text-based slides 3–18 for April (spec-exact content)
 *   3. Drive.copies April → "May 2026 - Promotions Team Report"  (supportsAllDrives)
 *   4. Updates May slides 1–2 via replaceAllText
 *   5. Deletes May slides 3–18 (copied from April)
 *   6. Creates May slides 3–19 with May-specific content + Miro slide
 *
 * Usage:
 *   node bin/build-deck-content.mjs
 *   node bin/build-deck-content.mjs --april-only
 *   node bin/build-deck-content.mjs --may-only      (April must already be rebuilt)
 *   node bin/build-deck-content.mjs --dry-run
 */

import { getGoogleAuth, loadGoogleapis } from '../src/google-auth.js';

// ── IDs ──────────────────────────────────────────────────────────────
const APRIL_DECK_ID    = '1AGIwKFBc3vs8KL0Zo9ISPXU5DUb3Zu2ap3jAyjdayyc';
const REPORTS_FOLDER   = '1y6mptIbRmqHnjgk_8ryzAW4vKzaApWpz';

// Existing image slide objectIds (slides 3–14) — obtained from _read-deck-text.mjs
const APRIL_IMG_SLIDES = [
  'g3c7012c08f0_0_0','g3d03f46ea43_0_7','g3bd125615bc_0_22','g3c853c5bd67_0_0',
  'g3bd125615bc_0_11','g3b257e5c76a_0_308','g3d45bb31140_0_15','g3b257e5c76a_0_302',
  'g3d45bb31140_0_28','g3d45bb31140_0_34','g3d45bb31140_0_40','g3d45bb31140_0_46',
];

const FLAGS = {
  dryRun:    process.argv.includes('--dry-run'),
  aprilOnly: process.argv.includes('--april-only'),
  mayOnly:   process.argv.includes('--may-only'),
};

// ── SLIDE DIMENSIONS ─────────────────────────────────────────────────
const SW = 9144000;  // slide width EMU  (10 inches)
const SH = 5143500;  // slide height EMU (5.625 inches)
const E  = (in_) => Math.round(in_ * 914400);  // inches → EMU

// ── COLORS ───────────────────────────────────────────────────────────
const NAVY   = '#1B3A6E';
const WHITE  = '#FFFFFF';
const LBLUE  = '#EAF2FB';   // KPI card bg
const DARK   = '#202124';   // body text
const GRAY   = '#5F6368';   // secondary / subtitles
const GREEN  = '#0F7B45';
const RED    = '#C5221F';
const TBHDR  = '#1B3A6E';   // table header bg
const TBALT  = '#F1F6FB';   // table alt row
const CALLBG = '#FFF3E0';   // callout background

// ── LOW-LEVEL REQUEST BUILDERS ────────────────────────────────────────
const rgb = h => { const n=parseInt(h.replace('#',''),16); return{red:((n>>16)&255)/255,green:((n>>8)&255)/255,blue:(n&255)/255}; };

function mkShape(id,page,x,y,w,h,type='RECTANGLE'){
  return{createShape:{objectId:id,shapeType:type,elementProperties:{pageObjectId:page,
    size:{width:{magnitude:w,unit:'EMU'},height:{magnitude:h,unit:'EMU'}},
    transform:{scaleX:1,scaleY:1,translateX:x,translateY:y,unit:'EMU'}}}};
}
function fillIt(id,hex,alpha=1){
  if(hex==='none') return{updateShapeProperties:{objectId:id,shapeProperties:{shapeBackgroundFill:{propertyState:'NOT_RENDERED'}},fields:'shapeBackgroundFill'}};
  return{updateShapeProperties:{objectId:id,shapeProperties:{shapeBackgroundFill:{solidFill:{color:{rgbColor:rgb(hex)},alpha}}},fields:'shapeBackgroundFill'}};
}
function noBorder(id){
  return{updateShapeProperties:{objectId:id,shapeProperties:{outline:{propertyState:'NOT_RENDERED'}},fields:'outline'}};
}
function setText(id,text){ return{insertText:{objectId:id,insertionIndex:0,text}}; }
function styleAll(id,{bold,italic,sz,col,font}){
  const s={},f=[];
  if(bold!==undefined){s.bold=bold;f.push('bold');}
  if(italic!==undefined){s.italic=italic;f.push('italic');}
  if(sz){s.fontSize={magnitude:sz,unit:'PT'};f.push('fontSize');}
  if(col){s.foregroundColor={opaqueColor:{rgbColor:rgb(col)}};f.push('foregroundColor');}
  if(font){s.fontFamily=font;f.push('fontFamily');}
  return{updateTextStyle:{objectId:id,style:s,fields:f.join(',')}};
}
function styleRng(id,s,e,{bold,sz,col}){
  const st={},f=[];
  if(bold!==undefined){st.bold=bold;f.push('bold');}
  if(sz){st.fontSize={magnitude:sz,unit:'PT'};f.push('fontSize');}
  if(col){st.foregroundColor={opaqueColor:{rgbColor:rgb(col)}};f.push('foregroundColor');}
  return{updateTextStyle:{objectId:id,textRange:{type:'FIXED_RANGE',startIndex:s,endIndex:e},style:st,fields:f.join(',')}};
}
function alignAll(id,al='CENTER'){
  return{updateParagraphStyle:{objectId:id,textRange:{type:'ALL'},style:{alignment:al},fields:'alignment'}};
}
function vAlign(id,al='MIDDLE'){
  return{updateShapeProperties:{objectId:id,shapeProperties:{contentAlignment:al},fields:'contentAlignment'}};
}
function mkTable(id,page,x,y,w,h,rows,cols){
  return{createTable:{objectId:id,elementProperties:{pageObjectId:page,
    size:{width:{magnitude:w,unit:'EMU'},height:{magnitude:h,unit:'EMU'}},
    transform:{scaleX:1,scaleY:1,translateX:x,translateY:y,unit:'EMU'}},
    rows,columns:cols}};
}
function cellTxt(id,r,c,text){ return{insertText:{objectId:id,cellLocation:{rowIndex:r,columnIndex:c},insertionIndex:0,text}}; }
function cellSty(id,r,c,{bold,sz,col}){
  const s={},f=[];
  if(bold!==undefined){s.bold=bold;f.push('bold');}
  if(sz){s.fontSize={magnitude:sz,unit:'PT'};f.push('fontSize');}
  if(col){s.foregroundColor={opaqueColor:{rgbColor:rgb(col)}};f.push('foregroundColor');}
  return{updateTextStyle:{objectId:id,cellLocation:{rowIndex:r,columnIndex:c},style:s,fields:f.join(',')}};
}
function cellFill(id,r,c,hex){
  return{updateTableCellProperties:{objectId:id,
    tableRange:{location:{rowIndex:r,columnIndex:c},rowSpan:1,columnSpan:1},
    tableCellProperties:{tableCellBackgroundFill:{solidFill:{color:{rgbColor:rgb(hex)}}}},
    fields:'tableCellBackgroundFill'}};
}

// ── LAYOUT ───────────────────────────────────────────────────────────
const M  = E(0.15);   // margin
const HDR_H = E(0.42);
const TTL_Y = E(0.50);
const TTL_H = E(0.55);
const SUB_Y = E(1.12);
const SUB_H = E(0.30);
const KPI_Y = E(1.52);
const KPI_H = E(1.28);
const KPI_G = E(0.10);
const CT_Y  = KPI_Y + KPI_H + KPI_G;  // content top
const CT_H  = SH - CT_Y - M;           // content height
const CT_W  = SW - 2*M;                // content width

function kpiPos(n) {
  const gap = (n+1)*KPI_G;
  const cw = Math.floor((SW - gap) / n);
  return Array.from({length:n},(_,i)=>({x:KPI_G+i*(cw+KPI_G),y:KPI_Y,w:cw,h:KPI_H}));
}

// ── HIGH-LEVEL SLIDE BUILDERS ─────────────────────────────────────────

function headerBlock(reqs, sId, sectionLabel) {
  // Full-width navy header bar
  const hId = `${sId}_hdr`;
  reqs.push(mkShape(hId,sId,0,0,SW,HDR_H));
  reqs.push(fillIt(hId,NAVY));
  reqs.push(noBorder(hId));
  if(sectionLabel){
    reqs.push(setText(hId,`  ${sectionLabel}`));
    reqs.push(styleAll(hId,{sz:9,col:WHITE}));
    reqs.push(alignAll(hId,'START'));
    reqs.push(vAlign(hId,'MIDDLE'));
  }
}

function titleSubtitle(reqs, sId, title, subtitle) {
  const tId = `${sId}_ttl`;
  reqs.push(mkShape(tId,sId,M,TTL_Y,SW-2*M,TTL_H,'TEXT_BOX'));
  reqs.push(fillIt(tId,'none'));
  reqs.push(noBorder(tId));
  reqs.push(setText(tId,title));
  reqs.push(styleAll(tId,{bold:true,sz:20,col:DARK}));

  const sId2=`${sId}_sub`;
  reqs.push(mkShape(sId2,sId,M,SUB_Y,SW-2*M,SUB_H,'TEXT_BOX'));
  reqs.push(fillIt(sId2,'none'));
  reqs.push(noBorder(sId2));
  reqs.push(setText(sId2,subtitle));
  reqs.push(styleAll(sId2,{sz:11,col:GRAY}));
}

/**
 * KPI-type slide: header, title, subtitle, KPI cards, bullet content
 * kpis: [{label, value, change, neg}]
 * content: string[] (bullet items) or single string
 */
function buildKpiSlide(reqs, sId, insertIdx, {sectionLabel,title,subtitle,kpis,content}) {
  reqs.push({createSlide:{objectId:sId,insertionIndex:insertIdx,slideLayoutReference:{predefinedLayout:'BLANK'}}});
  headerBlock(reqs,sId,sectionLabel);
  titleSubtitle(reqs,sId,title,subtitle);

  const pos = kpiPos(kpis.length);
  kpis.forEach((kpi,i)=>{
    const kId=`${sId}_k${i}`;
    const lbl = kpi.label.toUpperCase();
    const val = kpi.value;
    const chg = kpi.change||'';
    const text = chg ? `${lbl}\n${val}\n${chg}` : `${lbl}\n${val}`;
    const lblEnd = lbl.length+1;
    const valEnd = lblEnd+val.length+(chg?1:0);
    const p=pos[i];
    reqs.push(mkShape(kId,sId,p.x,p.y,p.w,p.h));
    reqs.push(fillIt(kId,LBLUE));
    reqs.push(noBorder(kId));
    reqs.push(setText(kId,text));
    reqs.push(alignAll(kId,'CENTER'));
    reqs.push(vAlign(kId,'MIDDLE'));
    reqs.push(styleRng(kId,0,lblEnd,{sz:9,col:GRAY}));
    reqs.push(styleRng(kId,lblEnd,valEnd,{bold:true,sz:20,col:NAVY}));
    if(chg){
      const changeColor = kpi.neg ? RED : GREEN;
      reqs.push(styleRng(kId,valEnd,text.length,{sz:10,col:changeColor}));
    }
  });

  // Content bullets
  const cId=`${sId}_ct`;
  reqs.push(mkShape(cId,sId,M,CT_Y,CT_W,CT_H,'TEXT_BOX'));
  reqs.push(fillIt(cId,'none'));
  reqs.push(noBorder(cId));
  const ctext = Array.isArray(content) ? content.map(b=>`• ${b}`).join('\n') : (content||'');
  reqs.push(setText(cId,ctext));
  reqs.push(styleAll(cId,{sz:10,col:DARK}));
}

/**
 * Table slide: header, title, subtitle, data table, optional callout(s) below
 * headers: string[]
 * rows: string[][]
 * callouts: string[] (plain text callout boxes)
 */
function buildTableSlide(reqs, sId, insertIdx, {sectionLabel,title,subtitle,headers,rows,callouts}) {
  reqs.push({createSlide:{objectId:sId,insertionIndex:insertIdx,slideLayoutReference:{predefinedLayout:'BLANK'}}});
  headerBlock(reqs,sId,sectionLabel);
  titleSubtitle(reqs,sId,title,subtitle);

  const numRows = rows.length+1;
  const numCols = headers.length;
  // Table starts below subtitle
  const tY = SUB_Y+SUB_H+E(0.15);
  // If callouts, reserve bottom space
  const calloutH = callouts&&callouts.length>0 ? E(0.65)*callouts.length : 0;
  const tH = SH - tY - M - calloutH - (calloutH>0?E(0.1):0);
  const tblId=`${sId}_tbl`;
  reqs.push(mkTable(tblId,sId,M,tY,CT_W,tH,numRows,numCols));

  // Header row
  headers.forEach((h,ci)=>{
    reqs.push(cellTxt(tblId,0,ci,h));
    reqs.push(cellSty(tblId,0,ci,{bold:true,sz:9,col:WHITE}));
    reqs.push(cellFill(tblId,0,ci,TBHDR));
  });

  // Data rows
  rows.forEach((row,ri)=>{
    row.forEach((cell,ci)=>{
      reqs.push(cellTxt(tblId,ri+1,ci,cell));
      reqs.push(cellSty(tblId,ri+1,ci,{sz:9,col:DARK}));
      if(ri%2===1) reqs.push(cellFill(tblId,ri+1,ci,TBALT));
    });
  });

  // Callout boxes at bottom
  if(callouts&&callouts.length>0){
    const caW = callouts.length===1 ? CT_W : Math.floor((CT_W-(callouts.length-1)*E(0.1))/callouts.length);
    callouts.forEach((txt,ci)=>{
      const caId=`${sId}_ca${ci}`;
      const caX=M+ci*(caW+E(0.1));
      const caY=SH-M-calloutH;
      reqs.push(mkShape(caId,sId,caX,caY,caW,calloutH));
      reqs.push(fillIt(caId,CALLBG));
      reqs.push(noBorder(caId));
      reqs.push(setText(caId,txt));
      reqs.push(styleAll(caId,{sz:9,col:DARK}));
      reqs.push(vAlign(caId,'MIDDLE'));
    });
  }
}

/**
 * Card slide: header, title, subtitle, optional KPI bar, 2×2 (or 1×4) cards
 * kpis: optional top stats
 * cards: [{title, body, badge}]  — 2–4 cards
 */
function buildCardSlide(reqs, sId, insertIdx, {sectionLabel,title,subtitle,kpis,cards}) {
  reqs.push({createSlide:{objectId:sId,insertionIndex:insertIdx,slideLayoutReference:{predefinedLayout:'BLANK'}}});
  headerBlock(reqs,sId,sectionLabel);
  titleSubtitle(reqs,sId,title,subtitle);

  // Optional mini KPI strip
  let contentTop = CT_Y;
  if(kpis&&kpis.length){
    const pos=kpiPos(kpis.length);
    const stripH=E(0.85);
    kpis.forEach((k,i)=>{
      const kId=`${sId}_ks${i}`;
      const p=pos[i];
      reqs.push(mkShape(kId,sId,p.x,KPI_Y,p.w,stripH));
      reqs.push(fillIt(kId,NAVY));
      reqs.push(noBorder(kId));
      const text=`${k.label}\n${k.value}`;
      reqs.push(setText(kId,text));
      reqs.push(alignAll(kId,'CENTER'));
      reqs.push(vAlign(kId,'MIDDLE'));
      const lblEnd=k.label.length+1;
      reqs.push(styleRng(kId,0,lblEnd,{sz:9,col:'#AACCE8'}));
      reqs.push(styleRng(kId,lblEnd,text.length,{bold:true,sz:16,col:WHITE}));
    });
    contentTop = KPI_Y + stripH + KPI_G;
  }

  // Cards grid
  const cardCount = cards.length;
  const cols = Math.min(cardCount,2);
  const cardRows = Math.ceil(cardCount/cols);
  const cH = Math.floor((SH-contentTop-M-(cardRows-1)*KPI_G)/cardRows);
  const cW = Math.floor((CT_W-(cols-1)*KPI_G)/cols);

  cards.forEach((card,i)=>{
    const col=i%cols, row=Math.floor(i/cols);
    const cId=`${sId}_cd${i}`;
    const cx=M+col*(cW+KPI_G);
    const cy=contentTop+row*(cH+KPI_G);
    reqs.push(mkShape(cId,sId,cx,cy,cW,cH));
    reqs.push(fillIt(cId,LBLUE));
    reqs.push(noBorder(cId));
    const titleLine=card.title;
    const bodyLine=card.body||'';
    const text=bodyLine ? `${titleLine}\n${bodyLine}` : titleLine;
    const titleEnd=titleLine.length+1;
    reqs.push(setText(cId,text));
    reqs.push(styleRng(cId,0,Math.min(titleEnd,text.length),{bold:true,sz:11,col:NAVY}));
    if(bodyLine) reqs.push(styleRng(cId,titleEnd,text.length,{sz:10,col:DARK}));
    if(card.badge){
      // Add status badge
      const bId=`${sId}_bd${i}`;
      const bH=E(0.22); const bW=E(1.2);
      reqs.push(mkShape(bId,sId,cx+cW-bW-E(0.1),cy+E(0.05),bW,bH));
      reqs.push(fillIt(bId,GREEN));
      reqs.push(noBorder(bId));
      reqs.push(setText(bId,card.badge));
      reqs.push(styleAll(bId,{sz:8,col:WHITE}));
      reqs.push(alignAll(bId,'CENTER'));
      reqs.push(vAlign(bId,'MIDDLE'));
    }
  });
}

// ── APRIL SLIDE DATA ─────────────────────────────────────────────────

const APRIL_SLIDES = [

  // Slide 3 — Promotion code distribution
  { type:'kpi', id:'apr_s3',
    sectionLabel:'SLIDE 3 · CAMPAIGN & CONTENT OPERATIONS',
    title:'Promotion code — brand & region distribution',
    subtitle:'April 2026 · Total: 140 codes across 14 active brands',
    kpis:[
      {label:'Total codes',    value:'140',       change:'+34.6% vs Mar'},
      {label:'Top brand',      value:'QP2D · 27', change:'highest single brand'},
      {label:'Primary market', value:'MY · 130',  change:'SG: 15 codes'},
    ],
    content:[
      'Recovery from March\'s 56.8% drop — +34.6% MoM confirms steady-state ops on full team',
      'QP2D dominated promo workload (27 codes) — heavy reload + free-credit refresh cycle',
      'Volume concentrated in MY (93%) — SG share dropped to 7% (from March\'s 23%)',
      '9 brands had zero promo activity this month — workload focused on core 7',
      'VIP Migration Campaign launch (Apr 16, WS1 MY+SG) drove tail-end volume',
    ],
  },

  // Slide 4 — MoM trend
  { type:'kpi', id:'apr_s4',
    sectionLabel:'SLIDE 4 · CAMPAIGN & CONTENT OPERATIONS',
    title:'Promotion code — month-on-month trend',
    subtitle:'Feb–Apr 2026 · QP2D-led recovery after March normalisation',
    kpis:[
      {label:'February',value:'241',change:'+288% vs Jan'},
      {label:'March',   value:'104',change:'−56.8% MoM',neg:true},
      {label:'April',   value:'140',change:'+34.6% MoM'},
    ],
    content:[
      'April lifted from March\'s normalised floor — +34.6% confirms steady-state activity',
      'QP2D reload refresh cycle drove the largest single-brand contribution',
      'VIP Migration Campaign (Apr 16) added late-month volume on WS1 MY+SG',
      'World Cup Lucky Wheel kicked off — extends into May (Q2–Q3 campaign)',
      'Promo canary first live saves — automated pipeline contributed to throughput resilience',
    ],
  },

  // Slide 5 — CRM assignments
  { type:'kpi', id:'apr_s5',
    sectionLabel:'SLIDE 5 · CAMPAIGN & CONTENT OPERATIONS',
    title:'CRM assignments — April 2026',
    subtitle:'354 total segments · VM cycle stable post-Smartico training',
    kpis:[
      {label:'Total segments',value:'354',      change:'−10.4% vs Mar',neg:true},
      {label:'Top brand',     value:'WS1 · 25', change:'flagship retention engine'},
      {label:'MY segments',   value:'~335',     change:'94% of total'},
      {label:'SG segments',   value:'~19',      change:'−47% vs Mar',neg:true},
    ],
    content:[
      'CRM closure rate hit 100% in W4 — all 183 assignments marked Completed, zero carryover',
      'Smartico training from March paying off — segmentation now happening independently',
      'Top brands for W4: WS1 25 / QPRO1 22 / QP2B 19 / QP2C 19 / QPRO2 18 / QP2D 15',
      'SG segment drop reflects Smartico low-activity week in W3–W4, not capacity issue',
    ],
  },

  // Slide 6 — Banners
  { type:'kpi', id:'apr_s6',
    sectionLabel:'SLIDE 6 · CAMPAIGN & CONTENT OPERATIONS',
    title:'Banners — April 2026',
    subtitle:'75 banners · vendor pipeline bottleneck, in-house steady',
    kpis:[
      {label:'Total banners', value:'75',    change:'−31% vs Mar',neg:true},
      {label:'Top brand',     value:'WS1 · 18',change:'cross-region rollouts'},
      {label:'Malaysia',      value:'~52',   change:'~69% of total'},
      {label:'Task lead',     value:'Alysa', change:'+ Wen support'},
    ],
    content:[
      'April dip reflects vendor backlog (Pragmatic Play + Microgaming queue), not internal bandwidth',
      'In-house: Gadget Mania Giveaway (Apr 1), Hatch Your Fortune Raffle, Lucky Loot Giveaway',
      'Vendor: PP Daily Wins S9 L1, PP Gates of Olympus Roulette Daily Drops, MG Playboy Ultimate, PT Spin to Glory',
      'W4 zero banners — full pivot to CRM (183 segments) while waiting on vendor assets',
    ],
  },

  // Slide 7 — New games
  { type:'kpi', id:'apr_s7',
    sectionLabel:'SLIDE 7 · CAMPAIGN & CONTENT OPERATIONS',
    title:'New games — April 2026',
    subtitle:'24 games · 4 vendors · steady cadence',
    kpis:[
      {label:'Total games',   value:'24',            change:'+26% vs Mar'},
      {label:'Top vendor',    value:'Playtech · 7',  change:'single batch 09/04'},
      {label:'Cadence',       value:'4 batches',     change:'vendor pipeline healthy'},
    ],
    content:[
      '30/3: MG 5 games + PP 4 games + FastSpin 1 game (3 providers, 10 games)',
      '09/04: PP 2 + Playtech 7 — Playtech ramped sharply with 7-game batch',
      '15/04: PP 2 + MG 3 — steady continuation',
      'Vendor split: Pragmatic Play 8 / Microgaming 8 / Playtech 7 / FastSpin 1',
      'PP cross-rollout continuing (S9 L1 → L2 prep)',
    ],
  },

  // Slide 8 — QC performance
  { type:'kpi', id:'apr_s8',
    sectionLabel:'SLIDE 8A · QUALITY CHECK RESULTS',
    title:'QC performance — April 2026',
    subtitle:'7 corrections logged · 1 High Risk · Pass rate 70%',
    kpis:[
      {label:'Total corrections', value:'7',        change:'(Correction Log actual)'},
      {label:'High Risk incidents',value:'1',       change:'vs 4 in Mar actual',neg:true},
      {label:'Severity mix',       value:'1S1·5S2·1S3',change:'S2 dominant'},
      {label:'Pass rate',          value:'70%',     change:'21/30 sessions'},
    ],
    content:[
      '70% pass rate (21/30) — down from March\'s 80% (62/77), explained by Wen\'s continued ramp',
      'All amendments concentrated in Promo Code (6 of 9) — template copy-paste, max bonus mis-entry',
      '1 High Risk — Wen, CRM, Apr 6 (VIP Uncontactable: missing currency + generic segments)',
      'Net trend: −46% corrections vs Mar (13→7) — Peer QC catching more errors before they land',
      '⚠ Note: Mar deck reported 3/0; this report uses actual Correction Log numbers (single source of truth)',
      'Stacked bar trend: Feb 19 / Mar 13 / Apr 7 — consistent monthly improvement',
    ],
  },

  // Slide 9 — Targeted improvements
  { type:'kpi', id:'apr_s9',
    sectionLabel:'SLIDE 8B · QUALITY CHECK RESULTS — ACTION PLAN',
    title:'Targeted improvements — ongoing',
    subtitle:'April 2026 — Peer QC + standardised templates delivered 46% correction drop',
    kpis:[
      {label:'Maintain',   value:'Peer QC', change:'sign-off discipline'},
      {label:'Reinforce',  value:'CRM',     change:'generic+bump pairing'},
      {label:'Continue',   value:'Wen ramp',change:'final month shadowing'},
      {label:'Watch',      value:'Templates',change:'6/9 errors trace here'},
    ],
    content:[
      'MAINTAIN: Peer QC sign-off discipline — caught 9 amendments in real time before launch',
      'REINFORCE: CRM generic+bump pairing for VIP Uncontactable — root cause of April\'s only High Risk',
      'CONTINUE: Wen ramp-up plan — final month of structured shadowing, error rate trending down',
      'WATCH: Promo Code template re-use — 6 of 9 amendments traced to inherited template defaults',
      'Impact: Peer QC + standardised templates dropped Mar→Apr corrections by 46%. April\'s only High Risk already covered by updated SOP — zero recurrence expected.',
    ],
  },

  // Slide 10 — Team utilisation
  { type:'kpi', id:'apr_s10',
    sectionLabel:'SLIDE 9 · TEAM UTILISATION',
    title:'Team utilisation — April 2026',
    subtitle:'~78% avg · Michelle exit Apr 2 · Wen reached steady-state',
    kpis:[
      {label:'Monthly avg',     value:'~78%',       change:'+12pp vs Mar 66.3%'},
      {label:'Best week',       value:'81.7%',      change:'W4 (20–24/4)'},
      {label:'Top performer',   value:'Jascinta',   change:'~89% consistent lead'},
      {label:'Team size',       value:'4',          change:'Michelle resigned 2/4',neg:true},
    ],
    content:[
      'W4 utilisation: Jascinta 96.7% / Alysa ~85% / Wen ~75% (ramp) / Elyssa ~62% (VA)',
      'Wen\'s ramp reached steady-state by W3 (75.1%). Full-month productivity confirmed for May',
      'Michelle exit Apr 2 — tasks redistributed to Alysa + Wen with zero workflow disruption',
      'Monthly avg per staff: Jascinta 89.0% / Alysa 81.5% / Wen 58.6% (avg, ramping) / Elyssa 62.2%',
      'W4 (20–24/4): 81.7% utilisation, 224 tasks, 41 promo codes, 183 CRM segments',
    ],
  },

  // Slide 11 — Campaign roadmap (table)
  { type:'table', id:'apr_s11',
    sectionLabel:'SLIDES 10–11 · 2026 UPCOMING CAMPAIGNS & FOCUS AREAS',
    title:'Campaign roadmap & initiative status',
    subtitle:'April 2026 update — key milestones delivered',
    headers:['INITIATIVE','DESCRIPTION','STATUS','TARGET'],
    rows:[
      ['Internal Capability','Wen full-month productivity confirmed; all 4 pillars covered','Completed','Apr 2026'],
      ['IBC9','Customer journey for member','In progress','Q2 2026'],
      ['VIP Migration','WS1 MY+SG affiliate-driven acquisition (WELC_VIPMIGRATION_22X)','Launched','Apr 16, 2026'],
      ['MG x Enigma','Free Spin Redeem Code campaign (Apr 8 – May 30)','Live','Q2 2026'],
      ['3-Deposit 100% Reload','WS1 MY+SG tiered reload (500/1500/3000)','Implemented','Apr 2026'],
      ['KingSG + BPSG Unlimited Streak','Daily Turnover Challenge, x5 iPhone 17 Promax 1TB','Live','Apr 2026'],
      ['World Cup Lucky Wheel','Lucky Wheel campaign kicked off','In progress','Q2–Q3 2026'],
      ['BP9 High Stakes Raffle','Apr 15 winners announced; reward expansion teased','Implemented','Apr 2026'],
      ['Promo Automation','Canary multi-brand orchestrator MVP live','Launched','Apr 2026'],
    ],
    callouts:[
      'CRM closure rate 100% in W4 — all 183 assignments completed, zero carryover',
    ],
  },

  // Slide 12 — Process improvements (table)
  { type:'table', id:'apr_s12',
    sectionLabel:'SLIDE 12 · 2026 NEW INITIATIVES & STRUCTURAL CONTRIBUTIONS',
    title:'Process improvements & team operations',
    subtitle:'Completed and active initiatives — April 2026',
    headers:['INITIATIVE','DESCRIPTION','STATUS','TARGET'],
    rows:[
      ['Michelle handover','Smooth exit Apr 2; tasks redistributed to Alysa + Wen','Completed','Apr 2026'],
      ['Wen full-month productivity','Onboarding plan delivered; all 4 pillars covered by W3','Completed','Apr 2026'],
      ['VM blasting maturity','Single-day 64-segment cycle (QPRO1 MY+SG, QP2B–D) Apr 21','Active','Q2 2026'],
      ['AdvantPlay Rebate','Settings + Blacklist config across QPRO16–QP2A–D','Completed','Apr 3, 2026'],
      ['T&C Hyperlinks','QPRO16–19 + QP2A–D promo content T&C links activated','Completed','Apr 2026'],
      ['Promo canary MVP','First live saves QPRO11; multi-brand orchestrator sequential mode verified','Launched','Apr 2026'],
    ],
    callouts:[
      'Peer QC: Corrections dropped 46% from March to April (13→7). High Risk dropped 4→1 — SOP updates addressing root causes.',
      'Wen ramp completed: Banner + Promo Code + CRM + Games coverage achieved by W3. 50–75% util week-over-week.',
    ],
  },

  // Slide 13 — Team operations & structural contributions (cards)
  { type:'cards', id:'apr_s13',
    sectionLabel:'SLIDE 13 · STRUCTURAL CONTRIBUTIONS',
    title:'Team operations & structural contributions',
    subtitle:'Systems built and maintained — April 2026',
    kpis:[
      {label:'Active systems',  value:'4'},
      {label:'QC corrections',  value:'−46%'},
      {label:'High Risk',       value:'1'},
      {label:'Training Apr',    value:'2h'},
    ],
    cards:[
      {title:'Team Operations & QC Dashboard',
       body:'Single source of truth for utilisation + QC + training. 4 tabs active. Foundation for this monthly report.',
       badge:'Active'},
      {title:'Peer QC System',
       body:'Apr: 30 sessions, 9 amendments caught, 1 High Risk (Wen CRM ramp). Corrections −46% vs Mar.',
       badge:'Proven'},
      {title:'Wen onboarding completed',
       body:'Full ramp confirmed by Apr 14. Banner + Promo Code + CRM + Games all delivered.',
       badge:'Completed'},
      {title:'Promo automation pipeline',
       body:'Canary MVP live. Multi-brand orchestrator sequential mode verified. First live saves on QPRO11.',
       badge:'MVP Live'},
    ],
  },

  // Slide 14 — Delivery timeline (table)
  { type:'table', id:'apr_s14',
    sectionLabel:'SLIDE B · STRUCTURAL CONTRIBUTIONS — DELIVERY TIMELINE',
    title:'Delivery timeline & measurable impact',
    subtitle:'Jan–Apr 2026 · initiative milestones and outcomes',
    headers:['INITIATIVE','MILESTONE','STATUS','PERIOD'],
    rows:[
      ['Team Ops & QC Dashboard','Maintained. 4 active tabs, foundation for monthly report','Active','Jan–Apr 2026'],
      ['Peer QC System','Mandatory sign-off all tasks. Apr: 30 sessions, 70% pass, 1 High Risk caught','Effective','Jan–Apr 2026'],
      ['Wen onboarding','Full 4-pillar coverage by W3. Training 9.0h (Feb–Mar) +2h Apr. Operational.','Completed','Feb–Apr 2026'],
      ['Michelle exit handover','Tasks redistributed Apr 2. Zero workflow disruption.','Completed','Apr 2026'],
    ],
    callouts:[
      'QC Dashboard + Peer QC + Wen ramp + Michelle handover → 46% drop in corrections + Wen 75% W3 util — direct measurable outcomes.',
    ],
  },

  // Slide 15 — Automation pipeline overview (NEW)
  { type:'kpi', id:'apr_s15',
    sectionLabel:'SLIDE 15 · AUTOMATION & TOOLING',
    title:'Promo automation pipeline — MVP live',
    subtitle:'Sheet → ingest → canary → BO save · first month of automated runs',
    kpis:[
      {label:'Brands covered', value:'19+',          change:'QPRO1–19 + QP2A–D wired'},
      {label:'Bonus types',    value:'3',            change:'FC / Deposit / FS'},
      {label:'First live save',value:'QPRO11',       change:'TEST_FS_V23 · Apr 2026'},
    ],
    content:[
      'Pipeline: Sheet ingest → QC engine → BO config mapper → Canary (Playwright) → Save + write-back',
      'Multi-brand orchestrator sequential mode verified end-to-end',
      'QPRO Deposit + FC saves landing on QPRO11; FS game-code resolver unblocked',
      'Auto-namer (P###, prefix engine for VIP/GLD/FT) wired in',
      'Banner upload-promo.js shipped (B-ID pipeline, confirmed on B16+B17)',
      'Translation HTML skill operational: ZH / TH / KM / ID / BM languages',
    ],
  },

  // Slide 16 — Banner & 3.3 content pipeline (NEW)
  { type:'cards', id:'apr_s16',
    sectionLabel:'SLIDE 16 · AUTOMATION & TOOLING',
    title:'Banner upload & 3.3 promotion content — API direct',
    subtitle:'Goodbye manual clicks · upload-promo.js shipped',
    kpis:[
      {label:'B-IDs supported', value:'WS1/WS2/QPRO/QP2'},
      {label:'Tool',             value:'upload-promo.js'},
      {label:'Content pipeline', value:'20-step HTML'},
    ],
    cards:[
      {title:'3.3 Promotion Content',
       body:'API-direct POST to /api/bo/promotioncontent. Wire shape confirmed. Handles title + description + content body + T&C hyperlink (sentence 11 only, :brandname/:merchantname).',
       badge:'Live'},
      {title:'14.2 Homepage Banners',
       body:'API-direct POST to /api/bo/banner. Position auto-assigned by source (in-house→1/2, PP→3/4, other→5). Both 3.3 + 14.2 activated post-create.',
       badge:'Live'},
      {title:'fetchDocHtml Pipeline',
       body:'20-step doc transformation: no text-align:left, p-strip after td-center, lists→numbered, <hr> spacing. Handles ZH inverted structure + ID Drive doc quirks.',
       badge:'Verified'},
      {title:'First end-to-end runs',
       body:'B16 (QPRO16) + B17 (QPRO17) MG Road to Glory complete. EVEMGRTGA cross-brand (QP2A+QPRO15/16/17) unified. Foundation laid for B-series scale-up in May.',
       badge:'Apr 2026'},
    ],
  },

  // Slide 17 — Code & content automation (NEW)
  { type:'kpi', id:'apr_s17',
    sectionLabel:'SLIDE 17 · AUTOMATION & TOOLING',
    title:'Promo code automation — multi-brand canary',
    subtitle:'First live saves on QPRO11 · sequential mode verified',
    kpis:[
      {label:'QPRO coverage',value:'19 brands', change:'Dep + FC + FS'},
      {label:'QP2 coverage', value:'4 merchants',change:'IBC22/KING333/ACE66/SPADE66'},
      {label:'Proof of concept',value:'April',  change:'May = production target'},
    ],
    content:[
      'Auto-namer: generates promo_code + promotion_name_* from bonus_type + parsed + remark + campaign',
      'Tier prefix engine: VIP / GLD / FT / TEST / NRM — extensible, generalized from this month',
      'Dynamic per-brand catalog: game_provider_ids fetched live, no hardcoded drift across brand BOs',
      'Cross-merchant share-code: QP2A–D promos extend merchant_ids rather than duplicating codes',
      'Blacklist Template auto-select: exact category-set match before save (hard rule for QPRO + QP2)',
      'April = proof-of-concept month. May target: 21-brand verification matrix complete, scaled saves',
    ],
  },

  // Slide 18 — Translation skill & operational hygiene (NEW)
  { type:'cards', id:'apr_s18',
    sectionLabel:'SLIDE 18 · AUTOMATION & TOOLING',
    title:'Translation skill + operational hygiene',
    subtitle:'Promo doc translation — paste-ready HTML across 5 languages',
    kpis:[],
    cards:[
      {title:'Translation HTML Skill',
       body:'Promo Google Docs → Calibri 12pt HTML matching source styling. Supports ZH / TH / KM / ID / BM. Auto-appends glossary terms. Installed at ~/.claude/skills/.',
       badge:'Operational'},
      {title:'Brand & Platform Directory',
       body:'Reference sheet covering 30+ brands across WS1/WS2/QPRO1–19/QP2A–D/NX/UG/SBO28/WARUNG18. Single source of truth for BO links, PICs, tools, SOPs.',
       badge:'Live'},
      {title:'Apr 16 Weekly Promo Catch-Up',
       body:'Slide-based meeting kicked off this quarter. Surfaced VIP Migration, MG Enigma, World Cup deadlines, ownership clarification.',
       badge:'Q2 2026'},
      {title:'Foundation for May',
       body:'~5 promo docs translated, KM/ID glossary growth, automation saves scale to P100+. Translation skill powers full-stack promo launch workflow.',
       badge:'Planned'},
    ],
  },
];

// ── MAY SLIDE DATA ─────────────────────────────────────────────────

const MAY_SLIDES = [

  // Slide 3 — Promotion code distribution (May)
  { type:'kpi', id:'may_s3',
    sectionLabel:'SLIDE 3 · CAMPAIGN & CONTENT OPERATIONS',
    title:'Promotion code — brand & region distribution',
    subtitle:'May 2026 · ~125 codes across 14 active brands',
    kpis:[
      {label:'Total codes',     value:'~125',      change:'−10.7% vs Apr',neg:true},
      {label:'Top brand',       value:'QP2D · 56', change:'24.9% of total (W1 alone)'},
      {label:'Primary market',  value:'MY · ~165', change:'SG: ~75 codes (+5× vs Apr)'},
    ],
    content:[
      'QP2D again top — code refresh cycle continued from April momentum (56 codes in W1 alone)',
      'SG share rebounded sharply — +27% vs Apr\'s 7% — driven by cross-merchant duplication',
      'Bonus type split: Deposit-Reload 75% / Free Credit 25% — retention focus',
      'Tool split balanced: Fastrack 76 / Smartico 67 — no single-tool risk',
      'promo test bot doing systematic automated saves — first month with bot-led code creation (P085–P096+)',
      '231 test promos deactivated in mass cleanup mid-May — operational hygiene milestone',
    ],
  },

  // Slide 4 — MoM trend (May)
  { type:'kpi', id:'may_s4',
    sectionLabel:'SLIDE 4 · CAMPAIGN & CONTENT OPERATIONS',
    title:'Promotion code — month-on-month trend',
    subtitle:'Mar–May 2026 · automation enters production',
    kpis:[
      {label:'March', value:'104', change:'baseline'},
      {label:'April', value:'140', change:'+34.6%'},
      {label:'May',   value:'~125',change:'−10.7% (W1: 57 logged)',neg:true},
    ],
    content:[
      'Volume normalised after April\'s QP2D refresh cycle — expected seasonal stabilisation',
      'Automation share rising — promo test bot contributed measurable % of May saves',
      'SG market activation — cross-merchant share-code workflow live',
      '231 test promos deactivated in mass cleanup mid-May — operational hygiene milestone',
      '🟡 May total is W1 confirmed + estimated from canary saves. Month closes end of May.',
    ],
  },

  // Slide 5 — CRM assignments (May)
  { type:'kpi', id:'may_s5',
    sectionLabel:'SLIDE 5 · CAMPAIGN & CONTENT OPERATIONS',
    title:'CRM assignments — May 2026',
    subtitle:'143 in W1 alone · 100% closure · UG02 brand onboarded',
    kpis:[
      {label:'Total segments', value:'~280',   change:'−21% vs Apr (partial)',neg:true},
      {label:'Top brand',      value:'WS1 · 35',change:'MY 26 + SG 9'},
      {label:'MY / SG split',  value:'73%/27%', change:'SG rebound from Apr'},
      {label:'W1 closure rate',value:'100%',   change:'all 143 Completed'},
    ],
    content:[
      'W1: WS1 35 / QPRO1 ~25 / QP2C 12 / QP2D 11 / QP2B 9 / QP2A 9 / others',
      'UG02 brand onboarded (Indonesian) — new VM cycle active',
      'CRM tool split balanced: Fastrack 76 / Smartico 67 — no single-tool dependency confirmed',
      '🟡 May total ~280 based on W1 actual + W2–W5 estimation. Full data at month-close.',
    ],
  },

  // Slide 6 — Banners (May)
  { type:'kpi', id:'may_s6',
    sectionLabel:'SLIDE 6 · CAMPAIGN & CONTENT OPERATIONS',
    title:'Banners — May 2026',
    subtitle:'~175 banners · +133% rebound · MG + PP cross-brand rollouts',
    kpis:[
      {label:'Total banners',  value:'~175',    change:'+133% vs Apr'},
      {label:'Top brand',      value:'WS1 · ~25',change:'cross-region + cross-merchant'},
      {label:'Top campaigns',  value:'MG Road to Glory + PP S9L3'},
      {label:'Task lead',      value:'Full team',change:'+Gaby +Bangun onboarded'},
    ],
    content:[
      'April vendor backlog cleared — May saw two simultaneous cross-brand vendor rollouts',
      'Microgaming Road to Glory: 24+ brand-region combos across WS1/WS2/QPRO1–17/QP2A–D',
      'PP Daily Wins Season 9 L3: ~24+ cross-brand placements',
      'In-house: BP9 Mid-Year Mega Draw + Winners, RWS77 Mega-Gear Giveaway',
      'UG02 brand launch: 8 promos in Bahasa (Bonus Slot, Deposit Harian, Cashback Mingguan, Referral)',
      'Vendor ~70% / In-house ~30% split',
    ],
  },

  // Slide 7 — New games (May)
  { type:'kpi', id:'may_s7',
    sectionLabel:'SLIDE 7 · CAMPAIGN & CONTENT OPERATIONS',
    title:'New games — May 2026',
    subtitle:'29 games · record month · Playtech-led batch',
    kpis:[
      {label:'Total games',   value:'29',            change:'+21% vs Apr'},
      {label:'Top vendor',    value:'Playtech · 13', change:'11-game batch 7/5'},
      {label:'Mini Games',    value:'Sustained',     change:'Q2 milestone holds'},
    ],
    content:[
      '30/4: PP 2 + FastSpin 1 — month start carry-over',
      '7/5: PP 2 + Playtech 11 — largest single batch of the year',
      '15/5: PP 2 + MG 2 + Playtech 3',
      '21/5: PP 4 + MG 2',
      'Vendor split: Playtech 13 / Pragmatic Play 11 / Microgaming 5',
      'New hires (Gaby, Bangun) actively contributing to game upload pipeline',
    ],
  },

  // Slide 8 — QC performance (May)
  { type:'kpi', id:'may_s8',
    sectionLabel:'SLIDE 8A · QUALITY CHECK RESULTS',
    title:'QC performance — May 2026',
    subtitle:'Data pending — Correction Log backfill in progress',
    kpis:[
      {label:'Corrections logged', value:'0',      change:'(log backfill pending)'},
      {label:'QC sessions',        value:'~12',    change:'per Jascinta tracker'},
      {label:'Severity mix',       value:'TBD',    change:'to be updated'},
      {label:'Dashboard entries',  value:'3',      change:'vs ~30 expected',neg:true},
    ],
    content:[
      '⚠ Per-staff trackers show ~12+ QC reviews across May (P085–P087, P075–P079, P102–P105+)',
      '⚠ Dashboard Correction Log has only 3 sessions. Team will backfill at month-end',
      'Action item: Correction Log backfill required before June monthly report',
      'Recommend SOP: corrections logged within 24h of resolution',
      'Trend bar (logged only): Feb 19 / Mar 13 / Apr 7 / May 0 — caveat: May log incomplete',
    ],
  },

  // Slide 9 — Targeted improvements (May)
  { type:'kpi', id:'may_s9',
    sectionLabel:'SLIDE 8B · QUALITY CHECK RESULTS — ACTION PLAN',
    title:'Targeted improvements — May',
    subtitle:'Peer QC sustained · new-joiner ramp · log backfill action item',
    kpis:[
      {label:'Maintain', value:'Peer QC',    change:'+ Correction Log backfill'},
      {label:'Reinforce',value:'New joiner', change:'Gaby + Bangun ramp'},
      {label:'Continue', value:'Automation', change:'reduce manual error surface'},
      {label:'Watch',    value:'Log discipline',change:'May gap flagged'},
    ],
    content:[
      'MAINTAIN: Peer QC sign-off discipline + Correction Log backfill habit (new — May gap)',
      'REINFORCE: New-joiner ramp template — Gaby + Bangun joined May; use Wen\'s lessons learned',
      'CONTINUE: Auto-namer + canary expansion — reduce manual code-creation error surface',
      'WATCH: Backfill discipline — May log gap suggests retroactive logging stale',
      '231 test promos deactivated in mass cleanup mid-May — operational hygiene action completed. Zero production impact.',
    ],
  },

  // Slide 10 — Team utilisation (May)
  { type:'kpi', id:'may_s10',
    sectionLabel:'SLIDE 9 · TEAM UTILISATION',
    title:'Team utilisation — May 2026',
    subtitle:'~85% avg · team expanded to 6 (+Gaby +Bangun)',
    kpis:[
      {label:'Monthly avg',     value:'~85%',     change:'+7pp vs Apr'},
      {label:'W1 utilisation',  value:'84.8%',    change:'225 tasks delivered'},
      {label:'Top performer',   value:'Wen · 97', change:'items delivered W1'},
      {label:'Team size',       value:'6',        change:'+Gaby +Bangun onboarded'},
    ],
    content:[
      'W1 breakdown: Wen 77.97% (97 items) / Elyssa 104.38% ⚠️ / Alysa 73.75% (61 items) / Jascinta 83.12%',
      'Elyssa over-utilisation (104.38%) flagged for review — VA workload distribution being adjusted',
      'Gaby + Bangun onboarding: both contributing across UG02 + game upload + banner from Week 1',
      'Team footprint 4 → 6 with Gaby (Indonesian) + Bangun onboarded in under one month',
    ],
  },

  // Slide 11 — Campaign roadmap (May)
  { type:'table', id:'may_s11',
    sectionLabel:'SLIDES 10–11 · 2026 UPCOMING CAMPAIGNS',
    title:'Campaign roadmap & initiative status',
    subtitle:'May 2026 update — automation + team expansion month',
    headers:['INITIATIVE','DESCRIPTION','STATUS','TARGET'],
    rows:[
      ['MG Road to Glory','Cross-brand rollout (WS1+WS2+QPRO1–17+QP2A–D, ~50 placements, 2 rounds)','Implemented','May 2026'],
      ['PP Daily Wins S9 L3','Cross-brand rollout (~50 placements)','Implemented','May 2026'],
      ['UG02 brand onboarding','New Indonesian brand — 8 BM promos launched','Launched','May 2026'],
      ['BP9 Mid-Year Mega Draw','QPRO1 MY+SG+ID — promo + winners list','Implemented','May 2026'],
      ['RWS77 Mega-Gear Giveaway','WS2 — promo + winners list','Implemented','May 2026'],
      ['FIFA World Cup Prediction','QPRO2–9 MY — Joel campaign','Implemented','May 2026'],
      ['TLEO codes — QPRO2','10 new VM codes','Completed','May 2026'],
      ['VIP Migration (cont.)','WS1 MY+SG ongoing','Active','Q2 2026'],
      ['World Cup Lucky Wheel','(continued from Apr)','In progress','Q2–Q3 2026'],
      ['Mid-Autumn Campaign','Planning phase','Planned','Q3 2026'],
    ],
    callouts:[],
  },

  // Slide 12 — Process improvements (May)
  { type:'table', id:'may_s12',
    sectionLabel:'SLIDE 12 · 2026 NEW INITIATIVES & STRUCTURAL CONTRIBUTIONS',
    title:'Process improvements & team operations',
    subtitle:'Completed and active initiatives — May 2026',
    headers:['INITIATIVE','DESCRIPTION','STATUS','TARGET'],
    rows:[
      ['Gaby + Bangun onboarded','Indonesian + general — game upload + banner + UG02 promos','Active','May 2026'],
      ['UG02 brand onboarding','8 Bahasa promos live; new BM workflow established','Implemented','May 2026'],
      ['Multi-brand canary live','21 brands verified (QPRO1–19 + QP2A–D)','Launched','May 2026'],
      ['API-direct canary','QP2A workflow drops from minutes to ~5 seconds','Shipped','May 2026'],
      ['Sheets API OAuth live','Live ingest + write-back from tracker spreadsheet','Active','May 2026'],
      ['231 test promo cleanup','Mass deactivation across QPRO + QP2; 0 errors','Completed','May 2026'],
      ['QP2C Miro customer journey','18 cohort codes, V4 Day-by-Day layout','Active','May 2026'],
    ],
    callouts:[
      'Automation pipeline production-ready — promo test bot running systematic saves P085–P096+, sheet write-back live',
      'Team expansion: Gaby + Bangun onboarded <1 month. UG02 brand workflow established.',
    ],
  },

  // Slide 13 — Team ops & structural contributions (May)
  { type:'cards', id:'may_s13',
    sectionLabel:'SLIDE 13 · STRUCTURAL CONTRIBUTIONS',
    title:'Team operations & structural contributions',
    subtitle:'Systems built and maintained — May 2026',
    kpis:[
      {label:'Active systems',  value:'5'},
      {label:'Banners vs Apr',  value:'+133%'},
      {label:'Brands live',     value:'21'},
      {label:'New hires',       value:'2'},
    ],
    cards:[
      {title:'Team Operations & QC Dashboard',
       body:'Sustained · 4 tabs · QC log catch-up flagged for backfill. Remains single source of truth.',
       badge:'Active'},
      {title:'Peer QC System',
       body:'Sustained · ~12 reviews in May per Jascinta tracker · formal log behind. Action item: backfill.',
       badge:'Active'},
      {title:'Gaby + Bangun onboarding',
       body:'Both joined May, contributing UG02 + game upload + banner. Onboarding plan delivered in <1 month.',
       badge:'Launched'},
      {title:'Promo automation pipeline',
       body:'From MVP (Apr) to production (May). 21 brands verified, API-direct save, Sheets ingest+writeback, 231 test cleanup.',
       badge:'Production'},
    ],
  },

  // Slide 14 — Delivery timeline (May)
  { type:'table', id:'may_s14',
    sectionLabel:'SLIDE B · STRUCTURAL CONTRIBUTIONS — DELIVERY TIMELINE',
    title:'Delivery timeline & measurable impact',
    subtitle:'Jan–May 2026 · 5-month structural contributions',
    headers:['INITIATIVE','MILESTONE','STATUS','PERIOD'],
    rows:[
      ['Team Ops & QC Dashboard','Sustained. 4 active tabs. QC log backfill flagged.','Active','Jan–May 2026'],
      ['Peer QC System','Sustained. ~12 May reviews (formal log incomplete).','Active','Jan–May 2026'],
      ['Wen onboarding → producing','Completed Feb–Apr. May: contributing at 75%+ util.','Producing','Feb–May 2026'],
      ['Michelle exit handover','Clean. Tasks redistributed Apr 2.','Completed','Apr 2026'],
      ['Gaby + Bangun onboarded','Joined May. Contributing UG02/banner/games within week 1.','Active','May 2026'],
      ['Promo automation MVP → production','April MVP → May production. 21 brands, API-direct, save+writeback.','Production','Apr–May 2026'],
    ],
    callouts:[
      'Jan–May structural work: same throughput on 4-person core + 2 new hires with 21-brand canary. Team no longer scales linearly with workload.',
    ],
  },

  // Slide 15 — Automation pipeline — production state (May)
  { type:'kpi', id:'may_s15',
    sectionLabel:'SLIDE 15 · AUTOMATION & TOOLING',
    title:'Automation pipeline — production state',
    subtitle:'21-brand canary verified · API-direct · sheet-driven',
    kpis:[
      {label:'Brands verified live', value:'21',      change:'QPRO1–19 + QP2A–D'},
      {label:'Execution time',       value:'~5 sec',  change:'API-direct (QP2A)'},
      {label:'Bonus type coverage',  value:'3/3',     change:'FC · Deposit · FS'},
    ],
    content:[
      'Diagram: Sheet (live ingest) → QC engine → BO config mapper → Canary/API-direct → BO save → write-back',
      '21-brand coverage matrix complete (session_2026-05-16_part2)',
      'API-direct runner shipped — bin/canary-api-qp2.js cuts QP2A run from minutes to ~5s',
      'Sheets API OAuth integrated — bin/sheets-test.mjs + bin/sheets-writeback.mjs',
      'Multi-brand orchestrator dispatching by platform (QPRO vs QP2)',
      'Bare P### auto-resolves to current-month handle',
    ],
  },

  // Slide 16 — Promo canary in action (May)
  { type:'table', id:'may_s16',
    sectionLabel:'SLIDE 16 · AUTOMATION & TOOLING',
    title:'Promo canary in production — P085–P125 saves',
    subtitle:'promo test bot · systematic automated runs · May 2026',
    headers:['DATE','RANGE / CODE','BRAND','TYPE'],
    rows:[
      ['20/5','P085–P090','WS1, QPRO4','Dep / FC'],
      ['26/5','P102–P107','QP2D','FC'],
      ['26/5','FC_588/1088/288/188/888','QPRO5','FC (VM)'],
      ['26/5','FT_50FC/100FC_15X_WCCHURNED','QP2A','FC (churned cohort)'],
    ],
    callouts:[
      'This is the first month of fully-systematic bot saves. Cross-merchant share-code live (QP2A→QP2D extension). Operator role shifted: "execute" → "QC + supervise".',
    ],
  },

  // Slide 17 — Banner & 3.3 content automation at scale (May)
  { type:'kpi', id:'may_s17',
    sectionLabel:'SLIDE 17 · AUTOMATION & TOOLING',
    title:'Banner & 3.3 content — at scale',
    subtitle:'MG Road to Glory + PP Daily Wins S9L3 — cross-brand rollouts',
    kpis:[
      {label:'Vendor banner placements', value:'~50',    change:'via upload tooling'},
      {label:'In-house campaigns',       value:'5+',     change:'BP9/RWS77/UG02'},
      {label:'T&C patches',              value:'4 sites',change:'QPRO15/16/17+QP2A'},
    ],
    content:[
      'upload-promo.js verified end-to-end on B-series banner uploads',
      '3.3 Promotion Content + 14.2 Banner wire shapes confirmed; both POST + activation in one CLI run',
      'EVEMRTG cross-brand consolidation — QPRO15/16/17 + QP2A IBC22 unified content + banner',
      'fetchDocHtml pipeline handles every doc variant: no text-align:left, p-strip after td-center, lists→numbered, <hr> spacing, ID Drive inverted structure',
      'T&C hyperlink rules confirmed: :brandname (QPRO, no target), :merchantname (QP2, target=_blank, ?lang=)',
    ],
  },

  // Slide 18 — Translation + operational hygiene (May)
  { type:'cards', id:'may_s18',
    sectionLabel:'SLIDE 18 · AUTOMATION & TOOLING',
    title:'Translation, hygiene & dedicated tooling',
    subtitle:'Production-grade scripts + operational cleanup',
    kpis:[],
    cards:[
      {title:'Translation HTML Skill',
       body:'5 languages (ZH/TH/KM/ID/BM). Auto-glossary growth. Used for May promo doc handoffs across QPRO + QP2.',
       badge:'Operational'},
      {title:'231 test promos deactivated',
       body:'Mass cleanup script bin/deactivate-test-promos.mjs. Zero errors across QPRO + QP2. Operational hygiene milestone.',
       badge:'Completed'},
      {title:'Rebate add-provider script',
       body:'bin/add-provider-to-rebate.mjs. Dry-run verified on PP2 (17 brands, 184 candidates). Idempotent, resolves provider by CODE.',
       badge:'Verified'},
      {title:'May automation footprint',
       body:'From manual BO saves to: live sheet ingest + auto-namer + 21-brand orchestrator + API-direct + banner automation + translation. One quarter of structural investment.',
       badge:'Production'},
    ],
  },

  // Slide 19 — Customer journey work (QP2C Miro) — MAY ONLY
  { type:'kpi', id:'may_s19',
    sectionLabel:'SLIDE 19 · AUTOMATION & TOOLING',
    title:'Customer journey board — QP2C / ACE66',
    subtitle:'18 cohort codes mapped · V4 Day-by-Day layout · May 2026',
    kpis:[
      {label:'Cohort codes',   value:'18',        change:'A–I + Ref segments'},
      {label:'Layout version', value:'V4',        change:'Day-by-Day (Deposit vs No-Deposit)'},
      {label:'Tiers × Days',   value:'3 × 3',     change:'9 journey cells per cohort'},
    ],
    content:[
      'V4 layout: Deposit=1 vs No Deposit · 3 tiers · 3 days → 9 journey-branch grid per cohort code',
      'Built in Miro · Browser-JS method + REST API script (build_miro_v4.js)',
      'First customer-journey-as-code artifact — foundation for similar boards on other merchants',
      'Cohort codes: A–I (8 cohorts) + Ref (referral trigger) = 18 total promo entries',
      'Open items: ZH translations for cohort triggers, V4 frames + arrows completion, Miro PAT scaling',
    ],
  },
];

// ── MAIN ──────────────────────────────────────────────────────────────

let slidesApi, driveApi;

async function batchUpdate(deckId, requests) {
  if(FLAGS.dryRun){ console.log(`  DRY-RUN: would send ${requests.length} requests to ${deckId.slice(0,12)}…`); return []; }
  const res = await slidesApi.presentations.batchUpdate({ presentationId:deckId, requestBody:{requests} });
  return res.data.replies||[];
}

async function buildAprilSlides() {
  console.log('\n━━━ Building April slides 3–18 ━━━');

  // Step 1: delete old image slides
  const delReqs = APRIL_IMG_SLIDES.map(id=>({deleteObject:{objectId:id}}));
  console.log(`  Deleting ${delReqs.length} image slides…`);
  await batchUpdate(APRIL_DECK_ID, delReqs);
  console.log('  ✓ Deleted');

  // Step 2: build each new slide
  // After deletion, deck has 2 slides. We insert starting at index 2.
  let insertIdx = 2;
  for(const slide of APRIL_SLIDES){
    const reqs=[];
    if(slide.type==='kpi')      buildKpiSlide(reqs, slide.id, insertIdx, slide);
    else if(slide.type==='table') buildTableSlide(reqs, slide.id, insertIdx, slide);
    else if(slide.type==='cards') buildCardSlide(reqs, slide.id, insertIdx, slide);
    if(!FLAGS.dryRun){
      const res = await slidesApi.presentations.batchUpdate({
        presentationId:APRIL_DECK_ID, requestBody:{requests:reqs} });
      console.log(`  ✓ Slide ${insertIdx+1} created (${slide.id}) — ${reqs.length} ops`);
    } else {
      console.log(`  DRY-RUN: slide ${insertIdx+1} (${slide.id}) would need ${reqs.length} ops`);
    }
    insertIdx++;
  }
  console.log(`  ✓ April: ${insertIdx} slides total`);
  console.log(`  URL: https://docs.google.com/presentation/d/${APRIL_DECK_ID}/edit`);
}

async function buildMaySlides() {
  console.log('\n━━━ Building May deck ━━━');

  // Check for existing May deck
  let mayId=null;
  const search = await driveApi.files.list({
    q:`name='May 2026 - Promotions Team Report' and mimeType='application/vnd.google-apps.presentation' and trashed=false`,
    fields:'files(id,name)',
    supportsAllDrives:true,
    includeItemsFromAllDrives:true,
  });
  const existing=search.data.files?.[0];
  if(existing){
    console.log(`  Existing May deck found: ${existing.id} — rebuilding content`);
    mayId=existing.id;
  } else {
    if(FLAGS.dryRun){ console.log(`  DRY-RUN: would Drive.copy April → "May 2026 - Promotions Team Report"`); return; }
    const copy = await driveApi.files.copy({
      fileId:APRIL_DECK_ID,
      supportsAllDrives:true,
      requestBody:{ name:'May 2026 - Promotions Team Report', parents:[REPORTS_FOLDER] },
    });
    mayId=copy.data.id;
    console.log(`  ✓ Created May deck: ${mayId}`);
  }

  // Update May slides 1–2 month references
  const monthReplaces = [
    {find:'April 2026 Report', replace:'May 2026 Report'},
    {find:'April 2026 Report Promotion Team', replace:'May 2026 Report Promotion Team'},
  ];
  const repReqs = monthReplaces.map(r=>({
    replaceAllText:{ containsText:{text:r.find,matchCase:true}, replaceText:r.replace }
  }));
  await batchUpdate(mayId, repReqs);
  console.log('  ✓ Month references updated in slides 1–2');

  // Read May deck to get current slide objectIds (need to delete April content slides)
  const mayDeck = await slidesApi.presentations.get({
    presentationId:mayId, fields:'slides.objectId' });
  const maySlidesToDelete = (mayDeck.data.slides||[]).slice(2).map(s=>s.objectId);
  console.log(`  Deleting ${maySlidesToDelete.length} April-content slides from May deck…`);
  if(maySlidesToDelete.length>0){
    await batchUpdate(mayId, maySlidesToDelete.map(id=>({deleteObject:{objectId:id}})));
  }
  console.log('  ✓ Cleared');

  // Build May content slides 3–19
  let insertIdx=2;
  for(const slide of MAY_SLIDES){
    const reqs=[];
    if(slide.type==='kpi')      buildKpiSlide(reqs, slide.id, insertIdx, slide);
    else if(slide.type==='table') buildTableSlide(reqs, slide.id, insertIdx, slide);
    else if(slide.type==='cards') buildCardSlide(reqs, slide.id, insertIdx, slide);
    if(!FLAGS.dryRun){
      await slidesApi.presentations.batchUpdate({
        presentationId:mayId, requestBody:{requests:reqs} });
      console.log(`  ✓ May slide ${insertIdx+1} created (${slide.id}) — ${reqs.length} ops`);
    } else {
      console.log(`  DRY-RUN: May slide ${insertIdx+1} would need ${reqs.length} ops`);
    }
    insertIdx++;
  }
  console.log(`  ✓ May: ${insertIdx} slides total`);
  console.log(`  URL: https://docs.google.com/presentation/d/${mayId}/edit`);
}

async function main() {
  const {client} = await getGoogleAuth();
  const {google} = await loadGoogleapis();
  slidesApi = google.slides({version:'v1', auth:client});
  driveApi  = google.drive({version:'v3',  auth:client});

  // Auth check
  const meta = await slidesApi.presentations.get({
    presentationId:APRIL_DECK_ID, fields:'presentationId,title,slides.objectId'
  });
  console.log(`✓ Auth OK — April deck "${meta.data.title}", ${meta.data.slides.length} slides`);

  if(!FLAGS.mayOnly)  await buildAprilSlides();
  if(!FLAGS.aprilOnly) await buildMaySlides();
}

main().catch(e=>{
  console.error('✗ Build failed:', e.message);
  if(e.errors) console.error(JSON.stringify(e.errors,null,2));
  process.exit(1);
});
