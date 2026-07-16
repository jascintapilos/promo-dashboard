---
name: promo-troubleshoot
description: Discover or troubleshoot QPRO/QP2 promotions from either a promo code or natural-language mechanics, then cross-check BO configuration against inbox/SMS copy. Use for promo verification, missing-code identification, cross-brand comparison, or reported discrepancies.
---

# Promo Troubleshoot

Pull BO config + inbox/SMS templates for a promo code and cross-check for mismatches. The goal is to surface discrepancies between what the system enforces and what the member sees in messages — the most common source of CS escalations.

## Input

Exact-code format: `<promo_code> <site_id> [--cross-brand]`

Discovery format: `--discover <site_id> "<request text>"`

Examples:
- `WELC_RND3_FS_FOO_260225 qpro5`
- `REL_VIP_50PCT_3X qpro11 --cross-brand`
- `FT_WEL_SLOTS_120PCT ws1`
- `--discover ibc22 "QP2D MY welcome 120% depo 50 get 110, depo 300 get 660, sports"`

If the user provides a Slack link instead of a promo code, read the Slack thread first (via `slack_read_thread` MCP tool) to extract the promo code and site, then proceed.

If the user gives mechanics but no exact code, use discovery mode. Never manually choose a code from a broad search result. If the user only gives a promo code without a site, ask which site. If they give a brand name (e.g. "U388", "BX99"), resolve it to the site ID using the brand ecosystem memory or `bo-sites.json`.

## Workflow

### Step 1: Run the troubleshoot script

```bash
node "<skill-path>/scripts/troubleshoot.mjs" <promo_code> <site_id> [--cross-brand] --json
```

The `--json` flag gives structured output for you to parse and present. Without it, you get human-readable text (useful if you just want to show raw output).

The script handles:
- Auth (automatic via session cache)
- Promo lookup via `findPromotionByCode`
- Per-currency config fetch (`/api/bo/promotioncurrency`)
- Inbox template detail fetch (`/api/bo/messagetemplate/{id}`)
- SMS templates from the promo listing response
- Amount extraction from HTML bodies (MYR/SGD/IDR patterns)
- Automated mismatch detection
- Cross-brand comparison when `--cross-brand` is passed
- Merchant-isolated natural-language discovery
- Deterministic checks for rate, promo type, category, and deposit-to-total examples
- Ranked candidates with evidence and explicit rejection reasons

For discovery, show the top 2–3 candidates. Treat explicit categories and arithmetic as decisive: a Slots promo cannot satisfy a Sports request, and every `deposit X get Y` example must match `X + min(X × rate, max_bonus)`. If the result is `AMBIGUOUS`, do not assert a match.

### Step 2: Present findings

Always lead with a **summary table** showing the promo config at a glance:

| Field | Value |
|---|---|
| Code | `WELC_RND3_FS_FOO_260225` |
| Site | QPRO5 (U388) |
| Status | Active |
| Bonus type | Free Spin - Welcome |
| Game | vs20olympgcl (PP2) |
| Inbox template | 221 |
| SMS template | 83 |

Then a **per-currency table**:

| Currency | min_deposit | rounds | fc_amount | max_bonus |
|---|---|---|---|---|
| MYR | 50 | 208 | - | - |
| SGD | 100 | 308 | - | - |

Then a **mismatches section** if any were found:

| Severity | Type | Locale | Detail |
|---|---|---|---|
| HIGH | min_transfer | MY_EN | BO=50 but template says MYR 100 |
| HIGH | min_transfer | MY_ZH | BO=50 but template says MYR 100 |

If `--cross-brand` was used, add a **cross-brand comparison table**:

| Site | Currency | min_transfer | rounds |
|---|---|---|---|
| qpro3 | MYR | 50 | 218 |
| qpro3 | SGD | 100 | 319 |
| qpro4 | MYR | 50 | 215 |
| qpro5 | MYR | 50 | 208 |

### Step 3: Recommend a fix

Based on the mismatches:

1. **If config is the outlier** (other brands + template agree): recommend updating the BO config field
2. **If template is the outlier** (other brands + BO config agree): recommend updating the message template via `PUT /api/bo/messagetemplate/{id}`
3. **If cross-brand shows all brands have the same mismatch**: the template was likely copied wrong everywhere — recommend a bulk fix
4. **If SMS mentions amounts not in BO**: flag that the SMS may come from Smartico (separate from BO templates) — escalate to the Smartico owner (Ryan for QPRO2-19)

When recommending template fixes, offer to execute them. Use the PUT shape:
```json
{
  "name": "<template name>",
  "section": <int>,
  "type": <int>,
  "status": <int>,
  "details": {
    "<locale_id>": {
      "settings_locale_id": <int>,
      "subject": "<subject>",
      "message": "<corrected html>"
    }
  }
}
```

Always GET the template first to read existing `name`, `section`, `type`, `status` — include all locales in the PUT (even unchanged ones).

## Edge cases

- **WS1/WS2 (IGMP)**: These use a different API stack (`/PM/` endpoints, not `/api/bo/`). The script only covers QPRO/QP2 sites. For WS1/WS2, tell the user you need to check manually or via the IGMP endpoints.
- **No inbox template linked**: Some promos have `message_template_id=0`. Flag this — the member won't receive any inbox message, which may itself be the issue.
- **No SMS template**: `message_template_sms_id=0` means no BO-originated SMS. If the member received an SMS, it came from Smartico or another channel.
- **Archived/inactive promos**: `status=0` means inactive. Note this prominently — the promo may have been deactivated as the fix.
