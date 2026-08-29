# Forward-Outcome Pull — Spec (validation layer 1 of 3)

**Status:** Spec — ready to implement. Generalises `01c_rescue_forward.py` from Lane‑B‑only to the whole VIP/whale bonus universe.
**Date:** 2026-08-29 · **Market:** WS1 Malaysia (MYR) · **Owner to run:** Sales HOD · Promotions · CRM
**Layer:** 1 (measure). Layer 2 = attribution model (governance). Layer 3 = holdout (causal proof — `cashback-holdout-spec.md`, `frequency-cap-holdout-spec.md`). **This pull does NOT prove causation** — it turns placeholders into measured observational numbers.

---

## Why (what it fixes)

The report shows real forward net‑revenue **only for Lane B** (Weekly Rescue), because only `01c_rescue_forward.py` pulls it. Everywhere else the forward view is a placeholder:

- **Whale tab — "Is the bonus spend working?"** renders the hint *"bonus efficiency · 30/60/90 pending pull"*; `whale_detection.py` fills it with `eff_coarse = ytd_ngr / vip_bonus` — a **YTD ratio**, not a forward one — and an explicit note: *"Real 30/60/90‑day forward efficiency lands with the deposit + forward‑NGR pull (P2)."*
- **Incrementality panels** (Retention "Extra returns vs the player's own baseline"; Lane‑A NGR‑lift) read a **7‑day** own‑baseline window only — hence the standing caveat *"a read, not a controlled test"* / *"directional read, not proof."*

This pull provides, for **every** VIP/whale bonus claim, the forward deposit + NGR series at 30/60/90 days **and** a matched pre‑claim baseline — so the whale efficiency card becomes measured and the incrementality panels get a 30/60/90 own‑baseline instead of 7‑day. (It stays observational; the "not a controlled test" caveat remains until the holdout.)

## The universe

- **Bonuses:** every code in `scratchpad/vip/vip-codes-MY.json` — **all four lanes** (A‑performance, B‑cashback, C‑entitlement, D‑engagement), not just Lane B. Same code list the rest of the report uses, so no universe drift.
- **Period of claims:** `2026-01-01 → 2026-08-26` (the report window; `START`/`END1` in `01c`).
- **Grain — pull it at TWO grains** (a member with several codes needs both):
  - **A. Per `(member, code)`** — anchored at the member's **first** claim of that code in‑period, `bonus_amount` = total for that member×code. Feeds **per‑code / lane** efficiency in `02_compute_metrics.py` (matches its existing `fwd[(code, member)]` join).
  - **B. Per `member`** — anchored at the member's **first VIP claim across all codes**, `bonus_amount` = total VIP bonus. Feeds the **whale per‑member** efficiency in `whale_detection.py`.
  - **Why both:** you cannot get grain B by summing grain A. A whale holding 3 codes with overlapping 30/60/90 windows would have the same calendar‑day NGR counted under each code — inflating a summed numerator against the correct total‑bonus denominator. Grain B measures each member's forward days **once**. Use A for per‑code cards, B for per‑member (whale) cards; never sum A to member level.
  - (Limitation, both grains: repeat claims of the same anchor collapse to the first; forward windows run from it — the same simplification Lane B already accepts. Note it in output.)

## The pull (ClickHouse — generalises `01c_rescue_forward.py`)

Same connection (`from csir_config import get_client`, `send_receive_timeout=300`), same tables, same window trick — widen the offset range to **−90 … +89** so we get both a matched pre‑baseline and the forward outcomes in one pass, and add deposit + bonus columns.

```python
START, END1   = "2026-01-01", "2026-08-26"     # claim window
SNAP_LO, SNAP_HI = "2025-10-01", "2026-11-30"   # LO covers pre-90 of the earliest claim; HI covers fwd-90 of the last
STATUSES = "('Approved','Redeemed','Complete','Active','Completed','Low Balance 1','Low Balance 2')"
inlist   = ",".join("'" + c["code"].replace("'", "''") + "'" for c in vip_codes)   # ALL lanes
```

