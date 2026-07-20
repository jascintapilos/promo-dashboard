import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Readable } from 'node:stream';
import { readJsonBounded } from '../src/qc-dashboard/read-json.js';

// ── readJsonBounded — unit tests (no server) ──────────────────────────────────

function fakeStream(str) {
  return Readable.from(str ? [Buffer.from(str)] : []);
}

test('readJsonBounded returns {} for empty body', async () => {
  const result = await readJsonBounded(fakeStream(''));
  assert.deepEqual(result, {});
});

test('readJsonBounded parses valid JSON', async () => {
  const result = await readJsonBounded(fakeStream('{"brand":"QP2A","code":"X"}'));
  assert.deepEqual(result, { brand: 'QP2A', code: 'X' });
});

test('readJsonBounded throws 413 when body exceeds limit', async () => {
  const big = 'x'.repeat(33000);
  await assert.rejects(
    () => readJsonBounded(fakeStream(big), 32768),
    (err) => {
      assert.equal(err.status, 413, 'status must be 413');
      assert.match(err.message, /too large/i);
      return true;
    },
  );
});

test('readJsonBounded throws 400 for malformed JSON', async () => {
  await assert.rejects(
    () => readJsonBounded(fakeStream('{not valid}')),
    (err) => {
      assert.equal(err.status, 400, 'status must be 400');
      assert.match(err.message, /Invalid JSON/i);
      return true;
    },
  );
});

// ── HTTP-layer tests — minimal test server ────────────────────────────────────

async function startTestServer() {
  const server = http.createServer(async (req, res) => {
    try {
      if (req.url === '/throw-internal') {
        throw new Error('secret stack trace at C:\\Users\\vdiuser\\secret\\file.js:42');
      }
      const maxBytes = req.url === '/fix-request' ? 65536 : 32768;
      const body = await readJsonBounded(req, maxBytes);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    } catch (e) {
      const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: status < 500 ? e.message : 'Internal server error' }));
    }
  });
  await new Promise((resolve) => server.listen(0, 'localhost', resolve));
  const { port } = server.address();
  return { server, port };
}

async function post(port, path, body, extraHeaders = {}) {
  const res = await fetch(`http://localhost:${port}${path}`, {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json', ...extraHeaders },
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

test('malformed JSON body returns HTTP 400', async () => {
  const { server, port } = await startTestServer();
  try {
    const { status, data } = await post(port, '/echo', '{invalid json');
    assert.equal(status, 400);
    assert.ok(data.error, 'error field missing');
    assert.match(data.error, /JSON/i);
  } finally {
    server.close();
  }
});

test('oversized body returns HTTP 413', async () => {
  const { server, port } = await startTestServer();
  try {
    const { status, data } = await post(port, '/echo', 'x'.repeat(33000));
    assert.equal(status, 413);
    assert.ok(data.error, 'error field missing');
    assert.match(data.error, /too large/i);
  } finally {
    server.close();
  }
});

test('413 error response does not leak stack traces or filesystem paths', async () => {
  const { server, port } = await startTestServer();
  try {
    const { data } = await post(port, '/echo', 'x'.repeat(33000));
    const body = JSON.stringify(data);
    assert.ok(!body.includes('node_modules'), 'must not leak node_modules path');
    assert.ok(!body.includes('at '), 'must not contain stack frame lines');
    assert.ok(!body.toLowerCase().includes('traceback'), 'must not contain traceback');
  } finally {
    server.close();
  }
});

test('genuine server failure returns HTTP 500 with generic message', async () => {
  const { server, port } = await startTestServer();
  try {
    const { status, data } = await post(port, '/throw-internal', '{}');
    assert.equal(status, 500);
    assert.equal(data.error, 'Internal server error');
  } finally {
    server.close();
  }
});

test('500 response does not leak internal error message or filesystem path', async () => {
  const { server, port } = await startTestServer();
  try {
    const { data } = await post(port, '/throw-internal', '{}');
    const body = JSON.stringify(data);
    assert.ok(!body.includes('secret'), 'must not leak internal error text');
    assert.ok(!body.includes('vdiuser'), 'must not leak filesystem path');
    assert.ok(!body.includes('file.js'), 'must not leak source file name');
  } finally {
    server.close();
  }
});
