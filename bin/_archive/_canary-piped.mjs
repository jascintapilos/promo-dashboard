#!/usr/bin/env node
// Tactical wrapper around canary-write.js so it can be driven from a non-TTY
// background process. Watches `canary-input.tmp` for newly appended lines and
// forwards them to the canary's stdin. Child output streams to this process's
// stdout/stderr (which the launching shell can redirect to a log file).
//
// Usage:
//   node bin/_canary-piped.mjs <REQUEST_ID> [--commit] [--site=<id>]
//
// Send an input from another shell / file write:
//   echo go    >> canary-input.tmp
//   echo next  >> canary-input.tmp
//   echo saved >> canary-input.tmp

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const inFile = path.resolve('canary-input.tmp');
// Reset on launch so stale content from a prior run doesn't auto-advance.
fs.writeFileSync(inFile, '');

const args = process.argv.slice(2);
console.log(`[piped-runner] spawning: node bin/canary-write.js ${args.join(' ')}`);
console.log(`[piped-runner] stdin source: ${inFile}`);

const proc = spawn('node', ['bin/canary-write.js', ...args], {
  stdio: ['pipe', 'inherit', 'inherit'],
});

let lastSize = 0;
const poll = setInterval(() => {
  try {
    const s = fs.statSync(inFile);
    if (s.size > lastSize) {
      const newContent = fs.readFileSync(inFile, 'utf8').slice(lastSize);
      lastSize = s.size;
      console.log(`[piped-runner] → canary stdin: ${JSON.stringify(newContent)}`);
      proc.stdin.write(newContent);
    }
  } catch {
    // input file vanished — ignore until next tick
  }
}, 250);

proc.on('exit', (code, signal) => {
  clearInterval(poll);
  console.log(`\n[piped-runner] canary exited code=${code} signal=${signal ?? 'null'}`);
  try { fs.unlinkSync(inFile); } catch {}
  process.exit(code ?? 0);
});

proc.on('error', (err) => {
  console.error(`[piped-runner] spawn error: ${err.message}`);
  clearInterval(poll);
  process.exit(1);
});
