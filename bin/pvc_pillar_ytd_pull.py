"""Pull YTD WS1 bonus codes (MY + SG) from CSIR ClickHouse using the official
Bonus Performance Report SQL, then classify each code into one of the 5
budget Pillars (ACQ / RET / VIP / WHALE / BRA) from its code prefix.

Source query: projects/promo-value-creation/reference/bonus_performance_sql_reference.py
Pillar convention: [FT_]PILLAR_TEAM_OBJECTIVE_[NODEP]_PROMO[_TO], rebuilt 2026-07-09.
Codes that predate the convention (or never adopted it) will not have a
matching first segment -- those are reported as unmapped/inferred rather
than guessed.
"""
from __future__ import annotations

import importlib.util
import json
import re
from collections import defaultdict
from datetime import date
from pathlib import Path
import sys

# CSIR endpoint, credentials and client all come from csir_config.py at the repo root.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import csir_config


PROJECT_ROOT = Path(__file__).resolve().parent.parent
REFERENCE_PATH = (
    PROJECT_ROOT / "projects" / "promo-value-creation" / "reference"
    / "bonus_performance_sql_reference.py"
)
OUT_DIR = PROJECT_ROOT / "outputs" / "pvc-csir-probe"

DIMS = ["SITE_edit", "BonusType", "BonusCode", "BonusName"]
MARKETS = [("MY", "MYR"), ("SG", "SGD")]
ANALYSIS_START = "2026-01-01"
ANALYSIS_END = date.today().isoformat()

PILLARS = {
    "ACQ": "Acq",
    "RET": "Retention",
    "VIP": "VIP",
    "WHALE": "Whale Detection",
    "BRA": "Branding",
}
# Secondary substring hints for codes that don't carry a formal pillar-first
# prefix (pre-2026-07-09 or never-converted). Medium confidence only.
INFERRED_HINTS = {
    "Acq": ["ACQ", "WELC", "NODEP"],
    "Retention": ["RET_", "_RET", "CHURN", "REACT", "REL_", "_REL"],
    "VIP": ["VIP", "DIAMOND", "PLATINUM", "TIER"],
    "Whale Detection": ["WHALE", "GROOM", "PROBE", "HIGHROLLER", "HIGH ROLLER"],
    "Branding": ["BRA", "LUCKYWHEEL", "SCRATCHMANIA", "XMAS", "SCRATCH", "ANGPOW", "CHECKIN", "FIFA"],
}

# Codes confirmed live on the public promo pages (mb8mys.com / mb8sin.net,
# checked 2026-08-10) -- self-claimable by any player, not owned by one
# budget pillar. These are labelled "Public Promo" instead of a pillar,
# overriding whatever pillar the code text would otherwise infer.
PUBLIC_PROMO_CODES = {
    "optimove_my_weekly_rescue_bonus_tier_1", "optimove_my_weekly_rescue_bonus_tier_2",
    "optimove_my_weekly_rescue_bonus_tier_3a_1", "optimove_my_weekly_rescue_bonus_tier_3b",
    "optimove_my_weekly_rescue_bonus_tier_3c", "optimove_my_weekly_rescue_bonus_tier_3d",
    "optimove_my_weekly_rescue_bonus_tier_3e",
    "optimove_sg_weekly_rescue_bonus_tier_1", "optimove_sg_weekly_rescue_bonus_tier_2",
    "optimove_sg_weekly_rescue_bonus_tier_3a", "optimove_sg_weekly_rescue_bonus_tier_3b",
    "optimove_sg_weekly_rescue_bonus_tier_3c", "optimove_sg_weekly_rescue_bonus_tier_3d",
    "optimove_sg_weekly_rescue_bonus_tier_3e",
    "10PERCENTUNLIMITEDBONUS",
    "FC_VIP_BDAY_SILVER", "FC_VIP_BDAY_GOLD", "FC_VIP_BDAY_PLATINUM", "FC_VIP_BDAY_DIAMOND",
    "200% Welcome Bonus (30%) Stage 1", "200% Welcome Bonus (70%) Stage 2", "200% Welcome Bonus (100%) Stage 3",
    "REFERRAL_BONUS_3.0", "REFERRAL_BONUS_3.0_R",
    "FC_KYC_30",
}


def get_client():
    return csir_config.get_client(send_receive_timeout=120)


