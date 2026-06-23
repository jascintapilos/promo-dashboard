import { getGoogleAuth } from '../src/google-auth.js';
const SCRIPT_ID = '1G8PrjOQ45yafM4lo3dL1AG8HKFSZ8tSlX7ei9EPZgw6bacjHk5CPtTW_';
const { client } = await getGoogleAuth();
const tok = (await client.getAccessToken()).token;
const res = await fetch(`https://script.googleapis.com/v1/projects/${SCRIPT_ID}/content`, {
  headers: { Authorization: 'Bearer ' + tok },
});
const proj = await res.json();
const dash = proj.files.find(f => f.name === 'Dashboard').source;
console.log('Has openTaskDrawer onclick:', /onclick="openTaskDrawer\(/.test(dash));
console.log('Has showTaskDetail onclick:', /onclick="showTaskDetail\(/.test(dash));
console.log('window.openTaskDrawer assigned:', /window\.openTaskDrawer\s*=/.test(dash));
console.log('Has TASK_DRAWER_INJECT_BEGIN:', dash.includes('TASK_DRAWER_INJECT_BEGIN'));
