// Reads the permanent sheet ID from ops-sheet-id.local.json.
// Created once by: node bin/setup-permanent-sheet.mjs
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const CONFIG_FILE = path.resolve('ops-sheet-id.local.json');

export function getOpsSheetId() {
  if (!existsSync(CONFIG_FILE)) {
    throw new Error(
      `ops-sheet-id.local.json not found.\n` +
      `Run: node bin/setup-permanent-sheet.mjs\n` +
      `to create the permanent PromoOps Data sheet.`
    );
  }
  const cfg = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
  if (!cfg.sheetId) throw new Error(`ops-sheet-id.local.json is missing sheetId.`);
  return cfg.sheetId;
}
