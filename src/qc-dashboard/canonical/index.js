// Increment 4 (real-QC upgrade): canonical adapter dispatch.
// Compare engine (Increment 5) calls this — it decides which platform
// adapter to run based on the runtime metadata.

import { expectedFromSource } from './expected-adapter.js';
import { liveFromQpro } from './qpro-adapter.js';
import { liveFromQp2 } from './qp2-adapter.js';
import { liveFromIgmp } from './igmp-adapter.js';

export { expectedFromSource, liveFromQpro, liveFromQp2, liveFromIgmp };
export { CANONICAL_VERSION, BONUS_TYPES } from './canonical-model.js';

export function liveFromPlatform(platform, liveState, opts = {}) {
  switch (platform) {
    case 'qpro': return liveFromQpro(liveState, opts);
    case 'qp2':  return liveFromQp2(liveState, opts);
    case 'igmp': return liveFromIgmp(liveState, opts);
    default: throw new Error(`liveFromPlatform: unsupported platform "${platform}"`);
  }
}
