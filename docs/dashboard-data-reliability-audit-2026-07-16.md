# Promo Operations Dashboard — Data Reliability Audit

**Audit date:** 2026-07-16  
**Business timezone:** Asia/Kuala_Lumpur  
**Scope:** Unified dashboard source code, the live `PromoOps_Control_Layer` spreadsheet, and the live `PromoOps Data` QC source.  
**Mode:** Read-only. No live sheet or dashboard data was changed.

**Source clarification:** The repository contains both `unified-dashboard` and `control-tower` implementations. The production deployment script uses `control-tower`. Findings about the latest-20 truncation apply to the older `unified-dashboard` copy, not the production `control-tower` task endpoint. Production-specific remediation is tracked in the sections below.

## Executive conclusion

The dashboard is not ready for SLA, overdue, workload, or automation-health metrics yet. The live sources contain useful data, but the current pull and UI do not apply one consistent schema. A polished dashboard built on the current result would present incomplete and materially misleading figures.

The immediate objective should be to establish a canonical data contract, normalize the existing records during read time, return the complete task population, and expose source freshness. Only after those checks pass should operational alerts and management metrics be added.

## Sources verified

| Source | Live status | Intended use | Key observation |
|---|---|---|---|
| `PromoOps_Control_Layer` → `Task_Master` | Available | Tasks, owners, priority, status, due dates | 164 populated task records; values use multiple incompatible standards |
| `PromoOps_Control_Layer` → supporting tabs | Partially available | History, comments, sources, automation logs | `Status_History`, `Task_Comments`, `Task_Sources`, and `Automation_Logs` are not currently present |
| `PromoOps Data` → `QC Results Log` | Available | QC health and failure details | 1,331 QC records, but it is not connected to the unified dashboard pull |
| Weekly reports in Drive | Referenced by dashboard | YTD production reporting | Existing dashboard discovers these separately; freshness is not shown to the user |

## Confirmed critical findings

### 1. The older unified dashboard only returns the latest 20 tasks

The older `unified-dashboard` server counts all task rows, then returns only `tasks.slice(-20).reverse()` to the browser. The production `control-tower` implementation reads the complete task sheet and is not affected by this truncation. If the older implementation is reused, this means:

- KPI totals use the full population.
- Tables, boards, filters, exports, My Tasks, approvals, and the calendar use only the latest 20.
- All of the latest 20 records currently have status `New`, so the visible task list is not representative of the overall pipeline.

This is the highest-risk completeness problem because the screen can look complete while omitting most records.

### 2. The due-date field name does not match

The live sheet header is `Due_Date`. The dashboard reads and exports `Deadline`.

Impact:

- Deadline cells render blank.
- Calendar grouping falls back to “No deadline.”
- Deadline filters do not work as intended.
- Overdue and due-today calculations would be wrong if added without fixing the contract.

### 3. Status values do not use one standard

Live distribution across 164 task records:

| Status | Records | Recognized by current dashboard lifecycle? |
|---|---:|---|
| New | 64 | Yes |
| In Progress | 46 | No |
| Done | 43 | No |
| Need_Clarification | 5 | Yes |
| QC_Required | 4 | Yes |
| Ready_To_Execute | 1 | Yes |
| Waiting_Approval | 1 | Yes |

**89 of 164 records (54.3%) use statuses the dashboard does not recognize.**

Impact:

- `Done` is excluded from Completed KPIs.
- `In Progress` is excluded from pipeline calculations.
- Board view does not have columns for either value and can omit those records.
- Status colours and transition logic are inconsistent.

### 4. Priority values do not use one standard

The dashboard expects P1–P4, while the live data also uses `Urgent`, `High`, `Medium`, and `Normal`.

**137 of 164 records (83.5%) use values outside the P1–P4 standard.**

Impact:

- Priority styling and descriptions are missing for most tasks.
- SLA rules cannot be applied consistently.
- Priority filters split logically equivalent values.

### 5. Dates and timestamps are inconsistent

Due-date quality across 164 records:

- 43 use strict `YYYY-MM-DD` format.
- 78 are blank or `-`.
- 43 use another format, including `28/5`, `5/6 EOD`, `3pm today`, and written dates.

Additional completeness issues:

- 45 records have no `Submitted_At`.
- 72 records have no `Status_Updated_At`.

Timezone configuration is also inconsistent:

