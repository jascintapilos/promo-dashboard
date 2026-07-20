const DEFAULT_MAX_BYTES = 32768; // 32 KB

export async function readJsonBounded(req, maxBytes = DEFAULT_MAX_BYTES) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      if (typeof req.resume === 'function') req.resume();
      throw Object.assign(new Error('Request body too large'), { status: 413 });
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('Invalid JSON in request body'), { status: 400 });
  }
}
