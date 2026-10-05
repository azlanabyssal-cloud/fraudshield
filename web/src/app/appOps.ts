import { FAMILIES, RULE_IDS } from '../adapters/analyzers';
import { TOPICS } from '../engine/followup';
import { ENTRIES } from '../engine/knowledge';
import * as O from '../engine/ops';

export type Ops = ReturnType<typeof O.createOps>;
export const OPS_KEY = 'fs_ops_v1';

const tabStorage = (): O.StorageLike | null => { try { return window.sessionStorage; } catch { return null; } };

/** The on-device record of what the tool did: counts and timings, never words. The lists name the values the tool really uses, so anything else is stored as "other". */
export function createAppOps(storage: O.StorageLike | null = tabStorage()): Ops {
  return O.createOps({
    storage,
    key: OPS_KEY,
    known: {
      family: Object.keys(FAMILIES),
      rules: [...RULE_IDS, 'link-scam', 'link-suspicious', 'link-unverified', ...O.LINK_CODES],
      topic: [...TOPICS.map(t => t[0]), ...ENTRIES.map(e => e.id.replace(/_/g, '-'))],
      code: O.ERROR_CODES
    }
  });
}
