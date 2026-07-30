import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { getSite } from '../sites.js';
import {
  findPromotionByCodeReadonly,
  getPromotionDetailReadonly,
  getQproListingReadonly,
  readonlyIgmpPost,
} from './readonly-client.js';
import { resolveBrandRuntime } from './brand-config.js';

const FETCH_DIR = 'captures/qc-dashboard/fetches';
const FAILED_LOG = 'captures/qc-dashboard/failed-fetches.jsonl';
const CURRENCY = { 1: 'MYR', 3: 'SGD', 4: 'IDR' };

class PromoNotFoundError extends Error {
  constructor(brand, code) {
    super(`Code ${code} not found on ${brand}`);
    this.name = 'PromoNotFoundError';
    this.brand = brand;
    this.code = code;
  }
}

function isPromoNotFoundError(error) {
  return error?.name === 'PromoNotFoundError';
}

function unavailable(v) {
  if (v == null || v === '') return 'unavailable';
  if (Array.isArray(v) && !v.length) return 'unavailable';
  return v;
}

function firstPresent(...pairs) {
  for (const [obj, key] of pairs) {
    if (obj && Object.hasOwn(obj, key)) return obj[key];
  }
  return undefined;
}

function hasField(obj, key) {
  return Boolean(obj && Object.hasOwn(obj, key));
}

function isBlank(v) {
  return v == null || v === '';
}

function dateOnly(v) {
  if (isBlank(v)) return null;
  const s = String(v);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : s;
}

function validityLabel(detail = {}, listingRow = {}) {
  const start = firstPresent([detail, 'valid_from'], [detail, 'start_at'], [detail, 'start_date'], [listingRow, 'valid_from'], [listingRow, 'start_at'], [listingRow, 'start_date']);
  const end = firstPresent([detail, 'valid_to'], [detail, 'end_at'], [detail, 'end_date'], [listingRow, 'valid_to'], [listingRow, 'end_at'], [listingRow, 'end_date']);
  const hasStart = [detail, listingRow].some((o) => ['valid_from', 'start_at', 'start_date'].some((k) => hasField(o, k)));
  const hasEnd = [detail, listingRow].some((o) => ['valid_to', 'end_at', 'end_date'].some((k) => hasField(o, k)));
  if (!hasStart && !hasEnd) return 'unavailable';
  const startLabel = dateOnly(start) || 'unavailable';
  const endLabel = dateOnly(end) || 'Unlimited';
  return `${startLabel} \u2192 ${endLabel}`;
}

function formatNumberLike(v) {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
  if (typeof v !== 'string') return v;
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  return Number.isInteger(n) ? String(n) : String(n);
}

function rewardLabel(detail = {}, firstCurrency = {}) {
  const bonusRate = firstPresent([detail, 'bonus_rate'], [detail, 'bonus_percentage'], [firstCurrency, 'bonus_rate'], [firstCurrency, 'bonus_percentage']);
  if (!isBlank(bonusRate) && Number(bonusRate) !== 0) return `${formatNumberLike(bonusRate)}%`;
  const amount = firstPresent([detail, 'amount'], [firstCurrency, 'amount'], [firstCurrency, 'free_credit_amount'], [firstCurrency, 'bonus_amount']);
  if (!isBlank(amount) && Number(amount) !== 0) return formatNumberLike(amount);
  const rounds = firstPresent([detail, 'rounds'], [firstCurrency, 'rounds']);
  if (!isBlank(rounds) && Number(rounds) !== 0) return `${formatNumberLike(rounds)} spins`;
  if ([detail, firstCurrency].some((o) => ['bonus_rate', 'bonus_percentage', 'amount', 'free_credit_amount', 'bonus_amount', 'rounds'].some((k) => hasField(o, k)))) return formatNumberLike(bonusRate ?? amount ?? rounds ?? 0);
  return 'unavailable';
}

function totalLimitLabel(value, { fieldExists = false, platform } = {}) {
  if (isBlank(value)) return fieldExists && platform === 'qp2' ? 'Unlimited' : 'unavailable';
  if (Number(value) === 0) return 'Unlimited';
  return formatNumberLike(value);
}

