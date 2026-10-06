#!/usr/bin/env python3
"""Multi-horizon "keeps players" for the action-code verification pack.

The report judges "keeps players better than normal" on a single 30-day redeposit window.
This re-pulls the came-back curve at 7 / 30 / 60 / 90 days AND lifetime, for every code (so the
"normal" baseline = the same-bonus-type average is computed over the full population, not just the
action codes), then reports per ACTION code, at each horizon:
  * came-back rate %  = share of matured claimers who deposited again within the window
  * uplift pts        = that rate minus the bonus-type (mechanic) average at the same horizon
plus lifetime: came-back % (ever redeposited so far) and lifetime NGR (avg all-time NGR / player).

"Came back within W" = a deposit on a day strictly after the first claim and before claim+W
(days 1..W-1 — the report's redeposit convention, so the 30-day figure ties to the report).
A horizon is only counted for a claimer whose window is fully matured (claim_date <= data_max-(W-1)).

Writes scratchpad/keeps-horizon-{MK}.json. Run: python bin/keeps_horizon.py  (PROMO_MARKET=SG for SG)
"""
import sys, json
from pathlib import Path
from datetime import date, timedelta

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from csir_config import get_client, CURRENCY, SITE_EDIT, START, END_INCL, AS_OF_DATE, MARKET, SYMBOL

