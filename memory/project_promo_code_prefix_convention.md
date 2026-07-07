---
name: promo-code-prefix-convention
description: Approved owner×objective promo code prefix matrix + request sheet dropdowns (effective 1 Aug 2026)
metadata: 
  node_type: memory
  type: project
  originSessionId: 796b9c07-6856-4b25-9cd3-74418eebdc72
---

Approved 2026-07-07 (matrix signed off by stakeholders). Promo code format: `FT_OWNER_OBJECTIVE_[NODEP]_MECHANIC/DATE`.

- Owners: CRM, VM, TSM, AM, AFF (column E "Requestor" repurposed as Owner dropdown).
- Objectives: WELC (ACQ/Welcome), REL (Retention/active), RET (Churn/Reactivation), ADHOC, GROOM. RET always = churn, REL always = active — "VIP Retention" is VM_REL not VM_RET; never use CHURN as a token.
- NODEP is a modifier appended after the objective, not a segment.
- Stakeholder tags KN (Kien), CD (Cedric/Abigail), YH, JT (Joe) live in sheet column Z only, NEVER inside the promo code.
- FT_ stays auto-prepended by the canary for WS1/WS2 ([[ws1-ws2-ft-prefix]]) — not in sheet formula.

Sheet changes applied 2026-07-07 to the Promo Code Request sheet (1dqvCM9SoPLJ2iYNCQRe450wBk3S7HSHtbayuAJguodM):
- Hidden tab `Ref - Codes` = source of truth lists; named ranges OwnerList / ObjectiveList / StakeholderList / NoDepList.
- July 2026 tab: dropdown validation on E (Owner), K (Objective), Z (Stakeholder), AA (No Deposit?) for rows 18+ only (rows 2-17 grandfathered); AB = Suggested Prefix formula (rows 18-1000); W1 header legend replaced with new glossary; Guideline tab rows 12-22 hold the matrix.
- Effective for new requests from 1 Aug 2026; existing live codes grandfathered.

Phase 3 (repo side) done 2026-07-07: ingest emits `campaign_owner` (from Requestor col when ∈ owner codes; person name → null = legacy row), `stakeholder`, `no_deposit`, `suggested_prefix`. `src/campaign-prefix-rules.js` has `resolveConvention()` + `validatePrefixConvention()` (new convention takes precedence; legacy CAMPAIGN_PREFIX_RULES kept for grandfathered rows). Namer prepends OWNER_OBJECTIVE_[NODEP]_ and swaps a leading REL_→RET_ for churn-objective reloads. All 3 QC agents (promo-qc-engine, promo-qc, sentinel) check the new convention first and treat CHURN as a banned segment on new rows.

Rollout: team-wide Slack announcement (was step 4.3) cancelled per Wai Yip 2026-07-07 — do not post it. Remaining open step: mid-Aug 2026 spot-check of Aug-tab rows for legacy-style codes / empty dropdowns / CHURN tokens.

Naming skill (plugin anthropic-skills:promo-qc-engine SKILL.md) updated 2026-07-07 to the approved matrix — added CRM/AM owners, ADHOC/GROOM objectives, AFF as owner (not standalone segment), CHURN banned, Suggested Prefix (AB) cross-check, and corrected the stale column map (RN=D, Requestor/Owner=E, Campaign=K, Promo Code=W). Canonical mirror lives in repo user-skills/promo-qc-engine/SKILL.md (plugin dir can be overwritten by plugin updates — restore from mirror if that happens).