function lifetimeClaimLabel({ detail = {}, firstCurrency = {}, platform }) {
  const topValue = firstPresent([detail, 'max_application'], [detail, 'max_claim'], [detail, 'max_applications'], [detail, 'max_total_applications']);
  if (!isBlank(topValue) || ['max_application', 'max_claim', 'max_applications', 'max_total_applications'].some((k) => hasField(detail, k))) {
    return totalLimitLabel(topValue, {
      fieldExists: ['max_application', 'max_claim', 'max_applications', 'max_total_applications'].some((k) => hasField(detail, k)),
      platform,
    });
  }
  const currencyValue = firstPresent([firstCurrency, 'max_total_applications'], [firstCurrency, 'max_claim'], [firstCurrency, 'max_application']);
  return totalLimitLabel(currencyValue, {
    fieldExists: ['max_total_applications', 'max_claim', 'max_application'].some((k) => hasField(firstCurrency, k)),
    platform,
  });
}

function dailyClaimLabel(detail = {}) {
  const value = firstPresent([detail, 'daily_max'], [detail, 'max_application_daily'], [detail, 'daily_claim_limit'], [detail, 'daily_max_claim']);
  const fieldExists = ['daily_max', 'max_application_daily', 'daily_claim_limit', 'daily_max_claim'].some((k) => hasField(detail, k));
  if (!fieldExists) return 'unavailable';
  if (isBlank(value)) return 'unavailable';
  if (Number(value) === 99999) return 'Unlimited';
  return formatNumberLike(value);
}

function recurringLabel(detail = {}) {
  const recurring = firstPresent([detail, 'recurring'], [detail, 'allow_continuous_claim']);
  const hasRecurring = ['recurring', 'allow_continuous_claim'].some((k) => hasField(detail, k));
  const reset = firstPresent([detail, 'reset_frequency'], [detail, 'frequency_type']);
  if (!hasRecurring && !hasField(detail, 'reset_frequency') && !hasField(detail, 'frequency_type')) return 'unavailable';
  if (recurring === true || recurring === 1 || recurring === '1' || String(recurring).toLowerCase() === 'recurring') {
    if (reset === 1 || reset === '1' || String(reset).toLowerCase() === 'daily') return 'Daily reset';
    return isBlank(reset) || Number(reset) === 0 ? 'Recurring' : formatNumberLike(reset);
  }
  if (recurring === false || recurring === 0 || recurring === '0' || /one\s*time|once/i.test(String(recurring))) return 'Once';
  return unavailable(recurring ?? reset);
}

function statusLabel(v) {
  if (v === 1 || v === '1' || v === true) return 'Active';
  if (v === 0 || v === '0' || v === false) return 'Inactive';
  return unavailable(v);
}

function boolPresence(v) {
  if (v === 'unavailable') return 'unavailable';
  return v ? 'present' : 'missing';
}

function asCurrencyLabel(v) {
  if (Array.isArray(v)) return unavailable(v.map((x) => CURRENCY[x] || x).join(', '));
  return unavailable(CURRENCY[v] || v);
}

function firstCurrencyBlock(rows = []) {
  return rows[0] || {};
}

