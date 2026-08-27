"""Rebuild the Bonus-Performance-by-Pillar tables using TL's classification
(scratchpad/tl_pillars.json) so they match the TL-aligned All Codes tab.
Reuses the per-code attribution in scratchpad/attrib-<cur>.json.
Writes scratchpad/perf-tl-MY.json / perf-tl-SG.json.
"""
import json
from pathlib import Path
from collections import defaultdict
import sys

# CSIR endpoint, credentials and client all come from csir_config.py at the repo root.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from csir_config import get_client

ROOT = Path("C:/Users/vdiuser/Downloads/promo-automation")
SCR = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad")
MET = ["claims", "bonus_cost", "t1_dep", "t1_ggr", "t1_ngr", "dep_lift", "ggr_lift", "ngr_lift"]


client = get_client(send_receive_timeout=300)

_tl_raw = json.load(open(SCR / "tl_pillars.json", encoding="utf-8"))
# trim codes on both sides — source sheet has stray leading/trailing spaces on a few codes
tl = {}
for _k, _v in _tl_raw.items():
    _m, _c = _k.split("||", 1)
    tl[f"{_m}||{_c.strip()}"] = _v


def kf(x, sign=False):
    v = round((x or 0) / 1000); s = f"{v:,}K"
    return ("+" + s) if (sign and v > 0) else s


def nf(x, sign=False):
    v = round(x or 0); s = f"{v:,}"
    return ("+" + s) if (sign and v > 0) else s


def xf(n, d): return f"{n/d:.2f}x" if d else "n/a"
def pct(n, d): return f"{n/d*100:.1f}%" if d else "0.0%"
def f1(n, d): return f"{n/d:.1f}" if d else "0.0"


for cur, mkt, label, sym in [("MYR", "MY", "Malaysia", "RM"), ("SGD", "SG", "Singapore", "S$")]:
    attrib = json.load(open(SCR / f"attrib-{cur}.json", encoding="utf-8"))
    agg = defaultdict(lambda: defaultdict(float))
    members = defaultdict(set)
    for r in attrib:
        p = tl.get(f"{mkt}||{(r['BonusCode'] or '').strip()}")
        if not p: continue
        for k in MET: agg[p][k] += float(r[k] or 0)
    mc = client.query(f"""
        SELECT DISTINCT MEMBER_ID, if(BonusCode='','Undefined',BonusCode) AS BonusCode
        FROM WORKSPACE.GetBonus_ABC WHERE SITE_edit='WS1' AND Currency='{cur}'
          AND BonusTime_gmt8 >= '2026-01-01 00:00:00' AND BonusTime_gmt8 < '2026-08-10 00:00:00'
          AND BonusStatus IN ('Approved','Redeemed','Complete','Active','Completed','Low Balance 1','Low Balance 2')
          AND BonusAmount > 0
    """, settings={"readonly": 1, "max_execution_time": 120, "max_result_rows": 2000000, "result_overflow_mode": "break"})
    all_mem = set()
    for mid, code in mc.result_rows:
        p = tl.get(f"{mkt}||{(code or '').strip()}")
        if p: members[p].add(mid); all_mem.add(mid)

    order = sorted(agg.keys(), key=lambda p: -agg[p]["bonus_cost"])
    total_spend = sum(agg[p]["bonus_cost"] for p in order)
    tot = {k: sum(agg[p][k] for p in order) for k in MET}

    def row_for(a, mem, name):
        c, s = a["claims"], a["bonus_cost"]
        return [name, nf(mem), nf(c), kf(s), pct(s, total_spend),
                kf(a["t1_dep"], 1), kf(a["t1_ggr"], 1), kf(a["t1_ngr"], 1),
                kf(a["dep_lift"], 1), kf(a["ggr_lift"], 1), kf(a["ngr_lift"], 1),
                xf(a["dep_lift"], s), xf(a["ggr_lift"], s), xf(a["ngr_lift"], s),
                f1(c, mem), nf(s/mem if mem else 0), nf(a["dep_lift"]/mem if mem else 0, 1),
                nf(a["ggr_lift"]/mem if mem else 0, 1), nf(a["ngr_lift"]/mem if mem else 0, 1),
                nf(s/c if c else 0), nf(a["dep_lift"]/c if c else 0, 1), nf(a["ngr_lift"]/c if c else 0, 1)]

    rows = []
    rows.append([f"BONUS PERFORMANCE BY CAMPAIGN PILLAR — {label} (WS1) · 1 Jan – 9 Aug 2026 · TL CLASSIFICATION"])
    rows.append([f"Lift = 7 days after each claim vs that member's previous 14 days. NGR Lift = extra revenue after winnings, bonuses & rebates. Amounts in {sym} thousands (K). Pillars per TL's classification (VM/AM + gamification counted as VIP)."])
    rows.append([])
    rows.append(["", "", "", "TOTALS PER PILLAR", "", "", "", "", "", "", "", "", "", "",
                 "PER MEMBER", "", "", "", "", "PER CLAIM", "", ""])
    rows.append(["Pillar", "Members", "Claims", "Spend", "% of Spend", "Deposit in Window", "GGR in Window",
                 "NGR in Window", "Deposit Lift", "GGR Lift", "NGR Lift", "Dep Lift / Spend", "GGR Lift / Spend",
                 "NGR Lift / Spend", "Claims / Mbr", "Spend / Mbr", "Dep Lift / Mbr", "GGR Lift / Mbr",
                 "NGR Lift / Mbr", "Spend / Claim", "Dep Lift / Claim", "NGR Lift / Claim"])
    for p in order:
        rows.append(row_for(agg[p], len(members[p]), p))
    rows.append(row_for(tot, len(all_mem), "All pillars"))
    rows.append([])
    rows.append(["Note", "Classification per TL (Team Lead): VM/AM-run reloads, gamification and check-ins are counted under VIP. (The objective-based framework would place these under Retention — see the TL Reconcile tab for the 630-code difference.)"])

    (SCR / f"perf-tl-{mkt}.json").write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
    print(f"{label}: pillars={order} | spend={kf(total_spend)} | members={len(all_mem)} -> perf-tl-{mkt}.json")
