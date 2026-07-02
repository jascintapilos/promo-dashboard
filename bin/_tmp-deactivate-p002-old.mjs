// One-shot: deactivate old P002-r3 save (FT_88FS_10X_060_GOO, promo=1310, MT=1236, popup=1615)
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const SITE_ID = 'qp2a';
const PROMO_ID = 1310;
const MT_ID = 1236;
const POPUP_ID = 1615;

const site = getSite(SITE_ID);

function isoToYmdHms(iso) {
  if (!iso || typeof iso !== 'string') return iso;
  return iso.replace('T', ' ').replace(/\.\d+Z?$/, '').replace(/Z$/, '');
}

// 1. Deactivate promo
console.log(`→ Deactivating promo ${PROMO_ID}…`);
const detail = await authedFetch(site, `/api/bo/promotion/${PROMO_ID}`);
const body = detail?.data?.rows;
if (!body) throw new Error('GET promo returned no body');
body.status = 0;
if (body.valid_from) body.valid_from = isoToYmdHms(body.valid_from);
if (body.valid_to)   body.valid_to   = isoToYmdHms(body.valid_to);
// merchant_ids: GET returns [{id,name,...}], PUT expects [id]
if (Array.isArray(body.merchant_ids) && body.merchant_ids.length && typeof body.merchant_ids[0] === 'object') {
  body.merchant_ids = body.merchant_ids.map(m => m.id);
}
for (const k of [
  'created_at', 'updated_at', 'created_by', 'updated_by', 'deleted_at',
  'promotion_category', 'currencies', 'message_templates',
  'sms_message_templates', 'bonus_type', 'member_group', 'target_type',
  'game_provider', 'category', 'currencies_bonus_type', 'kyc_type',
  'phase_game_provider_code', 'phase_game_provider_category',
  'kyc_listing', 'bonus_settings', 'site_name', 'merchant_name',
  'platform_name', 'frequency_text', 'before_ftd', 'ftd',
  'deposit_count_reset_frequency', 'deposit_count_reset_day',
  'fingerprint_check', 'freespin_check', 'allow_deposit',
  'allow_continuous_claim', 'auto_reward_activation', 'withdrawal_unlock',
  'active_period', 'members_only',
  'promotion_currency', 'promotion_currency_rate',
  'blacklists', 'promotion_reward', 'dialog_popup_list', 'promotion_names',
]) { delete body[k]; }
if (body.free_spin_game_code == null) delete body.free_spin_game_code;
if (body.promo_p1_id == null)         delete body.promo_p1_id;
if (body.promo_p2_id == null)         delete body.promo_p2_id;
if (body.promo_p2_code == null)       delete body.promo_p2_code;
if (body.promo_p2_name == null)       delete body.promo_p2_name;
if (body.reset_day == null)           delete body.reset_day;
if (body.reset_month == null)         delete body.reset_month;
if (body.free_spin_game_provider_id == null) delete body.free_spin_game_provider_id;
if (body.blacklist_template_id == null) delete body.blacklist_template_id;
if (body.bonus_rate == null)          delete body.bonus_rate;
await authedFetch(site, `/api/bo/promotion/${PROMO_ID}`, { method: 'PUT', body });
console.log(`  ✓ promo ${PROMO_ID} deactivated (status=0)`);

// 2. Deactivate MT
console.log(`→ Deactivating MT ${MT_ID}…`);
const mtDetail = await authedFetch(site, `/api/bo/messagetemplate/${MT_ID}`);
const tmpl = mtDetail?.data?.message_template;
const details = mtDetail?.data?.message_details;
if (!tmpl) throw new Error('MT detail returned no body');
const mtPut = { name: tmpl.name, section: tmpl.section, type: tmpl.type, status: 0, details };
await authedFetch(site, `/api/bo/messagetemplate/${MT_ID}`, { method: 'PUT', body: mtPut });
console.log(`  ✓ MT ${MT_ID} deactivated (status=0)`);

// 3. Deactivate popup
console.log(`→ Deactivating popup ${POPUP_ID}…`);
const popupList = await authedFetch(site, `/api/bo/popups?perPage=200&page=1`);
const popup = popupList?.data?.rows?.find(p => p.id === POPUP_ID);
if (!popup) {
  console.log(`  ⚠ popup ${POPUP_ID} not found in list — skipping`);
} else {
  const contents = Array.isArray(popup.contents)
    ? Object.fromEntries(popup.contents.map((c, i) => [String(i), c]))
    : popup.contents || {};
  const fn = s => s ? s.replace('T', ' ').replace(/\.\d+Z?$/, '').replace(/Z$/, '') : s;
  const popupPut = { ...popup, status: 0, start_date: fn(popup.start_date), end_date: fn(popup.end_date), contents };
  await authedFetch(site, `/api/bo/popups/${POPUP_ID}`, { method: 'PUT', body: popupPut });
  console.log(`  ✓ popup ${POPUP_ID} deactivated (status=0)`);
}

console.log('\n✓ Done. Old P002 (FT_88FS_10X_060_GOO) is now inactive on QP2A.');