export function normalizeQproQp2({ brand, runtime, listingRow, detail, currencies, names, listingFull }) {
  const firstCurrency = firstCurrencyBlock(currencies);
  const platform = String(runtime.platform || '').toLowerCase();
  const messageTemplates = listingRow?.message_templates || [];
  const dialogPopupCount = listingRow?.dialog_popup_list?.length || 0;
  const promoName = names.find((n) => n.locale?.endsWith('_EN'))?.promotion_name || detail?.name || listingRow?.name;
  const target = Array.isArray(detail?.target) ? detail.target[0] : null;
  const details = {
    promoCode: unavailable(detail?.code || listingRow?.code),
    promoName: unavailable(promoName),
    promoType: unavailable(
      listingRow?.bonus_type
      || promoTypeLabel(detail?.promo_type, detail?.promo_sub_type ?? listingRow?.promo_sub_type),
    ),
    currency: asCurrencyLabel(currencies.map((c) => c.currency).filter((v) => v != null)),
    minDeposit: unavailable(firstCurrency.min_transfer ?? firstCurrency.min_deposit),
    maxBonus: unavailable(firstCurrency.max_bonus),
    turnover: unavailable(target?.multiplier),
    reward: rewardLabel(detail, firstCurrency),
    lifetimeClaim: lifetimeClaimLabel({ detail, firstCurrency, platform }),
    dailyClaim: dailyClaimLabel(detail),
    validity: validityLabel(detail, listingRow),
    rewardValidity: unavailable(detail?.reward_validity ?? detail?.validity),
    recurring: recurringLabel(detail),
    eligibility: unavailable(detail?.member_group_ids?.length ? detail.member_group_ids.join(', ') : 'All/unspecified'),
    gamesProviders: unavailable([listingRow?.category, listingRow?.game_provider].filter(Boolean).join(' / ')),
    inboxContent: boolPresence(messageTemplates.length),
    dialogPopup: boolPresence(dialogPopupCount),
    status: statusLabel(detail?.status ?? listingRow?.status),
    createdBy: unavailable(detail?.created_by ?? listingRow?.created_by),
    createdAt: unavailable(detail?.created_at ?? listingRow?.created_at),
    updatedAt: unavailable(detail?.updated_at ?? listingRow?.updated_at),
  };
  const checkCandidate = {
    platform: runtime.platform,
    brand,
    code: details.promoCode,
    name: details.promoName,
    category: listingRow?.category || '',
    gameProvider: listingRow?.game_provider || '',
    messageTemplateCount: messageTemplates.length,
    messageTemplates,
    dialogPopupCount,
    currencies: currencies.map((c) => c.currency),
    validTo: detail?.valid_to || listingRow?.valid_to,
    status: detail?.status ?? listingRow?.status,
  };
  return { details, checkCandidate, raw: { listingRow, detail, currencies, names, listingFull } };
}

function promoTypeLabel(type, subType) {
  const combined = {
    '2:1': 'Deposit - Reload',
    '2:2': 'Deposit - Welcome',
    '3:1': 'Free Credit',
    '4:1': 'Free Spin - Welcome',
    '4:2': 'Free Spin - Reload',
  }[`${type}:${subType}`];
  if (combined) return combined;
  return ({ 1: 'Deposit', 2: 'Deposit', 3: 'Free Credit', 4: 'Free Spin', 5: 'Rebate' })[type]
    || (type == null ? null : `type_${type}`);
}

function igmpData(res) {
  return res?.data?.Promotion || res?.data || res;
}

function igmpReward(detail) {
  return detail?.PromotionRewards?.[0] || detail?.PromotionReward || detail?.Rewards?.[0] || detail?.Reward || {};
}

function normalizeIgmp({ brand, runtime, list, detail, rewardContents }) {
  const row = igmpData(list);
  const det = igmpData(detail);
  const reward = igmpReward(det);
  const type = row?.PromotionType || det?.PromotionType;
  const details = {
    promoCode: unavailable(row?.PromotionCode || det?.PromotionCode),
    promoName: unavailable(row?.PromotionName || det?.PromotionName || reward?.RewardName),
    promoType: unavailable(type),
    currency: unavailable(runtime.region),
    minDeposit: unavailable(reward?.MinDeposit ?? reward?.MinimumDeposit ?? det?.MinDeposit),
    maxBonus: unavailable(reward?.MaxBonus ?? reward?.MaximumBonus ?? reward?.MaxTransferOut),
    turnover: unavailable(reward?.Turnover ?? reward?.TurnoverMultiplier ?? det?.Turnover),
    reward: unavailable(reward?.BonusPercentage ?? reward?.FreeCreditAmount ?? reward?.Quantity ?? reward?.RewardName),
    lifetimeClaim: unavailable(det?.Quantity ?? reward?.Quantity),
    dailyClaim: unavailable(det?.DailyLimit ?? reward?.DailyLimit ?? det?.DailyClaimLimit),
    validity: unavailable(row?.PromotionStartDate && row?.PromotionEndDate ? `${row.PromotionStartDate} to ${row.PromotionEndDate}` : row?.PromotionEndDate),
    rewardValidity: unavailable(det?.ExpiryMinutes ? `${det.ExpiryMinutes} minutes` : reward?.ExpiryMinutes),
    recurring: unavailable(det?.RedeemableDay),
    eligibility: unavailable(det?.MemberGroupName || 'All/unspecified'),
    gamesProviders: unavailable(reward?.GameProviderName || reward?.GameProvider || det?.GameProviderName),
    inboxContent: boolPresence(Array.isArray(rewardContents?.data) ? rewardContents.data.length : rewardContents?.data),
    dialogPopup: 'unavailable',
    status: unavailable(row?.IsActive === true ? 'Active' : row?.Status ?? row?.IsActive),
    createdBy: 'unavailable',
    createdAt: unavailable(row?.CreatedDate),
    updatedAt: unavailable(row?.UpdatedDate),
  };
  const checkCandidate = {
    platform: 'igmp',
    brand,
    code: details.promoCode,
    siteId: runtime.siteId,
    region: runtime.region,
    promotionId: row?.PromotionId,
    promotionType: type,
    name: details.promoName,
    endDate: row?.PromotionEndDate,
    isExpired: Boolean(row?.IsExpired),
  };
  return { details, checkCandidate, raw: { list, detail, rewardContents } };
}

