// temp probe: get 422 error detail for popup 289
import { getSite } from '../src/sites.js';
import { authedFetch } from '../src/api-client.js';

const site = getSite('qpro2');

const r = await authedFetch(site, '/api/bo/popups?perPage=500&page=1&sort_by=id&sort_order=desc');
const popup = r?.data?.rows?.find(p => p.id === 289);
console.log('Popup meta keys:', Object.keys(popup || {}).join(', '));
console.log('Content[0] keys:', Object.keys(popup?.contents?.[0] || {}).join(', '));
console.log('\nPopup meta (no contents):', JSON.stringify({ ...popup, contents: undefined }, null, 2));

function toMysqlDatetime(isoStr) {
  if (!isoStr) return null;
  return isoStr.replace('T', ' ').replace(/\.\d+Z?$/, '').replace(/Z$/, '');
}

const body = {
  label: popup.label,
  position: popup.position,
  session: popup.session,
  start_date: toMysqlDatetime(popup.start_date),
  end_date: toMysqlDatetime(popup.end_date),
  status: popup.status,
  platform: popup.platform,
  location: popup.location || [],
  affiliates_visibility: popup.affiliates_visibility ?? 0,
  always_pop: popup.always_pop ?? 0,
  do_not_show_again: popup.do_not_show_again ?? 0,
  contents: (popup.contents || []).map(c => ({
    id: c.id, popup_id: c.popup_id, locale_id: c.locale_id,
    media_type: c.media_type, desktop_link: c.desktop_link, mobile_link: c.mobile_link,
    title: c.title, content: c.content,
    cta_button_text_1: c.cta_button_text_1, cta_button_link_1: c.cta_button_link_1,
    cta_button_text_2: c.cta_button_text_2, cta_button_link_2: c.cta_button_link_2,
  })),
};

try {
  await authedFetch(site, '/api/bo/popups/289', { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body) });
  console.log('PUT OK (no-change test passed)');
} catch(e) {
  console.log('Full error:\n', e.message);
}