def load_reference_module():
    spec = importlib.util.spec_from_file_location("bonus_sql_ref", REFERENCE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def classify_pillar(bonus_code: str, bonus_name: str) -> tuple[str, str]:
    """Return (pillar_label, confidence) where confidence in {confirmed, inferred, unmapped}.

    Public promos are checked first and labelled "Public Promo" rather than a
    pillar -- they're self-claimable by any player, not one budget owner's
    spend, so forcing them into ACQ/RET/VIP/WHALE/BRA misrepresents them.
    """
    if (bonus_code or "") in PUBLIC_PROMO_CODES:
        return "Public Promo", "confirmed"

    code = (bonus_code or "").upper()
    name = (bonus_name or "").upper()
    stripped = re.sub(r"^FT_", "", code)
    first_segment = stripped.split("_")[0] if stripped else ""

    if first_segment in PILLARS:
        return PILLARS[first_segment], "confirmed"

    haystack = f"{code} {name}"
    for pillar_label, hints in INFERRED_HINTS.items():
        if any(hint in haystack for hint in hints):
            return pillar_label, "inferred"

    return "Unmapped", "unmapped"


def split_rollup_rows(columns: list[str], rows: list[list], dims: list[str]) -> dict:
    idx = {c: i for i, c in enumerate(columns)}
    leaf_rows, subtotals, grand_total = [], [], None

    for row in rows:
        vals = [str(row[idx[d]] or "").strip() for d in dims]
        first_empty = next((i for i, v in enumerate(vals) if not v), len(dims))
        record = dict(zip(columns, row))
        if first_empty == 0:
            grand_total = record
        elif first_empty == len(dims):
            leaf_rows.append(record)
        else:
            subtotals.append(record)

    return {"leaf_rows": leaf_rows, "subtotals": subtotals, "grand_total": grand_total}


def run_market(client, ref_module, market_label: str, currency: str) -> dict:
    date_params = ref_module._compute_date_params(ANALYSIS_START, ANALYSIS_END)
    date_params["[currency]"] = currency

    cache = {
        "selected_sites": ["WS1"],
        "selected_bonus_types": [],
        "bonus_code_filter": "",
        "bonus_code_match": "exact",
        "bonus_name_filter": "",
        "bonus_name_match": "exact",
    }

    sql = ref_module._inject_rollup_order(
        ref_module._inject_all_filters(
            ref_module._inject_dates(ref_module.SQL_LOCAL, date_params),
            cache,
        ),
        DIMS,
    )

    result = client.query(
        sql,
        settings={
            "readonly": 1,
            "max_execution_time": 90,
            "max_result_rows": 50000,
            "result_overflow_mode": "break",
        },
    )
    split = split_rollup_rows(result.column_names, result.result_rows, DIMS)

    for leaf in split["leaf_rows"]:
        pillar, confidence = classify_pillar(leaf.get("BonusCode", ""), leaf.get("BonusName", ""))
        leaf["pillar"] = pillar
        leaf["pillar_confidence"] = confidence

    return {"market": market_label, "currency": currency, "sql_used": sql, **split}


def summarize(all_results: list[dict]) -> dict:
    by_pillar_market = defaultdict(lambda: defaultdict(lambda: {"codes": 0, "claims": 0, "bonus_cost": 0.0, "ngr_lift": 0.0}))
    confidence_counts = defaultdict(int)

    for res in all_results:
        market = res["market"]
        for leaf in res["leaf_rows"]:
            pillar = leaf["pillar"]
            confidence_counts[leaf["pillar_confidence"]] += 1
            bucket = by_pillar_market[pillar][market]
            bucket["codes"] += 1
            bucket["claims"] += int(leaf.get("claims") or 0)
            bucket["bonus_cost"] += float(leaf.get("bonus_cost") or 0)
            bucket["ngr_lift"] += float(leaf.get("ngr_lift") or 0)

    return {
        "by_pillar_market": {p: dict(m) for p, m in by_pillar_market.items()},
        "confidence_counts": dict(confidence_counts),
    }


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    ref_module = load_reference_module()
    client = get_client()

    all_results = []
    for market_label, currency in MARKETS:
        print(f"Querying WS1 {market_label} ({currency}) {ANALYSIS_START} -> {ANALYSIS_END} ...")
        res = run_market(client, ref_module, market_label, currency)
        print(f"  leaf rows (distinct codes): {len(res['leaf_rows'])}, subtotal rows: {len(res['subtotals'])}")
        all_results.append(res)

    summary = summarize(all_results)

    print("\nPillar coverage summary:")
    for pillar, markets in summary["by_pillar_market"].items():
        parts = ", ".join(f"{m}={v['codes']} codes" for m, v in markets.items())
        print(f"  {pillar}: {parts}")
    print(f"\nClassification confidence: {summary['confidence_counts']}")

    out_path = OUT_DIR / f"pillar-ytd-pull-{date.today().isoformat()}.json"
    payload = {
        "analysis_start": ANALYSIS_START,
        "analysis_end": ANALYSIS_END,
        "scope": "WS1 MY + SG only (project scope per CLAUDE.md) -- WS1 also has IDR/INR/THB/USD rows not pulled here",
        "pillar_convention": "PILLAR_TEAM_OBJECTIVE prefix, rebuilt 2026-07-09; pre-dating codes classified as inferred/unmapped, not guessed",
        "results": [
            {k: v for k, v in res.items() if k != "sql_used"}
            for res in all_results
        ],
        "summary": summary,
    }
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    print(f"\nSaved: {out_path}")


if __name__ == "__main__":
    main()
