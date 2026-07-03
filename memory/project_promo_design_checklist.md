---
name: promo-design-checklist
description: "Standard questions + mechanics benchmarks for proposing any new promo code (Deposit/FC/FS). Covers intake, wallet-type considerations, cost model, anti-hunting, and presentation format."
metadata: 
  node_type: memory
  type: project
  updated: 2026-06-18
  originSessionId: 516be00b-4936-4782-89bb-3ad902570566
---

## Part 0 — Segment type → mechanics guide (read before Part 1)

This is the most important dimension. Segment drives mechanics more than anything else.

### Segment codes

| Code | Who | Mindset | Cost expectation |
|------|-----|---------|-----------------|
| REL_ | Active depositing players | "I'm already here, reward me" | Moderate — they're LTV contributors |
| RET_ | Churned or at-risk players | "Convince me to come back" | Higher — win-back cost is accepted |
| WELC_ | New / first-time players | "Show me what this platform is" | Highest — acquisition cost is budgeted |

### How segment should change mechanics

| Parameter | REL_ (Active) | RET_ (Churn/at-risk) | WELC_ (New) |
|---|---|---|---|
| **Rate / value** | Standard (15–25%) | Higher than REL (20–30%) | High (25–40%) or no-dep FC/FS |
| **TO** | Standard (10–15x) | Slightly lower for attractiveness (8–12x) | Lower (5–10x) — acquisition, not ROI |
| **Min deposit** | Standard (50–100) | Lower or none (remove barrier to re-entry) | None or very low (5–20) |
| **Max bonus / W/D** | = max bonus cap | Slightly higher (sweetener) | Capped (controls acquisition cost) |
| **Recurrence** | Recurring (daily/weekly) | Limited (1x per reactivation window, e.g. 30 days) | Once per lifetime |
| **Anti-hunting priority** | High (repeat claimers) | Moderate (KYC already done) | High (unknown player behaviour) |
| **Delivery** | CRM push (targeted blast) | CRM push or agent-assigned | Player-claimed or CRM welcome flow |

### Base vs Booster within a segment

Both Base and Booster are within the same segment — e.g. both REL_. The split is by player **value tier**, not by segment.

| | Base | Booster |
|---|---|---|
| Who qualifies | All active players in segment | Higher-value / higher-frequency depositors |
| How to identify | CRM default assignment | CRM scoring, deposit frequency, tier level |
| Rate | Lower end (e.g. 20%) | Higher end (e.g. 25%) |
| Min dep | Lower (e.g. 50) | Higher (e.g. 100–200) — they deposit more anyway |
| Max bonus | Smaller cap (e.g. 300) | Larger cap (e.g. 500–1000) |
| TO | Same or slightly lower | Same or slightly higher (higher value = more risk to protect) |

**Key rule: Base mechanics must be completable by ALL players in the segment — not just high-value ones.** If base TO × min dep produces a wagering requirement a casual player can't realistically complete, the promo fails silently (they don't claim it, or claim and abandon).

### Segment × delivery × anti-hunting matrix

| Segment | Common delivery | Anti-hunting level | Notes |
|---|---|---|---|
| WELC_ × player-claimed | Lobby/portal | High | Unknown player, unknown intent |
| WELC_ × CRM | Welcome flow | Moderate | Slightly more known |
| REL_ × CRM push | Weekly blast | High | Repeat claimers, volume risk |
| REL_ × player-claimed | Always-on lobby | Very high | Any player can claim any day |
| RET_ × CRM push | Reactivation campaign | Moderate | Churned = known players |
| RET_ × agent-assigned | CS outreach | Low | Manual case-by-case |

**If delivery = player-claimed:** max W/D cap, blacklist template, and claim frequency are non-negotiable regardless of segment.

---

## Part 1 — Intake questions (ask ALL before proposing any mechanics)

### 1. Player segment
- Which segment: REL_ / RET_ / WELC_? (See Part 0 for how this changes mechanics.)
- Is Base = all players in segment, and Booster = higher-value subset? Or defined differently?
- Must mechanics work for ALL players in segment including casual low-deposit players (dep 50–100)? Or is this explicitly VIP/high-value only?
- What is the recurrence intent: once-ever / per-reactivation-event / daily / weekly?

