#!/usr/bin/env node
import { getGoogleAuth } from '../src/google-auth.js';
const SCRIPT_ID = '1G8PrjOQ45yafM4lo3dL1AG8HKFSZ8tSlX7ei9EPZgw6bacjHk5CPtTW_';
const { client } = await getGoogleAuth();
const tok = (await client.getAccessToken()).token;
const res = await fetch(`https://script.googleapis.com/v1/projects/${SCRIPT_ID}/content`, {
  headers: { Authorization: 'Bearer ' + tok },
});
const proj = await res.json();
const dash = proj.files.find(f => f.name === 'Dashboard').source;
console.log('Has SLACK_REFRESH_HOOK:', dash.includes('SLACK_REFRESH_HOOK'));
console.log('Has loadTasks fn:', dash.match(/function loadTasks/g)?.length || 0);
console.log('Has loadTasks calls:', dash.match(/loadTasks\(/g)?.length || 0);

// Print first 500 chars around 'Refresh' button click handlers
const refreshIdx = dash.indexOf("'Refresh'");
if (refreshIdx >= 0) {
  console.log('\nContext around \"Refresh\":');
  console.log(dash.substring(Math.max(0, refreshIdx - 200), refreshIdx + 400));
}

// Print the bottom of file (where my hook should be)
console.log('\nBottom 800 chars of Dashboard.html:');
console.log(dash.slice(-800));
