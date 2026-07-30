import { createHash } from 'node:crypto';
import { igmpPost } from './igmp-client.js';

export const DEFAULT_CLONE_SHEET_ID = '1Nemq3Fwq0ABHP2XBtHwRAsu1jMUI0uBb11o_GqgpywU';

export const REGION_TO_IGMP_SITE = Object.freeze({
  MY: 'ws1-v3-my',
  SG: 'ws1-v3-sg',
  ID: 'ws1-v3-id',
  TH: 'ws1-v3-th',
  KH: 'ws1-v3-kh',
  WS2: 'ws2',
});

const SITE_SUFFIX = Object.freeze({
  'ws1-v3-my': 'MY',
  'ws1-v3-sg': 'SG',
  'ws1-v3-id': 'ID',
  'ws1-v3-th': 'TH',
  'ws1-v3-kh': 'KH',
  ws2: 'WS2',
});

const DETAIL_ENDPOINT = Object.freeze({
  Bonus: '/PM/GetBonusInfo',
  FreeCredit: '/PM/GetFreeCreditInfo',
  FreeSpin: '/PM/GetFreeSpinPromotionInfo',
});

const REWARD_FIELDS = [
  'RewardName',
  'RedemptionType',
  'RewardType',
  'MinimumActionAmount',
  'BonusPercentage',
  'RolloverMultiplier',
  'FixedBonusAmount',
  'FixedRolloverAmount',
  'PhysicalGiftDescription',
  'RedeemableQuantity',
  'RemainingQuantity',
  'IsActive',
  'RolloverType',
  'CapBonusAmount',
  'RedeemableKYCStatus',
  'WithdrawalCap',
  'MaximumBalance',
  'ExpiryMinutes',
  'DepositRequirement',
  'RequiredApprovedDeposit',
  'DepositPeriodicDays',
];

const FREE_SPIN_FIELDS = [
  'ProductId',
  'GameId',
  'StartTimeStamp',
  'EndTimeStamp',
  'FreeSpinCode',
  'FreeSpinName',
  'FreeSpinRounds',
  'AmountPerBet',
  'AmountPerLine',
  'ValidityTimeStamp',
  'RedeemableDay',
  'RedeemableCount',
  'AdditionalSettings',
];

const NUMERIC_FIELDS = new Set([
  'MinimumActionAmount',
  'BonusPercentage',
  'RolloverMultiplier',
  'FixedBonusAmount',
  'FixedRolloverAmount',
  'RedeemableQuantity',
  'RemainingQuantity',
  'CapBonusAmount',
  'WithdrawalCap',
  'MaximumBalance',
  'ExpiryMinutes',
  'RequiredApprovedDeposit',
  'DepositPeriodicDays',
  'RedeemableStartTime',
  'RedeemableEndTime',
  'RedeemableCount',
  'EffectiveMinutes',
  'ProductId',
  'GameId',
  'FreeSpinRounds',
  'AmountPerBet',
  'AmountPerLine',
  'MaxFreeSpinDayDuration',
]);

