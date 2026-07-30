# WS1 Promotions MCP — Technical Requirements

**Document status:** Draft for WS1 Technology review  
**Version:** 1.0  
**Date:** 23 July 2026  
**Business owner:** Promotions  
**Technical owner:** WS1 Technology  
**Platforms in scope:** WS1 V3 IGMP MY, SG, ID, TH, KH; WS2 only after explicit confirmation  

## 1. Purpose

Build a Model Context Protocol (MCP) server that allows approved automation
agents to inspect, plan, create, verify, update, activate, and deactivate WS1
promotions through safe business-level tools.

The MCP must prevent incomplete promotion records, especially promotion shells
without rewards. It must not expose unrestricted raw IGMP endpoints directly to
an agent.

The MCP is intended to support:

- normal promotion creation from structured requests;
- controlled BO-to-BO cloning or code migration;
- read-only promotion discovery and troubleshooting;
- persisted-state quality control;
- separately approved activation and deactivation;
- auditable recovery from partial failures.

## 2. Incident and problem statement

An automation agent previously created multiple promotion header records without
the required reward records. These incomplete records caused the IGMP promotion
detail page to remain loading and required Technology support to remove them.

The failure occurred because:

- low-level create calls could be made directly;
- promotion creation was treated as successful before its reward existed;
- there was no atomic business operation covering promotion, reward, content,
  settings, verification, and activation;
- incomplete records could be created repeatedly in a batch;
- prompt instructions were relied on instead of system-enforced invariants.

The MCP must enforce the safety contract in this document regardless of the
prompt used by the agent.

## 3. Design principles

1. **Business-level tools, not raw endpoints.** The agent requests an operation
   such as `promotion_create_draft`; the MCP owns the IGMP endpoint sequence.
2. **Fail closed.** Missing or inconclusive evidence never becomes success.
3. **Inactive first.** A new promotion must remain inactive until its complete
   persisted graph has passed verification.
4. **Persisted state is authoritative.** Create responses and submitted payloads
   are not proof of success.
5. **Separate duties.** Planning, creation, verification, activation, and
   deactivation are distinct actions.
6. **Idempotent execution.** Retrying the same approved operation must not create
   duplicates.
7. **Ownership-aware recovery.** The MCP may automatically quarantine only a
   record created by the same execution.
8. **Explicit scope.** Site, region, environment, old code, and new code must
   never be inferred from whichever BO responds first.
9. **Versioned schemas.** Unknown meaningful fields must block the operation
   until the MCP schema is updated.
10. **Auditability.** Every state transition must have durable evidence.

## 4. Scope

### 4.1 Promotion types

The first production version must support:

| IGMP type | Business name | Required create sequence |
|---|---|---|
| `Bonus` | Deposit/Reload Bonus | Create promotion and embedded reward/content as one operation |
| `FreeCredit` | Free Credit | Create promotion and embedded reward/content as one operation |
| `FreeSpin` | Free Spin | Create shell, resolve PromotionId, add reward/content and Free Spin configuration, update settings |

### 4.2 Regions and sites

The MCP must use an explicit, server-managed site catalogue:

| Region | Logical site ID |
|---|---|
| MY | `ws1-v3-my` |
| SG | `ws1-v3-sg` |
| ID | `ws1-v3-id` |
| TH | `ws1-v3-th` |
| KH | `ws1-v3-kh` |
| WS2 | `ws2` |

The MCP must reject an unknown site or a request where source/destination scope
is missing.

### 4.3 Out of scope for version 1

- QPRO and QP2 promotion APIs;
- banners and promotion-content CMS;
- Notification Manager inbox automation unless separately specified;
- automatic cross-region currency/content conversion;
- unrestricted arbitrary calls to `/PM/*` or `/VIM/*`;
- automatic deletion of promotions;
- automatic deactivation of an old promotion during cloning;
- bulk production activation without a separate approved cutover.

## 5. Required MCP tools

Tool names are recommendations. WS1 Technology may apply its naming standard,
but the separation of capabilities must remain.

