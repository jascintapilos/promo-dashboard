---
name: feedback-ws1-qpro-template-leak
description: WS1/WS2 T&C must be the 5-clause format (reference-inbox-tnc-docs) — the QPRO/QP2 8-clause format (with its "Refresh button" clause) is a real defect on WS1, not a valid variant.
metadata:
  type: feedback
---

Found 2026-07-06 (Slack thread, Alysa QC on WS1 SG): 3 TLEO codes — `FT_REL_TLEO_LC_20PCT_100MX`, `FT_REL_TLEO_LC_45PCT_138MX_BR`, `FT_REL_TLEO_LC_45PCT_48MX_BR` — had QPRO/QP2's 8-clause T&C template (distinctive "Refresh button" / ZH "刷新按钮" reminder clause, per [[reference-inbox-tnc-docs]]) instead of WS1's own 5-clause format, on BOTH MY and SG. Alysa manually corrected SG same-day; MY was untouched (dated 2026-07-04, before this QC pass) until found and fixed via `bin/fix-my-tleo-qpro-template-leak.mjs`.

**Why this matters:** `bin/_deep-qc-ws1-tleo-tnc.mjs`'s first pass (2026-07-06, earlier same day) found these exact 3 MY promos had a "different template" and — WRONGLY — cleared it as a harmless newer-format variant, not a defect. It is a real platform-template mismatch: WS1/WS2 must never carry QPRO/QP2 wording (different clause count, different reminder language, wrong tone for the platform).

**How to apply:** the auditor now has a Q1 check — any WS1 T&C body matching `/Refresh button/i` (EN) or `/刷新按钮/` (ZH) is a hard FAIL, not a warn. Any future "this looks like a slightly different but plausible template" finding on WS1 T&C should be checked against [[reference-inbox-tnc-docs]] before being waved off — WS1 has exactly one valid format (5 clauses), no legitimate variants.