// R17 (TEMP DIAG — remove after root-cause identified): tiny helper that redacts
// URLs down to host-only + returns object-key shapes without values, so nothing
// sensitive lands in the pipeline log. Fires ONLY when QC_DIAG_BRAND env var
// matches the brand being fetched (default off; opt-in per deploy).
function _r17SafeHost(u) {
  try { return new URL(u).host; } catch { return String(u || '').replace(/[?#].*$/, '').slice(0, 60); }
}
function _r17Keys(obj) {
  if (obj === null || obj === undefined) return null;
  if (Array.isArray(obj)) return `Array(${obj.length})`;
  if (typeof obj === 'object') return Object.keys(obj);
  return typeof obj;
}
function _r17LogQpro({ tag, brand, code, site, listingResp, detailBundle }) {
  try {
    const listingRows = listingResp?.data?.rows || [];
    const matched = listingRows.find((r) => r.code === code);
    const currencyRows = detailBundle?.currencies || [];
    const nameRows = detailBundle?.names || [];
    console.log('[r17-diag] ' + JSON.stringify({
      tag, brand, code,
      site: { id: site?.id, platform: site?.platform, baseUrl: _r17SafeHost(site?.baseUrl), apiHost: _r17SafeHost(site?.apiHost) },
      listing: { rowCount: listingRows.length, matched: !!matched, matchedRowKeys: matched ? Object.keys(matched).slice(0, 40) : null, matchedId: matched?.id ?? null },
      detail: { keys: _r17Keys(detailBundle?.detail), sample: detailBundle?.detail?.[0] ? Object.keys(detailBundle.detail[0]).slice(0, 40) : null },
      currencies: { rowCount: currencyRows.length, firstRowKeys: currencyRows[0] ? Object.keys(currencyRows[0]).slice(0, 40) : null, firstRow: currencyRows[0] ? { currency: currencyRows[0].currency, currency_id: currencyRows[0].currency_id, currency_code: currencyRows[0].currency_code, has_currency_field: 'currency' in currencyRows[0] } : null },
      names: { rowCount: nameRows.length, firstRowKeys: nameRows[0] ? Object.keys(nameRows[0]).slice(0, 40) : null, sampleLangs: nameRows.map((n) => n.language || n.lang || n.locale || null).slice(0, 8) },
    }));
  } catch (e) {
    try { console.log('[r17-diag] logger-failed: ' + (e?.message || 'unknown')); } catch {}
  }
}

async function fetchQproQp2(brand, code, runtime) {
  const site = getSite(runtime.siteId);
  const diagTarget = process.env.QC_DIAG_BRAND;
  const diagOn = !!diagTarget && (diagTarget === '*' || diagTarget.split(',').map((s) => s.trim()).includes(brand));
  const listingResp = diagOn ? await getQproListingReadonly(site, code, { merchantId: runtime.merchantId }) : null;
  const listingRow = diagOn
    ? (listingResp?.data?.rows || []).find((r) => r.code === code) || null
    : await findPromotionByCodeReadonly(site, code, { merchantId: runtime.merchantId });
  if (!listingRow) {
    if (diagOn) _r17LogQpro({ tag: 'listing-empty', brand, code, site, listingResp, detailBundle: null });
    throw new PromoNotFoundError(brand, code);
  }
  const [detailBundle, listingFull] = await Promise.all([
    getPromotionDetailReadonly(site, listingRow.id),
    diagOn ? Promise.resolve(listingResp) : getQproListingReadonly(site, code, { merchantId: runtime.merchantId }),
  ]);
  if (diagOn) _r17LogQpro({ tag: 'listing+detail', brand, code, site, listingResp: listingFull, detailBundle });
  const fullRow = (listingFull?.data?.rows || []).find((r) => r.code === code) || listingRow;
  return normalizeQproQp2({ brand, runtime, listingRow: fullRow, listingFull, ...detailBundle });
}

async function fetchIgmp(brand, code, runtime) {
  const list = await readonlyIgmpPost(runtime.siteId, '/PM/GetPromotionInfoByCode', { PromotionCode: code });
  const row = igmpData(list);
  if (!row?.PromotionId) throw new PromoNotFoundError(brand, code);
  const detailEndpoint = {
    Bonus: '/PM/GetBonusInfo',
    Deposit: '/PM/GetBonusInfo',
    FreeCredit: '/PM/GetFreeCreditInfo',
    'Free Credit': '/PM/GetFreeCreditInfo',
    FreeSpin: '/PM/GetFreeSpinPromotionInfo',
    'Free Spin': '/PM/GetFreeSpinPromotionInfo',
  }[row.PromotionType] || '/PM/GetBonusInfo';
  const detail = await readonlyIgmpPost(runtime.siteId, detailEndpoint, { PromotionId: row.PromotionId });
  const rewardId = igmpReward(igmpData(detail))?.RewardId;
  const rewardContents = rewardId
    ? await readonlyIgmpPost(runtime.siteId, '/PM/GetPromotionRewardContents', { RewardId: rewardId })
    : { data: null };
  return normalizeIgmp({ brand, runtime, list, detail, rewardContents });
}

// R14: shared "unavailable" details shape reused by both the resolve-runtime
// pre-fetch catch and the fetch failure catch below. Keeps every failure mode
// returning the same shape so the frontend never gets an unexpected null.
const UNAVAILABLE_DETAILS = {
  promoName: 'unavailable', promoType: 'unavailable', currency: 'unavailable',
  minDeposit: 'unavailable', maxBonus: 'unavailable', turnover: 'unavailable',
  reward: 'unavailable', lifetimeClaim: 'unavailable', dailyClaim: 'unavailable',
  validity: 'unavailable', recurring: 'unavailable', eligibility: 'unavailable',
  gamesProviders: 'unavailable', inboxContent: 'unavailable', rewardValidity: 'unavailable',
  status: 'unavailable', createdBy: 'unavailable', updatedAt: 'unavailable',
};
function unavailableSnapshot({ brand, code, runtime = null, error, detail }) {
  return {
    brand, code, runtime,
    fetchedAt: new Date().toISOString(),
    snapshotPath: null,
    error, detail,
    notFound: false,
    details: { promoCode: code, ...UNAVAILABLE_DETAILS },
    checkCandidate: { platform: runtime?.platform || 'unknown', brand, code },
    raw: null,
  };
}

export async function fetchPromoSnapshot({ brand, code }) {
  // R14: wrap resolveBrandRuntime so a bad site config on the SELECTED brand
  // returns the same "unavailable" details shape as notFound (with a config-
  // specific error label) instead of throwing out of the API handler.
  let runtime;
  try {
    runtime = resolveBrandRuntime(brand);
  } catch (e) {
    const detail = e?.code === 'SITE_CONFIG_INCOMPLETE'
      ? (e.publicMessage || 'Site not fully configured on server')
      : (e?.publicMessage || 'Unknown brand configuration error');
    try { console.warn(`[qc-hub] fetchPromoSnapshot resolve failed: brand=${brand} ${e?.message || 'unknown'}`); } catch {}
    return unavailableSnapshot({ brand, code, error: 'Site config incomplete', detail });
  }
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  await mkdir(FETCH_DIR, { recursive: true });
  const snapshotPath = `${FETCH_DIR}/${brand}__${code}__${ts}.json`;
  try {
    const fetched = runtime.platform === 'igmp'
      ? await fetchIgmp(brand, code, runtime)
      : await fetchQproQp2(brand, code, runtime);
    const snapshot = { brand, code, runtime, fetchedAt: new Date().toISOString(), snapshotPath, ...fetched };
    await writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
    return snapshot;
  } catch (e) {
    const notFound = isPromoNotFoundError(e);
    // R14: sanitize file paths and use publicMessage if the underlying error
    // carries one (e.g. SITE_CONFIG_INCOMPLETE thrown mid-fetch). Server log
    // still gets the full message via appendFile below.
    const clientDetail = e?.publicMessage || (e?.message || '').replace(/[A-Z]:\\\S+|\/var\/\S+|\/etc\/\S+|\/opt\/\S+|\/home\/\S+/g, '<server-path>');
    const failed = {
      brand,
      code,
      runtime,
      ts: new Date().toISOString(),
      error: notFound ? 'Code not found' : 'BO unreachable',
      detail: e.message,
      snapshotPath,
    };
    await appendFile(FAILED_LOG, `${JSON.stringify(failed)}\n`, 'utf8').catch(async () => {
      await mkdir('captures/qc-dashboard', { recursive: true });
      await appendFile(FAILED_LOG, `${JSON.stringify(failed)}\n`, 'utf8');
    });
    const snapshot = unavailableSnapshot({
      brand, code, runtime,
      error: notFound ? null : 'BO unreachable',
      detail: clientDetail,
    });
    snapshot.notFound = notFound;
    snapshot.fetchedAt = failed.ts;
    return snapshot;
  }
}

// R14: per-brand isolation. One broken site config must never fail the batch.
// - SITE_CONFIG_INCOMPLETE errors surface as a WARNING finding (`duplicate-check-partial`)
//   so admins know the check is degraded, not silently passing.
// - Other errors (network / auth) are noted in the same warning but at a lower severity signal.
// - Server log gets the raw error for debugging; the client-visible message never
//   contains an absolute filesystem path (all such throws now carry .publicMessage).
export async function probeDuplicateAcrossMvp({ brand, code }, brandList) {
  const enabled = brandList.filter((b) => b.enabled && b.id !== brand);
  const hits = [];
  const skipped = [];
  await Promise.all(enabled.map(async (b) => {
    try {
      const runtime = resolveBrandRuntime(b.id);
      if (runtime.platform === 'igmp') {
        const res = await readonlyIgmpPost(runtime.siteId, '/PM/GetPromotionInfoByCode', { PromotionCode: code });
        if (igmpData(res)?.PromotionId) hits.push(b.id);
      } else {
        const site = getSite(runtime.siteId);
        const row = await findPromotionByCodeReadonly(site, code, { merchantId: runtime.merchantId });
        if (row) hits.push(b.id);
      }
    } catch (e) {
      const reason = e?.code === 'SITE_CONFIG_INCOMPLETE'
        ? `config incomplete (missing ${e.field || 'credentials'})`
        : (e?.publicMessage || 'unavailable');
      skipped.push({ brand: b.id, reason });
      // Server-side log keeps the real error for debugging; do not surface it to the client
      try { console.warn(`[qc-hub] probe-duplicate skipped: ${b.id} (${e?.message || 'unknown'})`); } catch {}
    }
  }));
  const findings = [];
  if (hits.length) {
    findings.push({
      severity: 'WARNING',
      check: 'duplicate-brand',
      message: `Same code also found on MVP brand(s): ${hits.sort().join(', ')}`,
      actual: hits,
    });
  }
  if (skipped.length) {
    const parts = skipped.map((s) => `${s.brand}: ${s.reason}`).sort();
    findings.push({
      severity: 'WARNING',
      check: 'duplicate-check-partial',
      message: `Duplicate check skipped for ${skipped.length} brand${skipped.length===1?'':'s'} — ${parts.join('; ')}`,
      actual: skipped.map((s) => s.brand).sort(),
    });
  }
  return findings;
}