### 5.1 Read-only tools

#### `promotion_get`

Returns a complete, normalized persisted promotion graph.

**Input**

```json
{
  "environment": "staging",
  "site_id": "ws1-v3-sg",
  "promotion_code": "FT_REL_29PCT_HSD_D1"
}
```

**Required behavior**

1. Resolve the promotion by exact code.
2. Determine its type.
3. Fetch the type-specific detail.
4. Fetch every reward.
5. Fetch all reward-content locales for every RewardId.
6. Include promotion settings and type-specific configuration.
7. Return a normalized graph and a deterministic `state_hash`.

**Output**

```json
{
  "status": "FOUND_COMPLETE",
  "site_id": "ws1-v3-sg",
  "promotion_id": 2565,
  "promotion_code": "FT_REL_29PCT_HSD_D1",
  "promotion_type": "Bonus",
  "is_active": true,
  "is_published": false,
  "reward_count": 1,
  "reward_ids": [12187],
  "locales": ["en", "zh"],
  "state_hash": "sha256:...",
  "graph": {}
}
```

The tool must distinguish:

- `NOT_FOUND`
- `FOUND_COMPLETE`
- `FOUND_INCOMPLETE`
- `AUTH_EXPIRED`
- `BO_UNAVAILABLE`
- `UNSUPPORTED_SCHEMA`

#### `promotion_list`

Lists promotions using bounded pagination and structured filters.

Required filters:

- exact or partial code;
- type;
- active status;
- published status;
- created/modified period where available.

The tool must not use `PromotionType: 0` to represent all types. It must query
all types correctly so Free Credit and Free Spin records are not omitted.

#### `promotion_validate`

Validates a proposed promotion without writing.

It must return:

- required-field results;
- code uniqueness;
- name uniqueness;
- reward completeness;
- locale requirements;
- date and enum validation;
- game/provider catalogue validation for Free Spin;
- unknown-field/schema findings;
- deterministic validation hash.

#### `promotion_compare`

Compares two normalized graphs or a normalized graph and a proposed plan.

It must produce:

- exact field paths;
- source value;
- destination/proposed value;
- whether the difference is allowed;
- final verdict: `MATCH`, `APPROVAL_REQUIRED`, or `FAIL`.

#### `mcp_health`

Returns:

- MCP version;
- supported schema versions;
- site availability;
- authentication state per site without exposing credentials;
- environment;
- dependency health;
- server time and timezone.

### 5.2 Planning tools

#### `promotion_plan_create`

Creates an immutable plan from structured business input.

The output must include:

- plan ID;
- plan hash;
- environment and site;
- exact promotion code;
- promotion type;
- normalized business graph;
- rendered IGMP operation sequence;
- validation results;
- expiry time for approval;
- schema version.

The plan must contain no credentials or reusable session tokens.

#### `promotion_clone_plan`

Creates a same-site clone/code-migration plan from a complete persisted source.

**Input**

```json
{
  "environment": "staging",
  "source_site_id": "ws1-v3-sg",
  "source_code": "FT_REL_29PCT_HSD_D1",
  "destination_site_id": "ws1-v3-sg",
  "destination_code": "FT_CRM_RET_REL_29PCT_HSD_D1"
}
```

Required controls:

- source and destination site must be explicit;
- source must be `FOUND_COMPLETE`;
- destination code must be absent;
- same-site cloning only in version 1;
- the destination code is exact and must not be rewritten;
- all source settings, reward mechanics, locales, and type-specific fields must
  be represented in the plan;
- unknown fields must cause `UNSUPPORTED_SCHEMA`;
- allowed changes must be listed explicitly;
- source `state_hash` must be bound into the plan hash.

### 5.3 Write tools

Write tools must not be available to read-only MCP clients.

#### `promotion_create_draft`

Creates exactly one inactive promotion from an approved immutable plan.

**Input**

