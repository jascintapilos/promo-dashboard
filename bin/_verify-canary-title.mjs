#!/usr/bin/env node
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';
const site = getSite('qpro3');
const im = await authedFetch(site, '/api/bo/messagetemplate/419');
for (const d of Object.values(im.data?.message_details || {})) {
  console.log(`MT 419 locale=${d.settings_locale_id} subject="${d.subject}"`);
}
const pr = await authedFetch(site, '/api/bo/popups?perPage=300&page=1');
const pop = Object.values(pr.data?.rows || {}).find(p => p.id === 288);
console.log(`\nPopup 288 label="${pop.label}"`);
for (const c of pop.contents || []) {
  console.log(`  locale=${c.locale_id} title="${c.title}"`);
  const ref = (c.content || '').match(/Choose \[<strong>(.*?)<\/strong>\]/) || (c.content || '').match(/<strong>\[(.*?)\s?\]<\/strong>/);
  if (ref) console.log(`    content ref: "${ref[1]}"`);
}
