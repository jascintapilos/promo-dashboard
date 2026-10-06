#!/usr/bin/env python3
"""Deposit-behaviour by purpose (design D4) — per pillar×type, both markets, windows 7/30/90.

SECTION A · deposit-required (match/reload) — "the deposit that earned the bonus":
  qualifying deposit = the nearest deposit strictly BEFORE each claim within W days (the trigger, from
  dedup_Deposit_A exact TIME); within-group distinct sum + coverage. bonus ≈ match% × qualifying deposit.
SECTION B · no-deposit give-aways (free-credit/free-spins) — "did players come back & deposit?":
  recipients (distinct claimers) · came-back = distinct recipients who deposited within W days AFTER a claim
  (snapshot) · came-back % · amount from returners (within-group distinct) · speed = median days to first return.

Out: scratchpad/deposit-behaviour-{MK}.json
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
WINDOWS = (7, 30, 90)
T0 = "toDateTime('2010-01-01')"


def bt(m):
    m = (m or "").lower()
    if "spin" in m: return "Free spins"
    if "credit" in m or m == "fc": return "Free credit"
    if "cash" in m: return "Cashback"
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
    grp_of = {co: f"{meta[co]['pillar']}||{bt(meta[co]['mechanic'])}" for co in allcodes}
    cfg = load(f"promo-config-{MK}.json") or {}
    import re as _re
    def dep_req(co):
        cc = cfg.get(co) or cfg.get(co.strip())
        if cc is not None:
            return bool(cc.get("deposit_required"))   # structural config flag (min_dep>0 / bonus_pct>0 / action) — catches deposit-gated free-spins
        if bt(meta[co]["mechanic"]) == "Deposit":
            return True
        return bool(_re.search(r'MD\d|DEP\d|GET\d|PCT|PAYDAY|_REL', co, _re.I))   # unmatched fallback: min-deposit name hints
    dr_codes = [co for co in allcodes if dep_req(co)]
    ga_codes = [co for co in allcodes if not dep_req(co)]
    # group tag (pillar||type) for any code
    groups = {}
    for co in allcodes:
        groups.setdefault(grp_of[co], []).append(co)
    grp_case = "multiIf(" + ", ".join(f"trimBoth(BonusCode) IN ({inl(cs)}), '{lbl}'" for lbl, cs in groups.items()) + ", 'other')"
    claim_where = (f"SITE_edit='{SITE_EDIT}' AND Currency='{CUR}' AND BonusAmount>0 AND BonusStatus IN {STATUSES} "
                   f"AND toDate(BonusTime_gmt8) >= '{START}' AND toDate(BonusTime_gmt8) < '{END_EXCL}'")

    out = {"sym": SYM, "windows": {}}
    for W in WINDOWS:
        # ---- Section A: qualifying (trigger) deposit before, per deposit-required group ----
        A = {}
        if dr_codes:
            rowsA = c.query(f"""
              WITH claims AS (
                SELECT MEMBER_ID member, BonusTime_gmt8 bt, {grp_case} grp
                FROM WORKSPACE.GetBonus_ABC WHERE {claim_where} AND trimBoth(BonusCode) IN ({inl(dr_codes)})
              ),
              qual AS (
                SELECT j.grp grp, j.member member, j.bt bt,
                  maxIf(d.TIME, d.TIME < j.bt AND d.TIME >= j.bt - INTERVAL {W} DAY) AS qtime,
                  argMaxIf(d.PostProcessAmount, d.TIME, d.TIME < j.bt AND d.TIME >= j.bt - INTERVAL {W} DAY) AS qdep
                FROM claims j
                LEFT JOIN WORKSPACE.dedup_Deposit_A d ON d.MEMBER_ID=j.member AND d.SITE='{LOGSITE}' AND {DEP_OK}
                GROUP BY grp, member, bt
              ),
              agg AS (SELECT grp, count() claims, uniqExact(member) claimants, countIf(qtime > {T0}) with_qual FROM qual GROUP BY grp),
              qsum AS (SELECT grp, round(sum(qdep)) qsum FROM (SELECT grp, member, qtime, any(qdep) qdep FROM qual WHERE qtime > {T0} GROUP BY grp, member, qtime) GROUP BY grp)
              SELECT a.grp, a.claims, a.claimants, a.with_qual, ifNull(q.qsum,0) qsum
              FROM agg a LEFT JOIN qsum q ON a.grp=q.grp
            """).result_rows
            for grp, claims, claimants, with_qual, qsum in rowsA:
                A[grp] = {"claims": int(claims), "claimants": int(claimants), "with_qual": int(with_qual),
                          "coverage": round(int(with_qual) / int(claims) * 100) if claims else 0, "qual_sum": float(qsum or 0)}

        # ---- Section B: reactivation (came-back) per give-away group ----
        B = {}
        if ga_codes:
            rowsB = c.query(f"""
              WITH claims AS (
                SELECT MEMBER_ID member, toDate(BonusTime_gmt8) cd, {grp_case} grp
                FROM WORKSPACE.GetBonus_ABC WHERE {claim_where} AND trimBoth(BonusCode) IN ({inl(ga_codes)})
              ),
              deps AS (
                SELECT MEMBER_ID member, SnapshotDate sd, sum(DepositAmount) dep FROM (
                  SELECT MEMBER_ID, SnapshotDate, DepositAmount FROM WORKSPACE.Daily_GMT8_Snapshot_A  WHERE Currency='{CUR}' AND DepositAmount>0
                  UNION ALL
                  SELECT MEMBER_ID, SnapshotDate, DepositAmount FROM WORKSPACE.Daily_GMT8_Snapshot_BC WHERE Currency='{CUR}' AND DepositAmount>0
                ) WHERE MEMBER_ID IN (SELECT member FROM claims) GROUP BY MEMBER_ID, SnapshotDate
              ),
              cb AS (
                SELECT cl.grp grp, cl.member member, min(dateDiff('day', cl.cd, d.sd)) gap
                FROM claims cl INNER JOIN deps d ON cl.member=d.member
                WHERE d.sd > cl.cd AND d.sd <= cl.cd + {W} GROUP BY grp, member
              ),
              amt AS (
                SELECT grp, round(sum(dep)) amount FROM (
                  SELECT cl.grp grp, cl.member member, d.sd sd, any(d.dep) dep
                  FROM claims cl INNER JOIN deps d ON cl.member=d.member
                  WHERE d.sd > cl.cd AND d.sd <= cl.cd + {W} GROUP BY grp, member, sd
                ) GROUP BY grp
              )
              SELECT r.grp, r.recipients, ifNull(c2.cameback,0) cameback, ifNull(c2.speed,0) speed, ifNull(a.amount,0) amount
              FROM (SELECT grp, uniqExact(member) recipients FROM claims GROUP BY grp) r
              LEFT JOIN (SELECT grp, uniqExact(member) cameback, round(median(gap),1) speed FROM cb GROUP BY grp) c2 ON r.grp=c2.grp
              LEFT JOIN amt a ON r.grp=a.grp
            """).result_rows
            for grp, recipients, cameback, speed, amount in rowsB:
                r = int(recipients)
                B[grp] = {"recipients": r, "cameback": int(cameback), "cameback_pct": round(int(cameback) / r * 100, 1) if r else 0,
                          "speed": float(speed or 0), "amount": float(amount or 0)}

        out["windows"][str(W)] = {"A": A, "B": B}
        # console readout
        print(f"\n[{MK}] W={W}d")
        print("  A · deposit-required (qualifying deposit before):")
        for grp, v in sorted(A.items()):
            print(f"     {grp:24} claims {v['claims']:>6,} · qualifying {SYM}{v['qual_sum']:>14,.0f} · {v['coverage']}% have one")
        print("  B · give-aways (came back & deposited):")
        for grp, v in sorted(B.items()):
            print(f"     {grp:24} recipients {v['recipients']:>6,} · came back {v['cameback']:>6,} ({v['cameback_pct']}%) · {SYM}{v['amount']:>13,.0f} · median {v['speed']:.0f}d")

    json.dump(out, open(SCR / f"deposit-behaviour-{MK}.json", "w", encoding="utf-8"), ensure_ascii=False)
    print(f"[{MK}] wrote deposit-behaviour-{MK}.json")
print("\nDONE.")