```json
{
  "plan_id": "plan_...",
  "plan_hash": "sha256:...",
  "idempotency_key": "client-generated-unique-key",
  "approval": {
    "action": "create_draft",
    "approval_id": "approval_...",
    "approved_by": "operator identity",
    "approved_at": "2026-07-23T10:00:00+08:00"
  }
}
```

Required behavior:

1. Revalidate the plan hash and expiry.
2. Re-read the destination code and fail closed on lookup error.
3. Re-read the source for clone plans and block if its state hash changed.
4. Execute one type-specific create transaction.
5. Capture the new PromotionId.
6. Explicitly enforce or verify `IsActive=false` immediately.
7. Complete reward, content, settings, and type-specific follow-ups.
8. Read the complete destination graph back.
9. Require reward count, RewardId, locales, settings, and mechanics to match.
10. Return `VERIFIED_INACTIVE` only after every persisted check passes.

The tool must never return success for a promotion shell.

#### `promotion_verify`

Re-reads and verifies the complete persisted graph against an approved plan.

Possible verdicts:

- `VERIFIED_INACTIVE`
- `VERIFIED_ACTIVE`
- `FAIL_MISSING_REWARD`
- `FAIL_MISSING_CONTENT`
- `FAIL_MECHANICS_MISMATCH`
- `FAIL_SETTINGS_MISMATCH`
- `FAIL_STATUS_MISMATCH`
- `INCONCLUSIVE`

`INCONCLUSIVE` must never authorize activation.

#### `promotion_activate`

Activates a previously verified inactive promotion.

Required input:

- action-specific activation approval;
- plan ID and plan hash;
- destination PromotionId;
- verified destination state hash;
- reference to a prior `VERIFIED_INACTIVE` execution record.

Required behavior:

1. Re-read the promotion.
2. Re-run persisted verification.
3. Confirm it is owned by the approved plan.
4. Confirm it remains inactive and unpublished.
5. Activate using the server-side status operation.
6. Re-read status and confirm `IsActive=true`.
7. Confirm `IsPublished=false`.
8. Return a durable `ACTIVATED_VERIFIED` record.

Creation approval must not authorize activation.

#### `promotion_deactivate`

Deactivation must require its own explicit approval and exact PromotionId/code.

The MCP may automatically call deactivation without a separate user approval
only as compensation when:

- the PromotionId was created by the current execution;
- creation has not been reported successful;
- verification failed;
- the MCP records the reason and subsequently confirms inactivity.

The MCP must never automatically deactivate a pre-existing promotion it does
not own.

#### `promotion_update`

Version 1 should expose only an allowlisted set of update operations with
complete replacement semantics documented per field.

At minimum, the MCP must protect against:

- omitted fields being wiped;
- reward T&C being removed by an update;
- fields that IGMP does not support editing;
- accidental activation or publication.

Where a field is create-only, return `RECREATE_REQUIRED`; do not pretend the
update succeeded.

## 6. Promotion graph contract

The normalized graph must be versioned per promotion type.

### 6.1 Common promotion fields

- PromotionId
- PromotionCode
- PromotionName
- PromotionDescription
- PromotionType
- PromotionStartDate
- PromotionEndDate
- PromotionManagementId
- IsActive
- IsPublished
- Settings
- CreatedBy / ModifiedBy where available
- CreatedAt / ModifiedAt where available

### 6.2 Reward fields

- RewardId
- RewardName
- RedemptionType
- RewardType
- MinimumActionAmount
- BonusPercentage
- RolloverMultiplier
- FixedBonusAmount
- FixedRolloverAmount
- RedeemableQuantity
- RemainingQuantity
- IsActive
- RolloverType
- CapBonusAmount
- RedeemableKYCStatus
- WithdrawalCap
- MaximumBalance
- type-specific expiry/deposit fields
- PromotionRewardContents by locale

### 6.3 Deposit/Reload wrapper fields

- RedeemableDay
- RedeemableStartTime
- RedeemableEndTime
- RedeemableCount
- EffectiveMinutes

### 6.4 Free Credit wrapper fields

