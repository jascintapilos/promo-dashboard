// Google Apps Script — standalone project at script.google.com
// Deploy as Web App: Execute as "Me", Access "Anyone, even anonymous"
// Reads ALL tabs; detects promo / banner / game tables by header signature.

var SHEET_ID = '1w4r0B0xNiEobi-URKEOQkWhl_uPznPlmDY8yCFutuXQ';

function doGet(e) {
  // Auth bootstrap: ensures script.external_request scope is authorized for this deployment.
  // Safe to call — only fetches a tiny public endpoint. Remove after first successful doPost.
  try { UrlFetchApp.fetch('https://www.example.com', { muteHttpExceptions: true }); } catch(ignored) {}
  var cb = (e && e.parameter && e.parameter.callback) ? e.parameter.callback : 'callback';
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var tz = ss.getSpreadsheetTimeZone();
    var sheets = ss.getSheets();
    var promos = [], banners = [], games = [], utilisation = [], crm = [], debug = [];

    function fmt(c) {
      if (c === null || c === undefined) return '';
      if (Object.prototype.toString.call(c) === '[object Date]') {
        return Utilities.formatDate(c, tz, 'dd/MM/yyyy');
      }
      return String(c).trim();
    }

    for (var s = 0; s < sheets.length; s++) {
      var rng = sheets[s].getDataRange().getValues();
      debug.push(sheets[s].getName() + ':' + rng.length);
      var mode = null, headers = null;

      for (var i = 0; i < rng.length; i++) {
        var cells = rng[i].map(fmt);
        var low = cells.map(function(c){ return c.toLowerCase(); });

        if (low.indexOf('code') >= 0 && low.indexOf('brand') >= 0 && low.indexOf('created by') >= 0) {
          mode = 'promos'; headers = cells; continue;
        }
        if (low.indexOf('banner title') >= 0) {
          mode = 'banners'; headers = cells; continue;
        }
        if (low.indexOf('game name') >= 0 && low.indexOf('game provider') >= 0) {
          mode = 'games'; headers = cells; continue;
        }
        if (low.indexOf('staff') >= 0 && low.indexOf('% utilisation') >= 0) {
          mode = 'utilisation'; headers = cells; continue;
        }
        if (low.indexOf('crm tool') >= 0 && low.indexOf('segment name') >= 0) {
          mode = 'crm'; headers = cells; continue;
        }

        if (cells.join('') === '') continue;
        if (!mode) continue;

        var obj = {}, hasVal = false;
        for (var j = 0; j < headers.length; j++) {
          if (headers[j]) { obj[headers[j]] = cells[j]; if (cells[j] !== '') hasVal = true; }
        }
        if (!hasVal) continue;

        if (mode === 'promos') promos.push(obj);
        else if (mode === 'banners') banners.push(obj);
        else if (mode === 'games') games.push(obj);
        else if (mode === 'utilisation') utilisation.push(obj);
        else if (mode === 'crm') crm.push(obj);
      }
    }

    var result = {
      promos: promos, banners: banners, games: games, utilisation: utilisation, crm: crm,
      debug: debug, lastUpdated: new Date().toISOString()
    };
    return ContentService
      .createTextOutput(cb + '(' + JSON.stringify(result) + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);

  } catch (err) {
    return ContentService
      .createTextOutput(cb + '({"error":' + JSON.stringify(err.message) + '})')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
}