```sql
WITH per_cm AS (
    SELECT SITE, MEMBER_ID, BonusCode,
           min(toDate(BonusTime_gmt8)) AS claim_date,
           sum(BonusAmount)            AS bonus_amount,
           count()                     AS claims
    FROM WORKSPACE.GetBonus_ABC
    WHERE SITE_edit='WS1' AND Currency='MYR' AND BonusAmount>0
      AND BonusStatus IN {STATUSES}
      AND BonusTime_gmt8 >= '{START} 00:00:00' AND BonusTime_gmt8 < '{END1} 00:00:00'
      AND BonusCode IN ({inlist})
    GROUP BY SITE, MEMBER_ID, BonusCode
),
snap AS (
    SELECT SITE AS ss, MEMBER_ID AS sm, SnapshotDate AS sd,
           DepositAmount AS dep, NGR AS ngr, GGR AS ggr
    FROM WORKSPACE.Daily_GMT8_Snapshot_A
    WHERE Currency='MYR' AND (DepositAmount>0 OR NGR!=0 OR GGR!=0)
      AND SnapshotDate >= '{SNAP_LO}' AND SnapshotDate < '{SNAP_HI}'
    UNION ALL
    SELECT SITE, MEMBER_ID, SnapshotDate, DepositAmount, NGR, GGR
    FROM WORKSPACE.Daily_GMT8_Snapshot_BC
    WHERE Currency='MYR' AND (DepositAmount>0 OR NGR!=0 OR GGR!=0)
      AND SnapshotDate >= '{SNAP_LO}' AND SnapshotDate < '{SNAP_HI}'
)
SELECT
    p.MEMBER_ID    AS MEMBER_ID,
    p.BonusCode    AS BonusCode,
    p.claim_date   AS claim_date,
    p.bonus_amount AS bonus_amount,
    p.claims       AS claims,
    -- matched pre-claim own-baseline (days -30/-60/-90 .. -1)
    sumIf(ifNull(s.ngr,0), w.off >= -30 AND w.off < 0) AS pre_ngr_30,
    sumIf(ifNull(s.ngr,0), w.off >= -60 AND w.off < 0) AS pre_ngr_60,
    sumIf(ifNull(s.ngr,0), w.off >= -90 AND w.off < 0) AS pre_ngr_90,
    sumIf(ifNull(s.ggr,0), w.off >= -7  AND w.off < 0) AS pre_loss_ggr,   -- Lane-B keeps its 7d loss
    -- forward outcomes; claim day 0 included; snapshot NGR is ALREADY net of bonus
    sumIf(ifNull(s.ngr,0), w.off >= 0 AND w.off < 30) AS fwd_ngr_30,
    sumIf(ifNull(s.ngr,0), w.off >= 0 AND w.off < 60) AS fwd_ngr_60,
    sumIf(ifNull(s.ngr,0), w.off >= 0 AND w.off < 90) AS fwd_ngr_90,
    sumIf(ifNull(s.dep,0), w.off >= 0 AND w.off < 30) AS fwd_dep_30,
    sumIf(ifNull(s.dep,0), w.off >= 0 AND w.off < 60) AS fwd_dep_60,
    sumIf(ifNull(s.dep,0), w.off >= 0 AND w.off < 90) AS fwd_dep_90,
    sum(if(ifNull(s.dep,0) > 0 AND w.off >= 1 AND w.off < 30, 1, 0)) AS redep_days_30,
    max(if(ifNull(s.dep,0) > 0 AND w.off >= 1 AND w.off < 60, 1, 0)) AS redep_60,
    max(if(ifNull(s.dep,0) > 0 AND w.off >= 1 AND w.off < 90, 1, 0)) AS redep_90
FROM per_cm p
CROSS JOIN (SELECT toInt32(number) - 90 AS off FROM numbers(180)) w   -- -90 .. +89
LEFT JOIN snap s
    ON p.SITE = s.ss AND p.MEMBER_ID = s.sm
   AND addDays(p.claim_date, w.off) = s.sd
GROUP BY p.MEMBER_ID, p.BonusCode, p.claim_date, p.bonus_amount, p.claims
```

Run with the same settings as `01c`: `settings={"max_execution_time": 290, "max_memory_usage": 40000000000}`. Whole‑universe pull is bigger than Lane‑B — if it times out, chunk `inlist` by lane and concatenate.

**Grain B (per member)** is the *same query* with two changes: drop `BonusCode` from `per_cm`'s `SELECT`/`GROUP BY` (so the anchor becomes the member's first VIP claim across all codes and `bonus_amount` sums all VIP bonus), and drop `BonusCode`/`p.BonusCode` from the final `SELECT`/`GROUP BY`. Everything else — the snapshot CTE, the −90…+89 window, the `sumIf`/maturity columns — is identical.

### Net‑of‑bonus note
The snapshot `NGR` column is already **net of the bonus** (confirmed in `02_compute_metrics.py`: *"NGR is NET of bonus → break‑even 0"*). The forward window includes the claim day (`off=0`), so the bonus cost is inside `fwd_ngr_*`. Therefore `fwd_ngr_30 > 0` already means *the player produced net margin after the give*. Do **not** subtract bonus again.

### Maturity (compute in Python, per row, vs `data_as_of = 2026-08-26`)
A forward window is only trustworthy once it has fully elapsed:
```
mature_30 = claim_date <= as_of - 30d   # claims on/before 2026-07-27
mature_60 = claim_date <= as_of - 60d   # ... 2026-06-27
mature_90 = claim_date <= as_of - 90d   # ... 2026-05-28
```
Store `mature_30/60/90` booleans. **Efficiency and incrementality must average only over mature rows for each window** and fade/exclude immature ones — the same convention the report already uses for the 30‑day came‑back figures.

