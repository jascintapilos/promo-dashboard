#!/usr/bin/env node
// Standalone health check for QC Hub.
// Usage: node bin/qc-hub-health.mjs [--port=4321]
// Exit 0: healthy. Exit 1: unhealthy.
// Prints no OAuth client IDs or other configuration values.

import { checkHealth } from '../src/qc-hub-health.js';

const portArg = process.argv.find((a) => a.startsWith('--port='));
const port = portArg
  ? parseInt(portArg.split('=')[1], 10)
  : parseInt(process.env.PORT || '4321', 10);

try {
  await checkHealth({ port });
  console.log('QC Hub is healthy.');
} catch (err) {
  const code = err.message.split(':')[0];
  switch (code) {
    case 'TIMEOUT':
      console.error('Health check failed: connection timed out.');
      break;
    case 'CONNECT_ERROR':
      console.error('Health check failed: could not connect to QC Hub.');
      break;
    case 'HTTP_ERROR':
      console.error('Health check failed: server returned an error response.');
      break;
    case 'PARSE_ERROR':
      console.error('Health check failed: server response was not valid JSON.');
      break;
    case 'DEV_MODE':
      console.error('Health check failed: server is running in dev mode.');
      break;
    case 'NO_CLIENT_ID':
      console.error('Health check failed: Google client ID is not configured.');
      break;
    default:
      console.error('Health check failed: unexpected error.');
  }
  process.exit(1);
}
