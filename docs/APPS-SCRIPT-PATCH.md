# Apps Script patch — BO status update endpoint

This adds a single new POST route to your existing Promo Ops Apps Script
so the canary bot can mark a task as `QC_Required` (or any other status)
after it finishes a BO write.

## What you'll do (2 minutes)

1. Open the Apps Script editor:
   <https://script.google.com/u/0/home/projects/19iYZt9HzzqofN8Z5oqcv0nzT00F4VCyJr_inZZqMCoQ13D-zne4ir8vs/edit>
2. Open `Code.gs`.
3. **Edit `doPost`** — add one line near the top of the `try` block.
4. **Paste a new function** anywhere in the file (the bottom is fine).
5. **Deploy → Manage deployments → Edit → Version: New version → Deploy**.
6. The deployment URL stays the same; the bot just gets a new behaviour.

---

## Patch #1 — `doPost` (one new line)

Find this block (around line 857):

```javascript
function doPost(e) {
  try {
    const source = (e.parameter && e.parameter.source) || '';
    const body = JSON.parse(e.postData.contents);
    if (source === 'slack') return handleSlackEvent(body);
    if (source === 'telegram') return handleTelegramUpdate(body);
    const result = handleGuestSubmission(body);
    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ok:false, error:String(err)})).setMimeType(ContentService.MimeType.JSON);
  }
}
```

Add the **`bo_status`** branch between the `telegram` line and the `handleGuestSubmission` line:

```javascript
function doPost(e) {
  try {
    const source = (e.parameter && e.parameter.source) || '';
    const body = JSON.parse(e.postData.contents);
    if (source === 'slack') return handleSlackEvent(body);
    if (source === 'telegram') return handleTelegramUpdate(body);
    if (source === 'bo_status') {                                                       // ← NEW
      return ContentService.createTextOutput(JSON.stringify(handleBoStatusUpdate(body)))// ← NEW
        .setMimeType(ContentService.MimeType.JSON);                                     // ← NEW
    }                                                                                   // ← NEW
    const result = handleGuestSubmission(body);
    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ok:false, error:String(err)})).setMimeType(ContentService.MimeType.JSON);
  }
}
```

## Patch #2 — new function (paste at the bottom of `Code.gs`)

```javascript
// ─── BO Status Update endpoint ────────────────────────────────────────
// Accepts POST /exec?source=bo_status with JSON body:
//   {
//     "task_id":     "T-2026-0042",           // OR request_ref
//     "request_ref": "P069-r77",              // optional, used if task_id missing
//     "status":      "QC"  | "QC_Required" | "Completed" | "Failed_Escalated" ...,
//     "notes":       "Canary write complete; operator clicked Save"   // optional
//   }
// Short status names ("QC", "COMPLETED") are auto-resolved to the canonical
// STATUS values stored in Task_Master.
function handleBoStatusUpdate(body) {
  const taskId     = body.task_id     || '';
  const requestRef = body.request_ref || '';
  const statusKey  = body.status      || '';
  const notes      = body.notes       || '';

  const resolved = STATUS[String(statusKey).toUpperCase()] || statusKey;
  if (!Object.values(STATUS).includes(resolved)) {
    return {ok:false, error:'unknown status: ' + statusKey + '. Valid keys: ' + Object.keys(STATUS).join('|')};
  }
  if (!taskId && !requestRef) {
    return {ok:false, error:'provide task_id or request_ref'};
  }

  let foundTaskId = taskId;
  if (!foundTaskId) {
    const data = TASK_MASTER.getDataRange().getValues();
    const headers = data[0];
    const tIdx   = headers.indexOf('Task_ID');
    const refIdx = headers.indexOf('Request_Ref');
    for (let i = 1; i < data.length; i++) {
      if (data[i][refIdx] === requestRef) { foundTaskId = data[i][tIdx]; break; }
    }
  }
  if (!foundTaskId) return {ok:false, error:'no task found for the supplied identifiers'};

  const row = readRow(foundTaskId);
  if (!row) return {ok:false, error:'task ' + foundTaskId + ' not in Task_Master'};

  const prev = row.Status;
  setStatus(foundTaskId, resolved);
  if (notes) writeCell(foundTaskId, 'Notes', notes);
  logAction(foundTaskId, 'bo_status_update_external', prev, resolved, notes);

  return {ok:true, task_id: foundTaskId, previous_status: prev, new_status: resolved};
}
```

## How to test (after redeploy)

Apps Script reads `source` from the URL query string (via `e.parameter.source`),
not from the JSON body. So the test URL **must** include `?source=bo_status`.

In a PowerShell terminal:

```powershell
$url  = "$env:DASHBOARD_URL" + "?source=bo_status"
$body = @{ request_ref = "P069-r77"; status = "QC"; notes = "patch test" } | ConvertTo-Json
Invoke-RestMethod -Uri $url -Method Post -Body $body -ContentType "application/json"
```

Three response shapes tell you what happened:

- **Patch live + task exists:** `ok = true, task_id = T-…, previous_status = …, new_status = QC_Required` ✅
- **Patch live but no matching task:** `ok = false, error = "no task found for the supplied identifiers"` — the patch is deployed correctly; you just don't have a Task_Master row with `Request_Ref=P069-r77` yet (or pass `task_id = "T-..."` instead).
- **Patch not deployed yet** (you'll see HTML instead of JSON, or get back a "Request received." guest-submission message) — the route isn't live. Re-check that you saved `Code.gs` AND clicked **Deploy → Manage deployments → Edit → Version: New version → Deploy** (just clicking Save doesn't publish).

## Notes

- The handler is **additive**. It doesn't touch any existing code path.
- It uses the existing `setStatus`, `readRow`, `writeCell`, and `logAction`
  helpers, so the audit log and `Status_Updated_At` timestamp work
  automatically.
- Short status names (`QC`, `COMPLETED`, `FAILED`) are auto-resolved to
  their canonical `STATUS.*` values, so the bot doesn't need to know the
  exact strings like `QC_Required`.
- Notes are written to the `Notes` column on the task row, and also
  appear in the Action Log via `logAction`.
