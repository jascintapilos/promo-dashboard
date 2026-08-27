"""Task 5 — VIP program-wide metrics (the portfolio view above per-code grading).

Reads member-ledger-MY.json + vip-codes-MY.json + claim-rows-MY.json; pulls active-member-by-tier
for reach. Appends a "program" block to vip-metrics-MY.json:
  - per-player net margin -> net-negative VIP share + subsidy RM (by tier)
  - tier funding balance (spend-share vs NGR-share index) + reach + full-cost tier margin
  - whale concentration (top 1%/10% of players' share of +NGR + their bonus share) + value-at-risk
  - program ROI (incremental vs total-value, ranged) + payback context
  - rescue recidivism ; bonus-out fraud watchlist
NGR is NET of bonus -> net margin = ytd_ngr (do NOT subtract bonus again). Directional pending control.
Usage: python bin/vip_report/02b_program.py
"""
import sys, json
from pathlib import Path
from collections import defaultdict

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from csir_config import get_client

SCR = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad")
VIP = SCR / "vip"
LOGSITE = "WS1_MYS_MYR"
TIER_ORDER = ["Bronze", "Silver", "Gold", "Platinum", "Diamond", "Classic", "Unknown", "Other"]

import re
def norm_tier(t):
    t = (t or "Unknown").strip()
    if t in ("Agent Credit", "Scammers"): return "Other"
    if t in ("", "Unknown"): return "Unknown"
    return re.sub(r"\s*\(Trial\)$", "", t)

led = json.load(open(VIP / "member-ledger-MY.json", encoding="utf-8"))
for d in led: d["nt"] = norm_tier(d.get("tier_end"))
codes_meta = json.load(open(VIP / "vip-codes-MY.json", encoding="utf-8"))
rows = json.load(open(VIP / "claim-rows-MY.json", encoding="utf-8"))
facts = json.load(open(VIP / "vip-metrics-MY.json", encoding="utf-8"))

N = len(led)
tot_bonus = sum(d["vip_bonus"] for d in led)
tot_ngr = sum(d["ytd_ngr"] for d in led)

# ---- net-negative subsidy (by tier) ----
neg = [d for d in led if d["ytd_ngr"] < 0]
subsidy = sum(d["vip_bonus"] for d in neg)
by_tier = defaultdict(lambda: {"members": 0, "bonus": 0.0, "ngr": 0.0, "neg": 0, "neg_bonus": 0.0})
for d in led:
    t = by_tier[d["nt"]]; t["members"] += 1; t["bonus"] += d["vip_bonus"]; t["ngr"] += d["ytd_ngr"]
    if d["ytd_ngr"] < 0: t["neg"] += 1; t["neg_bonus"] += d["vip_bonus"]

# ---- reach: active MYR members by tier-at-end (one ClickHouse query) ----
print("reach: active members by tier...")
c = get_client(send_receive_timeout=200)
qr = f"""
WITH act AS (
  SELECT DISTINCT MEMBER_ID FROM (
    SELECT MEMBER_ID FROM WORKSPACE.Daily_GMT8_Snapshot_A WHERE Currency='MYR' AND DepositAmount>0 AND SnapshotDate>='2026-01-01' AND SnapshotDate<'2026-08-26'
    UNION ALL SELECT MEMBER_ID FROM WORKSPACE.Daily_GMT8_Snapshot_BC WHERE Currency='MYR' AND DepositAmount>0 AND SnapshotDate>='2026-01-01' AND SnapshotDate<'2026-08-26')
),
mem AS (SELECT MEMBER_ID, toDateTime('2026-08-25 23:59:59') AS asof FROM act)
SELECT ifNull(t.tier,'Unknown') AS tier, count() AS active
FROM mem
ASOF LEFT JOIN (SELECT MEMBER_ID, (TIME + INTERVAL 8 HOUR) AS tdt, NewMembershipName AS tier
                FROM WORKSPACE.dedup_PlayerMembershipLog_A WHERE SITE='{LOGSITE}' AND NewMembershipName!='') t
  ON mem.MEMBER_ID=t.MEMBER_ID AND mem.asof >= t.tdt
GROUP BY tier
"""
active_by_tier = defaultdict(int)
for tier, active in c.query(qr).result_rows:
    active_by_tier[norm_tier(tier)] += int(active)

