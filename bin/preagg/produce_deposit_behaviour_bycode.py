#!/usr/bin/env python3
"""Store-backed producer for bin/deposit_behaviour_bycode_pull.py — HYBRID.

Byte-compatible twin of the original stage. Post-processing + output JSON are IDENTICAL; only the
data source moves:

  Section B (give-away reactivation — give-away codes, daily SnapshotDate grain):
      ported to DuckDB over the LOCAL stores
        store_claims.parquet -> the `claims` CTE  (code already trimBoth'd, cd = toString(toDate(
                                 BonusTime_gmt8)), status/BonusAmount/SITE filters baked in at build)
        store_b.parquet      -> the `deps`  CTE   (member active-day; dep>0 + GROUP BY member,sd
                                 reproduces the live Snapshot_A/_BC UNION-ALL sum(DepositAmount))
      This is the "behaviour-B" deps shape: pre-sum DepositAmount per (member,sd), then any_value in
      the amount inner-group. Keyed per CODE here (no group CASE) — the code column IS the key.

  Section A (deposit-required — the nearest qualifying deposit strictly BEFORE each claim):
      KEPT ON THE WAREHOUSE. It needs dedup_Deposit_A exact deposit TIME (sub-day timestamps); no
      store carries those, it would not speed up locally, and the live event table drifts forward
      between runs. A hybrid process (some CTEs DuckDB, some ClickHouse) is fine and still removes
      most of the ~12s, because the give-away Section B is the heavy snapshot scan.

Out: scratchpad/deposit-behaviour-bycode-{MK}.json = { code: {type, ...} }  (unchanged shape)
"""
import sys, json, os
from pathlib import Path

ROOT = Path(r"C:/Users/vdiuser/Downloads/promo-automation")
sys.path.insert(0, str(ROOT))
from csir_config import get_client, SITE_EDIT, START, END_EXCL
import duckdb

