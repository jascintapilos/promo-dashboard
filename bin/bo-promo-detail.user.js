// ==UserScript==
// @name         BO Promo Detail Viewer
// @namespace    promo-bot
// @version      1.1
// @description  Shows real configured Categories & Game Providers in the Edit Promotion Code modal (works around BO Angular display bug)
// @match        https://ibc22.qtp777.com/*
// @match        https://bo.mei707.com/*
// @match        https://qpro2bo.mei707.com/*
// @match        https://qpro3bo.mei707.com/*
// @match        https://qpro4bo.mei707.com/*
// @match        https://qpro5bo.mei707.com/*
// @match        https://qpro6bo.mei707.com/*
// @match        https://qpro7bo.mei707.com/*
// @match        https://qpro8bo.mei707.com/*
// @match        https://qpro9bo.mei707.com/*
// @match        https://qpro10bo.mei707.com/*
// @match        https://qpro11bo.mei707.com/*
// @match        https://qpro12bo.mei707.com/*
// @match        https://qpro13bo.mei707.com/*
// @match        https://qpro14bo.mei707.com/*
// @match        https://qpro15bo.mei707.com/*
// @match        https://qpro16bo.mei707.com/*
// @match        https://qpro17bo.mei707.com/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // ── State ───────────────────────────────────────────────────────────────────
  let catById = {};           // id → name, loaded once per page
  let gpById  = {};           // id → "CODE - Name"
  let catalogsLoaded = false;

  // ── Catalog loader (runs once, silently) ────────────────────────────────────
  async function loadCatalogs() {
    if (catalogsLoaded) return;
    try {
      const [cRes, gRes] = await Promise.all([
        fetch('/api/bo/categories?perPage=500').then(r => r.json()),
        fetch('/api/bo/gameprovider?perPage=300&page=1').then(r => r.json()),
      ]);
      for (const c of Object.values(cRes?.data?.rows ?? {}))
        catById[c.id] = c.code ? `${c.code}` : c.name;
      for (const g of Object.values(gRes?.data?.rows ?? {}))
        gpById[g.id] = g.code ? `${g.code} - ${g.name ?? ''}`.trim() : String(g.id);
      catalogsLoaded = true;
    } catch { /* catalogs unavailable — will fall back to IDs */ }
  }

  // ── Intercept fetch to capture promo detail ─────────────────────────────────
  // The BO calls GET /api/bo/promotion/{id} when the Edit modal opens.
  // We piggyback on that response to get the structured data.
  const _fetch = window.fetch.bind(window);
  window.fetch = function (...args) {
    const promise = _fetch(...args);
    const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url ?? '');
    const m = url.match(/\/api\/bo\/promotion\/(\d+)$/);
    if (m) {
      promise.then(async res => {
        try {
          const clone = res.clone();
          const json  = await clone.json();
          const detail = json?.data?.rows;
          if (detail) {
            await loadCatalogs();
            // Small delay so Angular finishes building the modal DOM
            setTimeout(() => injectPanel(detail), 600);
          }
        } catch {}
      }).catch(() => {});
    }
    return promise;
  };

  // ── Panel injection ─────────────────────────────────────────────────────────
  function injectPanel(detail) {
    const container = document.querySelector('mat-dialog-container');
    if (!container) return;
    // Remove any stale panel from a previous open
    container.querySelectorAll('#promo-detail-panel').forEach(el => el.remove());

    // ── Build category list ──────────────────────────────────────────────────
    const pc = Array.isArray(detail.promotion_category) ? detail.promotion_category : [];
    const cats = pc.length
      ? pc.map(c => catById[c.category_id] ?? `id:${c.category_id}`)
      : ['— none configured'];

    // ── Build game provider list ─────────────────────────────────────────────
    const gpIds  = Array.isArray(detail.game_provider_ids) ? detail.game_provider_ids : [];
    // QP2 uses game_provider_codes (object map of string codes)
    const gpCodes = detail.game_provider_codes
      ? Object.values(detail.game_provider_codes).filter(Boolean)
      : [];
    let gps;
    if (gpIds.length) {
      gps = gpIds.map(id => gpById[id] ?? `id:${id}`);
    } else if (gpCodes.length) {
      gps = gpCodes.map(String);
    } else {
      gps = ['— none configured'];
    }
    const gpSummary = gps.length > 10
      ? `All providers (${gps.length})`
      : gps.join(', ');

    // ── Render panel ────────────────────────────────────────────────────────
    const panel = document.createElement('div');
    panel.id = 'promo-detail-panel';
    panel.style.cssText = [
      'background:#f0f7ff',
      'border:1.5px solid #1a73e8',
      'border-radius:6px',
      'padding:10px 14px',
      'margin:0 24px 12px',
      'font-size:12.5px',
      'line-height:1.8',
      'font-family:inherit',
      'z-index:9999',
    ].join(';');

    panel.innerHTML = `
      <span style="color:#1a73e8;font-weight:700">✓ Configured — live API data</span>
      &nbsp;<span style="color:#888;font-size:11px">(promo id: ${detail.id})</span><br>
      <b>Categories:</b> ${cats.join(', ')}<br>
      <b>Game Providers:</b> ${gpSummary}
    `;

    // Insert right after the dialog header (mat-dialog-title or h1)
    const header = container.querySelector('mat-dialog-title, h1, .kt-portlet__head');
    if (header) {
      header.parentNode.insertBefore(panel, header.nextSibling);
    } else {
      // Fallback: prepend inside the dialog content
      const content = container.querySelector('mat-dialog-content') ?? container;
      content.prepend(panel);
    }
  }

  // ── Clean up panel when modal closes ────────────────────────────────────────
  const bodyObserver = new MutationObserver(() => {
    if (!document.querySelector('mat-dialog-container')) {
      document.querySelectorAll('#promo-detail-panel').forEach(el => el.remove());
    }
  });
  bodyObserver.observe(document.body, { childList: true });

})();
