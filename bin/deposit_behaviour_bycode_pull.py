#!/usr/bin/env python3
"""Per-CODE deposit behaviour (30d) for the Codes tab — same metrics as the summary, grouped by code.

Deposit-match codes: qualifying/trigger deposit (nearest prior within 30d) sum + claimants (n).
Give-away codes: recipients (n) · came-back = distinct recipients who deposited within 30d · came-back % ·
amount from returners · median days back. n carried so the reader can apply the reliability rule
(>=100 solid · 30-99 small-sample · <30 % suppressed).
Out: scratchpad/deposit-behaviour-bycode-{MK}.json = { code: {type, ...} }
"""
import sys, json
from pathlib import Path

ROOT = Path(r"C:/Users/vdiuser/Downloads/promo-automation")
sys.path.insert(0, str(ROOT))
from csir_config import get_client, SITE_EDIT, START, END_EXCL

SCR = Path(__import__("os").environ.get("PROMO_SCRATCH", r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad"))
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

    if ga_codes:
        for code, recipients, cameback, speed, amount in c.query(f"""
          WITH claims AS (SELECT trimBoth(BonusCode) code, MEMBER_ID member, toDate(BonusTime_gmt8) cd
                          FROM WORKSPACE.GetBonus_ABC WHERE {cw} AND trimBoth(BonusCode) IN ({inl(ga_codes)})),
          deps AS (SELECT MEMBER_ID member, SnapshotDate sd, sum(DepositAmount) dep FROM (
                     SELECT MEMBER_ID, SnapshotDate, DepositAmount FROM WORKSPACE.Daily_GMT8_Snapshot_A  WHERE Currency='{CUR}' AND DepositAmount>0
                     UNION ALL
                     SELECT MEMBER_ID, SnapshotDate, DepositAmount FROM WORKSPACE.Daily_GMT8_Snapshot_BC WHERE Currency='{CUR}' AND DepositAmount>0
                   ) WHERE MEMBER_ID IN (SELECT member FROM claims) GROUP BY MEMBER_ID, SnapshotDate),
          cb AS (SELECT cl.code code, cl.member member, min(dateDiff('day', cl.cd, d.sd)) gap
                 FROM claims cl INNER JOIN deps d ON cl.member=d.member WHERE d.sd > cl.cd AND d.sd <= cl.cd + {W} GROUP BY code, member),
          amt AS (SELECT code, round(sum(dep)) amount FROM (SELECT cl.code code, cl.member member, d.sd sd, any(d.dep) dep
                    FROM claims cl INNER JOIN deps d ON cl.member=d.member WHERE d.sd > cl.cd AND d.sd <= cl.cd + {W} GROUP BY code, member, sd) GROUP BY code)
          SELECT r.code, r.recipients, ifNull(c2.cameback,0), ifNull(c2.speed,0), ifNull(a.amount,0)
          FROM (SELECT code, uniqExact(member) recipients FROM claims GROUP BY code) r
          LEFT JOIN (SELECT code, uniqExact(member) cameback, round(median(gap),1) speed FROM cb GROUP BY code) c2 ON r.code=c2.code
          LEFT JOIN amt a ON r.code=a.code
        """).result_rows:
            r = int(recipients)
            out[code.strip()] = {"type": "ga", "recipients": r, "cameback": int(cameback),
                                 "cameback_pct": round(int(cameback) / r * 100, 1) if r else 0, "speed": float(speed or 0), "amount": float(amount or 0)}

    json.dump({"sym": SYM, "byCode": out}, open(SCR / f"deposit-behaviour-bycode-{MK}.json", "w", encoding="utf-8"), ensure_ascii=False)
    dep = sum(1 for v in out.values() if v["type"] == "dep"); ga = sum(1 for v in out.values() if v["type"] == "ga")
    solid = sum(1 for v in out.values() if v["type"] == "ga" and v["recipients"] >= 100)
    print(f"[{MK}] wrote deposit-behaviour-bycode-{MK}.json — {dep} deposit-match + {ga} give-away codes ({solid} give-aways with n>=100)")
print("DONE.")
