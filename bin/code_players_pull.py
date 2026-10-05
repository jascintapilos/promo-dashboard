#!/usr/bin/env python3
"""code_players_pull.py — per-code "Players" drill-down source data (gated feature).

READ-ONLY / SELECT-only. Never writes the warehouse. Member-id only — NO usernames
(username resolves from ENIGMA.SignUp_A.Login at serve time, behind the sign-in gate).

For EVERY in-scope code (scratchpad/verify-action-{MK}.json .codes[].code) produce ONE
aggregated row PER PLAYER who claimed it, keyed by member_id:
  {member_id, claims, bonus, dep_to_unlock, dep_after, ngr, tier, is_vip,
   source('deposit_match'|'fasttrack'|'operator'|'self'), source_breakdown:{channel:claims},
   dm_detail:{system|user|legacy:events}(optional), tenure_days, flags:[...]}

Proven joins (reused from deposit_classify_pull.py + hunter_dig.py):
  - Claims/bonus         : WORKSPACE.GetBonus_ABC (SITE_edit=WS1, Currency, in-scope code,
                           approved statuses, window; MEMBER_ID, BonusAmount, BonusTime_gmt8).
  - Deposit to-unlock/after (Tab-2 timing, deposit_classify_pull.py): WORKSPACE.dedup_Deposit_A,
                           TIME-level, SITE-filtered, DEP_OK; W=30d (report default). Per member x code:
                           dep_to_unlock = sum of DISTINCT deposits, each the nearest deposit strictly
                           BEFORE a claim of this code within W (Tab 2's before_amt). A deposit that is
                           the nearest-before for several claims counts ONCE (dedup by deposit TIME).
                           dep_after = sum of DISTINCT deposits landing strictly AFTER a claim within W
                           (Tab 2's after_amt), deduped by deposit TIME. Distinct-dedup removes the
                           per-claim double-count that inflated heavy claimers (Tab 2 aggregate hit ~847m).
  - NGR (window)         : Daily_GMT8_Snapshot_A/_BC member-day NGR summed over window (per member).
  - Lifetime NGR         : same snapshots, all-time (for the uncovered flag).
  - Tier + is_vip        : Members_Overview_ABC.Membership + is_vip_tier.
  - Source (authoritative): RedemptionType from WORKSPACE.260722_ws1_myr_PromotionReward (bridged via
                           ..._Promotion: PromotionCode -> PromotionId -> RewardId). 0=Deposit -> 'deposit_match';
                           1=Claim(assigned) -> assignment actor via GetBonus_ABC.ID = PAR.PlayerAssignedRewardId
                           (event id == assignment id for the assignment flow; full coverage). Actor vocabulary
                           {System,Player,User}: System->'fasttrack' (CRM push), User->'operator' (BO/VM hand-
                           issued), Player->'self'. BonusType {DepositBonus/FreeCredit/FreeSpinBonus} corroborates
                           and is the fallback for codes absent from config. deposit_match sub-actor
                           (system/user/legacy) recovered from dedup_GetDepositBonus_A. In-scope self-claim = 0.
                           row.source = DOMINANT channel by claim count; row.source_breakdown = {channel: claims}.
                           NB v2 used the GetBonus_ABC.ID = PAR join for ALL bonus types; that FK is only valid
                           for the assignment flow, so every DepositBonus fell out and was mislabeled 'self'.
  - Tenure               : Members_Overview_ABC.RegisterDate_gmt8 -> (END - reg).days.
  - flags: uncovered (free-credit recipients whose all-time lifetime NGR < the free credit
           given on THIS code this window, PAST the tenure guard tenure>90d & first-seen<window-start);
           reactivation (dormant >=30d before claim then deposited after).

Out: scratchpad/code-players-{MK}.json = {"_meta":{...}, "<code>":[{row},...], ...}

HONESTY: OBSERVED. deposits & bonus never silently netted. 'given' != abuse (a VIP perk is a
deliberate cost). Member ids are pseudonymous; no usernames are pulled or stored here.
"""
import sys, json, math
from pathlib import Path
from datetime import date, datetime

ROOT = Path(r"C:/Users/vdiuser/Downloads/promo-automation")
sys.path.insert(0, str(ROOT))
from csir_config import get_client, SITE_EDIT, START, END_EXCL

