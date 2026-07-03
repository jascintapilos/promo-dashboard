---
name: qp2-dialog-popup-body-templates
description: "Dialog popup short-body templates for QP2 — location, format, placeholder vars, and styling rules confirmed 2026-06-08."
metadata: 
  node_type: memory
  type: project
  originSessionId: 9261e5d7-0ac9-4bc6-801a-3f4ca8df2ed2
---

## Location

`src/dialog-popup-bodies/<slug>/<docKey>.html`
- slug: `deposit` | `free-credit` | `free-spin`
- docKey: `EN` | `ZH` (no ID — dialog popups skip ID locale)

## Format per bonus type (confirmed against operator BO references 2026-06-08)

### Deposit
```
<p><strong>How to Apply:</strong></p>
<ol>
  <li>Go to the [Transfer] page and select your game provider.</li>
  <li>Enter amount {{currency_symbol}} {{min_deposit_formatted}} and above</li>
  <li>Choose <strong>[{{promotion_name_en}} ]</strong> under "Promotion" and click SUBMIT.</li>
</ol>
<p><strong><em><span style="color:#FF0000;">*For full promotion terms & conditions, check your Inbox.</span></em></strong></p>
```
- Amount plain text (no bold), comma-formatted (`1,000`)
- Promo name bold in `[Name ]` with space before `]`
- SUBMIT plain (not bold)
- CTA left = `DEPOSIT` → `/member/deposit`

### Free Credit
```
<p>Congratulations! You have been rewarded with a free credit!</p>
<p><strong>Terms and Conditions</strong><br>1. Turnover is {{turnover}} times.</p>
<p><strong><em><span style="color:#FF0000;">*For full terms & conditions, check your Inbox.</span></em></strong></p>
```
- No "How to" steps — just congrats + T&C summary
- CTA left = `CLAIM NOW` → `/member/reward`

### Free Spin
```
<p><strong>How to Claim:</strong></p>
<ol>
  <li>Go to Account > Rewards and claim the reward <strong>[{{spin_count}} Free Spins - {{game_name}}]</strong></li>
  <li>After successfully claiming... <strong>{{game_provider}}</strong> ...game <strong>[{{game_name}}]</strong></li>
  <li>Redeem all your {{spin_count}} free spins!</li>
</ol>
<p><strong><em><span style="color:#FF0000;">*For full promotion terms & conditions, check your Inbox.</span></em></strong></p>
```
- "How to Claim:" IS bold/strong (same as Deposit heading)
- CTA left = `CLAIM NOW` → `/member/reward`

## Disclaimer line — always Bold + Italic + Red
`<strong><em><span style="color:#FF0000;">*For full... check your Inbox.</span></em></strong>`

## Placeholder vars available in `renderDialogBody()`
| Var | Source |
|-----|--------|
| `{{currency_symbol}}` | MYR/SGD/IDR symbol |
| `{{min_deposit}}` | raw number |
| `{{min_deposit_formatted}}` | comma-formatted (1,000) |
| `{{turnover}}` | `parsed.to_multiplier` |
| `{{promotion_name_en}}` | `resolved.promotion_name_en` |
| `{{spin_count}}` | `parsed.spin_count` |
| `{{game_provider}}` | provider name, prefix-stripped (e.g. PP2 - PRAGMATIC PLAY → PRAGMATIC PLAY) |
| `{{game_name}}` | `parsed.game` |

## Popup linkage QC note
- `GET /api/bo/promotion/{id}` does NOT return `dialog_popup_list`
- Use `GET /api/bo/promotion?code=<code>&list` to verify popup is linked
- Confirmed field: `dialog_popup_list[0].promotion_id` + `popup_id`
