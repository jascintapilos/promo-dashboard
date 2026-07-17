import { readFileSync } from 'node:fs';
import { brandToSite, QPRO_BRANDS, QP2_MERCHANTS, IGMP_SITES } from '../live-codes.js';
import { getSite } from '../sites.js';

const CONFIG_PATH = 'data/qc-dashboard-brands.json';
const MVP_BRANDS = new Set(['QP2A', 'QPRO1', 'QPRO5', 'WS1_MY']);

export function loadQcBrandConfig() {
  const parsed = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  const brands = parsed.brands || [];
  const ids = brands.map((b) => b.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) throw new Error(`${CONFIG_PATH}: duplicate brand ids: ${[...new Set(dupes)].join(', ')}`);

  const unresolvable = ids.filter((id) => !brandToSite(id));
  const resolvable = [
    ...QPRO_BRANDS.map((b) => b.brand),
    ...QP2_MERCHANTS.map((b) => b.brand),
    ...IGMP_SITES.map((b) => b.brand),
  ].sort();
  const missing = resolvable.filter((id) => !ids.includes(id));
  if (unresolvable.length || missing.length) {
    const parts = [];
    if (unresolvable.length) parts.push(`unresolvable in brandToSite(): ${unresolvable.join(', ')}`);
    if (missing.length) parts.push(`missing from JSON: ${missing.join(', ')}`);
    throw new Error(`${CONFIG_PATH} failed startup validation: ${parts.join(' | ')}`);
  }

  return brands
    .map((brand) => ({ ...brand, qcRules: brand.qcRules || {}, enabled: MVP_BRANDS.has(brand.id) }))
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || a.id.localeCompare(b.id));
}

export function resolveBrandRuntime(brandId) {
  const resolved = brandToSite(brandId);
  if (!resolved) throw new Error(`Unknown brand "${brandId}"`);
  if (resolved.platform === 'igmp') {
    return { ...resolved, brand: brandId, moduleUrl: null };
  }
  const site = getSite(resolved.siteId);
  return {
    ...resolved,
    brand: brandId,
    baseUrl: site.baseUrl,
    label: site.label || site.id,
    moduleUrl: site.baseUrl ? `${site.baseUrl.replace(/\/$/, '')}/promotion` : null,
  };
}

export function buildBrandList() {
  return loadQcBrandConfig().map((brand) => {
    const runtime = brandToSite(brand.id);
    let baseUrl = null;
    let moduleUrl = null;
    try {
      if (runtime?.platform !== 'igmp') {
        const site = getSite(runtime.siteId);
        baseUrl = site.baseUrl || null;
        moduleUrl = baseUrl ? `${baseUrl.replace(/\/$/, '')}${brand.promoModulePath}` : null;
      }
    } catch {}
    return {
      ...brand,
      runtime,
      baseUrl,
      moduleUrl,
      status: brand.enabled ? 'enabled' : 'coming_soon',
    };
  });
}