SCR = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad")
STATUSES = "('Approved','Redeemed','Complete','Active','Completed','Low Balance 1','Low Balance 2')"
DEP_OK = "(d.TransactionStatus IN ('Success','Approved','Completed') OR d.TransactionStatus='')"
# Authoritative promo config: RedemptionType 0=Deposit(match/reload), 1=Claim(assigned reward).
# The 260722_ws1_myr_* snapshot holds WS1 promotion definitions for BOTH markets (MY + SG codes resolve here).
CFG_PROMO = "WORKSPACE.260722_ws1_myr_Promotion"
CFG_REWARD = "WORKSPACE.260722_ws1_myr_PromotionReward"
# Reward-assignment actor lookup (warehouse actor vocabulary is exactly {System,Player,User}).
PARG = ("(SELECT PlayerAssignedRewardId, argMin(CreatedByActorType, TIME) act "
        "FROM WORKSPACE.dedup_PlayerAssignedReward_A GROUP BY PlayerAssignedRewardId)")
MK_CFG = {"MY": ("MYR", "WS1_MYS_MYR", "RM"), "SG": ("SGD", "WS1_SGP_SGD", "S$")}
DEP_W = 30          # deposit before/after window (days), per claim — matches deposit_classify texture default
NEW_TENURE_DAYS = 90
T0 = "toDateTime('2010-01-01')"

END_D = date.fromisoformat(END_EXCL)      # exclusive (2026-08-26)
START_D = date.fromisoformat(START)       # 2026-01-01


def inl(cs):
    return ",".join("'" + x.replace("'", "''") + "'" for x in cs)


def load(p):
    fp = SCR / p
    return json.load(open(fp, encoding="utf-8")) if fp.exists() else None


def norm_mech(m):
    return "".join(ch for ch in (m or "").lower() if ch.isalnum())


def as_date(v):
    if v is None:
        return None
    return v.date() if hasattr(v, "date") else v