SCR = Path(__import__("os").environ.get("PROMO_SCRATCH", r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad"))
STATUSES = "('Approved','Redeemed','Complete','Active','Completed','Low Balance 1','Low Balance 2')"
WINS = [7, 30, 60, 90]


def load(p):
    fp = SCR / p
    return json.load(open(fp, encoding="utf-8")) if fp.exists() else None


def main(mk):
    # full population per pillar -> (code -> pillar, mechanic); action subset = display rows
    pop = {}
    for pil, fn in (("Acquisition", f"acq/acq-metrics-{mk}.json"),
                    ("Retention", f"ret/ret-metrics-{mk}.json"),
                    ("VIP", f"vip/vip-metrics-{mk}.json")):
        m = load(fn)
        if not m:
            continue
        for c in m["codes"]:
            pop[c["code"].strip()] = {"pillar": pil, "mechanic": (c.get("mechanic") or "other")}
    va = load(f"verify-action-{mk}.json")
    action = {o["code"] for o in va["codes"]}
    codes = sorted(pop)
    inlist = ",".join("'" + c.replace("'", "''") + "'" for c in codes)

    cb_cols = ",\n      ".join(
        f"maxIf(1, d.SnapshotDate > c.claim_date AND d.SnapshotDate < addDays(c.claim_date,{w})) cb{w}"
        for w in WINS)
    SQL = f"""
    WITH
    claims AS (
      SELECT trimBoth(BonusCode) code, MEMBER_ID, SITE, min(toDate(BonusTime_gmt8)) claim_date
      FROM WORKSPACE.GetBonus_ABC
      WHERE SITE_edit='{SITE_EDIT}' AND Currency='{CURRENCY}' AND BonusAmount>0 AND BonusStatus IN {STATUSES}
        AND trimBoth(BonusCode) IN ({inlist})
        AND toDate(BonusTime_gmt8) >= '{START}' AND toDate(BonusTime_gmt8) <= '{END_INCL}'
      GROUP BY code, MEMBER_ID, SITE
    ),
    dep AS (
      SELECT MEMBER_ID, SITE, SnapshotDate FROM WORKSPACE.Daily_GMT8_Snapshot_A  WHERE Currency='{CURRENCY}' AND DepositAmount>0 AND SnapshotDate >= '{START}'
      UNION ALL
      SELECT MEMBER_ID, SITE, SnapshotDate FROM WORKSPACE.Daily_GMT8_Snapshot_BC WHERE Currency='{CURRENCY}' AND DepositAmount>0 AND SnapshotDate >= '{START}'
    ),
    life AS (
      SELECT MEMBER_ID, SITE, sum(NGR) life_ngr FROM (
        SELECT MEMBER_ID,SITE,NGR FROM WORKSPACE.Daily_GMT8_Snapshot_A  WHERE Currency='{CURRENCY}' AND NGR!=0
        UNION ALL SELECT MEMBER_ID,SITE,NGR FROM WORKSPACE.Daily_GMT8_Snapshot_BC WHERE Currency='{CURRENCY}' AND NGR!=0
      ) WHERE MEMBER_ID IN (SELECT MEMBER_ID FROM claims)
      GROUP BY MEMBER_ID, SITE
    )
    SELECT c.code code, c.claim_date claim_date,
      {cb_cols},
      maxIf(1, d.SnapshotDate > c.claim_date) cb_life,
      any(l.life_ngr) life_ngr
    FROM claims c
    LEFT JOIN dep  d ON d.MEMBER_ID=c.MEMBER_ID AND d.SITE=c.SITE
    LEFT JOIN life l ON l.MEMBER_ID=c.MEMBER_ID AND l.SITE=c.SITE
    GROUP BY c.code, c.MEMBER_ID, c.claim_date
    """
    cl = get_client(send_receive_timeout=600)
    SET = {"readonly": 1, "max_execution_time": 590, "max_memory_usage": 80000000000,
           "max_result_rows": 8000000, "result_overflow_mode": "break", "join_algorithm": "hash"}
    print(f"[{mk}] keeps-horizon over {len(codes)} codes (pop for norms), {len(action)} action codes...")
    rows = cl.query(SQL, settings=SET).result_rows
    cols = ["code", "claim_date"] + [f"cb{w}" for w in WINS] + ["cb_life", "life_ngr"]

    dmax = AS_OF_DATE
    # accumulate per code and per (pillar,mechanic) pool
    from collections import defaultdict
    def blank():
        d = {f"cb{w}": [0, 0] for w in WINS}          # [came_back, matured]
        d["life"] = [0, 0]; d["ngr"] = [0.0, 0]       # [ever_back, members] ; [sum_ngr, members]
        return d
    per_code = defaultdict(blank)
    pool = defaultdict(blank)                          # key (pillar, mechanic)
    for r in rows:
        d = dict(zip(cols, r))
        code = d["code"].strip()
        meta = pop.get(code)
        if not meta:
            continue
        cd = d["claim_date"]
        cd = cd if isinstance(cd, date) else date.fromisoformat(str(cd))
        key = (meta["pillar"], meta["mechanic"])
        for w in WINS:
            if cd <= dmax - timedelta(days=w - 1):    # window fully observed
                cb = 1 if d[f"cb{w}"] else 0
                per_code[code][f"cb{w}"][0] += cb; per_code[code][f"cb{w}"][1] += 1
                pool[key][f"cb{w}"][0] += cb;        pool[key][f"cb{w}"][1] += 1
        life = 1 if d["cb_life"] else 0
        per_code[code]["life"][0] += life; per_code[code]["life"][1] += 1
        pool[key]["life"][0] += life;      pool[key]["life"][1] += 1
        ln = float(d["life_ngr"] or 0.0)
        per_code[code]["ngr"][0] += ln; per_code[code]["ngr"][1] += 1
        pool[key]["ngr"][0] += ln;      pool[key]["ngr"][1] += 1

    def rate(pair):
        return round(pair[0] / pair[1] * 100, 1) if pair[1] else None
    def avg(pair):
        return round(pair[0] / pair[1]) if pair[1] else None

    out = {}
    for code in sorted(action):
        pc = per_code.get(code)
        meta = pop.get(code, {"pillar": "?", "mechanic": "other"})
        key = (meta["pillar"], meta["mechanic"])
        pl = pool.get(key)
        rec = {"pillar": meta["pillar"], "mechanic": meta["mechanic"], "windows": {}}
        for w in WINS:
            cr = rate(pc[f"cb{w}"]) if pc else None
            nr = rate(pl[f"cb{w}"]) if pl else None
            rec["windows"][str(w)] = {"rate": cr, "n": (pc[f"cb{w}"][1] if pc else 0),
                                      "norm": nr, "uplift": (round(cr - nr, 1) if (cr is not None and nr is not None) else None)}
        clr = rate(pc["life"]) if pc else None
        nlr = rate(pl["life"]) if pl else None
        rec["life"] = {"rate": clr, "n": (pc["life"][1] if pc else 0), "norm": nlr,
                       "uplift": (round(clr - nlr, 1) if (clr is not None and nlr is not None) else None)}
        cv = avg(pc["ngr"]) if pc else None
        nv = avg(pl["ngr"]) if pl else None
        rec["value"] = {"per_player": cv, "norm": nv,
                        "uplift": (cv - nv if (cv is not None and nv is not None) else None)}
        out[code] = rec

    res = {"market": mk, "sym": SYMBOL, "as_of": dmax.isoformat(), "windows": WINS, "codes": out}
    json.dump(res, open(SCR / f"keeps-horizon-{mk}.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    # quick console read (guard thin/recent windows that produced no codes)
    print(f"  wrote keeps-horizon-{mk}.json ({len(out)} action codes)")
    if out:
        ex = next(iter(out)); e = out[ex]
        print(f"  e.g. {ex[:30]} [{e['pillar']}/{e['mechanic']}]:")
        for w in WINS:
            wd = e["windows"][str(w)]
            print(f"     {w}d: rate {wd['rate']}% (n{wd['n']}) vs norm {wd['norm']}% -> {wd['uplift']:+} pts" if wd['uplift'] is not None else f"     {w}d: n/a")
        print(f"     life: {e['life']['rate']}% vs {e['life']['norm']}%  | value {SYMBOL}{e['value']['per_player']}/player vs {SYMBOL}{e['value']['norm']}")
    return res


if __name__ == "__main__":
    main(MARKET)