## Output

Two files, same object shape (grain B omits `code`):
- `scratchpad/vip/forward-outcomes-MY.json` — grain **A**, one object per `(member, code)`.
- `scratchpad/vip/forward-outcomes-member-MY.json` — grain **B**, one object per `member`.

Object shape:

```json
{ "code": "...", "member": "...", "claim_date": "2026-03-04",
  "bonus_amount": 0, "claims": 1,
  "pre_ngr_30": 0, "pre_ngr_60": 0, "pre_ngr_90": 0, "pre_loss_ggr": 0,
  "fwd_ngr_30": 0, "fwd_ngr_60": 0, "fwd_ngr_90": 0,
  "fwd_dep_30": 0, "fwd_dep_60": 0, "fwd_dep_90": 0,
  "redep_days_30": 0, "redep_60": 0, "redep_90": 0,
  "mature_30": true, "mature_60": true, "mature_90": false }
```

Member‑level → **scratchpad only, never committed** (standing rule). Everything that reaches a shared/committed view stays aggregated or opaque‑ref'd.

This file is a **superset of `rescue-forward-MY.json`** (Lane B ⊂ all lanes). Either (a) replace `01c` with this and have Lane‑B read the subset, or (b) keep `01c` and add this as `01d`. Prefer (a) — one pull, one source of truth.

## Derived metrics (what the consumers compute from it)

- **Real efficiency (whale tab):** `fwd_ngr_W / bonus_amount` = net‑revenue back per RM at W∈{30,60,90}, over mature rows. Replaces `eff_coarse`.
- **Incremental (own‑baseline):** `fwd_ngr_W − pre_ngr_W` = extra net revenue vs the player's matched pre‑window; `(fwd_ngr_W − pre_ngr_W) / bonus_amount` = incremental NGR per RM. Replaces the 7‑day incrementality read.
- **Deposit lift:** `fwd_dep_W − pre_dep_W` (pull `pre_dep_*` too if the deposit‑lift panel wants it; add three `sumIf(dep, off∈[-W,0))` lines by symmetry).
- **Retention:** `redep_60/90` (did they redeposit at all in the window).

## Consumers to rewire (name only — implementation is a follow‑up)

1. `01c_rescue_forward.py` → generalise to `forward-outcomes-MY.json` (all lanes).
2. `02_compute_metrics.py` — the `fwd[(code, member)]` dict now spans all lanes; give **Lane A** forward 30/60/90 + incremental (today it only has the 7‑day `ngr_lift`).
3. `whale_detection.py` — read **grain B** (`forward-outcomes-member-MY.json`); replace `eff_coarse` with real forward efficiency; fill the `efficiency` block (`median_ngr_per_bonus_rm`, over‑fed/under‑attended) from mature forward rows; **delete the `pending` note**. (Do not sum grain A up to member level — see the two‑grain note above.)
4. Incrementality panels (`cashback_incrementality.py` / the Retention `retIncrCard` builder) — swap the 7‑day baseline for the 30/60/90 matched pre‑window.
5. Template caveats: the whale card's *"30/60/90 pending pull"* hint and the `efficiency.pending` line go away. The *"a read, not a controlled test"* caveat **stays** (still observational — the holdout is layer 3).

## Guardrails

- **Observational, not causal.** This measures forward outcomes on treated players against their own past; it cannot separate "the bonus caused it" from "they'd have deposited anyway." That is the holdout's job (layer 3). Keep the "not a controlled test" caveat wherever a forward number appears.
- **Not promo‑attributed yet.** Do not relabel any of this as "promo‑attributed NGR" until the attribution model (layer 2) is documented and HOD‑approved — standing project rule.
- **Maturity honesty.** Never average an immature window; show N (mature/total) so a thin figure reads as still‑forming.
- **Privacy.** Member‑level rows stay in scratchpad; shared views carry opaque SHA1[:6] refs or aggregates only.

## Acceptance / QC

- Row count ≈ distinct `(member, code)` pairs across all lanes in‑period (sanity vs `claim-rows-MY.json`).
- Lane‑B subset of the new file **reconciles** to the old `rescue-forward-MY.json` (`fwd_ngr_30/60/90`, `pre_loss_ggr` within rounding) — the regression test that the generalisation didn't change Lane B.
- `Σ fwd_ngr_90 (mature)` and median forward efficiency print in the builder's stdout, same as `01c`.
- Immature‑row share reported (expect the last ~90 days of claims to lack `mature_90`).

## Not in scope

Causal proof (the holdout), the attribution model doc, and SG (the pull is MYR‑only; SG is a separate market run once its data is pulled).