def main():
    c = get_client(send_receive_timeout=900)
    summary = {}
    for MK, (CUR, LOGSITE, SYM) in MK_CFG.items():
        try:
            va = load(f"verify-action-{MK}.json")
            meta = {co["code"].strip(): co for co in va["codes"]}
            codes = sorted(meta)
            INL = inl(codes)
            # free-credit codes: mechanic normalises to 'freecredit' (covers 'FreeCredit' + 'free-credit')
            fc_codes = {k for k in codes if norm_mech(meta[k].get("mechanic")) == "freecredit"}
            cw = (f"SITE_edit='{SITE_EDIT}' AND Currency='{CUR}' AND BonusAmount>0 AND BonusStatus IN {STATUSES} "
                  f"AND toDate(BonusTime_gmt8) >= '{START}' AND toDate(BonusTime_gmt8) < '{END_EXCL}' "
                  f"AND trimBoth(BonusCode) IN ({INL})")
            claimers_sub = f"(SELECT MEMBER_ID FROM WORKSPACE.GetBonus_ABC WHERE {cw})"

            # ---- 1) claims + bonus per (code, member) ------------------------------------
            claims = {}   # (code, mid) -> {claims, bonus}
            for code, mid, ncl, bonus in c.query(f"""
              SELECT trimBoth(BonusCode) code, MEMBER_ID mid, count() ncl, sum(BonusAmount) bonus
              FROM WORKSPACE.GetBonus_ABC WHERE {cw}
              GROUP BY code, mid
            """).result_rows:
                claims[(code.strip(), mid)] = {"claims": int(ncl), "bonus": float(bonus or 0)}

            members = sorted({mid for (_, mid) in claims})

            # ---- 2) AUTHORITATIVE source per (code, member): deposit_match/fasttrack/operator/self
            # RedemptionType (260722_ws1_myr_PromotionReward, bridged via ..._Promotion) is the AUTHORITATIVE
            # channel signal — 0=Deposit(match/reload), 1=Claim(assigned reward). BonusType corroborates and is
            # the fallback for codes absent from config. v2 derived source from GetBonus_ABC.ID = PAR.parid,
            # but GetBonus_ABC.ID is the getbonus EVENT id, not the reward FK: every DepositBonus fell out
            # 'unmatched' and was mislabeled 'self' (~51% of MY claims). Those are deposit-match volume;
            # in-scope Player self-claim = ZERO.
            #   code RedemptionType=0 (or BonusType=DepositBonus)      -> channel 'deposit_match'
            #   code RedemptionType=1 (assigned; FreeCredit/FreeSpin)  -> assignment actor via the correct FK.
            #        For the assignment flow the getbonus event id == PlayerAssignedRewardId, so GetBonus_ABC.ID
            #        joins PAR directly with FULL coverage (GetBonus_A_all is _A-partition-only and drops rows);
            #        System -> 'fasttrack' (CRM push) ; User -> 'operator' (BO/VM hand-issued) ; Player -> 'self'.
            #   deposit_match sub-actor (system/user/legacy) recovered separately from dedup_GetDepositBonus_A.

            # 2a) RedemptionType per code (authoritative); config holds WS1 codes for both markets.
            rt = {}   # code -> 0 | 1 | None(unresolved -> fall back to BonusType)
            for code, rts in c.query(f"""
              SELECT trimBoth(p.PromotionCode) code, groupUniqArray(pr.RedemptionType) rts
              FROM {CFG_PROMO} p INNER JOIN {CFG_REWARD} pr ON p.PromotionId = pr.PromotionId
              WHERE trimBoth(p.PromotionCode) IN ({INL}) GROUP BY code
            """).result_rows:
                vs = list(rts)
                rt[code.strip()] = 0 if 0 in vs else (1 if vs == [1] else None)
            n_rt_resolved = sum(1 for co in codes if rt.get(co) is not None)
            rt_unresolved = [co for co in codes if rt.get(co) is None]

            # 2b) claim-count per (code, member, bonustype, assignment-actor) via the correct direct FK
            CH_PRIORITY = {"deposit_match": 0, "fasttrack": 1, "operator": 2, "self": 3}
            ACTOR_CH = {"System": "fasttrack", "User": "operator", "Player": "self"}
            src = {}  # (code, mid) -> {channel: claim_count}
            src_totals = {"deposit_match": 0, "fasttrack": 0, "operator": 0, "self": 0}
            for code, mid, bt, actor, ncl in c.query(f"""
              SELECT trimBoth(g.BonusCode) code, g.MEMBER_ID mid, g.BonusType bt,
                     coalesce(nullIf(par.act,''),'') actor, count() ncl
              FROM WORKSPACE.GetBonus_ABC g
              LEFT JOIN {PARG} par ON g.ID = par.PlayerAssignedRewardId
              WHERE {cw}
              GROUP BY code, mid, bt, actor
            """).result_rows:
                code = code.strip()
                ncl = int(ncl or 0)
                rtc = rt.get(code)
                if rtc == 0 or (rtc is None and bt == "DepositBonus"):
                    ch = "deposit_match"
                else:  # assigned reward (RedemptionType=1, or unresolved FreeCredit/FreeSpinBonus)
                    ch = ACTOR_CH.get(actor)
                    if ch is None:  # assigned reward with no resolvable actor (does not occur in-scope):
                        ch = "fasttrack" if code.upper().startswith("FT") else "operator"  # never default to 'self'
                d = src.setdefault((code, mid), {})
                d[ch] = d.get(ch, 0) + ncl
                src_totals[ch] += ncl

            # 2c) deposit_match sub-actor split (system/user/legacy) from dedup_GetDepositBonus_A (event grain,
            #     a best-effort attribution overlay: NOT reconciled 1:1 to the deposit_match claim count above).
            dm_detail = {}  # (code, mid) -> {system,user,legacy: event_count}
            dm_totals = {"system": 0, "user": 0, "legacy": 0}
            for code, mid, sub, n in c.query(f"""
              WITH db AS (
                SELECT ID, any(PlayerAssignedRewardId) parid, any(MEMBER_ID) mem,
                       any(trimBoth(PromotionCode)) code
                FROM WORKSPACE.dedup_GetDepositBonus_A
                WHERE SITE='{LOGSITE}' AND trimBoth(PromotionCode) IN ({INL})
                  AND toDate(BonusTime) >= '{START}' AND toDate(BonusTime) < '{END_EXCL}'
                  AND DepositBonusStatus IN {STATUSES}
                GROUP BY ID
              )
              SELECT db.code code, db.mem mid,
                     multiIf(db.parid='','legacy', par.act='User','user', par.act='System','system','legacy') sub,
                     count() n
              FROM db LEFT JOIN {PARG} par ON db.parid = par.PlayerAssignedRewardId
              GROUP BY code, mid, sub
            """).result_rows:
                code = code.strip()
                n = int(n or 0)
                d = dm_detail.setdefault((code, mid), {})
                d[sub] = d.get(sub, 0) + n
                dm_totals[sub] += n

            def source_of(code, mid):
                d = src.get((code, mid))
                if not d:
                    return "deposit_match", {}
                # dominant channel = most claims; tie-break deposit_match>fasttrack>operator>self
                dom = min(d.items(), key=lambda kv: (-kv[1], CH_PRIORITY[kv[0]]))[0]
                bd = dict(sorted(d.items(), key=lambda kv: (-kv[1], CH_PRIORITY[kv[0]])))
                return dom, bd

            # ---- 3) dep_to_unlock / dep_after per (code, member) + reactivation ----------
            # Tab-2 timing (deposit_classify_pull.py), W=30d, distinct-dedup by deposit TIME:
            #   dep_to_unlock = sum of DISTINCT nearest-before deposits (one per claim, deduped so a
            #                   deposit that unlocks several claims counts once).
            #   dep_after     = sum of DISTINCT deposits landing after ANY claim within W (deduped).
            #   react (first claim): first deposit within W after first claim AND dormant >=30d/never before.
            dep = {}  # (code, mid) -> {dep_to_unlock, dep_after, react}
            for code, mid, dep_to_unlock, dep_after, react in c.query(f"""
              WITH claims AS (
                SELECT trimBoth(BonusCode) code, MEMBER_ID member, BonusTime_gmt8 bt
                FROM WORKSPACE.GetBonus_ABC WHERE {cw}
              ),
              perclaim AS (
                SELECT c.code code, c.member member, c.bt bt,
                  argMaxIf(d.TIME, d.TIME, d.TIME < c.bt AND d.TIME >= c.bt - INTERVAL {DEP_W} DAY) unlock_time,
                  argMaxIf(d.PostProcessAmount, d.TIME, d.TIME < c.bt AND d.TIME >= c.bt - INTERVAL {DEP_W} DAY) unlock_amt
                FROM claims c
                LEFT JOIN WORKSPACE.dedup_Deposit_A d
                  ON d.MEMBER_ID=c.member AND d.SITE='{LOGSITE}' AND {DEP_OK}
                GROUP BY c.code, c.member, c.bt
              ),
              unlock AS (
                SELECT code, member, sum(amt) dep_to_unlock FROM (
                  SELECT code, member, unlock_time, any(unlock_amt) amt
                  FROM perclaim WHERE unlock_time > {T0}
                  GROUP BY code, member, unlock_time
                ) GROUP BY code, member
              ),
              afterdep AS (
                SELECT code, member, sumIf(amt, q=1) dep_after FROM (
                  SELECT c.code code, c.member member, d.TIME dt, any(d.PostProcessAmount) amt,
                    max(if(d.TIME > c.bt AND d.TIME <= c.bt + INTERVAL {DEP_W} DAY, 1, 0)) q
                  FROM claims c
                  LEFT JOIN WORKSPACE.dedup_Deposit_A d
                    ON d.MEMBER_ID=c.member AND d.SITE='{LOGSITE}' AND {DEP_OK}
                  WHERE d.TIME > {T0}
                  GROUP BY c.code, c.member, d.TIME
                ) GROUP BY code, member
              ),
              span AS (SELECT code, member, min(bt) first_bt FROM claims GROUP BY code, member),
              spandep AS (
                SELECT s.code code, s.member member,
                  if(minIf(d.TIME, d.TIME > s.first_bt AND d.TIME <= s.first_bt + INTERVAL {DEP_W} DAY) > {T0}
                     AND (maxIf(d.TIME, d.TIME < s.first_bt) <= {T0}
                          OR dateDiff('day', maxIf(d.TIME, d.TIME < s.first_bt), s.first_bt) > 30), 1, 0) react
                FROM span s
                LEFT JOIN WORKSPACE.dedup_Deposit_A d
                  ON d.MEMBER_ID=s.member AND d.SITE='{LOGSITE}' AND {DEP_OK}
                GROUP BY s.code, s.member, s.first_bt
              )
              SELECT sp.code code, sp.member member,
                     round(u.dep_to_unlock) dep_to_unlock, round(a.dep_after) dep_after, sp.react react
              FROM spandep sp
              LEFT JOIN unlock u ON u.code = sp.code AND u.member = sp.member
              LEFT JOIN afterdep a ON a.code = sp.code AND a.member = sp.member
            """).result_rows:
                dep[(code.strip(), mid)] = {"dep_to_unlock": float(dep_to_unlock or 0),
                                            "dep_after": float(dep_after or 0),
                                            "react": int(react or 0)}

            # ---- 4) per-member enrichment: window NGR, lifetime NGR, tier/is_vip, reg ----
            win_ngr = {}
            for mid, ngr in c.query(f"""
              SELECT MEMBER_ID, sum(NGR) ngr FROM (
                SELECT MEMBER_ID, NGR FROM WORKSPACE.Daily_GMT8_Snapshot_A
                  WHERE Currency='{CUR}' AND SnapshotDate>='{START}' AND SnapshotDate<'{END_EXCL}'
                UNION ALL
                SELECT MEMBER_ID, NGR FROM WORKSPACE.Daily_GMT8_Snapshot_BC
                  WHERE Currency='{CUR}' AND SnapshotDate>='{START}' AND SnapshotDate<'{END_EXCL}'
              ) WHERE MEMBER_ID IN {claimers_sub} GROUP BY MEMBER_ID
            """).result_rows:
                win_ngr[mid] = float(ngr or 0)

            life_ngr = {}
            for mid, lngr in c.query(f"""
              SELECT MEMBER_ID, sum(NGR) lngr FROM (
                SELECT MEMBER_ID, NGR FROM WORKSPACE.Daily_GMT8_Snapshot_A WHERE Currency='{CUR}'
                UNION ALL
                SELECT MEMBER_ID, NGR FROM WORKSPACE.Daily_GMT8_Snapshot_BC WHERE Currency='{CUR}'
              ) WHERE MEMBER_ID IN {claimers_sub} GROUP BY MEMBER_ID
            """).result_rows:
                life_ngr[mid] = float(lngr or 0)

            tier = {}  # mid -> (membership, is_vip, reg_date)
            for mid, mship, isvip, reg in c.query(f"""
              SELECT MEMBER_ID, any(Membership) mship, max(is_vip_tier) isvip, min(RegisterDate_gmt8) reg
              FROM WORKSPACE.Members_Overview_ABC
              WHERE SITE='{LOGSITE}' AND MEMBER_ID IN {claimers_sub}
              GROUP BY MEMBER_ID
            """).result_rows:
                tier[mid] = (mship, int(isvip or 0), as_date(reg))

            # ---- assemble rows -----------------------------------------------------------
            out = {}
            n_rows = 0
            recon = {}  # code -> summed bonus
            src_row_dom = {"deposit_match": 0, "fasttrack": 0, "operator": 0, "self": 0}  # dominant-channel row counts
            max_unlock = {"v": 0.0, "code": None, "mid": None}
            max_after = {"v": 0.0, "code": None, "mid": None}
            for (code, mid), cb in claims.items():
                mship, is_vip, reg = tier.get(mid, (None, 0, None))
                tenure_days = (END_D - reg).days if reg else None
                lngr = life_ngr.get(mid, 0.0)
                dpv = dep.get((code, mid), {"dep_to_unlock": 0.0, "dep_after": 0.0, "react": 0})
                bonus = cb["bonus"]
                flags = []
                # reactivation
                if dpv["react"] == 1:
                    flags.append("reactivation")
                # uncovered (free-credit recipients only, past tenure guard)
                if code in fc_codes and reg is not None:
                    tenure_ok = (tenure_days is not None and tenure_days > NEW_TENURE_DAYS) and (reg < START_D)
                    if tenure_ok and lngr < bonus:
                        flags.append("uncovered")
                src_label, src_bd = source_of(code, mid)
                src_row_dom[src_label] += 1
                dtu = round(dpv["dep_to_unlock"], 2)
                daf = round(dpv["dep_after"], 2)
                if dtu > max_unlock["v"]:
                    max_unlock.update(v=dtu, code=code, mid=mid)
                if daf > max_after["v"]:
                    max_after.update(v=daf, code=code, mid=mid)
                row = {
                    "member_id": mid,
                    "claims": cb["claims"],
                    "bonus": round(bonus, 2),
                    "dep_to_unlock": dtu,
                    "dep_after": daf,
                    "ngr": round(win_ngr.get(mid, 0.0), 2),
                    "tier": mship,
                    "is_vip": is_vip,
                    "source": src_label,
                    "source_breakdown": src_bd,
                    "tenure_days": tenure_days,
                    "flags": flags,
                }
                dmd = dm_detail.get((code, mid))
                if dmd:
                    row["dm_detail"] = dict(sorted(dmd.items(), key=lambda kv: -kv[1]))
                out.setdefault(code, []).append(row)
                recon[code] = recon.get(code, 0.0) + bonus
                n_rows += 1

            # sort each code's players by bonus desc for a sensible default drawer order
            for code in out:
                out[code].sort(key=lambda r: -r["bonus"])

            # ---- reconcile per-code summed bonus to report r_spend -----------------------
            matched = 0
            mism = []
            n_with_rspend = 0
            for code in codes:
                rsp = meta[code].get("r_spend")
                got = round(recon.get(code, 0.0))
                if rsp is None:
                    continue
                n_with_rspend += 1
                tol = max(2.0, 0.005 * abs(rsp))
                if abs(got - rsp) <= tol:
                    matched += 1
                else:
                    mism.append({"code": code, "summed_bonus": got, "r_spend": rsp, "diff": got - rsp})
            match_rate = round(100.0 * matched / n_with_rspend, 2) if n_with_rspend else None

            meta_block = {
                "market": MK, "sym": SYM, "window": va.get("window"),
                "n_codes": len([k for k in out]),
                "n_codes_scope": len(codes),
                "n_rows": n_rows,
                "n_distinct_members": len(members),
                "generated_for": "gated players drawer",
                "keying": "member_id only — pseudonymous; usernames joined at serve time (ENIGMA.SignUp_A.Login)",
                "deposit_window_days": DEP_W,
                "dep_semantics": {
                    "dep_to_unlock": f"sum of DISTINCT deposits, each the nearest deposit strictly BEFORE a claim "
                                     f"of this code within {DEP_W}d (Tab 2 before_amt); deduped by deposit TIME so a "
                                     f"deposit that unlocks several claims counts once.",
                    "dep_after": f"sum of DISTINCT deposits landing strictly AFTER a claim of this code within {DEP_W}d "
                                 f"(Tab 2 after_amt); deduped by deposit TIME.",
                    "caveat": "OBSERVED timings mirroring Tab 2's to-unlock/after. Deposits may fall inside the "
                              "windows of MULTIPLE codes (overlap across codes) and a heavy claimer's after-windows "
                              "tile across months — these are NOT clean per-player cash totals, do not sum across codes.",
                },
                "source_channels": {
                    "authoritative_basis": "RedemptionType from WORKSPACE.260722_ws1_myr_PromotionReward "
                                           "(bridged code->PromotionId->RewardId via ..._Promotion): 0=Deposit(match), "
                                           "1=Claim(assigned). BonusType {DepositBonus,FreeCredit,FreeSpinBonus} "
                                           "corroborates and is the fallback for codes absent from config.",
                    "channels": ["deposit_match", "fasttrack", "operator", "self"],
                    "mapping": "RedemptionType=0 (or BonusType=DepositBonus) -> deposit_match. "
                               "RedemptionType=1 (assigned) -> assignment actor via GetBonus_ABC.ID=PAR.parid "
                               "(event id == PlayerAssignedRewardId for the assignment flow; full coverage): "
                               "System->fasttrack (CRM push), User->operator (BO/VM hand-issued), Player->self.",
                    "bugfix": "v2 derived source from GetBonus_ABC.ID=PAR.parid for ALL bonus types; that FK is only "
                              "valid for the assignment flow, so every DepositBonus fell out 'unmatched' and was "
                              "mislabeled 'self' (~51% of MY claims). Corrected: DepositBonus is deposit_match; "
                              "in-scope Player self-claim = 0.",
                    "redemptiontype_coverage": {
                        "config_table": "WORKSPACE.260722_ws1_myr_PromotionReward",
                        "resolved": n_rt_resolved, "of": len(codes),
                        "unresolved_codes": rt_unresolved,
                    },
                    "source": "DOMINANT channel by claim count per player x code; ties broken "
                              "deposit_match>fasttrack>operator>self.",
                    "source_breakdown": "{channel: claim_count} — reconciles to the row's claim count.",
                    "dominant_row_counts": src_row_dom,
                    "claim_totals_by_channel": src_totals,
                    "deposit_match_sub_actor": {
                        "basis": "dedup_GetDepositBonus_A.PlayerAssignedRewardId -> PAR.CreatedByActorType; "
                                 "empty parid = legacy (pre-assignment-object deposit bonus).",
                        "grain": "deposit-bonus EVENT counts (attribution overlay; not reconciled 1:1 to the "
                                 "deposit_match claim count, which is at getbonus grain).",
                        "totals": dm_totals,
                        "per_row_field": "dm_detail (present only on rows with deposit-bonus events)",
                    },
                },
                "dep_maxima": {"max_dep_to_unlock": max_unlock, "max_dep_after": max_after},
                "flags_defined": {
                    "uncovered": f"free-credit code AND lifetime NGR (all-time) < this code's bonus this window, "
                                 f"AND tenure_days>{NEW_TENURE_DAYS} AND registered before window start",
                    "reactivation": "no deposit in the 30d before the FIRST claim of this code (or never), "
                                    f"then a deposit within {DEP_W}d after that first claim",
                },
                "reconciliation": {
                    "codes_with_r_spend": n_with_rspend,
                    "matched": matched,
                    "match_rate_pct": match_rate,
                    "tolerance": "max(2, 0.5% of r_spend)",
                    "mismatches": sorted(mism, key=lambda x: -abs(x["diff"]))[:20],
                },
                "honesty": "OBSERVED. deposits & bonus never netted. 'given' != abuse. member ids pseudonymous; "
                           "no usernames stored.",
            }
            payload = {"_meta": meta_block}
            payload.update(out)

            fp = SCR / f"code-players-{MK}.json"
            json.dump(payload, open(fp, "w", encoding="utf-8"), ensure_ascii=False)
            size_mb = fp.stat().st_size / 1e6

            # top 5 codes by player count
            top5 = sorted(((code, len(rows)) for code, rows in out.items()), key=lambda x: -x[1])[:5]
            summary[MK] = {
                "file": str(fp), "size_mb": round(size_mb, 3), "n_rows": n_rows,
                "n_codes": len(out), "n_distinct_members": len(members),
                "reconcile_match_rate_pct": match_rate, "matched": matched,
                "codes_with_r_spend": n_with_rspend, "n_mismatch": len(mism),
                "top_mismatches": sorted(mism, key=lambda x: -abs(x["diff"]))[:5],
                "top5_codes_by_players": [{"code": co, "players": n} for co, n in top5],
                "source_claim_totals": src_totals,
                "source_dominant_rows": src_row_dom,
                "deposit_match_sub_actor_totals": dm_totals,
                "redemptiontype_resolved": f"{n_rt_resolved}/{len(codes)}",
                "redemptiontype_unresolved": rt_unresolved,
                "max_dep_to_unlock": max_unlock,
                "max_dep_after": max_after,
            }
            print(f"[{MK}] rows={n_rows:,} codes={len(out)} members={len(members):,} "
                  f"file={fp.name} size={size_mb:.2f}MB reconcile={matched}/{n_with_rspend} ({match_rate}%)")
            print(f"        RedemptionType resolved {n_rt_resolved}/{len(codes)}"
                  + (f" (unresolved: {rt_unresolved})" if rt_unresolved else ""))
            print(f"        source claims: " + " ".join(f"{k}={v:,}" for k, v in src_totals.items()))
            print(f"        source dom rows: " + " ".join(f"{k}={v:,}" for k, v in src_row_dom.items()))
            print(f"        deposit_match sub-actor (events): " + " ".join(f"{k}={v:,}" for k, v in dm_totals.items()))
            print(f"        max dep_to_unlock={max_unlock['v']:,.0f} ({max_unlock['code']}/{max_unlock['mid']})  "
                  f"max dep_after={max_after['v']:,.0f} ({max_after['code']}/{max_after['mid']})")
            for co, n in top5:
                print(f"        {co:<40} {n:>5} players")
            if mism:
                print(f"        mismatches ({len(mism)}): " +
                      ", ".join(f"{m['code']}({m['diff']:+.0f})" for m in mism[:6]))
        except Exception as e:
            import traceback
            traceback.print_exc()
            summary[MK] = {"error": repr(e)[:400]}
            print(f"[{MK}] ERROR: {e!r}")

    print("\n=== SUMMARY JSON ===")
    print(json.dumps(summary, ensure_ascii=False, indent=1, default=str))
    print("DONE.")


if __name__ == "__main__":
    main()