tier_rows = []
for t in [x for x in TIER_ORDER if x in by_tier] + [x for x in by_tier if x not in TIER_ORDER]:
    v = by_tier[t]
    spend_share = v["bonus"] / tot_bonus if tot_bonus else 0
    ngr_share = v["ngr"] / tot_ngr if tot_ngr else 0
    rewarded = v["members"]; active = active_by_tier.get(t, 0)
    tier_rows.append({
        "tier": t, "members": v["members"], "bonus": round(v["bonus"]), "ytd_ngr": round(v["ngr"]),
        "spend_share_pct": round(spend_share * 100, 1), "ngr_share_pct": round(ngr_share * 100, 1),
        "funding_index": round(spend_share / ngr_share, 2) if ngr_share > 0 else None,   # >1 over-funded
        "net_margin": round(v["ngr"]),                       # ytd_ngr is already all-in net margin (net of bonus)
        "net_negative_members": v["neg"], "net_negative_bonus": round(v["neg_bonus"]),
        "reach_pct": round(rewarded / active * 100, 1) if active else None, "active_base": active,
    })

# ---- whale concentration + value-at-risk ----
ngr_sorted = sorted(led, key=lambda d: -d["ytd_ngr"])
pos_ngr = sum(d["ytd_ngr"] for d in led if d["ytd_ngr"] > 0)
top1_n = max(1, N // 100); top10_n = max(1, N // 10)
top1 = ngr_sorted[:top1_n]; top10 = ngr_sorted[:top10_n]
whale = {
    "top1pct_members": top1_n, "top1pct_ngr_share": round(sum(d["ytd_ngr"] for d in top1) / pos_ngr * 100, 1),
    "top1pct_bonus_share": round(sum(d["vip_bonus"] for d in top1) / tot_bonus * 100, 1),
    "top10pct_ngr_share": round(sum(d["ytd_ngr"] for d in top10) / pos_ngr * 100, 1),
}
# value-at-risk: top-decile-by-NGR players whose deposits are declining (H2 < 0.7*H1)
var = [d for d in top10 if d["dep_h1"] > 0 and d["dep_h2"] < 0.7 * d["dep_h1"]]
whale["value_at_risk_members"] = len(var)
whale["value_at_risk_ngr"] = round(sum(d["ytd_ngr"] for d in var))

# ---- program ROI (ranged) ----
# Ring-fence the cashback lane: its 7-day NGR is a loss give-back (invalid as an incremental read).
# The honest program-incremental EXCLUDES Lane B; cashback is judged on forward-margin/break-even (cashback_validation).
incr_ngr = facts["lane_summary"]  # claim-window lift by lane
laneB = incr_ngr.get("B-cashback", {})
b_ngr, b_bonus = laneB.get("ngr_lift", 0), laneB.get("spend", 0)
tot_incr_all = sum(l["ngr_lift"] for l in incr_ngr.values())
tot_incr = tot_incr_all - b_ngr                              # ex-cashback (the headline incremental read)
bonus_excl_b = tot_bonus - b_bonus
per_rm = round(tot_incr / bonus_excl_b, 2) if bonus_excl_b else None
roi = {
    "total_value_ratio": round(tot_ngr / tot_bonus, 1),     # YTD NGR / bonus — CONTEXT ONLY (mostly non-incremental)
    "incremental_ngr_lift": round(tot_incr),                 # 7-day claim-window lift, EX-cashback (honest headline)
    "incremental_per_rm": per_rm,                            # on non-cashback bonus
    "incremental_ngr_lift_with_cashback_7d": round(tot_incr_all),  # distorted by ring-fenced cashback — transparency, NOT headlined
    "cashback_bonus_ringfenced": round(b_bonus),
    "note": (f"Total value vs. bonus ({round(tot_ngr / tot_bonus, 1)}x) is background context only — most VIP net revenue is not extra profit "
             f"(the big players would play anyway). The honest extra-profit read leaves out the kept-separate money-back lane (its 7-day net revenue "
             f"is really a loss give-back, so it does not count here): setting the money-back aside, the program is about paying for itself (zero) "
             f"({'+' if tot_incr >= 0 else ''}RM{round(tot_incr):,}, {'+' if (per_rm or 0) >= 0 else ''}{per_rm} back for every RM1). "
             f"Money-back (RM{round(b_bonus):,}) is judged on its forward margin and whether each tier pays for itself (zero) (see cashback_validation), "
             f"not this window. This is a read, not proof; a matched control group is the proof step."),
}

# ---- recidivism ----
recid = [d for d in led if d["rescue_claims"] >= 2]
recidivism = {"members": len(recid), "bonus": round(sum(d["vip_bonus"] for d in recid)),
              "share_of_rescued": round(len(recid) / max(1, sum(1 for d in led if d["rescue_claims"] >= 1)) * 100, 1)}

# ---- bonus-out fraud watchlist (per-code top-1 share of bonus RM) + cross-code ----
# Mini-games (Lucky Wheel / Scratch Card) are EXCLUDED: their prize concentration (one big winner)
# is the game mechanic, not bonus farming — flagging them is a false positive.
minigame = {c["code"] for c in codes_meta if c.get("is_minigame")}
by_code = defaultdict(lambda: defaultdict(float))
for r in rows: by_code[r["code"]][r["member"]] += r["bonus_cost"]
flags = []
for code, mem in by_code.items():
    if code in minigame: continue
    sp = sum(mem.values())
    if sp < 5000: continue
    top1 = max(mem.values()); share = top1 / sp
    if share > 0.35 and len(mem) >= 5:
        flags.append({"code": code, "top1_share": round(share * 100), "spend": round(sp), "members": len(mem)})
flags.sort(key=lambda x: -x["spend"])
cross = [d for d in led if d["vip_claims"] >= 40]   # members draining many codes
fraud = {"code_concentration_flags": flags[:12], "cross_code_members_40plus": len(cross),
         "cross_code_bonus": round(sum(d["vip_bonus"] for d in cross))}

facts["program"] = {
    "members": N, "total_bonus": round(tot_bonus), "total_ytd_ngr": round(tot_ngr),
    "net_negative_members": len(neg), "net_negative_share_pct": round(len(neg) / N * 100, 1),
    "subsidy_rm": round(subsidy), "subsidy_share_pct": round(subsidy / tot_bonus * 100, 1),
    "by_tier": tier_rows, "whale": whale, "roi": roi, "recidivism": recidivism, "fraud": fraud,
}
json.dump(facts, open(VIP / "vip-metrics-MY.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)

# ---- report ----
p = facts["program"]
print(f"\nPROGRAM-WIDE ({N:,} VIP members):")
print(f"  bonus RM{p['total_bonus']:,} | YTD NGR RM{p['total_ytd_ngr']:,} | total-value ratio {roi['total_value_ratio']}x | incremental lift RM{roi['incremental_ngr_lift']:,} ({roi['incremental_per_rm']}/RM)")
print(f"  NET-NEGATIVE VIPs: {p['net_negative_members']:,} ({p['net_negative_share_pct']}%) -> subsidy RM{p['subsidy_rm']:,} ({p['subsidy_share_pct']}% of spend)")
print(f"  whale: top1% = {whale['top1pct_ngr_share']}% of +NGR (get {whale['top1pct_bonus_share']}% of bonus) | top10% = {whale['top10pct_ngr_share']}% | value-at-risk {whale['value_at_risk_members']} whales RM{whale['value_at_risk_ngr']:,} NGR")
print(f"  recidivism: {recidivism['members']} members ({recidivism['share_of_rescued']}% of rescued) RM{recidivism['bonus']:,} | fraud flags {len(fraud['code_concentration_flags'])} codes, cross-code(>=40 claims) {fraud['cross_code_members_40plus']}")
print(f"\n  TIER FUNDING BALANCE (index >1 = over-funded vs value):")
print(f"  {'TIER':9s} {'MEMBERS':>7} {'BONUS':>11} {'YTD NGR':>12} {'SPEND%':>6} {'NGR%':>6} {'INDEX':>6} {'REACH':>6} {'NET-NEG':>7}")
for t in tier_rows:
    print(f"  {t['tier']:9s} {t['members']:>7,} {t['bonus']:>11,} {t['ytd_ngr']:>12,} {t['spend_share_pct']:>5}% {t['ngr_share_pct']:>5}% {str(t['funding_index']):>6} {str(t['reach_pct'])+'%':>6} {t['net_negative_members']:>7}")
print("Saved program block into scratchpad/vip/vip-metrics-MY.json")
