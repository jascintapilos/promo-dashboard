---
name: project-ws1-sg-tleo-name-issues
description: "Deep QC 2026-07-06 — WS1 SG TLEO names never deduped; 5 promos named \"45% Reload Bonus\" pay pct=20; MY FC BR pairs share names. T&C content itself verified clean 54/54 both sites."
metadata: 
  node_type: memory
  type: project
  originSessionId: 05fa4dab-4d6e-4c2c-b58d-dc42509031b9
---

Deep QC of TLEO reward T&C (2026-07-06, `bin/_deep-qc-ws1-tleo-tnc.mjs` + 2 Sentinel agents): **T&C content verified correct 54/54 on BOTH WS1 MY and SG** — category clauses match code tokens (LC→Live Casino excl. Blackjack, SL/SLOT→Slots excl. Arcade/Table, else all-categories excl. Blackjack+Virtual Sports), titles match live rates, stats numbers match live economics, currency/links per-site correct. **TLEO category convention (promo request sheet Apr r64-132 / May r125-164, col M): _LC = Live Casino only; NO token on reload = SLOT ONLY (not all-games); FC codes = Slots and LC only.** 2026-07-06 (later): fix-tleo-tnc-categories.mjs corrected the category clause on 30 promos/site (18 slot-reloads + 12 FC) that wrongly said "all game categories" — on BOTH sites; wording confirmed by Wai Yip; deep-QC re-verified 54/54 PASS both sites with sheet-derived expectations. Two ZH wordings existed for the old all-categories sentence (replication batch vs rebuilt-12). Note: TLEO T&C exist in TWO formats — legacy 5-clause (category at clause 3) and newer 8-clause (category at clause 4, rids MY 15190-15192 / SG 13026-13028); QC must scan full text, not clause position.

**Findings:**
1. **FIXED 2026-07-06** (bin/_fix-sg-tleo-wrong-rate-names.mjs — renamed to MY-twin names; the reward-detail PUT wiped their T&C, restored via bin/_restore-sg-tleo-tnc-5.mjs, see [[feedback-igmp-reward-details-put-wipes-tnc]]; deep-QC 54/54 PASS both sites after): FT_REL_TLEO_20PCT_300MX_BR (pid 2817), 20PCT_400MX_BR (2818), LC_20PCT_20MX_BR (2822), LC_20PCT_300MX_BR (2823), LC_20PCT_400MX_BR (2824) — PromotionName + RewardName = "Time Limited Exclusive Offer - 45% Reload Bonus" but live pct=20. Wrong-reward risk for Manual Reward team.
2. **WS1 SG — names never deduped:** "20% Reload Bonus" ×17, "TLEO 45%" ×14, "45%" ×9 etc. The 2026-07-04 uniqueness pass was MY-only.
3. **WS1 MY + SG — FC BR pairs share names:** FT_TLEO_FC228/458/888_10X vs _BR → "Exclusive Offer - N Free Credit" ×2 each (FC codes were invisible to the Bonus-only listing used by the original dedupe).

Confirmed intentional (matches original TLEO design in bin/_archive/_update-tleo-ws1-tnc.mjs): TO 3x all-category / 8x LC / 10x small-tier+FC; lucky-number caps (138/228/458/888).

Fix recipe: pass-1 `UpdatePromotionDetails` (name+desc+dates passthrough), pass-2 `UpdatePromotionRewardDetails` (WS1 v3: numbers as STRINGS, KYC CSV). Related: [[project-ws1-legacy-name-dedupe]], [[project-ws1-my-tleo-tnc-missing]].
