/**
 * Build a single UNIFIED promo report with real Malaysia + Singapore tabs.
 *
 * The report template renders one market via load-time global singletons, so two markets
 * cannot share one script scope. Instead of refactoring the render engine (high risk to a
 * live deliverable), this composes the two ALREADY-BUILT, verified reports as isolated
 * iframes behind one country switcher: each market renders exactly as its standalone report
 * (MY with its narrative/whale/RM; SG with suppression/no-whale/S$). The shell adds a header,
 * the Malaysia|Singapore switcher, a shared theme toggle (pushed into both frames), and
 * auto-height so each frame grows to its content.
 *
 * Inputs : outputs/acq-dashboard-MY.html, outputs/acq-dashboard-SG.html (build those first).
 * Output : outputs/acq-dashboard-UNIFIED.html
 * Run    : node bin/build_unified.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

// --- embed tweak: hide the report's own header + country tabs, add theme-sync + height reporter ---
function embedTweak(html) {
  html = html.replace(
    '</style>',
    '\n  /* embedded in the unified shell — the shell supplies the header + country switcher */\n'
    + '  header{display:none!important} #ctabs{display:none!important} body{padding-top:6px!important}\n'
    + '</style>');
  const inject = `
<script>
(function(){
  function paintTheme(t){ try{ if(t){document.documentElement.setAttribute('data-theme',t);} else {document.documentElement.removeAttribute('data-theme');} if(window.paint)window.paint(); }catch(_){} }
  window.addEventListener('message',function(e){ var d=e&&e.data||{}; if(d.type==='theme'){ paintTheme(d.theme); reportH(); } });
  function reportH(){ try{ var h=Math.max(document.body.scrollHeight, document.documentElement.scrollHeight); parent.postMessage({type:'frameH',h:h},'*'); }catch(_){} }
  try{ new ResizeObserver(reportH).observe(document.body); }catch(_){}
  window.addEventListener('load',function(){ reportH(); try{ parent.postMessage({type:'frameReady'},'*'); }catch(_){} });
  document.addEventListener('click',function(){ setTimeout(reportH,80); setTimeout(reportH,300); });
  setInterval(reportH, 1500);
  reportH();
})();
<\/script>`;
  return html + inject;
}

const my = embedTweak(read('outputs/acq-dashboard-MY.html'));
const sg = embedTweak(read('outputs/acq-dashboard-SG.html'));
for (const [name, h] of [['MY', my], ['SG', sg]]) {
  if (h.includes('</template>')) throw new Error(`${name} report contains </template> — cannot embed via <template>`);
}

