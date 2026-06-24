---
name: banner-deep-qc
description: Post-upload deep QC for banners. Checks (1) saved BO banner record — images load, link valid, dates, position; (2) promo content (3.3) HTML — locale blocks, T&C hyperlink, brand placeholder; (3) front-end appearance via Claude-in-Chrome — banner visible in carousel, correct creative, clickthrough works, mobile viewport. Scoped to brands specified in Banner Schedule for the given B-ID range (not all brands in a multi-brand campaign). Trigger on `/banner-deep-qc B16`, `/banner-deep-qc B13-B16`, "deep qc the banner", "check how the banner looks on site".
---

# Banner Deep-QC — post-upload adversarial verification

Full verification of saved BO state + live front-end appearance. Scoped to B-IDs in the Banner Schedule — not every brand the ClickUp task covers.

**Position in QC chain:**

```
upload-promo.js --commit → [/banner-deep-qc]
                            ↑ THIS skill (post-save)
```

## Trigger

- `/banner-deep-qc B16`
- `/banner-deep-qc B13-B16`
- "deep qc the banner B16"
- "check how the banner looks on the site"
- "verify the banner is live"

## Pre-requisite

QC bundles must exist: `upload-promo.js --commit` writes `captures/banner-qc-bundles/{b_id}__{site_id}.json`. If none found, tell the user to run the commit first.

## Steps

### 1. List QC bundles

```sh
node bin/banner-qc-fanout.mjs <B-ID|range> --bundles --pretty
```

These are the brands to check — scoped to what the Banner Schedule assigned to these B-IDs, not the full ClickUp task brand list.

### 2. For each bundle — API checks

Read `captures/banner-qc-bundles/{b_id}__{site_id}.json`.

**A. Banner record (14.2):**

| Check | How | Pass condition |
|---|---|---|
| Banner exists | `banner_id` in bundle | Not null |
| Desktop image loads | HTTP GET `image_rows[].image_desktop` | HTTP 200, Content-Type image/* |
| Mobile image loads | HTTP GET `image_rows[].image_mobile` | HTTP 200, Content-Type image/* |
| Banner link valid | `link` = `/promotion?code={promo_code}` → GET promo from BO | Promo exists + active |
| Dates not expired | `end_datetime` > now | Pass |
| Status correct | `status` field | 0=draft (OK pre-activation), 1=active (OK post-activation) |

**B. Promo content (3.3):**

Use `content_id` from the bundle. Fetch via BO API: `GET /api/bo/promotioncontent/{content_id}`.

| Check | Pass condition |
|---|---|
| Content exists | HTTP 200, record found |
| EN locale populated | `content_details` has EN entry with non-empty `content` body |
| ZH locale populated (if MY brand) | ZH entry present and non-empty |
| T&C hyperlink present | Sentence 11 of body text contains `<a href=` pointing to brand's T&C domain |
| T&C hyperlink on sentence 11 ONLY | No other `<a href=` in the body (strip heading links) |
| Brand placeholder correct | QPRO: contains `:brandname`, QP2: contains `:merchantname` — neither is an empty URL |
| No HTML encoding artifacts | No `&amp;`, `&mdash;` etc. in visible title/description |

**C. Position check:**

| Campaign type | Expected position |
|---|---|
| Vendor campaign (PP, MG, Playtech, etc.) | 3 or 4 |
| In-house brand campaign | 1 or 2 |
| Other | 5 |

Flag if position = 99 (still at draft default — needs manual correction).

### 3. Front-end check (Claude-in-Chrome)

For each brand's `website` URL from the bundle:

**Step 1 — Desktop carousel:**
1. Navigate to `{website}` (player homepage)
2. Screenshot the full banner carousel area
3. Check: is a banner for this campaign visible? (match by image visual OR by clicking banner link)
4. If banner not visible: check if it's inactive (status=0) — flag as "not yet activated" vs "missing"

**Step 2 — Click-through:**
1. Click the banner
2. Verify: page loads (not 404), URL contains `/promotion` or `/member/reward`
3. Screenshot the landing page

**Step 3 — Mobile viewport:**
1. Resize browser to 390px width
2. Navigate back to homepage
3. Screenshot the mobile carousel
4. Verify the mobile banner image loads and fills the carousel

### 4. Aggregate verdict table

```
BANNER DEEP-QC — B16

| B-ID | Brand  | API    | Images     | 3.3 Content        | Front-end          | Verdict      |
|------|--------|--------|------------|--------------------|--------------------|--------------|
| B16  | QPRO16 | ✓      | ✓ both OK  | ✓ T&C OK           | ✓ visible pos 3    | PASS         |
| B15  | QPRO15 | ✓      | ✗ mobile   | ✓                  | INCONCLUSIVE       | FAIL         |
| B13  | QPRO1  | ✓      | ✓          | ⚠ no ZH locale     | ✓ not activated    | WARNING      |
```

For each non-PASS finding, expand:
- `field` / `check`
- `expected` vs `actual`
- `impact` (what the member sees)
- `recommended_action` (specific BO step or re-upload command)

### 5. Recommendation

- **All PASS** → banners are verified. If status=0 (draft), tell the user to activate in BO 14.2 when ready.
- **FAIL on image URL** → image may have been uploaded to wrong slot or URL changed. Re-run upload-promo.js for that B-ID with `--skip-content`.
- **FAIL on 3.3 content** → fix via BO 3.3 content editor or re-run upload-promo.js.
- **FAIL on front-end / not activated** → go to BO 14.2 Banner, find the banner by label, set position + activate. Then re-run `/banner-deep-qc` to confirm.
- **INCONCLUSIVE** → re-run with `--refresh` flag (re-fetches live BO state); if still inconclusive, log the specific missing evidence and escalate.

## Notes

- Read-only on BO and source files. Does NOT modify anything.
- **Scoped to B-IDs in Banner Schedule** — if a ClickUp task has 16 brands but Banner Schedule only assigns B13-B17, only those 5 brands are checked here.
- Front-end check requires Claude-in-Chrome MCP to be active. If unavailable, mark front-end column as INCONCLUSIVE and proceed with API checks only.
- If banner is still `status=0` (draft), front-end check will not show it — this is expected pre-activation. Note it clearly in the table.
- Position 99 in BO = staging default. Never consider position 99 a PASS — always flag as needing correction.

## Pairs with

- `/banner-pre-qc B##` — pre-upload plan check (runs before commit).
