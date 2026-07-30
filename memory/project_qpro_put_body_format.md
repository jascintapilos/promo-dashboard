---
name: project_qpro_put_body_format
description: QPRO BO PUT body format requirements — 4 transforms needed when constructing PUT from GET response verbatim
metadata:
  type: project
---

When doing surgical QPRO PUT operations (e.g., `bin/sync-promo-gp-catalog.mjs`) without going through `buildUpdateBody`, the GET response **cannot** be spread verbatim into the PUT body. The GET is a read model; the PUT is a write model. Four required transforms:

1. **Omit `free_spin_game_code`** — GET returns `null` for non-FS promos. BO PUT validator requires it to be a string. Do NOT set it to `""` (also rejected). Omit the field entirely.
   ```js
   const { free_spin_game_code: _fsgc, ...rest } = freshDetail;
   ```

2. **Reformat `valid_from` and `valid_to`** — GET returns ISO UTC (`"2025-03-28T03:12:00.000000Z"`). PUT requires `"Y-m-d H:i:s"` format (`"2025-03-28 03:12:00"`). BO rejects the ISO variant.
   ```js
   function isoToYmdHms(iso) {
     return iso.replace('T', ' ').replace(/\.\d+Z?$/, '').replace(/Z$/, '');
   }
   ```

3. **Set `promo_p1_id` null → 0** — FC promos return `promo_p1_id: null` from GET. BO PUT requires an integer.
   ```js
   promo_p1_id: freshDetail.promo_p1_id ?? 0,
   ```

4. **Build `promotion_category_turnover`** — GET returns `promotion_category: [{id, promotion_id, category_id}, ...]`. PUT needs `promotion_category_turnover: {"0": catId, "1": catId, ...}` (indexed object of IDs). Omitting this causes: `"Game category is required for a Turnover target"` HTTP 422.
   ```js
   const catIds = (freshDetail.promotion_category ?? []).map(c => c.category_id);
   const promotion_category_turnover = arrayToIntObj(catIds);
   ```

**Why:** The QPRO BO uses different field names and shapes for GET (read) vs PUT (write). Discovered 2026-07-24 during `sync-promo-gp-catalog.mjs` implementation — all 22 PUT calls returned HTTP 422 until these 4 transforms were applied.

**How to apply:** Any script that constructs a QPRO PUT body from a GET response must apply all 4 transforms. See `bin/sync-promo-gp-catalog.mjs` lines ~380-410 for the reference implementation. Using `buildUpdateBody` from the mapper avoids these issues but resets `valid_from` to now. [[feedback_qpro_put_silent_field_wipe]]