const shell = `<title>Promo Report</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Source+Sans+3:ital,wght@0,400;0,500;0,600;0,700&display=swap">
<style>
  :root{
    --sans:"Source Sans 3",system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    --bg:#F1F4F4; --surface:#FFFFFF; --inset:#EEF3F2; --ink:#152420; --muted:#54655F;
    --line:#E2E9E7; --accent:#0E7C7B; --shadow:0 1px 2px rgba(18,40,36,.05),0 6px 20px -12px rgba(18,40,36,.16);
  }
  @media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
    --bg:#0D1514; --surface:#15201E; --inset:#101917; --ink:#EAF0EE; --muted:#A3B6B2;
    --line:#243330; --accent:#41B2B0; --shadow:0 1px 2px rgba(0,0,0,.3),0 8px 24px -14px rgba(0,0,0,.6);
  }}
  :root[data-theme="dark"]{
    --bg:#0D1514; --surface:#15201E; --inset:#101917; --ink:#EAF0EE; --muted:#A3B6B2;
    --line:#243330; --accent:#41B2B0; --shadow:0 1px 2px rgba(0,0,0,.3),0 8px 24px -14px rgba(0,0,0,.6);
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);-webkit-font-smoothing:antialiased}
  .wrap{max-width:1280px;margin:0 auto;padding:0 20px}
  header{display:flex;align-items:flex-end;justify-content:space-between;padding:26px 0 4px}
  .eyebrow{font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--accent)}
  h1{margin:2px 0 0;font-size:30px;font-weight:700;letter-spacing:-.01em}
  .toggle{appearance:none;background:var(--surface);border:1px solid var(--line);border-radius:10px;color:var(--muted);
          font:inherit;font-size:13.5px;font-weight:600;padding:8px 14px;cursor:pointer;display:inline-flex;gap:7px;align-items:center;box-shadow:var(--shadow)}
  .toggle:hover{color:var(--ink)}
  .ctabs{display:inline-flex;gap:3px;background:var(--inset);border:1px solid var(--line);border-radius:12px;padding:3px;margin:22px 0 6px}
  .ctab{appearance:none;background:none;border:none;font:inherit;font-size:14.5px;font-weight:600;color:var(--muted);
        padding:8px 22px;border-radius:9px;cursor:pointer}
  .ctab.active{background:var(--surface);color:var(--ink);box-shadow:var(--shadow)}
  .ctab:hover:not(.active){color:var(--ink)}
  .frames{padding-bottom:40px}
  iframe{width:100%;border:0;display:block;background:var(--bg);min-height:80vh;overflow:hidden}
  iframe[hidden]{display:none}
</style>
<div class="wrap">
  <header>
    <div><div class="eyebrow">WS1</div><h1>Promo Report</h1></div>
    <button class="toggle" id="themeBtn"><span id="tIcon">●</span><span id="tTxt">Dark</span></button>
  </header>
  <nav class="ctabs" id="ctabs">
    <button class="ctab active" data-c="my">Malaysia</button>
    <button class="ctab" data-c="sg">Singapore</button>
  </nav>
  <div class="frames">
    <iframe id="f-my" title="Malaysia promo report"></iframe>
    <iframe id="f-sg" title="Singapore promo report" hidden></iframe>
  </div>
</div>
<template id="tpl-my">${my}</template>
<template id="tpl-sg">${sg}</template>
<script>
(function(){
  var fMy=document.getElementById('f-my'), fSg=document.getElementById('f-sg');
  var frames={my:fMy, sg:fSg};
  fMy.srcdoc=document.getElementById('tpl-my').innerHTML;
  fSg.srcdoc=document.getElementById('tpl-sg').innerHTML;

  // ---- theme (shared; pushed into both frames) ----
  var root=document.documentElement;
  function curTheme(){ return root.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light'); }
  function pushTheme(){ var t=root.getAttribute('data-theme'); ['my','sg'].forEach(function(k){ try{ frames[k].contentWindow.postMessage({type:'theme',theme:t},'*'); }catch(_){} }); }
  function setTheme(t){ if(t){root.setAttribute('data-theme',t);} else {root.removeAttribute('data-theme');}
    var dark=curTheme()==='dark';
    document.getElementById('tTxt').textContent=dark?'Light':'Dark';
    document.getElementById('tIcon').textContent=dark?'○':'●';
    try{localStorage.setItem('promoUnifiedTheme',t||'')}catch(_){}
    pushTheme();
  }
  document.getElementById('themeBtn').addEventListener('click',function(){ setTheme(curTheme()==='dark'?'light':'dark'); });
  (function(){ var t=null; try{t=localStorage.getItem('promoUnifiedTheme')}catch(_){}
    if(t){setTheme(t);} else { var dark=matchMedia('(prefers-color-scheme:dark)').matches; document.getElementById('tTxt').textContent=dark?'Light':'Dark'; document.getElementById('tIcon').textContent=dark?'○':'●'; } })();

  // ---- country switch ----
  var tabs=[].slice.call(document.querySelectorAll('.ctab'));
  function show(c){ ['my','sg'].forEach(function(k){ frames[k].hidden = (k!==c); });
    tabs.forEach(function(t){ t.classList.toggle('active', t.dataset.c===c); });
    try{localStorage.setItem('promoUnifiedCountry',c)}catch(_){}
    try{ frames[c].contentWindow.postMessage({type:'theme',theme:root.getAttribute('data-theme')},'*'); }catch(_){}
  }
  tabs.forEach(function(t){ t.addEventListener('click',function(){ show(t.dataset.c); }); });
  var sc=null; try{sc=localStorage.getItem('promoUnifiedCountry')}catch(_){}
  show(sc==='sg'?'sg':'my');

  // ---- auto-height + theme handshake from frames ----
  window.addEventListener('message',function(e){
    var d=e&&e.data||{}; if(!d||!d.type) return;
    var el = e.source===fMy.contentWindow ? fMy : (e.source===fSg.contentWindow ? fSg : null);
    if(d.type==='frameH' && el && d.h){ el.style.height=(d.h+2)+'px'; }
    if(d.type==='frameReady'){ pushTheme(); }
  });
})();
<\/script>`;

fs.mkdirSync(path.join(ROOT, 'outputs'), { recursive: true });
const dest = 'outputs/acq-dashboard-UNIFIED.html';
fs.writeFileSync(path.join(ROOT, dest), shell, 'utf8');
console.log(`built ${dest} (${(shell.length / 1024 / 1024).toFixed(2)} MB) — MY+SG iframes behind one Malaysia|Singapore switcher`);
