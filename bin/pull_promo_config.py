"""Pull per-code promo config (deposit requirement + wagering) from BO/ClickHouse.

Joins WORKSPACE.260722_ws1_myr_Promotion (PromotionCode -> PromotionId) to
...PromotionReward (the reward config) and aggregates one row per code. Lets the
report split each mechanic into DEPOSIT-REQUIRED vs NO-DEPOSIT and attach the
wagering (rollover/winover) requirement — the lever that decides whether a
no-deposit bonus can ever pay. Config only (no member data).
Out: scratchpad/promo-config-MY.json = {code: {deposit_required, min_deposit, wagering, bonus_pct, n_rewards}}
Usage: python bin/pull_promo_config.py
"""
import sys, json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from csir_config import get_client

S = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad")

# all codes the report grades, across pillars
codes = set()
for p in ["acq/acq-metrics-MY.json", "ret/ret-metrics-MY.json", "vip/vip-metrics-MY.json"]:
    m = json.load(open(S / p, encoding="utf-8"))
    codes |= {c["code"] for c in m["codes"]}

c = get_client(send_receive_timeout=120)
inlist = ",".join("'" + x.replace("'", "''") + "'" for x in codes)
q = f"""
SELECT p.PromotionCode AS code,
       max(toInt16(coalesce(r.DepositRequirement,0)))      AS dep_req,
       max(coalesce(r.RequiredApprovedDeposit,0))          AS req_dep,
       max(coalesce(r.MinimumActionAmount,0))              AS min_action,
       max(coalesce(r.BonusPercentage,0))                  AS bonus_pct,
       max(coalesce(r.RolloverMultiplier,0))               AS rollover,
       max(coalesce(r.WinoverMultiplier,0))                AS winover,
       count() AS n_rewards
FROM WORKSPACE.`260722_ws1_myr_Promotion` p
INNER JOIN WORKSPACE.`260722_ws1_myr_PromotionReward` r ON p.PromotionId = r.PromotionId
WHERE p.PromotionCode IN ({inlist})
GROUP BY code
"""
cfg = {}
for code, dep_req, req_dep, min_action, bonus_pct, rollover, winover, nrw in c.query(q).result_rows:
    code = code.strip()
    min_dep = max(float(req_dep), float(min_action))
    # deposit-required if the config demands a deposit/action, or the bonus is a % of a deposit
    dep_required = bool(int(dep_req) >= 1 or min_dep > 0 or float(bonus_pct) > 0)
    cfg[code] = {"deposit_required": dep_required, "min_deposit": round(min_dep, 2),
                 "wagering": round(max(float(rollover), float(winover)), 1),
                 "bonus_pct": round(float(bonus_pct), 1), "n_rewards": int(nrw)}

json.dump(cfg, open(S / "promo-config-MY.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)

matched = len(cfg); total = len(codes)
dr = sum(1 for v in cfg.values() if v["deposit_required"])
nd = matched - dr
print(f"CONFIG PULL — matched {matched}/{total} codes ({round(matched/total*100)}%) | deposit-required {dr} · no-deposit {nd} · unmatched {total-matched}")
print("  NO-DEPOSIT examples (free grants):")
for k in [k for k, v in cfg.items() if not v["deposit_required"]][:6]:
    v = cfg[k]; print(f"    {k[:36]:36s} min_dep {v['min_deposit']:>6} · wager {v['wagering']}x")
print("  DEPOSIT-REQUIRED examples:")
for k in [k for k, v in cfg.items() if v["deposit_required"]][:6]:
    v = cfg[k]; print(f"    {k[:36]:36s} min_dep {v['min_deposit']:>6} · wager {v['wagering']}x · pct {v['bonus_pct']}")
print("Saved scratchpad/promo-config-MY.json")
