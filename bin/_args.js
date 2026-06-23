// Shared CLI arg parsing — no dependencies.
export function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (const a of argv) {
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=', 2);
      flags[k] = v ?? true;
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}
