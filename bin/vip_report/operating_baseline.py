#!/usr/bin/env python3
"""Emit the `operating` block into vip-metrics-MY.json (VIP decision layer, P2).

Turns the one-off snapshot into the start of a monthly operating rhythm:
  - baseline: key metrics locked as of data_as_of (the before-picture);
  - leading_indicators: the few metrics to watch each month (deltas next run);
  - whale_slip_watch: the cooling top whales to act on now (OPAQUE refs only);
  - move_tracker: one row per decision-register action, baseline locked, owner TBC.

Reads existing scratchpad blocks only — no pulls. Run:
  python bin/vip_report/operating_baseline.py
"""
import json, os

SCR = os.environ.get(
    "VIP_SCR",
    "C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/"
    "879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad",
)
PATH = os.path.join(SCR, "vip", "vip-metrics-MY.json")

j = json.load(open(PATH, encoding="utf-8"))
as_of = j.get("data_as_of", "")
prog = j.get("program", {}) or {}
whale = prog.get("whale", {}) or {}
ls = j.get("lane_summary", {}) or {}
wl = j.get("whale_ledger", {}) or {}
tdc = (j.get("trend_decomp", {}) or {}).get("decomposition", {}) or {}
by_tier = {t["tier"]: t for t in prog.get("by_tier", [])}

# ---- baseline (locked before-picture) ---------------------------------------
baseline = {
    "as_of": as_of,
    "net_negative_subsidy": prog.get("subsidy_rm"),
    "laneA_ngr_per_rm": (ls.get("A-performance", {}) or {}).get("ngr_lift_per_rm"),
    "laneD_ngr_per_rm": (ls.get("D-engagement", {}) or {}).get("ngr_lift_per_rm"),
    "nodep_share_pct": tdc.get("nodep_share_h2"),
    "at_risk_whales": whale.get("value_at_risk_members"),
    "at_risk_ngr": whale.get("value_at_risk_ngr"),
    "funding_index": {t: (by_tier.get(t, {}) or {}).get("funding_index")
                      for t in ["Diamond", "Platinum", "Gold", "Silver", "Bronze"]},
}

# ---- leading indicators (watch monthly; deltas populate next run) ------------
leading_indicators = [
    {"label": "Lane A net rev / RM1", "value": baseline["laneA_ngr_per_rm"], "unit": "/RM", "good": "toward 0+"},
    {"label": "No-deposit share of Lane A spend", "value": baseline["nodep_share_pct"], "unit": "%", "good": "lower"},
    {"label": "Net-negative subsidy", "value": baseline["net_negative_subsidy"], "unit": "RM", "good": "lower"},
    {"label": "At-risk whales", "value": baseline["at_risk_whales"], "unit": "members", "good": "lower"},
    {"label": "Diamond funding index", "value": baseline["funding_index"].get("Diamond"), "unit": "x", "good": "toward 1.0"},
]

# ---- whale-slip watchlist (OPAQUE refs only) --------------------------------
members = [m for m in (wl.get("members", []) or []) if (m.get("drop_pct") or 0) > 0]
members.sort(key=lambda m: -(m.get("ytd_ngr") or 0))
whale_slip_watch = {
    "rows": [{"ref": m.get("ref"), "tier": m.get("tier"), "ytd_ngr": m.get("ytd_ngr"),
              "drop_pct": m.get("drop_pct"), "signal": m.get("signal")} for m in members],
    "shown": len(members),
    "cooling_top1pct": (wl.get("summary", {}) or {}).get("cooling"),
    "top1pct_total": (wl.get("summary", {}) or {}).get("whales"),
    "at_risk_members_all": whale.get("value_at_risk_members"),
    "at_risk_ngr_all": whale.get("value_at_risk_ngr"),
    "rule": "Alert any top whale whose 2nd-half deposits drop vs 1st-half; route to the owning VM.",
}

# ---- move tracker (mirrors the decision register; baseline locked) ----------
laneA_perrm = baseline["laneA_ngr_per_rm"]
move_tracker = [
    {"action": "Stop 2 flagship no-deposit codes", "watch": "Lane A spend + net rev/RM",
     "baseline": laneA_perrm, "owner": "TBC"},
    {"action": "Trim over-funded Bronze", "watch": "Bronze funding index",
     "baseline": baseline["funding_index"].get("Bronze"), "owner": "TBC"},
    {"action": "Cap big-player free-credit", "watch": "No-deposit share of Lane A",
     "baseline": baseline["nodep_share_pct"], "owner": "TBC"},
    {"action": "Redirect budget to slipping whales", "watch": "At-risk whale count",
     "baseline": baseline["at_risk_whales"], "owner": "TBC"},
    {"action": "Run Lane A matched holdout", "watch": "read-out date",
     "baseline": None, "owner": "TBC"},
]

j["operating"] = {
    "baseline": baseline,
    "leading_indicators": leading_indicators,
    "whale_slip_watch": whale_slip_watch,
    "move_tracker": move_tracker,
    "basis": ("Baseline locked as of the data date so next month's deltas are measurable. Watchlist uses "
              "opaque refs only; member-level stays in scratchpad. Deltas populate once a second period exists."),
}
json.dump(j, open(PATH, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

print(f"operating block written -> {PATH}")
print(f"  baseline as_of {as_of}: subsidy RM{baseline['net_negative_subsidy']:,} | Lane A {laneA_perrm}/RM | nodep {baseline['nodep_share_pct']}%")
print(f"  whale_slip_watch: {whale_slip_watch['shown']} shown (opaque refs) | cooling {whale_slip_watch['cooling_top1pct']}/{whale_slip_watch['top1pct_total']} top-1% | all at-risk {whale_slip_watch['at_risk_members_all']} (RM{whale_slip_watch['at_risk_ngr_all']:,})")
print(f"  leading indicators: {len(leading_indicators)} | move tracker rows: {len(move_tracker)}")
