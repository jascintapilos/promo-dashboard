#!/usr/bin/env node
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';
const site = getSite('qpro2');
const r = await authedFetch(site, '/api/bo/promotion/468');
const p = r.data?.rows;
console.log(JSON.stringify(p, null, 2));
