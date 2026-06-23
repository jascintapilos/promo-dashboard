# Sheets API Setup (one-time)

The bot reads + writes the Promo Code Request Details Template via a Google
service account. Once set up, the canary can post generated `promo_code`,
`promotion_name_en`, and `promotion_name_zh_id` values directly back into
the operator's row — no manual copy-paste, no XLSX re-download cycle.

This page is the one-time setup. Time required: ~10 minutes.

---

## 1. Create the service account

1. Go to https://console.cloud.google.com/projectselector2/iam-admin/serviceaccounts.
2. Pick or create a project (any project — e.g. `promo-bot`).
3. **Create service account** → name it `promo-bot-sheets` → **Create and Continue** → skip roles → **Done**.
4. Click the new account → **Keys** tab → **Add Key** → **Create new key** → **JSON** → save the file.
5. Rename the downloaded file to `google-credentials.local.json` and place it
   in the repo root next to `bo-sites.local.json`:

   ```
   C:\Users\vdiuser\Downloads\promo-automation\promo-automation\google-credentials.local.json
   ```

   (The file is in `.gitignore` — it will not be committed.)

## 2. Enable the Sheets API on the project

1. https://console.cloud.google.com/apis/library/sheets.googleapis.com
2. **Enable**.

## 3. Share the spreadsheet with the service account

1. Open `google-credentials.local.json` and copy the `client_email` value
   (looks like `promo-bot-sheets@<project>.iam.gserviceaccount.com`).
2. Open the Promo Code Request Details Template in Google Sheets.
3. **Share** → paste the service account email → **Editor** → uncheck "Notify people" → **Share**.

Repeat for any other sheet the bot needs to write to (e.g. the Banner Schedule
sheet if/when its automation lands).

## 4. Install the npm dep

```
cd promo-automation
npm install googleapis
```

(`googleapis` is the official Google client; it pulls in `google-auth-library`
which handles the JWT signing transparently.)

## 5. Verify

```
node bin/sheets-test.mjs
```

You should see:

```
SHEETS API PROBE
✓ Auth OK
  Spreadsheet: 1dqvCM9SoPLJ2iYNCQRe450wBk3S7HSHtbayuAJguodM
  Service account: promo-bot-sheets@…iam.gserviceaccount.com
✓ N tabs found:
    May 2026
    Apr 2026
    …
✓ Current-month tab: "May 2026"
✓ Header row has 33 cells
  Detected columns (field → col-letter [header-cell]):
    bonus_type               → L   [Bonus Type]
    brand                    → I   [Brand]
    promo_code               → W   [Promo Code]
    promotion_name_en        → X   [Promotion Name (EN)]
    promotion_name_zh_id     → Y   [Promotion Name (ZH / ID)]
    …
```

Then confirm write access:

```
node bin/sheets-test.mjs --write-test
```

This writes a timestamp into cell `AZ1` and immediately restores the original
value (round-trip proof of Editor access). On success:

```
▶ Write test → writing to May 2026!AZ1
  ✓ Wrote: "SHEETS_API_OK 2026-05-16T08:32:11.103Z"
  ✓ Restored original value: ""
✓ Round-trip write succeeded — the service account has Editor access.
```

## 6. Smoke-test write-back against a real row

Pick a `TEST_*` request from the captures and write its fixture values back:

```
node bin/sheets-writeback.mjs P067 --from-fixture
              # → dry-run preview, no write yet

node bin/sheets-writeback.mjs P067 --from-fixture --commit
              # → writes promo_code / promotion_name_en / promotion_name_zh_id
              #   to the May 2026 row for P067
```

Open the sheet, find P067's row, confirm the three columns updated.

---

## Troubleshooting

### `Auth failed: No Google service-account credentials found`
Place `google-credentials.local.json` in the repo root, or set
`GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/credentials.json`.

### `403 / forbidden / The caller does not have permission`
The service account is missing access to the spreadsheet. Re-share the sheet
with the `client_email` from the credentials JSON as **Editor**.

### `googleapis npm package not installed`
Run `npm install googleapis` in the repo root.

### `No current-month tab found`
Today's month doesn't match any tab name. `findCurrentMonthTab` accepts the
short form (`May 2026`) and the long form (`May 2026` / `March 2026`). If the
operator uses a different format (e.g. `2026-05`), add a regex pattern to
`findCurrentMonthTab` in `src/ingest-xlsx.js`.

### `Field "promo_code" not in current sheet header`
The header row has been renamed. Add a regex pattern to `HEADER_ALIASES` in
`src/ingest-xlsx.js`.

---

## Files added by this integration

| Path | Purpose |
|---|---|
| `src/sheets-client.js` | Auth + read/write helpers (importable from any bot CLI) |
| `bin/sheets-test.mjs` | Probe — list tabs, dump column map, optional round-trip write test |
| `bin/sheets-writeback.mjs` | Standalone write-back CLI (handle + field+value) |
| `docs/SHEETS-API-SETUP.md` | This page |
| `google-credentials.local.json` | Operator-supplied, gitignored |

The canary itself is **not** yet wired to write back automatically — that
hooks in once the auto-namer (open item B in
`memory/session_2026-05-16_part1_*`) generates the values.