### 2. Delivery mechanism
- CRM push (team controls segment — who gets which tier)
- Player-initiated claim (lobby/portal visible — any player can claim → anti-hunting becomes critical)
- Agent-assigned (CS applies per case — lowest abuse risk, least scalable)

### 3. Cost tracking / campaign ownership
- Which campaign bucket does cost get tracked against (CEE / TLEO / Starter / HSD)?
- Are there existing codes covering the same category/segment from a different campaign that would mix costs?
- CEE-owned = must be separate codes, not shared with other campaigns.

### 4. Brand & currency scope
- Which specific brands? Don't default to all brands — start narrow, expand after pilot.
- Wallet family for each brand (QP2 Seamless / QPRO Transfer / WS1 Deposit / AU) — affects TO and min dep defaults.
- Which currencies? MYR / SGD / IDR / AUD — each has different spend thresholds.

### 5. Category
- LC only / Sports only / Slots only / combined?
- If combined LC+Sports: cost tracking still clean? Or split into separate codes per category?
- FS = Slots only (standard rule — see [[fs-general-rules]]).

### 6. Code naming
- REL/RET/WELC + TIER (BASE/BOOSTER) + CATEGORY + RATE/SPINS + TOx
- PCT in code name must match stated rate exactly (25PCT ≠ 20%). Verify before writing.
- Probe BO for existing codes with same/similar name before finalising.
- WS1/WS2 auto-prepend FT_; TEST_ when campaign="TEST".

---

## Part 2 — Mechanics benchmarks by bonus type

### Deposit Bonus

**Category TO benchmarks (conservative → balanced → player-friendly):**

| Category | HE | Conservative TO | Balanced TO | Player-friendly TO | Note |
|---|---|---|---|---|---|
| Live Casino | 2.5% | 15x | 12x | 10x | TO15x + low max W/D = "not workable" (CEE lesson) |
| Sports | 5.0% | 15x | 12x | 10x | Min odds 1.50 required |
| Slots | 4.0% | 12x | 10x | 8x | Lower HE allows lower TO |

**Approved CEE standard (2026-06-18, SG market, all active brands):**
- REL_BASE_LC_20PCT_10X: 20% LC, min dep 50, max bns 300, TO 10x
- REL_BOOSTER_LC_25PCT_12X: 25% LC, min dep 50, max bns 500, TO 12x
- REL_BASE_SPORTS_20PCT_10X: 20% Sports, min dep 50, max bns 300, TO 10x
- REL_BOOSTER_SPORTS_25PCT_12X: 25% Sports, min dep 50, max bns 300, TO 12x

**Cost model:** Net cost = Bonus × (1 – TO × HE). Always show at dep 50/100/200/500.

| TO | LC (HE 2.5%) | Sports (HE 5%) | Slots (HE 4%) |
|---|---|---|---|
| 5x | 87.5% | 75.0% | 80.0% |
| 8x | 80.0% | 60.0% | 68.0% |
| 10x | 75.0% | 50.0% | 60.0% |
| 12x | 70.0% | 40.0% | 52.0% |
| 15x | 62.5% | 25.0% | 40.0% |

**Anti-hunting:**
- Max bonus cap: set (300–500 standard)
- Max withdrawal cap: = max bonus
- KYC: Advanced
- Claim frequency: 1x/day
- Sports: min odds 1.50
- Blacklist template: standard

---

### Free Credit (FC)

FC has no deposit requirement — 100% of the FC value is operator exposure before TO.

**Typical use case:** RET_ reactivation, or WELC_ no-deposit welcome.

**Mechanics benchmarks:**

| Parameter | Conservative | Balanced | Player-friendly |
|---|---|---|---|
| FC amount (MYR) | 5–10 | 15–20 | 30–50 |
| TO | 30x | 25x | 20x |
| Category | Slots only | Slots only | Slots or specific game |
| Max W/D | = FC amount | 2× FC amount | 3× FC amount |

**Cost model:** Net cost = FC Amount × (1 – TO × HE)
- MYR 20 FC at TO 25x, Slots HE 4% → cost = 20 × (1 – 1.00) = MYR 0 (fully wagered away — typical for high-TO FC)
- MYR 20 FC at TO 20x, Slots HE 4% → cost = 20 × 0.20 = MYR 4.00
- MYR 50 FC at TO 20x → MYR 10 net cost per claim

