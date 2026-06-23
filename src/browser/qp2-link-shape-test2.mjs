// Try more dialog_popup_list shapes — pull the full popup object from
// GET /popups and embed it as-is, or transform it various ways.

import fs from 'node:fs/promises';
import { getSite } from '../sites.js';
import { authedFetch, updatePromotion } from '../api-client.js';

const v25 = JSON.parse(await fs.readFile('captures/api-contract/2026-05-15T09-29-39-335Z-P-MULTI-test-v25-QP2A.json', 'utf8'));
const v25Body = JSON.parse((v25.calls || v25).find((c) => c.method === 'PUT' && c.url.includes('/promotion/')).requestBody);

const site = getSite('ibc22');
const promoId = 1154;

// Pull our V4 popup (id=1073, code=KFLZ9) from the list
const popups = await authedFetch(site, '/api/bo/popups?paginate=false&status=1');
const fullPopup = (popups?.data || popups?.data?.rows || []).find((p) => p.id === 1073);
if (!fullPopup) { console.error('popup 1073 not found'); process.exit(1); }
console.log('full popup keys:', Object.keys(fullPopup).join(', '));

const baseBody = { ...v25Body, id: promoId, code: 'TEST_API_QP2A_FC_V4',
  name: 'TEST API QP2A Exclusive Offer - 30 Free Credit (V4 API)',
  message_template_id: 1027 };

// Build the dialog-popup-list entry by mirroring the popup row + adding
// promotion_id (the field the Edit modal sets when an operator picks).
const sixField = {
  id: fullPopup.id,
  start_date: fullPopup.start_date,
  end_date: fullPopup.end_date,
  promotion_id: promoId,
  labelKey: `${fullPopup.code} (${fullPopup.contents?.[0]?.title?.slice(0, 14) || ''} . . . )`,
  code: fullPopup.code,
};
console.log('built six-field entry:', JSON.stringify(sixField));

const shapes = [
  { label: 'full popup as array',         val: [fullPopup] },
  { label: 'full popup keyed by 0',       val: { '0': fullPopup } },
  { label: '6-field with proper labelKey',val: { '0': sixField } },
  { label: '6-field array form',          val: [sixField] },
  { label: 'popup + promotion_id keyed',  val: { '0': { ...fullPopup, promotion_id: promoId } } },
  { label: 'just {id, code}',             val: { '0': { id: 1073, code: 'KFLZ9' } } },
];

for (const shape of shapes) {
  const body = { ...baseBody, dialog_popup_list: shape.val };
  try {
    const r = await updatePromotion(site, promoId, body);
    console.log(`✅ "${shape.label}" → OK`);
    console.log('   Working shape:', JSON.stringify(shape.val).slice(0, 300));
    break;
  } catch (e) {
    const m = (e.message.match(/I22-\w+/) || [''])[0];
    console.log(`❌ "${shape.label}" → ${m}`);
  }
}