// ── FT CRM relay ──────────────────────────────────────────────────────────────
// POST handler — proxies FastTrack API calls through Google's servers,
// bypassing the Cloudflare IP block on the local machine.
//
// Body: { instance: "ws1"|"qpro1"|"qp2", token: "<portaltoken>" }
// Returns: { users, segments, activities, changelogs, segFilters }
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents || '{}');
    var instance = body.instance;
    var token = body.token;
    if (!instance || !token) return jsonOutput({ error: 'missing instance or token' });
    // Debug: return OAuth token scopes if debugScopes flag is set
    if (body.debugScopes === '1') {
      return jsonOutput({ oauthToken: ScriptApp.getOAuthToken() });
    }

    var BASES = {
      ws1:   'https://mb8.ft-crm.com',
      qpro1: 'https://alpha-iota-qp1.ft-crm.com',
      qp2:   'https://alpha-iota-qp2.ft-crm.com',
    };
    var base = BASES[instance];
    if (!base) return jsonOutput({ error: 'unknown instance: ' + instance });

    // Support optional jwtToken override for auth header
    var authValue = body.jwtToken || token;

    function hdrs() {
      return { authtoken: authValue, Accept: 'application/json', 'Content-Type': 'application/json' };
    }

    // Debug: raw fetch — returns status + first 500 chars of response for a single endpoint
    if (body.debugRaw) {
      var r = UrlFetchApp.fetch(base + body.debugRaw, { headers: hdrs(), muteHttpExceptions: true });
      return jsonOutput({ status: r.getResponseCode(), body: r.getContentText().slice(0, 500) });
    }

    function ftFetch(path, method, payload) {
      var opts = { method: method || 'get', headers: hdrs(), muteHttpExceptions: true };
      if (payload !== undefined) opts.payload = JSON.stringify(payload);
      var r = UrlFetchApp.fetch(base + path, opts);
      var txt = r.getContentText();
      if (r.getResponseCode() === 403 || /cloudflare|attention required/i.test(txt.slice(0, 300))) {
        throw new Error('CF_BLOCKED:' + instance);
      }
      return JSON.parse(txt || 'null');
    }

    // Fetch users, segments, activities (3 sequential calls)
    var usersData = ftFetch('/crm-api/Authentication/AdminUsers');
    var segsData  = ftFetch('/crm-api/ActivityManager/Segments/ByCategory/1');
    var actsData  = ftFetch('/crm-api/ActivityManager/Activities/GetActivities', 'post', { archived: false, activityTypeId: 1 });

    // YTD one-off filter — used only to scope changelog + segFilter fetches
    var year = new Date().getFullYear().toString();
    var ytdActs = (actsData && actsData.Data ? actsData.Data : []).filter(function(a) {
      var d = a.SignedDate || a.ExecutionDateTime || '';
      return d.slice(0, 4) === year && a.TriggerTypeId === 2;
    });

    // Changelogs — parallel batches via fetchAll
    var changelogs = {};
    var BATCH = 20;
    for (var i = 0; i < ytdActs.length; i += BATCH) {
      var batch = ytdActs.slice(i, i + BATCH);
      var requests = batch.map(function(a) {
        return {
          url: base + '/crm-api/Changelog/Entity/activity/' + a.ActivityId,
          method: 'get', headers: hdrs(), muteHttpExceptions: true,
        };
      });
      var responses = UrlFetchApp.fetchAll(requests);
      batch.forEach(function(a, idx) {
        try {
          var r = responses[idx];
          if (r.getResponseCode() === 200) {
            var d = JSON.parse(r.getContentText() || 'null');
            changelogs[String(a.ActivityId)] = d && d.Data ? d.Data : [];
          }
        } catch (err) {}
      });
    }

    // GetSelective for no-region segments (same region heuristics as Node.js)
    function extractRegionGas(text) {
      var t = (text || '').toUpperCase();
      if (t.indexOf('MYR') >= 0 || /\bRM\d/.test(t)) return 'MY';
      if (t.indexOf('SGD') >= 0) return 'SG';
      if (t.indexOf('IDR') >= 0) return 'ID';
      if (/\bMYS?\b/.test(t)) return 'MY';
      if (/\bSGP?\b/.test(t)) return 'SG';
      if (/\bIDN?\b/.test(t)) return 'ID';
      if (/\bTH\b/.test(t)) return 'TH';
      if (/\bKH\b/.test(t)) return 'KH';
      var em = t.match(/(?:QP|WS|BP|MB)[0-9A-Z]*(MY|SG|ID|TH|KH)/);
      return em ? em[1] : '';
    }

    var segMap = {};
    (segsData && segsData.Data ? segsData.Data : []).forEach(function(s) {
      segMap[s.SegmentId] = s.SegmentName;
    });

    var noRegionIds = [];
    var seenIds = {};
    ytdActs.forEach(function(a) {
      if (!a.SegmentId || seenIds[a.SegmentId]) return;
      var seg = segMap[a.SegmentId] || a.ActivityName || '';
      if (!extractRegionGas(seg) && !extractRegionGas(a.ActivityName || '')) {
        noRegionIds.push(a.SegmentId);
        seenIds[a.SegmentId] = true;
      }
    });

    var segFilters = {};
    var GS_BATCH = 50;
    for (var j = 0; j < noRegionIds.length; j += GS_BATCH) {
      try {
        var batchIds = noRegionIds.slice(j, j + GS_BATCH);
        var gsr = ftFetch('/crm-api/ActivityManager/Segments/GetSelective', 'post', batchIds);
        (gsr && gsr.Data ? gsr.Data : []).forEach(function(s) {
          if (s.SegmentFilter) segFilters[String(s.SegmentId)] = s.SegmentFilter;
        });
      } catch (err) { /* non-fatal */ }
    }

    return jsonOutput({
      users:      usersData && usersData.Data ? usersData.Data : [],
      segments:   segsData  && segsData.Data  ? segsData.Data  : [],
      activities: actsData  && actsData.Data  ? actsData.Data  : [],
      changelogs: changelogs,
      segFilters: segFilters,
    });
  } catch (err) {
    return jsonOutput({ error: err.message });
  }
}

function jsonOutput(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── scripts.run callable wrapper ─────────────────────────────────────────────
// Called via Apps Script REST API scripts.run — the calling token's scopes are
// used, bypassing the web app deployment credential limitation.
// Parameters: (instance: "ws1"|"qpro1"|"qp2", token: "<portaltoken>")
// Returns: JSON string of { users, segments, activities, changelogs, segFilters }
function ftFetchViaRun(instance, token) {
  var fakeEvent = { postData: { contents: JSON.stringify({ instance: instance, token: token }) } };
  var result = doPost(fakeEvent);
  return result.getContent();
}
