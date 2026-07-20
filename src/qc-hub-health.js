/**
 * checkHealth(opts)
 *
 * Checks that the QC Hub is running and correctly configured.
 * Verifies /api/config responds with HTTP 200, devMode=false, and a
 * non-empty googleClientId.  Never prints the client ID or any other
 * configuration value.
 *
 * @param {object}   opts
 * @param {number}   opts.port       - Hub port (default 4321)
 * @param {Function} opts.fetch      - fetch implementation (injectable for tests)
 * @param {number}   opts.timeoutMs  - Connection timeout in ms (default 5000)
 * @returns {Promise<true>}
 *
 * Throws a coded Error on any failure.
 * Error codes: TIMEOUT, CONNECT_ERROR, HTTP_ERROR, PARSE_ERROR, DEV_MODE, NO_CLIENT_ID
 */
export async function checkHealth({
  port = 4321,
  fetch: fetchImpl = globalThis.fetch,
  timeoutMs = 5000,
} = {}) {
  const url = `http://localhost:${port}/api/config`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  let res;
  try {
    res = await fetchImpl(url, { signal: ctrl.signal });
  } catch (err) {
    clearTimeout(timer);
    throw new Error(err.name === 'AbortError' ? 'TIMEOUT' : 'CONNECT_ERROR');
  }
  clearTimeout(timer);

  if (!res.ok) throw new Error(`HTTP_ERROR: ${res.status}`);

  let body;
  try {
    body = await res.json();
  } catch {
    throw new Error('PARSE_ERROR');
  }

  if (body.devMode === true) throw new Error('DEV_MODE');
  if (!body.googleClientId) throw new Error('NO_CLIENT_ID');

  return true;
}
