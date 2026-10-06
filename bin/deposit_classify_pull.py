#!/usr/bin/env python3
"""Design 3 — deposit-trigger classification per code (pre-funded / bonus-led / no deposit response).

For EACH bonus claim (member x code x claim-time), look at the deposit timeline (dedup_Deposit_A,
TIME-level, SITE-filtered, DEP_OK) within window W and assign ONE bucket:
  - prefunded : a deposit landed strictly BEFORE the claim within W  (money already coming in)
                sub-texture: deposit-to-unlock (nearest before <=24h) vs already-active (>24h)
  - bonusled  : NO deposit before, but a deposit landed AFTER the claim within W (offer came first)
                sub-flag: reactivation (member's last deposit ever before claim was >30d ago or never)
  - noresp    : no deposit either side within W  (cost, no deposit movement)

Buckets are per-CLAIM and mutually exclusive, so CLAIM COUNT and BONUS SPEND split cleanly (no overlap).
Deposit RM per bucket is carried as SECONDARY/observed only (a deposit can be 'after' one claim and
'before' another across the 8-month window -> do not sum deposit RM as a clean total; overlap ~1.06x).

Out: scratchpad/deposit-classify-{MK}.json =
  { sym, byWindow: { "7": { code: {prefunded:{claims,spend,dtu_claims,before_amt},
                                   bonusled:{claims,spend,react_claims,after_amt},
                                   noresp:{claims,spend}} }, "30":..., "90":... } }
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


def load(p):
    fp = SCR / p
    return json.load(open(fp, encoding="utf-8")) if fp.exists() else None


def inl(cs):
    return ",".join("'" + x.replace("'", "''") + "'" for x in cs)


c = get_client(send_receive_timeout=900)

for MK, (CUR, LOGSITE, SYM) in MK_CFG.items():
    va = load(f"verify-action-{MK}.json")
    codes = sorted({co["code"].strip() for co in va["codes"]})
    if not codes:
        print(f"[{MK}] skip — no action codes in this window (thin/recent)"); continue  # empty IN (...) is a ClickHouse error
    cw = (f"SITE_edit='{SITE_EDIT}' AND Currency='{CUR}' AND BonusAmount>0 AND BonusStatus IN {STATUSES} "
          f"AND toDate(BonusTime_gmt8) >= '{START}' AND toDate(BonusTime_gmt8) < '{END_EXCL}' "
          f"AND trimBoth(BonusCode) IN ({inl(codes)})")
    out = {"sym": SYM, "byWindow": {}}
    for W in WINDOWS:
        rows = c.query(f"""
          WITH claims AS (
            SELECT trimBoth(BonusCode) code, MEMBER_ID member, BonusTime_gmt8 bt, BonusAmount amt
            FROM WORKSPACE.GetBonus_ABC WHERE {cw}
          ),
          perclaim AS (
            SELECT c.code code, c.amt amt,
              maxIf(d.TIME, d.TIME < c.bt AND d.TIME >= c.bt - INTERVAL {W} DAY) last_before,
              argMaxIf(d.PostProcessAmount, d.TIME, d.TIME < c.bt AND d.TIME >= c.bt - INTERVAL {W} DAY) before_amt,
              minIf(d.TIME, d.TIME > c.bt AND d.TIME <= c.bt + INTERVAL {W} DAY) first_after,
              sumIf(d.PostProcessAmount, d.TIME > c.bt AND d.TIME <= c.bt + INTERVAL {W} DAY) after_amt,
              maxIf(d.TIME, d.TIME < c.bt) last_ever,
              c.bt bt
            FROM claims c
            LEFT JOIN WORKSPACE.dedup_Deposit_A d
              ON d.MEMBER_ID=c.member AND d.SITE='{LOGSITE}' AND {DEP_OK}
            GROUP BY c.code, c.member, c.bt, c.amt
          ),
          cls AS (
            SELECT code, amt,
              multiIf(last_before > {T0}, 'prefunded', first_after > {T0}, 'bonusled', 'noresp') bucket,
              if(last_before > {T0} AND dateDiff('hour', last_before, bt) <= 24, 1, 0) dtu,
              before_amt, after_amt,
              if(first_after > {T0} AND (last_ever <= {T0} OR dateDiff('day', last_ever, bt) > 30), 1, 0) react
            FROM perclaim
          )
          SELECT code, bucket, count() claims, round(sum(amt)) spend,
                 sum(dtu) dtu_claims, sum(react) react_claims,
                 round(sum(before_amt)) before_amt, round(sum(after_amt)) after_amt
          FROM cls GROUP BY code, bucket
        """).result_rows

        byc = {}
        for code, bucket, claims, spend, dtu, react, before_amt, after_amt in rows:
            d = byc.setdefault(code.strip(), {})
            if bucket == "prefunded":
                d["prefunded"] = {"claims": int(claims), "spend": float(spend or 0),
                                  "dtu_claims": int(dtu or 0), "before_amt": float(before_amt or 0)}
            elif bucket == "bonusled":
                d["bonusled"] = {"claims": int(claims), "spend": float(spend or 0),
                                 "react_claims": int(react or 0), "after_amt": float(after_amt or 0)}
            else:
                d["noresp"] = {"claims": int(claims), "spend": float(spend or 0)}
        out["byWindow"][str(W)] = byc

        # window headline
        tot = {"prefunded": [0, 0.0], "bonusled": [0, 0.0], "noresp": [0, 0.0]}
        dtu = react = 0
        for d in byc.values():
            for b in ("prefunded", "bonusled", "noresp"):
                if b in d:
                    tot[b][0] += d[b]["claims"]; tot[b][1] += d[b]["spend"]
            dtu += d.get("prefunded", {}).get("dtu_claims", 0)
            react += d.get("bonusled", {}).get("react_claims", 0)
        tc = sum(v[0] for v in tot.values()); ts = sum(v[1] for v in tot.values())
        print(f"[{MK}] W={W:>2}d  claims={tc:,} spend={SYM}{ts:,.0f}")
        for b in ("prefunded", "bonusled", "noresp"):
            cl, sp = tot[b]
            print(f"        {b:<10} claims {cl:>6,} ({cl/tc*100:4.1f}%)  spend {SYM}{sp:>13,.0f} ({sp/ts*100:4.1f}%)")
        print(f"        └ prefunded deposit-to-unlock (<=24h) claims={dtu:,} ({dtu/tot['prefunded'][0]*100:.0f}% of prefunded)  |  bonus-led reactivation claims={react:,}")

    # timing textures (30d): pre-funded median HOURS deposit->claim; bonus-led median DAYS claim->first after-deposit
    gap_h, bl_days = c.query(f"""
      WITH claims AS (SELECT MEMBER_ID member, BonusTime_gmt8 bt FROM WORKSPACE.GetBonus_ABC WHERE {cw}),
      pc AS (
        SELECT c.member, c.bt,
          maxIf(d.TIME, d.TIME < c.bt AND d.TIME >= c.bt - INTERVAL 30 DAY) lb,
          minIf(d.TIME, d.TIME > c.bt AND d.TIME <= c.bt + INTERVAL 30 DAY) fa
        FROM claims c LEFT JOIN WORKSPACE.dedup_Deposit_A d
          ON d.MEMBER_ID=c.member AND d.SITE='{LOGSITE}' AND {DEP_OK}
        GROUP BY c.member, c.bt
      )
      SELECT round(medianIf(dateDiff('hour', lb, bt), lb > {T0})),
             round(medianIf(dateDiff('day', bt, fa), lb <= {T0} AND fa > {T0}))
      FROM pc
    """).result_rows[0]
    out["timing"] = {"prefunded_gap_h": int(gap_h or 0), "bonusled_days": int(bl_days or 0)}
    print(f"[{MK}] timing: pre-funded {int(gap_h or 0)}h deposit->claim · bonus-led {int(bl_days or 0)}d claim->deposit")

    json.dump(out, open(SCR / f"deposit-classify-{MK}.json", "w", encoding="utf-8"), ensure_ascii=False)
    print(f"[{MK}] wrote deposit-classify-{MK}.json\n")
print("DONE.")