**Key rule:** FC TO must be high enough that expected winning ≤ max W/D cap. Otherwise you're paying out more than the max W/D intends.

**Anti-hunting:**
- Max W/D cap is critical — primary control for FC (no deposit to anchor cost)
- KYC: Advanced (or phone verified minimum)
- 1x per lifetime per player (not 1x/day — FC is a one-time acquisition tool)
- Blacklist template: standard

---

### Free Spin (FS)

**New direction (set 2026-06-18):** Lower spins, higher value per spin, stronger deposit gate, safer TO. Applies to REL_/RET_ only — WELC_ codes exempt.

**General rules (all brands):**
- Spin count: ≤ 88 max (no more 100–288 for regular rotation)
- Spin value: ≥ 0.50/spin (raised from 0.20–0.40 floor)
- Min deposit: ≥ 100 base / ≥ 200 booster
- Max W/D: = total spin value (hard ceiling)

**TO by wallet type (critical — different risk profiles):**

| Wallet | Brands | Friction | Recommended TO |
|---|---|---|---|
| QP2 Seamless | IBC22/KING333/ACE66/SPADE66 | None — instant debit | 12–15x |
| QPRO Transfer | BP9→XE38 (QPRO1–17) | Transfer in/out step | 10–12x |
| WS1/WS2 Deposit (IGMP) | MB8, RWS77 | Bonus wallet isolated | 10–12x |
| QPRO-AU | PokiesPalace/OzPokies77 | Transfer step | 12–15x |

**Standard tier table (MYR for QPRO/WS1; SGD for QP2):**

| Tier | Spins | Spin value | Total | Min dep | TO (QPRO) | TO (QP2) | Net cost % |
|---|---|---|---|---|---|---|---|
| Base | 30 | 0.80 | 24 | 100 | 10x | 12x | 60% / 52% |
| Booster | 50 | 1.00 | 50 | 200 | 12x | 15x | 52% / 40% |
| High-value | 88 | 1.00 | 88 | 300 | 15x | 15x | 40% / 40% |

**Cost model:** Net cost = (Spins × Spin Value) × (1 – TO × HE_slots)
HE Slots = 4%

Full reference: [[fs-general-rules]]

**Anti-hunting:**
- Max W/D = total spin value (hard cap — no exceptions)
- Blacklist template: always applied
- 1x claim/day per player per code
- KYC: Verified minimum
- Deposit gate strongly preferred (deposit promo as prerequisite)

---

## Part 3 — Mechanics proposal format

**Always present a comparison table — never a single recommendation:**

| | Conservative | Balanced | Player-friendly |
|---|---|---|---|
| Rate / Spins / Amount | lower | mid | higher |
| TO | higher | mid | lower |
| Max cap | lower | mid | higher |
| Net cost (dep/spin floor) | lower | mid | higher |
| Net cost (dep/spin mid) | lower | mid | higher |

Let the team choose. Don't force one option and iterate — it wastes rounds.

**Deposit bonus:** always show at dep 50 / 100 / 200 / 500.
**FS:** always show at base / booster / high-value tiers.
**FC:** always show at the proposed FC amount.

---

## Part 4 — Common design mistakes (lessons learned)

| Mistake | What happened | Rule |
|---|---|---|
| TO too low on LC | TO 5x proposed; operator rejected as too risky | LC floor = TO 10x for REL_; Sports floor = TO 10x |
| Max W/D too restrictive | max W/D 150 at high dep = cap silently hit, player frustrated | Max W/D should scale with max bonus, not be fixed low |
| Assuming VIP-only | Mechanics not completable at dep 50–100 | Always ask: "must this work for casual players?" |
| Rate in name ≠ stated rate | REL_BOOSTER_SPORTS_25PCT had 20% in description | Code name PCT must match — verify before save |
| SB vs SPORTS | Used "SB" in code while existing CEE codes use "SPORTS" | Follow existing naming pattern, check before proposing |
| Not asking player segment | Designed deposit bonus without knowing REL vs RET | Ask segment before anything else |
| CEE cost mixing | Using shared codes → cost mixed across campaigns | CEE codes must be separate, never shared |
| FS spin count too high | 200–288 spins at TO 5x = high net cost | FS cap = 88 spins for regular rotation |