SCR = Path(os.environ.get("PROMO_SCRATCH", r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad"))
STORE = os.environ.get("PROMO_PREAGG", r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad/preagg")
CLAIMS = os.path.join(STORE, "store_claims.parquet").replace("\\", "/")
STOREB = os.path.join(STORE, "store_b.parquet").replace("\\", "/")
STATUSES = "('Approved','Redeemed','Complete','Active','Completed','Low Balance 1','Low Balance 2')"
DEP_OK = "(d.TransactionStatus IN ('Success','Approved','Completed') OR d.TransactionStatus='')"
MK_CFG = {"MY": ("MYR", "WS1_MYS_MYR", "RM"), "SG": ("SGD", "WS1_SGP_SGD", "S$")}
W = 30
T0 = "toDateTime('2010-01-01')"


def bt(m):
    m = (m or "").lower()
    if "spin" in m: return "Free spins"
    if "credit" in m or m == "fc": return "Free credit"
    if "reload" in m or "match" in m or "deposit" in m: return "Deposit"
    return (m or "Other").title()


def load(p):
    fp = SCR / p
    return json.load(open(fp, encoding="utf-8")) if fp.exists() else None


def inl(cs): return ",".join("'" + x.replace("'", "''") + "'" for x in cs)


c = get_client(send_receive_timeout=900)

for MK, (CUR, LOGSITE, SYM) in MK_CFG.items():
    va = load(f"verify-action-{MK}.json")
    meta = {x["code"].strip(): x for x in va["codes"]}
    allcodes = sorted(meta)
    if not allcodes:
        print(f"[{MK}] skip — no action codes in this window (thin/recent)"); continue  # empty IN (...) is a ClickHouse error
    cfg = load(f"promo-config-{MK}.json") or {}
    import re as _re
    def dep_req(co):
        cc = cfg.get(co) or cfg.get(co.strip())
        if cc is not None:
            return bool(cc.get("deposit_required"))   # structural config flag — catches deposit-gated free-spins
        if bt(meta[co]["mechanic"]) == "Deposit":
            return True
        return bool(_re.search(r'MD\d|DEP\d|GET\d|PCT|PAYDAY|_REL', co, _re.I))
    dr_codes = [co for co in allcodes if dep_req(co)]
    ga_codes = [co for co in allcodes if not dep_req(co)]
    cw = (f"SITE_edit='{SITE_EDIT}' AND Currency='{CUR}' AND BonusAmount>0 AND BonusStatus IN {STATUSES} "
          f"AND toDate(BonusTime_gmt8) >= '{START}' AND toDate(BonusTime_gmt8) < '{END_EXCL}'")
    out = {}

    # ── Section A — deposit-required: nearest qualifying deposit strictly BEFORE each claim.
    #    Exact-TIME (dedup_Deposit_A); KEPT ON WAREHOUSE — no store carries sub-day deposit TIME.
    if dr_codes:
        for code, claims, claimants, with_qual, qsum in c.query(f"""
          WITH claims AS (SELECT trimBoth(BonusCode) code, MEMBER_ID member, BonusTime_gmt8 bt
                          FROM WORKSPACE.GetBonus_ABC WHERE {cw} AND trimBoth(BonusCode) IN ({inl(dr_codes)})),
          qual AS (SELECT j.code code, j.member member, j.bt bt,
                     maxIf(d.TIME, d.TIME < j.bt AND d.TIME >= j.bt - INTERVAL {W} DAY) qtime,
                     argMaxIf(d.PostProcessAmount, d.TIME, d.TIME < j.bt AND d.TIME >= j.bt - INTERVAL {W} DAY) qdep
                   FROM claims j LEFT JOIN WORKSPACE.dedup_Deposit_A d ON d.MEMBER_ID=j.member AND d.SITE='{LOGSITE}' AND {DEP_OK}
                   GROUP BY code, member, bt),
          agg AS (SELECT code, count() claims, uniqExact(member) claimants, countIf(qtime > {T0}) with_qual FROM qual GROUP BY code),
          qsum AS (SELECT code, round(sum(qdep)) qsum FROM (SELECT code, member, qtime, any(qdep) qdep FROM qual WHERE qtime > {T0} GROUP BY code, member, qtime) GROUP BY code)
          SELECT a.code, a.claims, a.claimants, a.with_qual, ifNull(q.qsum,0) FROM agg a LEFT JOIN qsum q ON a.code=q.code
        """).result_rows:
            out[code.strip()] = {"type": "dep", "claimants": int(claimants), "coverage": round(int(with_qual) / int(claims) * 100) if claims else 0, "qual_sum": float(qsum or 0)}

    # ── Section B — give-away reactivation: recipients came back (deposited) within W days.
    #    Daily SnapshotDate grain; PORTED TO DuckDB over store_claims + store_b (keyed per CODE).
    if ga_codes:
        qB = f"""
          WITH claims AS (SELECT code, member, CAST(cd AS DATE) cd
                          FROM read_parquet('{CLAIMS}')
                          WHERE cur='{CUR}' AND cd>='{START}' AND cd<'{END_EXCL}' AND code IN ({inl(ga_codes)})),
          deps AS (SELECT member, CAST(sd AS DATE) sd, sum(dep) dep
                   FROM read_parquet('{STOREB}')
                   WHERE cur='{CUR}' AND dep>0 AND member IN (SELECT member FROM claims) GROUP BY member, sd),
          cb AS (SELECT cl.code code, cl.member member, min(date_diff('day', cl.cd, d.sd)) gap
                 FROM claims cl JOIN deps d ON cl.member=d.member WHERE d.sd > cl.cd AND d.sd <= cl.cd + INTERVAL {W} DAY GROUP BY cl.code, cl.member),
          amt AS (SELECT code, round(sum(dep)) amount FROM (SELECT cl.code code, cl.member member, d.sd sd, any_value(d.dep) dep
                    FROM claims cl JOIN deps d ON cl.member=d.member WHERE d.sd > cl.cd AND d.sd <= cl.cd + INTERVAL {W} DAY GROUP BY cl.code, cl.member, d.sd) GROUP BY code)
          SELECT r.code, r.recipients, COALESCE(c2.cameback,0), COALESCE(c2.speed,0), COALESCE(a.amount,0)
          FROM (SELECT code, count(DISTINCT member) recipients FROM claims GROUP BY code) r
          LEFT JOIN (SELECT code, count(DISTINCT member) cameback, round(median(gap),1) speed FROM cb GROUP BY code) c2 ON r.code=c2.code
          LEFT JOIN amt a ON r.code=a.code
        """
        for code, recipients, cameback, speed, amount in duckdb.sql(qB).fetchall():
            r = int(recipients)
            out[code.strip()] = {"type": "ga", "recipients": r, "cameback": int(cameback),
                                 "cameback_pct": round(int(cameback) / r * 100, 1) if r else 0, "speed": float(speed or 0), "amount": float(amount or 0)}

    json.dump({"sym": SYM, "byCode": out}, open(SCR / f"deposit-behaviour-bycode-{MK}.json", "w", encoding="utf-8"), ensure_ascii=False)
    dep = sum(1 for v in out.values() if v["type"] == "dep"); ga = sum(1 for v in out.values() if v["type"] == "ga")
    solid = sum(1 for v in out.values() if v["type"] == "ga" and v["recipients"] >= 100)
    print(f"[{MK}] wrote deposit-behaviour-bycode-{MK}.json — {dep} deposit-match + {ga} give-away codes ({solid} give-aways with n>=100)")
print("DONE.")
