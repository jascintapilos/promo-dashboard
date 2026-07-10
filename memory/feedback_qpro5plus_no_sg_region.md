---
name: qpro5plus-no-sg-region
description: QPRO5 and all brands from QPRO5 onward (QPRO5-17) do not support the SG region at all — a promo missing SGD currency there is not a bug.
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 75c42de7-5581-4012-b26c-698488506043
---

QPRO5 through QPRO17 do not support the SG region. Only QPRO1-3 confirmed to carry SG/SGD; **QPRO4 appears to be MY-only too** (observed 2026-07-09: P026 persisted MYR-only on QPRO4, and its 15 most recent promos are all MYR-only — no SGD row anywhere on that BO). QPRO1-3 all persisted MYR+SGD for the same request. Treat the no-SG boundary as effectively QPRO4+, pending directory confirmation.

**Confirmed again 2026-07-10 (P028) — operator directly confirmed "no SG currency for QPRO5-17" is expected, not a bug.** All 12 of QPRO4-17 in the P028 batch showed `detail.currencies=["MYR"]` only (QPRO1-3 correctly showed both). Before this correction, a Sentinel sweep + live ground-truth probe misread the pattern as a real defect: the initial `POST /api/bo/promotion` response DOES echo back a synthetic SGD `promotion_currency` row (since the create body optimistically includes both currencies per the source request's `regions:["MY","SG"]`), but the platform never actually persists it for these brands — the row 404s on GET-by-id immediately after, and a retry-POST fails with HTTP 422 "This currency already exists" (the platform holds a phantom record blocking recreation, it just never surfaces it). **This 422-on-retry-POST + 404-on-GET-by-id signature is not evidence of a data-loss bug — it IS the mechanism by which QPRO4-17 enforce "no SG region support."** Do not chase this as a defect or attempt a BO vendor escalation; it's confirmed expected platform behavior for these brands.

**Why:** Wai Yip corrected an AI-review-sweep (Sentinel) false positive 2026-07-08 — Sentinel flagged QPRO6 promo FT_88FS_10X_040_GOO_V2 as "SG region approved but never persisted (only MYR saved)" by comparing the bundle's declared `source.regions` against live currencies. The promo was correctly MY-only; the source request's region list (or Sentinel's inference of it) was wrong, not the live config. Recurred and reconfirmed 2026-07-10 on P028 across all 12 QPRO4-17 brands in one batch.

**How to apply:** When any QC agent (Sentinel, Pre-QC, Triage) or the brand-watch structural/AI layer flags a QPRO4-17 promo for "missing SGD/SG region," it is a false positive — do not escalate, do not attempt a live-BO fix (retry-POST will 422, PUT-by-id will falsely report success without restoring visibility — don't waste a cycle on this like 2026-07-10 did). Consider hardening `bin/find-ai-review-candidates.mjs` / Sentinel's region-comparison logic to consult brand region-support data (once captured) rather than trusting the bundle's raw `regions` field blindly for QPRO4+ brands. See [[project_brand_ecosystem]] for the full QPRO1-19 brand list.
