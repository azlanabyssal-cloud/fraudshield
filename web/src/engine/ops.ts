/* What the tool is doing, measured on the device and never sent anywhere.
   A security tool that cannot say how it is behaving has no evidence of working. But a verdict tool must not phone home with what people paste into it, and this one
   makes the browser refuse to (Content-Security-Policy, ADR-0015). So observability here is local: every verdict leaves an event in a small ring buffer, and a summary of
   those events (how many verdicts of each level, which rules fired most, how long they took, whether the name model and the text reader are healthy, which errors happened) can be read on the page
   and copied by the person if they choose to share it. Nothing is transmitted by this code.
   The one hard rule: an event can hold only fixed, enumerated, size-capped facts. No message text, no link, no number, no filename can get in: record() copies named fields and
   drops everything else, and tests/ops.test.js feeds it hostile objects to prove that. Timestamps are rounded to the minute. */

export const SCHEMA = 1;
export const KINDS = ['message', 'link', 'qr', 'ocr', 'followup', 'faq', 'unanswered', 'voice', 'error', 'model'] as const;
export const LEVELS = ['scam', 'suspicious', 'unverified', 'official', 'nothing'] as const;
const MODEL_STATES = ['applied', 'not-loaded', 'not-applicable'] as const;
export type Kind = (typeof KINDS)[number];
export type Level = (typeof LEVELS)[number];
export type ModelState = (typeof MODEL_STATES)[number];
const WORD = /^[a-z][a-z0-9-]{0,31}$/;   // a rule id, a family, a topic, an error code: a short lower-case slug, never free text
export const SLO_P95_MS = 50;             // docs/SPEC.md section 5
export const SLO_MIN_SAMPLES = 5;         // a percentile of three numbers is not a service level

/** One recorded event. Every field is optional except the time and the kind, and none can hold free text. */
export interface OpsEvent { t: number; kind: Kind; level?: Level; family?: string; rules?: string[]; ms?: number; nameModel?: ModelState; topic?: string; code?: string; hot?: boolean }
/** The values the tool really uses, so that anything else is stored as "other". */
export interface KnownLists { family?: readonly string[]; rules?: readonly string[]; topic?: readonly string[]; code?: readonly string[] }
/** The part of sessionStorage this module needs. */
export interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
export interface OpsEnv { now?: () => number; storage?: StorageLike | null; key?: string; capacity?: number; known?: KnownLists | null }
type Counts = Record<string, number>;
export interface OpsSummary {
  schema: number; note: string; since: string; events: number; verdicts: number; flaggedShare: number | null;
  byKind: Counts; byLevel: Counts; byFamily: Counts; topRules: { rule: string; count: number }[]; followUps: Counts;
  questions: { answered: number; unanswered: number; topics: Counts };
  latencyMs: { samples: number; p50: number | null; p95: number | null; p99: number | null; max: number | null };
  slo: { p95BudgetMs: number; status: 'not-enough-data' | 'met' | 'breached'; samples: number };
  nameModel: Counts; ocr: { runs: number; hotShare: number | null; p50Ms: number | null }; errors: Counts;
  [extra: string]: unknown;
}

const slug = (x: unknown): string | null => (typeof x === 'string' && WORD.test(x) ? x : null);
// A slug that looks fine is still free text if someone typed it, so where a list of the values the tool really uses is given, anything else is recorded as "other".
const known = (x: unknown, list: readonly string[] | undefined): string | null => { const v = slug(x); return v && list && list.indexOf(v) < 0 ? 'other' : v; };

// Every code the link and payment analyzers can emit (checked against the source in tests/ops.test.js), and the codes of errors the page records.
export const LINK_CODES: readonly string[] = ['action-words', 'amount', 'apk', 'app-link', 'backslash', 'bad-payee', 'brand-in-path', 'cheap-tld', 'code-scheme', 'deep-subdomain', 'duplicate-pa', 'duplicate-am', 'embedded-official', 'empty', 'forwards-to', 'free-tld', 'hidden-characters', 'homoglyph', 'hyphens', 'impersonation',
  'mandate', 'mixed-script', 'name-model', 'no-tls', 'official-in-query', 'other', 'other-email', 'other-scheme', 'other-tel', 'other-sms', 'other-smsto', 'other-mailto', 'other-geo', 'other-wifi', 'payee-impersonation', 'phone', 'pretext', 'raw-ip', 'shortener', 'text', 'typosquat', 'unknown-action', 'unparseable', 'userinfo', 'other-link'];
export const ERROR_CODES: readonly string[] = ['ocr-failed', 'ocr-module-missing', 'prepare-unreadable', 'prepare-too-large', 'qr-failed', 'model-failed', 'model-invalid', 'speech-unavailable', 'storage-failed', 'other'];
const num = (x: unknown, max: number): number | null => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.min(Math.round(x * 100) / 100, max) : null);
const pick = <T extends string>(x: unknown, list: readonly T[]): T | null => (list.indexOf(x as T) >= 0 ? (x as T) : null);

// Copies the allowed fields of a raw event and nothing else. Returns null if the event has no valid kind.
export function clean(raw: unknown, now: number, lists?: KnownLists | null): OpsEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const kind = pick(r.kind, KINDS); if (!kind) return null;
  const e: OpsEvent = { t: Math.floor(now / 60000) * 60000, kind };
  const level = pick(r.level, LEVELS); if (level) e.level = level;
  const L: KnownLists = lists || {}, family = known(r.family, L.family); if (family) e.family = family;
  if (Array.isArray(r.rules)) { const rules = r.rules.map(x => known(x, L.rules)).filter((x): x is string => !!x).slice(0, 12); if (rules.length) e.rules = rules; }
  const ms = num(r.ms, 600000); if (ms !== null) e.ms = ms;
  const nm = pick(r.nameModel, MODEL_STATES); if (nm) e.nameModel = nm;
  const topic = known(r.topic, L.topic); if (topic) e.topic = topic;
  const code = known(r.code, L.code); if (code) e.code = code;
  if (r.hot === true || r.hot === false) e.hot = r.hot;
  return e;
}

