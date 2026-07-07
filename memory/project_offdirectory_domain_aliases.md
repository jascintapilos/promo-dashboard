---
name: project_offdirectory_domain_aliases
description: Brand domains used in MT bodies that are NOT in the brand-directory.json website/tncDomain fields — alias list for buildDomainToBrand()
metadata:
  type: project
---

`buildDomainToBrand()` in `src/mt-content-checks.js` now reads `aliases[]` from each brand entry in `data/brand-directory.json` in addition to `website` and `tncDomain`.

**Why:** Wave 3 scan (2026-07-07) caught `king333mys.com` hardcoded in QP2 shared-BO templates 557/555 but was blind to `ibc22mys.com` anchors in the same templates (same `/promotion?code=EVEXMASSTREAKA` campaign link). `ibc22mys.com` is a regional-TLD alias for QP2A (IBC22) not listed as website or tncDomain.

**How to apply:** When brand-watch flags a QP2 literal-domain FAIL but the domain is a known variant of the brand's own site (not a cross-brand leak), add it to that brand's `aliases[]` in `data/brand-directory.json` — the check will then treat it as an own-domain hit and flag it correctly as a QP2 literal-domain violation (any literal domain in QP2 shared BO is wrong, even the brand's own).

## Known aliases seeded (2026-07-07)

| Brand | Alias | Status |
|---|---|---|
| QP2A (IBC22) | `ibc22mys.com` | Added — found in EVEXMAS templates 557/555 |

## Estate sweep — pending

A sweep of live MT bodies via `fetchAllLiveCodes()` (`src/live-codes.js`) is needed to surface any other alias hosts baked into templates. Pattern: URL host matches a merchant-name stem (e.g. `ace66sg.com`, `spade66myr.com`, `king333sg.com`) but is absent from the directory. Run after pulling a fresh session.

**How to apply:** run `node bin/brand-watch.js --mt-only 2>&1 | grep "FAIL\|WARNING"` after a session pull; any new hosts surfaced by the `qp2-literal-domain` or `foreign-tnc-domain` checks that look like alias variants should be added here and seeded in the directory.