- ExpiryMinutes
- AutoRedemption
- EffectiveMinutes
- DepositRequirement
- RequiredApprovedDeposit
- DepositPeriodicDays
- FreeCreditType setting where applicable

### 6.5 Free Spin fields

- ProductId
- GameId
- FreeSpinCode
- FreeSpinName
- FreeSpinRounds
- AmountPerBet
- AmountPerLine
- StartTimeStamp
- EndTimeStamp
- ValidityTimeStamp
- RedeemableDay
- RedeemableCount
- AdditionalSettings
- MaxFreeSpinDayDuration

### 6.6 Schema drift

For each type, Technology must maintain a versioned allowlist of known
meaningful fields.

If IGMP returns a new, non-audit field that is not in the active schema:

- planning must stop with `UNSUPPORTED_SCHEMA`;
- creation/cloning must not continue;
- the event must be logged for schema review.

The MCP must not silently discard unknown mechanics fields.

## 7. State machine

Every live operation must use the following durable state machine:

```text
PLANNED
  → VALIDATED
  → APPROVED_FOR_DRAFT
  → CREATE_STARTED
  → PROMOTION_ID_CAPTURED
  → FORCED_INACTIVE
  → REWARD_CONFIRMED
  → CONTENT_CONFIRMED
  → SETTINGS_CONFIRMED
  → VERIFIED_INACTIVE
  → APPROVED_FOR_ACTIVATION
  → ACTIVATED_VERIFIED
```

Failure states:

```text
CONFLICT_EXISTING_DESTINATION
SOURCE_CHANGED
PARTIAL_OWNED_RECORD
QUARANTINE_REQUIRED
QUARANTINED_VERIFIED
MANUAL_TECH_CLEANUP_REQUIRED
INCONCLUSIVE
```

Only `VERIFIED_INACTIVE` may proceed to activation approval.

## 8. Idempotency and ownership

### 8.1 Idempotency key

All write tools must require an idempotency key.

The server must persist:

- idempotency key;
- action;
- environment/site;
- plan hash;
- exact promotion code;
- source hash for clones;
- resulting PromotionId and RewardIds;
- terminal state.

### 8.2 Retry behavior

- Safe reads may be retried with bounded exponential backoff.
- A timed-out create must be reconciled by exact-code lookup before another
  create attempt.
- If the destination exists and is owned by the same execution, the MCP may
  resume a documented idempotent recovery step.
- If the destination exists but ownership is unknown or different, return
  `CONFLICT_EXISTING_DESTINATION` and perform no write.

### 8.3 Ownership

The MCP audit store must associate every created PromotionId with:

- MCP execution ID;
- plan ID/hash;
- actor;
- timestamp;
- site/environment.

Automatic compensation may act only on records owned by the same execution.

## 9. Authentication and authorization

### 9.1 Preferred authentication

Technology should provide a supported service-to-service authentication method
for the MCP. Browser session cookies should be treated as a temporary fallback,
not the long-term integration contract.

Requirements:

- separate staging and production credentials;
- separate credentials or scoped access per site where possible;
- credentials stored in an approved secret manager;
- automatic expiry detection;
- no credentials in MCP responses, prompts, plan bundles, or audit payloads;
- TLS for all transport;
- credential rotation without code changes.

### 9.2 MCP client authorization

Required roles:

| Role | Permissions |
|---|---|
| Reader | Health, list, get, compare |
| Planner | Reader + validate and create plans |
| Draft Writer | Create an approved inactive draft |
| Activator | Activate a verified inactive promotion |
| Deactivator | Explicitly deactivate approved targets |
| Administrator | Manage schemas, sites and credentials |

No single default agent identity should receive every role automatically.

## 10. Approval model

Approvals must be:

- action-specific;
- bound to environment, site, exact code, plan hash, and target PromotionId
  where known;
- time-limited;
- single-use or explicitly reusable only for a bounded wave;
- attributable to an authenticated human/operator;
- recorded in the audit trail.

Required approval actions:

- `create_draft`
- `activate`
- `deactivate`
- `update`
- `batch_wave`

A plan hash alone is not sufficient authorization.

## 11. Error model

Every MCP error response must include:

```json
{
  "ok": false,
  "error_code": "FAIL_MISSING_REWARD",
  "message": "Persisted promotion has no reward record",
  "retryable": false,
  "environment": "production",
  "site_id": "ws1-v3-sg",
  "execution_id": "exec_...",
  "safe_next_action": "Quarantine the owned partial record and escalate to Technology"
}
```

Minimum stable error codes:

- `INVALID_INPUT`
- `AUTH_EXPIRED`
- `AUTH_FORBIDDEN`
- `BO_UNAVAILABLE`
- `TIMEOUT_RECONCILIATION_REQUIRED`
- `NOT_FOUND`
- `SOURCE_INCOMPLETE`
- `SOURCE_CHANGED`
- `DESTINATION_EXISTS`
- `DESTINATION_OWNERSHIP_UNKNOWN`
- `UNSUPPORTED_PROMOTION_TYPE`
- `UNSUPPORTED_SCHEMA`
- `VALIDATION_FAILED`
- `PLAN_HASH_MISMATCH`
- `APPROVAL_REQUIRED`
- `APPROVAL_INVALID`
- `FAIL_MISSING_REWARD`
- `FAIL_MISSING_CONTENT`
- `FAIL_MECHANICS_MISMATCH`
- `FAIL_SETTINGS_MISMATCH`
- `QUARANTINE_FAILED`
- `MANUAL_TECH_CLEANUP_REQUIRED`

HTTP 500 alone must not be used to represent every failure.

## 12. Batch controls

- Planning may inspect up to 20 rows per wave.
- Version 1 live creation should execute one promotion at a time per site.
- The batch must stop on the first partial, inconclusive, or critical failure.
- Activation must be a separate bounded wave.
- Cross-site concurrency may be introduced only after recovery tests pass.
- The MCP must return per-item states; it must not report a batch successful
  when any item is incomplete.

## 13. Audit and observability

The MCP must durably record:

- execution ID and idempotency key;
- actor and role;
- MCP/tool/schema version;
- environment and site;
- request summary with secrets redacted;
- source and plan hashes;
- approval evidence;
- IGMP endpoint sequence and result codes;
- PromotionId and RewardIds;
- state transitions;
- verification findings;
- compensation/quarantine actions;
- final status and safe next action.

Metrics:

- operations by tool/site/type;
- success/failure/inconclusive rates;
- partial-write count;
- quarantine success/failure;
- auth expiry rate;
- latency by endpoint/tool;
- schema-drift events;
- idempotent replays;
- activation blocks.

Alerts:

- any shell without reward;
- quarantine failure;
- unexpected active state before verification;
- attempted write without valid approval;
- repeated auth failures;
- schema drift;
- more than one critical failure in a rollout wave.

## 14. Security and data protection

- Validate all inputs against JSON Schema.
- Reject unexpected properties on write tools.
- Enforce maximum string and collection sizes.
- Sanitize logs and error messages.
- Do not return cookies, passwords, session tokens, or secret headers.
- Apply rate limiting per MCP client and site.
- Maintain an explicit endpoint allowlist inside the MCP.
- Prevent URL/host injection; clients may send logical site IDs only.
- Separate staging and production network routes and secrets.
- Record privileged writes in an immutable audit store.

## 15. Non-functional requirements

| Requirement | Target |
|---|---|
| Availability | Agreed with Technology; maintenance windows must be visible through `mcp_health` |
| Read timeout | Configurable; return classified timeout, never ambiguous success |
| Write timeout | Reconcile exact code before any retry |
| Timezone | Asia/Kuala_Lumpur for business dates; store audit timestamps in ISO 8601 |
| Maximum planning wave | 20 |
| Initial live concurrency | 1 per site |
| Audit retention | Minimum 12 months or company policy, whichever is longer |
| Schema versioning | Required in every plan and normalized graph |
| Backward compatibility | Breaking tool/schema changes require a new version |