const percentile = (sorted: readonly number[], q: number): number | null => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? null : null);
const bump = (obj: Counts, key: string): void => { obj[key] = (obj[key] || 0) + 1; };

// env: { now(), storage (optional: a sessionStorage-like object), key, capacity, known: { family, rules, topic, code } (lists of the values the tool really uses) }
export function createOps(env?: OpsEnv) {
  const now = (env && env.now) || Date.now, lists = (env && env.known) || null, storage = env && env.storage, key = (env && env.key) || 'fs_ops_v1', capacity = (env && env.capacity) || 300;
  let events: OpsEvent[] = [], since = Math.floor(now() / 60000) * 60000;
  if (storage) {
    try {
      const saved: unknown = JSON.parse(storage.getItem(key) ?? 'null');
      const s = saved as { schema?: unknown; events?: unknown; since?: unknown } | null;
      if (s && s.schema === SCHEMA && Array.isArray(s.events)) {
        events = (s.events as unknown[]).map(e => clean(e, (e as { t?: number } | null)?.t ?? 0, lists)).filter((e): e is OpsEvent => e !== null).slice(-capacity);
        since = typeof s.since === 'number' ? s.since : since;
      }
    } catch (e) { /* nothing saved, or damaged: start empty */ }
  }
  const save = (): void => { if (storage) { try { storage.setItem(key, JSON.stringify({ schema: SCHEMA, since, events })); } catch (e) { /* storage full or blocked: the buffer in memory still works */ } } };

  function record(raw: unknown): boolean {
    const e = clean(raw, now(), lists); if (!e) return false;
    events.push(e); if (events.length > capacity) events = events.slice(-capacity);
    save(); return true;
  }

  // Everything a person (or a maintainer, if they are sent it) needs to judge how the tool is doing, with no message in it.
  function summary(extra?: Record<string, unknown>): OpsSummary {
    const byKind: Counts = {}, byLevel: Counts = {}, byFamily: Counts = {}, byRule: Counts = {}, errors: Counts = {}, nameModel: Counts = {}, topics: Counts = {}, faq: Counts = {}, lat: number[] = [], ocrMs: number[] = []; let ocrRuns = 0, ocrHot = 0;
    for (const e of events) {
      bump(byKind, e.kind);
      if (e.kind === 'message' || e.kind === 'link' || e.kind === 'qr') { if (e.level) bump(byLevel, e.level); if (e.family) bump(byFamily, e.family); for (const r of e.rules || []) bump(byRule, r); }
      if ((e.kind === 'message' || e.kind === 'link') && typeof e.ms === 'number') lat.push(e.ms);
      if (e.kind === 'link' && e.nameModel) bump(nameModel, e.nameModel);
      if (e.kind === 'ocr') { ocrRuns++; if (e.hot) ocrHot++; if (typeof e.ms === 'number') ocrMs.push(e.ms); }
      if (e.kind === 'error' || (e.kind === 'model' && e.code)) bump(errors, e.code || 'unknown');
      if (e.kind === 'followup' && e.topic) bump(topics, e.topic);
      if (e.kind === 'faq' && e.topic) bump(faq, e.topic);
    }
    lat.sort((a, b) => a - b); ocrMs.sort((a, b) => a - b);
    const topRules = Object.entries(byRule).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 10).map(([rule, count]) => ({ rule, count }));
    const p95 = percentile(lat, 0.95), enough = lat.length >= SLO_MIN_SAMPLES;
    const flagged = (byLevel.scam || 0) + (byLevel.suspicious || 0), judged = events.filter(e => e.kind === 'message' || e.kind === 'link' || e.kind === 'qr').length;
    return {
      schema: SCHEMA, note: 'Counts and timings only. No message, link, number or file name is ever recorded. Nothing is sent anywhere by this tool.',
      since: new Date(since).toISOString().slice(0, 16) + 'Z', events: events.length, verdicts: judged, flaggedShare: judged ? Math.round(1000 * flagged / judged) / 1000 : null,
      byKind, byLevel, byFamily, topRules, followUps: topics,
      questions: { answered: byKind.faq || 0, unanswered: byKind.unanswered || 0, topics: faq },
      latencyMs: { samples: lat.length, p50: percentile(lat, 0.5), p95, p99: percentile(lat, 0.99), max: lat.length ? lat[lat.length - 1] ?? null : null },
      slo: { p95BudgetMs: SLO_P95_MS, status: !enough || p95 === null ? 'not-enough-data' : p95 <= SLO_P95_MS ? 'met' : 'breached', samples: lat.length },
      nameModel, ocr: { runs: ocrRuns, hotShare: ocrRuns ? Math.round(1000 * ocrHot / ocrRuns) / 1000 : null, p50Ms: percentile(ocrMs, 0.5) },
      errors, ...(extra || {})
    };
  }

  function clear(): void { events = []; since = Math.floor(now() / 60000) * 60000; if (storage) { try { storage.removeItem(key); } catch (e) { /* ignore */ } } }
  return { record, summary, clear, get size() { return events.length; }, get events() { return events.slice(); } };
}
