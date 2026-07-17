import { mkdir, writeFile } from 'node:fs/promises';
import crypto from 'node:crypto';

const DIR = 'captures/qc-dashboard/fix-requests';

export async function dispatchFixRequest({ brand, code, finding, expected, actual, snapshotPath, requestedBy }) {
  await mkdir(DIR, { recursive: true });
  const uuid = crypto.randomUUID();
  const record = {
    uuid,
    brand,
    code,
    finding,
    expected: expected ?? finding?.expected ?? '',
    actual: actual ?? finding?.actual ?? '',
    snapshotPath: snapshotPath || '',
    requestedBy,
    ts: new Date().toISOString(),
  };
  const path = `${DIR}/${uuid}.json`;
  await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return { uuid, path, record };
}
