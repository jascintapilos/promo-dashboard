#!/usr/bin/env node
/**
 * V41: Hyperlink task title → Slack source message
 *
 * t.Source_Link is stored in Task_Master as the Slack permalink
 * (https://the-company-team-hub.slack.com/archives/<ch>/p<ts>)
 * built during serverSyncSlackTasks().
 *
 * Change: in taskRow(), build titleHtml that wraps title in <a> when
 * Source_Link is present. Styled color:inherit so it blends with the
 * row text; underline on hover via CSS class, opens in new tab.
 */
import { getGoogleAuth } from '../src/google-auth.js';
const SCRIPT_ID = '1G8PrjOQ45yafM4lo3dL1AG8HKFSZ8tSlX7ei9EPZgw6bacjHk5CPtTW_';
const { client } = await getGoogleAuth();
const tok = (await client.getAccessToken()).token;

async function api(method, url, body) {
  const r = await fetch(`https://script.googleapis.com/v1${url}`, {
    method, headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${method} ${url}: ${r.status} ${await r.text()}`);
  return r.json();
}

const proj = await api('GET', `/projects/${SCRIPT_ID}/content`);
const dashIdx = proj.files.findIndex(f => f.name === 'Dashboard');
let dash = proj.files[dashIdx].source;

// ── FIX 1: Add .task-link CSS for hover underline ─────────────────────────────
// Insert after .scroll-btn:hover rule
const OLD_SCROLL_BTN_CSS = `.scroll-btn:hover{background:var(--accent);border-color:var(--accent);color:#fff}`;
const NEW_SCROLL_BTN_CSS = `.scroll-btn:hover{background:var(--accent);border-color:var(--accent);color:#fff}
.task-link{color:inherit;text-decoration:none}
.task-link:hover{text-decoration:underline;text-underline-offset:3px}`;

if (dash.includes(OLD_SCROLL_BTN_CSS)) {
  dash = dash.replace(OLD_SCROLL_BTN_CSS, NEW_SCROLL_BTN_CSS);
  console.log('✓ .task-link CSS added');
} else {
  console.error('WARN: scroll-btn:hover CSS not found — skipping CSS add');
}

// ── FIX 2: Add titleHtml var in taskRow after const title line ────────────────
const OLD_TITLE_VAR = `  const title = esc(t.Title || t.Module || '—');`;
const NEW_TITLE_VAR = `  const title = esc(t.Title || t.Module || '—');
  const titleHtml = t.Source_Link
    ? '<a href="' + esc(t.Source_Link) + '" target="_blank" rel="noopener" class="task-link">' + title + '</a>'
    : title;`;

if (dash.includes(OLD_TITLE_VAR)) {
  dash = dash.replace(OLD_TITLE_VAR, NEW_TITLE_VAR);
  console.log('✓ titleHtml var added to taskRow');
} else {
  console.error('WARN: const title line not matched');
}

// ── FIX 3: Replace ${title} with ${titleHtml} in the title <td> ──────────────
const OLD_TITLE_TD = `<td style="font-weight:500;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">\${title}</td>`;
const NEW_TITLE_TD = `<td style="font-weight:500;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">\${titleHtml}</td>`;

if (dash.includes(OLD_TITLE_TD)) {
  dash = dash.replace(OLD_TITLE_TD, NEW_TITLE_TD);
  console.log('✓ Title <td> now uses titleHtml (linked when Source_Link present)');
} else {
  console.error('WARN: title <td> pattern not matched');
}

// ── FIX 4: Badge V40 → V41 ───────────────────────────────────────────────────
const OLD_BADGE = `>V40 ✓</span>`;
const NEW_BADGE = `>V41 ✓</span>`;
if (dash.includes(OLD_BADGE)) {
  dash = dash.replace(OLD_BADGE, NEW_BADGE);
  console.log('✓ Badge → V41');
} else {
  console.error('WARN: V40 badge not found');
}

proj.files[dashIdx].source = dash;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('✓ Pushed');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V41: title hyperlinks to Slack source message — ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);
console.log('');
console.log('Deploy V' + v.versionNumber + ' → Manage deployments → pick Version ' + v.versionNumber);