function cleanHeader(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function findHeaderIndex(headers, predicates) {
  return headers.findIndex((header) => predicates.some((predicate) => predicate(header)));
}

function valueAt(row, index) {
  return index >= 0 ? String(row[index] ?? '').trim() : '';
}

export function parseWorkbookManifest(values, { tab = 'WS1' } = {}) {
  const rows = Array.isArray(values) ? values : [];
  const headerOffset = rows.findIndex((row) => {
    const normalized = row.map(cleanHeader);
    return normalized.some((h) => h === 'old promo code')
      && normalized.some((h) => h.startsWith('new promo code'));
  });
  if (headerOffset < 0) {
    throw new Error(`Manifest tab "${tab}" does not contain OLD Promo Code and NEW Promo Code headers`);
  }

  const headers = rows[headerOffset].map(cleanHeader);
  const indexes = {
    number: findHeaderIndex(headers, [(h) => h === 'rn', (h) => h === 'no.', (h) => h === 'no']),
    oldCode: findHeaderIndex(headers, [(h) => h === 'old promo code']),
    newCode: findHeaderIndex(headers, [(h) => h.startsWith('new promo code')]),
    region: findHeaderIndex(headers, [(h) => h === 'region']),
    sourceRegion: findHeaderIndex(headers, [(h) => h === 'source region']),
    destinationRegion: findHeaderIndex(headers, [(h) => h === 'destination region']),
    sourceSite: findHeaderIndex(headers, [(h) => h === 'source site']),
    destinationSite: findHeaderIndex(headers, [(h) => h === 'destination site']),
    type: findHeaderIndex(headers, [(h) => h === 'type', (h) => h === 'bonus type']),
    status: findHeaderIndex(headers, [(h) => h === 'status']),
  };

  if (indexes.oldCode < 0 || indexes.newCode < 0) {
    throw new Error(`Manifest tab "${tab}" is missing required old/new code columns`);
  }

  return rows.slice(headerOffset + 1)
    .map((row, offset) => {
      const sheetRow = headerOffset + 2 + offset;
      const region = valueAt(row, indexes.region).toUpperCase();
      const sourceRegion = (valueAt(row, indexes.sourceRegion) || region).toUpperCase();
      const destinationRegion = (valueAt(row, indexes.destinationRegion) || region).toUpperCase();
      const sourceSite = valueAt(row, indexes.sourceSite) || REGION_TO_IGMP_SITE[sourceRegion] || '';
      const destinationSite = valueAt(row, indexes.destinationSite) || REGION_TO_IGMP_SITE[destinationRegion] || '';
      return {
        workbook_tab: tab,
        workbook_row: sheetRow,
        manifest_number: valueAt(row, indexes.number),
        old_code: valueAt(row, indexes.oldCode),
        new_code: valueAt(row, indexes.newCode),
        region,
        source_region: sourceRegion,
        destination_region: destinationRegion,
        source_site: sourceSite,
        destination_site: destinationSite,
        declared_type: valueAt(row, indexes.type),
        status: valueAt(row, indexes.status),
      };
    })
    .filter((row) => row.old_code || row.new_code);
}

function parseSelector(spec) {
  const selected = new Set();
  for (const rawPart of String(spec || '').split(',')) {
    const part = rawPart.trim();
    if (!part) continue;
    const range = part.match(/^(\d+)-(\d+)$/);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (to < from) throw new Error(`Invalid descending selector "${part}"`);
      for (let value = from; value <= to; value += 1) selected.add(String(value));
    } else if (/^\d+$/.test(part)) {
      selected.add(String(Number(part)));
    } else {
      throw new Error(`Invalid selector "${part}"`);
    }
  }
  return selected;
}

export function selectManifestRows(rows, { workbookRows, manifestNumbers } = {}) {
  const rowSet = parseSelector(workbookRows);
  const numberSet = parseSelector(manifestNumbers);
  if (rowSet.size === 0 && numberSet.size === 0) {
    throw new Error('Select rows explicitly with --rows=<sheet rows> or --numbers=<manifest numbers>');
  }
  const selected = rows.filter((row) =>
    rowSet.has(String(row.workbook_row))
    || numberSet.has(String(Number(row.manifest_number))));
  if (selected.length === 0) throw new Error('No manifest rows matched the selector');
  return selected;
}

export function validateManifestRow(row) {
  const errors = [];
  if (!row.old_code) errors.push('OLD Promo Code is blank');
  if (!row.new_code) errors.push('NEW Promo Code is blank');
  if (row.old_code && row.new_code && row.old_code === row.new_code) errors.push('old and new codes are identical');
  if (!row.source_site) errors.push('source region/site is blank or unsupported');
  if (!row.destination_site) errors.push('destination region/site is blank or unsupported');
  if (row.source_site && row.destination_site && row.source_site !== row.destination_site) {
    errors.push('cross-region cloning requires a versioned transformation profile and is not supported by this runner');
  }
  if (errors.length) {
    throw new Error(`Manifest row ${row.workbook_row}: ${errors.join('; ')}`);
  }
  return row;
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, sortObject(value[key])]),
    );
  }
  return value;
}

