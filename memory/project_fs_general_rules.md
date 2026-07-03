---
name: fs-general-rules
description: "FS promo general mechanics rules for ALL brands — spin count ceiling, spin value floor, min dep, TO by wallet type. Direction set 2026-06-18."
metadata: 
  node_type: memory
  type: project
  originSessionId: 516be00b-4936-4782-89bb-3ad902570566
---

## Direction (set 2026-06-18)

General standard for ALL REL_/RET_ Free Spin codes across all brands. Does NOT apply to WELC_ (welcome/acquisition) codes which follow separate logic.

- Spin count: **≤ 88 spins max** (no more 100–288 spin codes for regular rotation)
- Spin value: **≥ 0.50/spin** (raise from current 0.20–0.40 floor)
- Min deposit: **≥ 100 base / ≥ 200 booster** (raise from current 30–88 floor)
- TO: **10–15x** (raise from current 3–8x dominant range)
- Max withdrawal: **= total spin value** (hard anti-hunting ceiling)

## Current landscape (2026-06-16 snapshot)

~78% of existing FS codes are 100+ spins. Dominant pattern: 188–288 spins × 0.20/spin at TO 5–8x.
- QP2: 1589 FS codes; <100=253, =100=7, >100=932; values: 0.20/0.40/0.60; TO: 3–20x; min dep: 30–300
- QPRO: 2017 FS codes; <100=291, =100=38, >100=1022; values: 0.01–1.00; TO: 3–30x; min dep: 30–800
- QPRO-AU: 26 codes; values: 0.10–0.20; mostly WELC at TO 1–3x

## Standard tiers by wallet type

### QP2 Seamless (IBC22/KING333/ACE66/SPADE66) — SGD primary
Anti-hunting risk: **HIGHEST** — seamless wallet = no friction between win and withdrawal. Requires highest TO.
| Tier | Spins | Val | Total | Min dep | TO | Net cost |
|------|-------|-----|-------|---------|-----|---------|
| Base | 30 | SGD 0.80 | SGD 24 | SGD 80 | 12x | SGD 13.44 (56%) |
| Booster | 50 | SGD 1.00 | SGD 50 | SGD 150 | 15x | SGD 20.00 (40%) |
| High-value | 88 | SGD 1.00 | SGD 88 | SGD 300 | 15x | SGD 35.20 (40%) |

### QPRO Transfer (BP9→XE38, QPRO1–17) — MYR primary
Anti-hunting risk: **MODERATE** — transfer in/out step is a natural intent barrier.
| Tier | Spins | Val | Total | Min dep | TO | Net cost |
|------|-------|-----|-------|---------|-----|---------|
| Base | 30 | MYR 0.80 | MYR 24 | MYR 100 | 10x | MYR 14.40 (60%) |
| Booster | 50 | MYR 1.00 | MYR 50 | MYR 200 | 12x | MYR 26.00 (52%) |
| High-value | 88 | MYR 1.00 | MYR 88 | MYR 300 | 15x | MYR 35.20 (40%) |

### WS1/WS2 Deposit Wallet (MB8, RWS77) — MYR — IGMP platform
Anti-hunting risk: **LOW** — bonus wallet isolated from main balance until TO completes.
Same numbers as QPRO but IGMP API is different: `rounds × lines × amount_per_line` = total value.
| Tier | Spins | Val | Total | Min dep | TO | Net cost |
|------|-------|-----|-------|---------|-----|---------|
| Base | 30 | MYR 0.80 | MYR 24 | MYR 100 | 10x | MYR 14.40 (60%) |
| Booster | 50 | MYR 1.00 | MYR 50 | MYR 200 | 12x | MYR 26.00 (52%) |
| High-value | 88 | MYR 1.00 | MYR 88 | MYR 300 | 15x | MYR 35.20 (40%) |

### QPRO-AU (PokiesPalace/OzPokies77) — AUD — REL_ only
WELC_ codes (welcome/acquisition) keep their existing TO 1–3x giveaway mechanics unchanged.
| Tier | Spins | Val | Total | Min dep | TO | Net cost |
|------|-------|-----|-------|---------|-----|---------|
| Base | 30 | AUD 0.50 | AUD 15 | AUD 50 | 12x | AUD 7.80 (52%) |
| Booster | 50 | AUD 0.80 | AUD 40 | AUD 150 | 15x | AUD 16.00 (40%) |
| High-value | 88 | AUD 1.00 | AUD 88 | AUD 200 | 15x | AUD 35.20 (40%) |

## Why wallet type drives TO recommendation

- **QP2 Seamless** → TO 12–15x: no friction, funds move instantly, easiest to bonus hunt
- **QPRO Transfer** → TO 10–12x: transfer step = conscious intent, partial natural barrier
- **WS1 Deposit** → TO 10–12x: IGMP bonus wallet isolation provides platform-level protection
- **AU** → TO 12–15x: similar to QP2 (seamless-like player behavior, WELC codes excluded)

## Cost model (Slots HE 4%)

Net cost = (Spins × Spin Value) × (1 − TO × 0.04)

| TO | Net cost % |
|-----|------------|
| 5x | 80% |
| 8x | 68% |
| 10x | 60% |
| 12x | 52% |
| 15x | 40% |

Current 200-spin × 0.20 at TO5x = MYR40 total, MYR32 net cost (80%).
New 50-spin × 1.00 at TO12x = MYR50 total, MYR26 net cost (52%) — better risk profile at similar total.

## Anti-hunting standard for FS

- Max withdrawal = total spin value (hard cap)
- Blacklist template applied on all FS promos
- Max 1 claim/day per player per code
- KYC Verified minimum before FS triggers
- Min deposit gate strictly enforced

## Open questions (pending confirmation)

1. IDR spin value conversion: MYR 0.80 → approximately IDR 2700/spin (1 MYR ≈ 3400 IDR) — needs operator confirmation
2. 88-spin high-value tier: regular rotation or seasonal/campaign use only?
3. WS1/WS2 scope for CEE codes (see [[cee-lc-sports-codes]]) — pending CEE team confirmation