- `PromoOps_Control_Layer`: `America/Los_Angeles`
- `PromoOps Data`: `Etc/GMT`
- Business operation: `Asia/Kuala_Lumpur`

Impact: ageing, due-today, SLA, and refresh timestamps can shift dates or produce different results depending on the value type and reader location.

### 6. Ownership and task references are incomplete

- 58 of 164 records have no usable owner.
- 127 of 164 records have no usable `Request_Ref`.

Impact:

- Workload by owner is incomplete.
- Next-action ownership cannot be assigned reliably.
- Joining task records to promo and QC records is limited.

### 7. QC exists, but it is a separate unconnected source

The live `QC Results Log` contains 1,331 records and useful verdict fields. It is located in `PromoOps Data`, not the control-layer spreadsheet read by the dashboard.

Observed join coverage:

- 69 distinct P-number handles were identifiable in the QC log.
- 21 distinct P-number handles were identifiable in task request references.
- Only 9 handles appeared in both sources.

Impact: QC health cannot yet be reported as task-level truth. A canonical task-to-promo join key or bridge table is required.

### 8. Automation health is not yet an operations-wide data source

The control-layer workbook does not currently contain `Automation_Logs`. The dashboard code creates that tab when dashboard-controlled actions run, but this does not automatically include the promo automation programs running outside the Apps Script dashboard.

Impact: a dashboard automation-health card built from this tab alone would report only a subset of automations.

### 9. Some filters are presented but not applied

The UI collects Request Type and Language selections, but the current `applyFilters` function does not evaluate either field.

Impact: users can select a filter and receive an unchanged result without an error.

### 10. The local dashboard source contains a malformed task-source link expression

The task-detail renderer contains a corrupted expression in the `Source_Link` branch. The deployed Apps Script version must be compared with the local source before relying on task-detail behaviour.

## Required remediation order

### Gate 1 — Canonical data contract

Define one dashboard record shape and normalize all source records at read time:

- `dueAt` from `Due_Date`
- `status` mapped to the approved lifecycle
- `priority` mapped to P1–P4
- timestamps parsed into ISO 8601 with an explicit timezone
- normalized owner identifier plus display name
- stable task ID and optional request/promo handles

Do not rewrite historical source cells until the normalized read layer has been validated.

### Gate 2 — Complete retrieval

- Remove the hard latest-20 truncation from the data contract.
- Add server-side pagination for display performance.
- Return total record count and returned record count separately.
- Make filters execute against the full population.
- Make exports explicitly export either all matching records or the current page.

### Gate 3 — Source joins

- Add an explicit task-to-promo bridge using Task ID, Request Ref, promo handle, promo code, and brand.
- Measure matched, unmatched, and ambiguous QC rows.
- Connect operations-wide automation runs using a standard automation name, run ID, task/request reference, status, start/end time, and owner.

### Gate 4 — Freshness and health

Every response should report:

- generated-at timestamp in Malaysia time
- latest task update
- latest QC event
- latest automation event
- latest weekly report
- source read status and record count
- validation warnings and rejected-row count

### Gate 5 — Shadow validation

Run the normalized pull alongside the existing dashboard without replacing it. For at least five working days:

- compare status totals with source sheets
- compare task samples row by row
- reconcile every difference
- confirm timezone behaviour around midnight
- confirm new records appear within the expected refresh interval

## Acceptance criteria before dashboard enhancement

The data layer is ready only when all of the following pass:

1. 100% of populated Task IDs are returned or intentionally excluded with a recorded reason.
2. Dashboard totals match independently calculated source totals.
3. 100% of status and priority values are either normalized or quarantined as validation errors.
4. Every displayed deadline is machine-parseable and shown in Malaysia time.
5. Missing owner, due date, and timestamps are counted and visible as data-quality warnings.
6. QC linkage coverage is published and unmatched records are visible.
7. Automation-health coverage lists exactly which programs are included and excluded.
8. Every source displays a last-updated timestamp and stale threshold.
9. Filters are covered by tests against the full dataset.
10. Five working days of shadow comparison produce no unexplained mismatches.

## Recommended next implementation

Build a read-only normalization and validation layer first. It should produce both:

- the canonical dataset consumed by the future dashboard; and
- a compact data-health response containing source counts, rejected rows, unmapped values, join coverage, and freshness.

The dashboard redesign and SLA calculations should remain blocked until the acceptance criteria above are met.