export function stableStringify(value) {
  return JSON.stringify(sortObject(value));
}

export function sha256(value) {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function unwrapData(response) {
  return response?.data ?? response;
}

function findFirstKey(value, key) {
  if (!value || typeof value !== 'object') return null;
  if (Object.prototype.hasOwnProperty.call(value, key)) return value[key];
  for (const child of Object.values(value)) {
    const found = findFirstKey(child, key);
    if (found != null) return found;
  }
  return null;
}

function canonicalDate(value) {
  if (value == null || value === '') return null;
  const text = String(value).trim();
  let match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  match = text.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (match) return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return text;
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
}

function wireDate(value) {
  const canonical = canonicalDate(value);
  if (!canonical || !/^\d{4}-\d{2}-\d{2}$/.test(canonical)) {
    throw new Error(`Unsupported IGMP date "${value}"`);
  }
  const [year, month, day] = canonical.split('-').map(Number);
  return new Date(year, month - 1, day).toDateString();
}

function pick(object, keys) {
  const result = {};
  for (const key of keys) {
    if (object?.[key] !== undefined) result[key] = object[key];
  }
  return result;
}

function cloneReward(sourceReward, contents, { type } = {}) {
  const typeSpecificFields = type === 'Bonus'
    ? REWARD_FIELDS.filter((field) => !['DepositRequirement', 'RequiredApprovedDeposit', 'DepositPeriodicDays'].includes(field))
    : type === 'FreeCredit'
      ? REWARD_FIELDS.filter((field) => field !== 'ExpiryMinutes')
      : REWARD_FIELDS.filter((field) => !['ExpiryMinutes', 'DepositRequirement', 'RequiredApprovedDeposit', 'DepositPeriodicDays'].includes(field));
  const reward = pick(sourceReward, typeSpecificFields);
  if (reward.RedeemableQuantity != null) {
    reward.RemainingQuantity = reward.RedeemableQuantity;
  }
  for (const enumField of ['RedemptionType', 'RewardType', 'RolloverType']) {
    if (reward[enumField] != null) reward[enumField] = String(reward[enumField]);
  }
  if (Array.isArray(reward.RedeemableKYCStatus)) {
    reward.RedeemableKYCStatus = reward.RedeemableKYCStatus.join(',');
  }
  reward.IsActive = true;
  reward.PromotionRewardContents = contents.map((row) => ({
    Locale: row.Locale,
    // Preserve locale naming exactly. Some legacy ZH rows intentionally have
    // a blank name; filling it from the EN RewardName would make the clone
    // differ from its source and defeat the allowlisted-diff contract.
    PromotionRewardName: row.PromotionRewardName ?? '',
    Content: row.Content || '',
  }));
  return reward;
}

function cloneFreeSpin(sourceReward, { oldCode, newCode, destinationSite }) {
  const source = sourceReward?.FreeSpin || {};
  const suffix = SITE_SUFFIX[destinationSite] || destinationSite.toUpperCase();
  const oldGeneratedCodes = new Set([
    oldCode,
    `${oldCode}_${suffix}`,
    source.FreeSpinCode,
  ].filter(Boolean));
  const clonedName = oldGeneratedCodes.has(source.FreeSpinName)
    ? `${newCode}_${suffix}`
    : (source.FreeSpinName ?? '');
  return {
    ...pick(source, FREE_SPIN_FIELDS),
    StartTimeStamp: wireDate(source.StartTimeStamp),
    EndTimeStamp: wireDate(source.EndTimeStamp),
    ValidityTimeStamp: source.ValidityTimeStamp ? wireDate(source.ValidityTimeStamp) : null,
    FreeSpinCode: `${newCode}_${suffix}`,
    FreeSpinName: clonedName,
    AdditionalSettings: source.AdditionalSettings && typeof source.AdditionalSettings === 'object'
      ? source.AdditionalSettings
      : {},
  };
}

function normalizedScalar(key, value) {
  if (value === undefined) return null;
  if (NUMERIC_FIELDS.has(key)) {
    if (value === null || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : value;
  }
  if (key === 'PromotionStartDate' || key === 'PromotionEndDate'
      || key === 'StartTimeStamp' || key === 'EndTimeStamp' || key === 'ValidityTimeStamp') {
    return canonicalDate(value);
  }
  return value;
}

function normalizeObject(value) {
  if (Array.isArray(value)) return value.map(normalizeObject);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (child === undefined) continue;
    result[key] = child && typeof child === 'object'
      ? normalizeObject(child)
      : normalizedScalar(key, child);
  }
  return result;
}

function normalizeContents(contents) {
  return contents
    .map((row) => ({
      Locale: String(row.Locale || '').toLowerCase(),
      PromotionRewardName: String(row.PromotionRewardName || ''),
      Content: String(row.Content || '').trim(),
    }))
    .sort((a, b) => a.Locale.localeCompare(b.Locale));
}

function businessGraphFromParts({ type, promotion, outer, reward, contents }) {
  const common = {
    PromotionCode: promotion.PromotionCode,
    PromotionName: promotion.PromotionName,
    PromotionDescription: promotion.PromotionDescription ?? '',
    PromotionStartDate: promotion.PromotionStartDate,
    PromotionEndDate: promotion.PromotionEndDate,
    PromotionManagementId: promotion.PromotionManagementId ?? null,
  };
  const wrapper = type === 'Bonus'
    ? pick(outer, ['RedeemableDay', 'RedeemableStartTime', 'RedeemableEndTime', 'RedeemableCount', 'EffectiveMinutes'])
    : type === 'FreeCredit'
      ? pick(outer, ['ExpiryMinutes', 'AutoRedemption', 'EffectiveMinutes'])
      : pick(outer, ['MaxFreeSpinDayDuration']);
  const normalizedReward = pick(reward, REWARD_FIELDS);
  delete normalizedReward.RemainingQuantity;
  delete normalizedReward.IsActive;
  const graph = {
    type,
    promotion: common,
    wrapper,
    reward: normalizedReward,
    contents: normalizeContents(contents),
  };
  if (type === 'FreeSpin') graph.free_spin = pick(reward?.FreeSpin || {}, FREE_SPIN_FIELDS);
  return normalizeObject(graph);
}

export async function fetchIgmpPromotionGraph(siteId, code, { post = igmpPost } = {}) {
  const lookup = unwrapData(await post(siteId, '/PM/GetPromotionInfoByCode', { PromotionCode: code }));
  if (!lookup?.PromotionId) throw new Error(`Promotion "${code}" was not found on ${siteId}`);
  const type = lookup.PromotionType;
  const detailEndpoint = DETAIL_ENDPOINT[type];
  if (!detailEndpoint) throw new Error(`Promotion "${code}" has unsupported type "${type}"`);
  const outer = unwrapData(await post(siteId, detailEndpoint, { PromotionId: lookup.PromotionId }));
  const promotion = outer?.Promotion || outer;
  if (!promotion || typeof promotion !== 'object') {
    throw new Error(`${detailEndpoint} returned no promotion detail for "${code}"`);
  }
  const rewards = promotion.PromotionRewards || [];
  if (rewards.length !== 1) {
    throw new Error(`Source "${code}" must have exactly one reward; found ${rewards.length}`);
  }
  const reward = rewards[0];
  if (!reward?.RewardId) throw new Error(`Source "${code}" reward has no RewardId`);
  const contentsResponse = unwrapData(
    await post(siteId, '/PM/GetPromotionRewardContents', { RewardId: reward.RewardId }),
  );
  const contents = Array.isArray(contentsResponse)
    ? contentsResponse
    : (contentsResponse?.rows || contentsResponse?.PromotionRewardContents || []);
  if (!contents.length) throw new Error(`Source "${code}" reward has no PromotionRewardContents`);
  const locales = new Set(contents.map((row) => String(row.Locale || '').toLowerCase()));
  if (!locales.has('en')) throw new Error(`Source "${code}" reward content is missing EN`);
  if ((siteId === 'ws1-v3-my' || siteId === 'ws1-v3-sg') && !locales.has('zh')) {
    throw new Error(`Source "${code}" reward content is missing ZH for ${siteId}`);
  }
  if (contents.some((row) => !String(row.Content || '').trim())) {
    throw new Error(`Source "${code}" has an empty reward-content locale`);
  }

  const business = businessGraphFromParts({ type, promotion, outer, reward, contents });
  return {
    site_id: siteId,
    promotion_id: lookup.PromotionId,
    reward_id: reward.RewardId,
    type,
    lookup,
    detail_endpoint: detailEndpoint,
    outer,
    promotion,
    reward,
    contents,
    business,
    business_hash: sha256(business),
  };
}

export function buildIgmpClonePlan(manifest, sourceGraph) {
  validateManifestRow(manifest);
  if (manifest.source_site !== sourceGraph.site_id) {
    throw new Error(`Source snapshot site ${sourceGraph.site_id} does not match manifest ${manifest.source_site}`);
  }
  if (manifest.old_code !== sourceGraph.business.promotion.PromotionCode) {
    throw new Error('Source snapshot code does not match manifest OLD Promo Code');
  }

  const { type, promotion, outer, reward, contents } = sourceGraph;
  const common = {
    PromotionCode: manifest.new_code,
    PromotionName: promotion.PromotionName,
    PromotionDescription: promotion.PromotionDescription ?? '',
    PromotionStartDate: wireDate(promotion.PromotionStartDate),
    PromotionEndDate: wireDate(promotion.PromotionEndDate),
    PromotionManagementId: promotion.PromotionManagementId ?? null,
  };
  let endpoint;
  let body;
  let followups = [];

  if (type === 'Bonus') {
    endpoint = '/PM/AddBonus';
    body = {
      ...common,
      RedeemableDay: outer.RedeemableDay,
      RedeemableStartTime: outer.RedeemableStartTime,
      RedeemableEndTime: outer.RedeemableEndTime,
      RedeemableCount: outer.RedeemableCount,
      EffectiveMinutes: outer.EffectiveMinutes,
      Settings: promotion.Settings || [],
      PromotionRewards: [cloneReward(reward, contents, { type })],
    };
  } else if (type === 'FreeCredit') {
    endpoint = '/PM/AddFreeCredit';
    body = {
      ...common,
      ExpiryMinutes: outer.ExpiryMinutes,
      AutoRedemption: outer.AutoRedemption,
      EffectiveMinutes: outer.EffectiveMinutes,
      Settings: promotion.Settings || [],
      PromotionRewards: [cloneReward(reward, contents, { type })],
    };
  } else if (type === 'FreeSpin') {
    endpoint = '/PM/AddFreeSpin';
    body = {
      ...common,
      Settings: promotion.Settings || [],
    };
    followups = [
      {
        endpoint: '/PM/AddFreeSpinReward',
        capture_from: 'RewardId',
        body: {
          PromotionId: '$PromotionId',
          PromotionReward: cloneReward(reward, contents, { type }),
          FreeSpin: cloneFreeSpin(reward, {
            oldCode: manifest.old_code,
            newCode: manifest.new_code,
            destinationSite: manifest.destination_site,
          }),
          MaxFreeSpinDayDuration: outer.MaxFreeSpinDayDuration ?? 365,
        },
      },
      {
        endpoint: '/PM/UpdatePromotionSettings',
        body: {
          PromotionId: '$PromotionId',
          Settings: promotion.Settings || [],
        },
      },
    ];
  } else {
    throw new Error(`Unsupported source promotion type "${type}"`);
  }

  const expectedPromotion = {
    ...sourceGraph.business.promotion,
    PromotionCode: manifest.new_code,
  };
  const expectedBusiness = normalizeObject({
    ...sourceGraph.business,
    promotion: expectedPromotion,
    ...(type === 'FreeSpin'
      ? {
        free_spin: pick(
          cloneFreeSpin(reward, {
            oldCode: manifest.old_code,
            newCode: manifest.new_code,
            destinationSite: manifest.destination_site,
          }),
          FREE_SPIN_FIELDS,
        ),
      }
      : {}),
  });

  return {
    version: 1,
    platform: 'igmp',
    operation: 'clone_same_region',
    source_site: manifest.source_site,
    destination_site: manifest.destination_site,
    old_code: manifest.old_code,
    new_code: manifest.new_code,
    promotion_type: type,
    endpoint,
    body,
    followups,
    source_business: sourceGraph.business,
    expected_business: expectedBusiness,
    allowed_changes: [
      'promotion.PromotionCode',
      ...(type === 'FreeSpin' ? ['free_spin.FreeSpinCode', 'free_spin.FreeSpinName when source name is code-derived'] : []),
      'system-generated IDs and audit fields',
      'destination starts inactive',
      'RemainingQuantity resets to RedeemableQuantity',
    ],
  };
}

export function createCloneBundle({ spreadsheetId, tab, manifest, sourceGraph, plan, generatedAt = new Date().toISOString() }) {
  const bundle = {
    schema: 'igmp-clone-plan/v1',
    generated_at: generatedAt,
    workbook: {
      spreadsheet_id: spreadsheetId,
      tab,
      row: manifest.workbook_row,
      manifest_number: manifest.manifest_number,
    },
    manifest,
    source: {
      site_id: sourceGraph.site_id,
      promotion_id: sourceGraph.promotion_id,
      reward_id: sourceGraph.reward_id,
      business_hash: sourceGraph.business_hash,
      business: sourceGraph.business,
    },
    plan,
  };
  return { ...bundle, plan_hash: sha256(bundle) };
}

export function assertCloneBundleIntegrity(bundle, approvedHash) {
  if (!bundle || bundle.schema !== 'igmp-clone-plan/v1') throw new Error('Unsupported clone plan bundle');
  const withoutHash = { ...bundle };
  delete withoutHash.plan_hash;
  const actual = sha256(withoutHash);
  if (actual !== bundle.plan_hash) throw new Error(`Clone plan integrity failure: stored=${bundle.plan_hash} actual=${actual}`);
  if (!approvedHash || approvedHash !== actual) {
    throw new Error(`Approval hash must exactly match ${actual}`);
  }
  return actual;
}

export function diffBusinessGraphs(expected, actual, path = '') {
  if (stableStringify(expected) === stableStringify(actual)) return [];
  const expectedObject = expected && typeof expected === 'object';
  const actualObject = actual && typeof actual === 'object';
  if (!expectedObject || !actualObject || Array.isArray(expected) !== Array.isArray(actual)) {
    return [{ path: path || '$', expected, actual }];
  }
  if (Array.isArray(expected)) {
    const diffs = [];
    const count = Math.max(expected.length, actual.length);
    for (let index = 0; index < count; index += 1) {
      diffs.push(...diffBusinessGraphs(expected[index], actual[index], `${path}[${index}]`));
    }
    return diffs;
  }
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  const diffs = [];
  for (const key of [...keys].sort()) {
    diffs.push(...diffBusinessGraphs(expected[key], actual[key], path ? `${path}.${key}` : key));
  }
  return diffs;
}

export function verifyCloneGraph(plan, destinationGraph) {
  const diffs = diffBusinessGraphs(plan.expected_business, destinationGraph.business);
  return {
    pass: diffs.length === 0,
    diffs,
    destination_business_hash: destinationGraph.business_hash,
  };
}

export function substituteCloneTokens(value, captured) {
  if (typeof value === 'string' && value.startsWith('$')) {
    const key = value.slice(1);
    if (captured[key] == null) throw new Error(`Unresolved clone-plan token ${value}`);
    return captured[key];
  }
  if (Array.isArray(value)) return value.map((item) => substituteCloneTokens(item, captured));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, substituteCloneTokens(child, captured)]),
    );
  }
  return value;
}

export { findFirstKey };
