#!/usr/bin/env node
/**
 * V48 — Automation-aware AI insights.
 *
 * When promo_testbot tasks exist in the filtered range, the AI Summary,
 * Positive Changes, Areas to Improve, and Recommendations all surface
 * the automation impact on team workload:
 *   • AI Summary highlights manual-workload reduction
 *   • Top Positive Changes gets an "Automation Coverage ↑" entry
 *   • Recommendations adapts (e.g. "scale automation to more modules")
 *   • If manual workload grew despite automation, calls out demand spike
 */
import { getGoogleAuth } from '../src/google-auth.js';

const SCRIPT_ID     = '1Zw5W9LjmYL5hzFpHXdr0G_Q7oFRVCAGqZVTBmQCjiOmZIO2R7M6h8l6O';
const DEPLOYMENT_ID = 'AKfycbz8wysv66dtQuh4JsWiguglcsZUcsmLMd1N3ELdJQ9sYuXhoBsOuu9R6BeTjiIcAMYJPQ';

const { client } = await getGoogleAuth();
const tok = (await client.getAccessToken()).token;

async function api(method, url, body) {
  const r = await fetch(`https://script.googleapis.com/v1${url}`, {
    method,
    headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${method} ${url}: ${r.status} ${await r.text()}`);
  return r.json();
}

const proj = await api('GET', `/projects/${SCRIPT_ID}/content`);
const dashIdx = proj.files.findIndex(f => f.name === 'Dashboard');
let dash = proj.files[dashIdx].source;

// ─── Step 1: Extend __automationStats_ to expose prevTotal + prevManual ──────
const OLD_AUTO_RETURN = `  return {
    total: tasks.length, bot: bot.length, manual: manual, rate: rate,
    hoursSaved: hoursSaved, byModule: byModule,
    prevBot: prevBot.length, delta: __delta_(bot.length, prevBot.length),
  };
}`;

const NEW_AUTO_RETURN = `  var prevTotal = prevTasks.length;
  var prevManual = prevTotal - prevBot.length;
  var prevRate = prevTotal > 0 ? Math.round((prevBot.length / prevTotal) * 100) : 0;
  return {
    total: tasks.length, bot: bot.length, manual: manual, rate: rate,
    hoursSaved: hoursSaved, byModule: byModule,
    prevTotal: prevTotal, prevBot: prevBot.length, prevManual: prevManual, prevRate: prevRate,
    delta: __delta_(bot.length, prevBot.length),
    rateDelta: __delta_(rate, prevRate),
    manualDelta: __delta_(manual, prevManual),
  };
}`;

if (!dash.includes(OLD_AUTO_RETURN)) {
  console.error('✗ __automationStats_ return anchor not found');
  process.exit(1);
}
dash = dash.replace(OLD_AUTO_RETURN, NEW_AUTO_RETURN);
console.log('✓ __automationStats_ extended with prev-period workload fields');

// ─── Step 2: Rewrite __insightsRow_ summary/changes/recs to be auto-aware ────
const OLD_INSIGHTS = `function __insightsRow_(t, prevT, weeks, prev) {
  var totalCurr = t.p + t.b + t.c + t.g;
  var totalPrev = prevT.p + prevT.b + prevT.c + prevT.g;
  var deltaTotal = __delta_(totalCurr, totalPrev);

  // Compute changes per module
  function changeRow(label, curr, prev, inverseGood) {
    var d = __delta_(curr, prev);
    if (!d || d.dir==='flat') return null;
    var good = inverseGood ? d.dir==='down' : d.dir==='up';
    return { label: label, pct: d.pct, dir: d.dir, good: good };
  }
  var changes = [
    changeRow('Promo Codes', t.p, prevT.p),
    changeRow('Banners', t.b, prevT.b),
    changeRow('CRM Campaigns', t.c, prevT.c),
    changeRow('New Games', t.g, prevT.g),
  ].filter(Boolean);

  var positives = changes.filter(function(c){return c.good;}).sort(function(a,b){return b.pct-a.pct;});
  var negatives = changes.filter(function(c){return !c.good;}).sort(function(a,b){return b.pct-a.pct;});

  // AI summary text
  var dirWord = deltaTotal.dir==='up' ? 'increased' : deltaTotal.dir==='down' ? 'decreased' : 'stayed flat';
  var summary = '';
  if (weeks.length === 0) {
    summary = 'No data in the selected range.';
  } else {
    summary = 'Total output ' + dirWord + ' by <strong>' + deltaTotal.pct + '%</strong> vs previous '+weeks.length+'-week period. ';
    if (weeks.length >= 4) {
      var promoTrend = weeks.map(function(w){return w.p;});
      var rising = promoTrend[promoTrend.length-1] > promoTrend[0];
      summary += 'Promo throughput is <strong>'+(rising?'rising':'falling')+'</strong> across the range. ';
    }
    if (negatives.length) {
      summary += '<strong>'+negatives[0].label+'</strong> saw the biggest dip ('+negatives[0].pct+'%) — investigate workload.';
    } else if (positives.length) {
      summary += '<strong>'+positives[0].label+'</strong> grew the most (+'+positives[0].pct+'%) — strong momentum.';
    }
  }

  function changeList(arr, color, arrow) {
    if (!arr.length) return '<div style="color:var(--muted);font-size:11px;padding:6px 0">No significant changes</div>';
    return arr.map(function(c){
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--border);font-size:12px">'
        +'<span style="color:var(--text)">'+arrow+' '+c.label+'</span>'
        +'<span style="color:'+color+';font-weight:700;font-size:11px">'+(c.dir==='up'?'+':'-')+c.pct+'%</span>'
      +'</div>';
    }).join('');
  }

  // Recommendations
  var recs = [];
  if (negatives.length) recs.push('Investigate <strong>'+negatives[0].label+'</strong> drop — check workload + blockers.');
  if (positives.length) recs.push('Replicate <strong>'+positives[0].label+'</strong> success pattern across other modules.');
  if (totalCurr / Math.max(1, weeks.length) > 80) recs.push('High volume sustained — consider rebalancing per-owner capacity.');
  if (recs.length < 3) recs.push('Sync banner production cadence to match promo code throughput.');
  if (recs.length < 3) recs.push('Continue automation rollout — current pace is on track.');`;

const NEW_INSIGHTS = `function __insightsRow_(t, prevT, weeks, prev) {
  var totalCurr = t.p + t.b + t.c + t.g;
  var totalPrev = prevT.p + prevT.b + prevT.c + prevT.g;
  var deltaTotal = __delta_(totalCurr, totalPrev);

  // Automation context — drives the workload narrative when bot tasks exist
  var auto = __automationStats_();
  var hasAutomation = auto.bot > 0;
  var manualReduced = hasAutomation && auto.manualDelta && auto.manualDelta.dir === 'down';
  var rateGrew = hasAutomation && auto.rateDelta && auto.rateDelta.dir === 'up';
  var botGrew  = hasAutomation && auto.delta && auto.delta.dir === 'up';

  // Compute changes per module
  function changeRow(label, curr, prev, inverseGood) {
    var d = __delta_(curr, prev);
    if (!d || d.dir==='flat') return null;
    var good = inverseGood ? d.dir==='down' : d.dir==='up';
    return { label: label, pct: d.pct, dir: d.dir, good: good };
  }
  var changes = [
    changeRow('Promo Codes', t.p, prevT.p),
    changeRow('Banners', t.b, prevT.b),
    changeRow('CRM Campaigns', t.c, prevT.c),
    changeRow('New Games', t.g, prevT.g),
  ].filter(Boolean);

  // Inject automation-driven changes as inverse-good metrics (down is good for manual workload)
  if (hasAutomation) {
    if (rateGrew)      changes.push({ label:'Automation Coverage', pct: auto.rateDelta.pct, dir:'up',   good:true });
    if (botGrew)       changes.push({ label:'Bot-Handled Tasks',   pct: auto.delta.pct,    dir:'up',   good:true });
    if (manualReduced) changes.push({ label:'Manual Workload',     pct: auto.manualDelta.pct, dir:'down', good:true });
    else if (auto.manualDelta && auto.manualDelta.dir==='up')
                       changes.push({ label:'Manual Workload',     pct: auto.manualDelta.pct, dir:'up',   good:false });
  }

  var positives = changes.filter(function(c){return c.good;}).sort(function(a,b){return b.pct-a.pct;});
  var negatives = changes.filter(function(c){return !c.good;}).sort(function(a,b){return b.pct-a.pct;});

  // AI summary text
  var dirWord = deltaTotal.dir==='up' ? 'increased' : deltaTotal.dir==='down' ? 'decreased' : 'stayed flat';
  var summary = '';
  if (weeks.length === 0) {
    summary = 'No data in the selected range.';
  } else {
    summary = 'Total output ' + dirWord + ' by <strong>' + deltaTotal.pct + '%</strong> vs previous '+weeks.length+'-week period. ';
    if (weeks.length >= 4) {
      var promoTrend = weeks.map(function(w){return w.p;});
      var rising = promoTrend[promoTrend.length-1] > promoTrend[0];
      summary += 'Promo throughput is <strong>'+(rising?'rising':'falling')+'</strong> across the range. ';
    }

    if (hasAutomation) {
      // Automation narrative — surface team workload impact
      summary += '<span style="color:#10b981">🤖 Automation absorbed <strong>'+auto.bot+'</strong> task'+(auto.bot===1?'':'s')+' ('+auto.rate+'% of total), saving the team ~<strong>'+auto.hoursSaved+'h</strong> of manual effort.</span> ';
      if (manualReduced) {
        summary += '<strong style="color:#10b981">Manual workload on the team decreased '+auto.manualDelta.pct+'%</strong> vs the previous period — automation is offloading routine work and freeing capacity for higher-value tasks. ';
      } else if (auto.manualDelta && auto.manualDelta.dir==='up' && botGrew) {
        summary += 'Demand grew '+auto.manualDelta.pct+'% on the manual side, but bot output is scaling alongside it — automation is cushioning the surge. ';
      } else if (rateGrew) {
        summary += 'Automation coverage is up <strong>'+auto.rateDelta.pct+'%</strong> — the team\\'s manual load per task is trending down. ';
      }
    } else {
      if (negatives.length) {
        summary += '<strong>'+negatives[0].label+'</strong> saw the biggest dip ('+negatives[0].pct+'%) — investigate workload.';
      } else if (positives.length) {
        summary += '<strong>'+positives[0].label+'</strong> grew the most (+'+positives[0].pct+'%) — strong momentum.';
      }
    }
  }

  function changeList(arr, color, arrow) {
    if (!arr.length) return '<div style="color:var(--muted);font-size:11px;padding:6px 0">No significant changes</div>';
    return arr.map(function(c){
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--border);font-size:12px">'
        +'<span style="color:var(--text)">'+arrow+' '+c.label+'</span>'
        +'<span style="color:'+color+';font-weight:700;font-size:11px">'+(c.dir==='up'?'+':'-')+c.pct+'%</span>'
      +'</div>';
    }).join('');
  }

  // Recommendations — adapt to automation state
  var recs = [];
  if (hasAutomation) {
    if (manualReduced) {
      recs.push('🤖 <strong>Automation is reducing team workload</strong> — redirect freed capacity to QC, training, or new initiatives.');
    } else if (auto.rate < 30) {
      recs.push('Expand <strong>promo_testbot</strong> coverage — only '+auto.rate+'% of tasks are automated. Target 50%+ to unlock more team capacity.');
    }
    // Find module with low automation coverage
    var moduleNames = Object.keys(auto.byModule);
    if (moduleNames.length && moduleNames.length < 3) {
      recs.push('Scale automation beyond '+moduleNames[0]+' — apply the same bot patterns to other modules.');
    }
    if (botGrew) {
      recs.push('Bot output grew '+auto.delta.pct+'% — schedule a retro to capture what made automation effective.');
    }
  }
  if (negatives.length) recs.push('Investigate <strong>'+negatives[0].label+'</strong> drop — check workload + blockers.');
  if (positives.length && !hasAutomation) recs.push('Replicate <strong>'+positives[0].label+'</strong> success pattern across other modules.');
  if (totalCurr / Math.max(1, weeks.length) > 80) recs.push('High volume sustained — consider rebalancing per-owner capacity.');
  if (recs.length < 3) recs.push('Sync banner production cadence to match promo code throughput.');
  if (recs.length < 3 && !hasAutomation) recs.push('Roll out <strong>promo_testbot</strong> to start automating routine tasks.');`;

if (!dash.includes(OLD_INSIGHTS)) {
  console.error('✗ __insightsRow_ anchor not found (it may already be patched)');
  process.exit(1);
}
dash = dash.replace(OLD_INSIGHTS, NEW_INSIGHTS);
console.log('✓ __insightsRow_ now auto-aware (summary + changes + recommendations)');

// ─── Push & promote ──────────────────────────────────────────────────────────
proj.files[dashIdx].source = dash;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('✓ Content pushed');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V48: automation-aware AI insights (workload narrative when promo_testbot active) ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);

const dep = await api('PUT', `/projects/${SCRIPT_ID}/deployments/${DEPLOYMENT_ID}`, {
  deploymentConfig: {
    scriptId: SCRIPT_ID,
    versionNumber: v.versionNumber,
    manifestFileName: 'appsscript',
    description: 'V48: automation insights',
  },
});
console.log(`✓ Deployed V${dep.deploymentConfig.versionNumber}`);
console.log('\nhttps://script.google.com/macros/s/AKfycbz8wysv66dtQuh4JsWiguglcsZUcsmLMd1N3ELdJQ9sYuXhoBsOuu9R6BeTjiIcAMYJPQ/exec');
