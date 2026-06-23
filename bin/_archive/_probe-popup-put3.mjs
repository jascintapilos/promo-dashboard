#!/usr/bin/env node
// Try popup PUT with the create-shaped body (contents as object map, not array).
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const site = getSite('qpro3');
const r = await authedFetch(site, '/api/bo/popups?perPage=300&page=1');
const pop = Object.values(r.data?.rows || {}).find(p => p.id === 281);

// Build PUT body like POST creates them (contents as object keyed by locale_id)
const contentsObj = {};
for (const c of pop.contents || []) {
  contentsObj[String(c.locale_id)] = {
    id: c.id, locale_id: c.locale_id,
    title: c.title, content: c.content,
    media_type: c.media_type, mobile_link: c.mobile_link, desktop_link: c.desktop_link,
    video_mobile_link: c.video_mobile_link ?? null, video_desktop_link: c.video_desktop_link ?? null,
    cta_button_type: c.cta_button_type,
    cta_button_text_1: c.cta_button_text_1, cta_button_link_1: c.cta_button_link_1,
    cta_button_text_2: c.cta_button_text_2, cta_button_link_2: c.cta_button_link_2,
  };
}
// modify MY_EN title for test
contentsObj['1'].title = 'TEST-PUT-NEW-TITLE';

const body = {
  platform: pop.platform, start_date: pop.start_date.replace('T',' ').replace(/\.\d+Z?$/,''),
  end_date: pop.end_date, session: pop.session, position: pop.position,
  status: pop.status, location: pop.location, affiliates_visibility: pop.affiliates_visibility,
  always_pop: pop.always_pop, label: 'TEST-PUT-NEW-LABEL',
  contents: contentsObj,
};

console.log('PUT body keys:', Object.keys(body));
console.log('contents keys:', Object.keys(body.contents));
try {
  const r2 = await authedFetch(site, `/api/bo/popups/${pop.id}`, { method: 'PUT', body });
  console.log('PUT OK:', JSON.stringify(r2.data).slice(0, 400));
} catch (e) {
  console.log('PUT ERR:', e.message);
}

// re-fetch to confirm changes
const r3 = await authedFetch(site, '/api/bo/popups?perPage=300&page=1');
const pop2 = Object.values(r3.data?.rows || {}).find(p => p.id === 281);
console.log('After PUT — label:', pop2?.label, '  MY_EN title:', (pop2?.contents || []).find(c => c.locale_id === 1)?.title);
