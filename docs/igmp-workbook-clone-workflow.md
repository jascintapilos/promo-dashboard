# IGMP workbook clone workflow

This workflow is for WS1/WS2 code migrations where a workbook maps an existing
BO promotion code to a new code. It is deliberately separate from the Promo
Request `P###` flow:

- the workbook is a migration manifest;
- the old persisted BO record is the mechanics source of truth;
- the new-code cell is exact and is never renamed or prefix-inferred.

## Safety contract

Each selected row must explicitly resolve:

- source site/region;
- destination site/region;
- old promotion code;
- exact new promotion code.

Blank region cells are rejected. The runner never fills down visually grouped
regions. Cross-region clones are rejected until a versioned transformation
profile exists.

Planning fetches the complete source graph using:

1. `GetPromotionInfoByCode`
2. the type-specific detail endpoint
3. `GetPromotionRewardContents`

The source must contain exactly one reward, a RewardId, EN content, and ZH
content for WS1 MY/SG. Planning is read-only and writes an immutable plan bundle
under `captures/igmp-clone-plans/`.

## Commands

Plan explicit workbook rows:

```powershell
node bin/clone-igmp-from-workbook.mjs --rows=58-60
node bin/clone-igmp-from-workbook.mjs --numbers=55,56 --tab=WS1
```

Review the generated plan file and plan hash. Create one approved destination
inactive:

```powershell
node bin/clone-igmp-from-workbook.mjs `
  --commit `
  --plan=captures/igmp-clone-plans/<plan>.json `
  --approve=<exact-plan-hash>
```

The commit re-fetches the source and stops if its business hash changed. It
fails closed on destination lookup errors, creates the destination inactive,
reads the complete destination graph back, and compares it to the approved
plan. A partial destination is deactivated and recorded under
`captures/igmp-clone-runs/` as `PARTIAL_CLEANUP_REQUIRED`.

Activation is a separate approval:

```powershell
node bin/clone-igmp-from-workbook.mjs `
  --activate `
  --plan=captures/igmp-clone-plans/<plan>.json `
  --approve=<exact-plan-hash>
```

Activation performs the persisted-state comparison again before changing
status. It never deactivates the old promotion.

## Rollout

1. Plan and create one inactive canary per promotion type and region.
2. Review persisted mechanics, RewardId, localized content, and the BO detail
   page.
3. Activate only with separate approval.
4. Expand to a sequential wave of three to five rows.
5. Stop the wave on the first partial or inconclusive result.

The workbook's `Done Create New Code?` field must not be updated from a create
response. Completion write-back should only be added after the destination has
reached `ACTIVATED_VERIFIED`.
