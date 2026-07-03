---
name: cee-lc-sports-codes
description: "CEE team's new LC/Sports deposit promo codes being designed — mechanics, cost model, design constraints"
metadata: 
  node_type: memory
  type: project
  originSessionId: 516be00b-4936-4782-89bb-3ad902570566
---

## Context
CEE team needs new LC/Sports deposit promo codes that don't clash with other campaign cost tracking. Existing codes (RET_LC_BASE_15PCT / RET_LC_BOOST_18PCT at TO15x, RET_SPORTS_BASE_12PCT / RET_SPORTS_BOOST_15PCT at TO10x) are "not workable" for players due to TO15x + max W/D 150 cap.

## Design constraints
- Must be CEE-owned codes (no cost mixing with TLEO, Starter, HSD or other campaigns)
- **Must work for ALL player types — not just VIP/high value players.** Mechanics must be completable by casual low-deposit players (dep 50-100 range).
- Split by category: separate LC and Sports codes (CEE tracks costs by category)

## Proposed codes (pending TO finalisation)
| Code | Rate | Category | Min Dep | Max Bns |
|------|------|----------|---------|---------|
| REL_BASE_LC_20PCT_?X | 20% | LC only | 50 | 300 |
| REL_BOOSTER_LC_25PCT_?X | 25% | LC only | 50 | 500 |
| REL_BASE_SPORTS_18PCT_?X | 18% | Sports only | 50 | 300 |
| REL_BOOSTER_SPORTS_20PCT_?X | 20% | Sports only | 50 | 300 |

## Brands
- All 4 codes: IBC22, KING333, ACE66, SPADE66, BP9, 12HUAT, BX99, YE55, U388, WYN8, MBS66, WILD33, MINT33, UO8, MSB66, SBO18, IBC7, SBO28, E688, ED98, XE38 (21 brands)
- Sports only: POKIESPALACE
- Excluded: OZPOKIES77 (no LC or Sports category)
- WS1/WS2 (MB8, RWS77): pending CEE confirmation

## TO discussion
- TO 5x proposed initially — operator flagged as too low
- TO being reconsidered; must balance operator safety WITH casual player completability
- Key constraint: casual player deposits 50-100, must be able to realistically complete wagering

## Cost model (LC HE 2.5%, Sports HE 5%)
Net cost = Bonus × (1 - TO × HE)
- TO 5x: LC 87.5% of bonus, Sports 75%
- TO 8x: LC 80% of bonus, Sports 60%
- TO 10x: LC 75% of bonus, Sports 50%
