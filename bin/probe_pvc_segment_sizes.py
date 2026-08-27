"""Compute WS1 segment audience sizes from Members_Overview_ABC."""

from __future__ import annotations

import json
from pathlib import Path
import sys

# CSIR endpoint, credentials and client all come from csir_config.py at the repo root.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import csir_config


OUT = Path(__file__).parent.parent / "outputs" / "pvc-csir-probe" / "segment-sizes.json"


def get_client():
    return csir_config.get_client(send_receive_timeout=120)


def q(client, sql):
    try: return client.query(sql).result_rows
    except Exception as e: return f"ERR: {str(e)[:200]}"


def main():
    c = get_client()
    result = {}

    ws1_sites = ['WS1_MYS_MYR', 'WS1_SGP_SGD', 'WS1_IDN_IDR', 'WS1_THA_THB', 'WS1_KHM_USD', 'WS1_IND_INR']
    print("Segment sizing per WS1 market (from Members_Overview_ABC):\n")
    print(f"{'Site':<20} {'Total':>10} {'Never Dep':>10} {'Active 30d':>10} {'Inactive 30-90d':>15} {'Inactive 90-180d':>16} {'Inactive 180+':>13}")
    print("-" * 100)

    for site in ws1_sites:
        s = {'site': site}
        r = q(c, f"""
            SELECT
                count() AS total,
                countIf(LifetimeDepositCount = 0 OR FirstDepositDate_gmt8 IS NULL) AS never_deposited,
                countIf(dateDiff('day', LastDepositDate_gmt8, now()) BETWEEN 0 AND 30) AS active_30d,
                countIf(dateDiff('day', LastDepositDate_gmt8, now()) BETWEEN 31 AND 90) AS inactive_30_90,
                countIf(dateDiff('day', LastDepositDate_gmt8, now()) BETWEEN 91 AND 180) AS inactive_90_180,
                countIf(dateDiff('day', LastDepositDate_gmt8, now()) > 180) AS inactive_180plus
            FROM WORKSPACE.Members_Overview_ABC
            WHERE SITE = '{site}'
        """)
        if isinstance(r, str):
            print(f"  {site} ERR: {r}")
            continue
        (total, never, a30, i30_90, i90_180, i180) = r[0]
        s.update(total=int(total), never_deposited=int(never), active_30d=int(a30),
                 inactive_30_90=int(i30_90), inactive_90_180=int(i90_180), inactive_180plus=int(i180))
        result[site] = s
        print(f"{site:<20} {total:>10,} {never:>10,} {a30:>10,} {i30_90:>15,} {i90_180:>16,} {i180:>13,}")

    # Fresh Leads (registered last 90d)
    print("\nFresh Leads (registered <90d):")
    for site in ws1_sites:
        r = q(c, f"""
            SELECT count(), countIf(LifetimeDepositCount = 0) AS never_dep_new
            FROM WORKSPACE.Members_Overview_ABC
            WHERE SITE = '{site}' AND RegisterDate_gmt8 >= now() - INTERVAL 90 DAY
        """)
        if isinstance(r, str): continue
        (n, nd) = r[0]
        result[site]['fresh_leads_90d'] = int(n)
        result[site]['fresh_leads_never_dep'] = int(nd)
        print(f"  {site:<20} registered 90d: {n:>7,} | of which never deposited: {nd:>7,}")

    # VIP breakdown per site (from tier_snapshot which is WS1 not per-market)
    print("\nVIP breakdown (WS1 aggregate via tier_snapshot):")
    r = q(c, """
        SELECT membership, count() FROM VMDB.tier_snapshot
        WHERE lower(site) LIKE '%ws1%' GROUP BY membership ORDER BY 2 DESC
    """)
    vip = {}
    if not isinstance(r, str):
        for m, n in r:
            vip[m] = int(n)
            print(f"  {m:<20} {n:>7,}")
    result['ws1_vip_tiers'] = vip

    # Membership from Members_Overview_ABC — per market
    print("\nVIP-tagged members via Members_Overview.Membership (per market):")
    for site in ws1_sites:
        r = q(c, f"""
            SELECT Membership, count() FROM WORKSPACE.Members_Overview_ABC
            WHERE SITE = '{site}' AND Membership NOT IN ('', 'Standard', 'Normal', 'Regular')
            GROUP BY Membership ORDER BY 2 DESC LIMIT 15
        """)
        if isinstance(r, str) or not r:
            continue
        tiers = {row[0]: int(row[1]) for row in r}
        result[site]['vip_by_market'] = tiers
        summary = ', '.join(f"{k}: {v:,}" for k, v in tiers.items() if v > 0)
        if summary:
            print(f"  {site:<20} {summary}")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(result, indent=2, default=str), encoding='utf-8')
    print(f"\nSaved to {OUT}")


if __name__ == "__main__":
    main()