## 16. Acceptance criteria

Technology and Promotions must jointly demonstrate the following in staging.

### 16.1 Functional

1. Create and verify one Deposit Bonus.
2. Create and verify one Free Credit.
3. Create and verify one Free Spin including reward, game configuration, and
   locale content.
4. Produce a same-site clone plan where the only approved business change is the
   code.
5. Activate only after a separate activation approval.
6. Confirm `IsPublished=false` throughout the WS1 workflow.

### 16.2 Safety and failure injection

1. Missing reward blocks success and activation.
2. Failure immediately after Free Spin shell creation produces an owned,
   inactive/quarantined record.
3. Quarantine is read back and confirmed inactive.
4. A pre-existing destination owned outside the execution is never modified or
   deactivated.
5. A create timeout is reconciled by exact code and does not duplicate.
6. A source change after plan approval blocks cloning.
7. A settings-only source change is detected.
8. A destination settings mismatch fails persisted QC.
9. An unknown meaningful IGMP field produces `UNSUPPORTED_SCHEMA`.
10. Missing EN or required ZH content blocks creation/activation.
11. An expired authentication session returns `AUTH_EXPIRED`.
12. A BO outage returns `BO_UNAVAILABLE` or classified timeout.
13. Reusing a creation approval for activation is rejected.
14. A second call with the same idempotency key returns the original result.
15. The first critical batch failure stops later items.

### 16.3 Operational

1. Technology can locate an execution using execution ID, code, PromotionId, or
   idempotency key.
2. Promotions can see a concise mechanics and verification summary.
3. Logs contain no credentials or session cookies.
4. Alerting fires for a simulated shell-without-reward incident.
5. The IGMP BO promotion detail page loads for every verified test promotion.

Production approval requires all critical acceptance tests to pass with evidence.

## 17. Rollout

### Phase 1 — Read-only

- `mcp_health`
- `promotion_get`
- `promotion_list`
- `promotion_validate`
- `promotion_compare`
- normalized schemas and state hashes

### Phase 2 — Staging planning

- `promotion_plan_create`
- `promotion_clone_plan`
- approval service integration
- schema-drift checks

### Phase 3 — Staging writes

- `promotion_create_draft`
- `promotion_verify`
- compensation/quarantine
- fault-injection testing

### Phase 4 — Controlled production canary

- one promotion per type and site pattern;
- creation remains inactive;
- manual and automated QC;
- separate activation approval;
- Technology monitoring during the run.

### Phase 5 — Bounded production waves

- three to five promotions sequentially;
- stop on first critical failure;
- expand only after agreed stability criteria.

## 18. Information required from WS1 Technology

1. Official endpoint documentation and supported payload schemas.
2. Confirmation that all create endpoints default to inactive.
3. Supported service-to-service authentication method.
4. Session/token lifetime and refresh behavior.
5. Staging/test BO access for every supported promotion type.
6. Rate limits and recommended concurrency.
7. Complete error-code catalogue.
8. Transaction or delete/cleanup capability for partial promotions.
9. Definitive field mutability: create-only versus safely updateable.
10. Official schema for Settings and type-specific unknown fields.
11. Confirmation of locale requirements by region.
12. Promotion-code and FreeSpinCode uniqueness scope.
13. API versioning and change-notification process.
14. Audit-log and support-escalation contacts.
15. Whether the BO can expose an atomic server-side
    `CreatePromotionWithReward` operation.

## 19. Preferred Technology-side enhancement

The safest long-term interface is an atomic server-side operation:

```text
CreatePromotionDraftWithReward
  → validate complete request
  → create promotion + reward + contents + settings in one transaction
  → rollback automatically on any failure
  → return complete persisted graph
  → leave inactive
```

This would remove the highest-risk client-side failure mode. If an atomic
operation cannot be provided, the MCP must implement the state machine,
ownership controls, verification, and compensation requirements above.
