#!/usr/bin/env node
// Restore popup 281 on qpro3 (test artifact from probe). Label + MY_EN title = "Exclusive Offer".
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const site = getSite('qpro3');
const r = await authedFetch(site, '/api/bo/popups?perPage=300&page=1');
const pop = Object.values(r.data?.rows || {}).find(p => p.id === 281);

const contentsObj = {};
for (const c of pop.contents || []) {
  contentsObj[String(c.locale_id)] = {
    id: c.id, locale_id: c.locale_id,
    title: c.locale_id === 1 ? 'Exclusive Offer' : c.title,
    content: c.content,
    media_type: c.media_type, mobile_link: c.mobile_link, desktop_link: c.desktop_link,
    video_mobile_link: c.video_mobile_link ?? null, video_desktop_link: c.video_desktop_link ?? null,
    cta_button_type: c.cta_button_type,
    cta_button_text_1: c.cta_button_text_1, cta_button_link_1: c.cta_button_link_1,
    cta_button_text_2: c.cta_button_text_2, cta_button_link_2: c.cta_button_link_2,
  };
}
const body = {
  platform: pop.platform, start_date: pop.start_date.replace('T',' ').replace(/\.\d+Z?$/,''),
  end_date: pop.end_date, session: pop.session, position: pop.position,
  status: pop.status, location: pop.location, affiliates_visibility: pop.affiliates_visibility,
  always_pop: pop.always_pop, label: 'Exclusive Offer',
  contents: contentsObj,
};
await authedFetch(site, `/api/bo/popups/${pop.id}`, { method: 'PUT', body });
const r2 = await authedFetch(site, '/api/bo/popups?perPage=300&page=1');
const v = Object.values(r2.data?.rows || {}).find(p => p.id === 281);
console.log('Restored — label:', v?.label, '  MY_EN title:', (v?.contents || []).find(c => c.locale_id === 1)?.title);
