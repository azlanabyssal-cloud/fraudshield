/* What the tool is doing, measured on the device and never sent anywhere.
   A security tool that cannot say how it is behaving has no evidence of working. But a verdict tool must not phone home with what people paste into it, and this one
   makes the browser refuse to (Content-Security-Policy, ADR-0015). So observability here is local: every verdict leaves an event in a small ring buffer, and a summary of
   those events (how many verdicts of each level, which rules fired most, how long they took, whether the name model and the text reader are healthy, which errors happened) can be read on the page
   and copied by the person if they choose to share it. Nothing is transmitted by this code.
   The one hard rule: an event can hold only fixed, enumerated, size-capped facts. No message text, no link, no number, no filename can get in: record() copies named fields and
   drops everything else, and tests/ops.test.js feeds it hostile objects to prove that. Timestamps are rounded to the minute. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FraudShieldOps = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const SCHEMA = 1;
const KINDS = ['message', 'link', 'qr', 'ocr', 'followup', 'faq', 'unanswered', 'voice', 'error', 'model'];
const LEVELS = ['scam', 'suspicious', 'unverified', 'official', 'nothing'];
const MODEL_STATES = ['applied', 'not-loaded', 'not-applicable'];
const WORD = /^[a-z][a-z0-9-]{0,31}$/;   // a rule id, a family, a topic, an error code: a short lower-case slug, never free text
const SLO_P95_MS = 50;                    // docs/SPEC.md section 5
const SLO_MIN_SAMPLES = 5;                // a percentile of three numbers is not a service level

const slug = x => (typeof x === 'string' && WORD.test(x) ? x : null);
// A slug that looks fine is still free text if someone typed it, so where a list of the values the tool really uses is given, anything else is recorded as "other".
const known = (x, list) => { const v = slug(x); return v && list && list.indexOf(v) < 0 ? 'other' : v; };

// Every code the link and payment analyzers can emit (checked against the source in tests/ops.test.js), and the codes of errors the page records.
const LINK_CODES = ['action-words', 'amount', 'apk', 'app-link', 'backslash', 'bad-payee', 'brand-in-path', 'cheap-tld', 'code-scheme', 'deep-subdomain', 'duplicate-pa', 'duplicate-am', 'embedded-official', 'empty', 'forwards-to', 'free-tld', 'hidden-characters', 'homoglyph', 'hyphens', 'impersonation',
  'mandate', 'mixed-script', 'name-model', 'no-tls', 'official-in-query', 'other', 'other-email', 'other-scheme', 'other-tel', 'other-sms', 'other-smsto', 'other-mailto', 'other-geo', 'other-wifi', 'payee-impersonation', 'phone', 'pretext', 'raw-ip', 'shortener', 'text', 'typosquat', 'unknown-action', 'unparseable', 'userinfo', 'other-link'];
const ERROR_CODES = ['ocr-failed', 'ocr-module-missing', 'prepare-unreadable', 'prepare-too-large', 'qr-failed', 'model-failed', 'model-invalid', 'speech-unavailable', 'storage-failed', 'other'];
const num = (x, max) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.min(Math.round(x * 100) / 100, max) : null);
const pick = (x, list) => (list.indexOf(x) >= 0 ? x : null);

// Copies the allowed fields of a raw event and nothing else. Returns null if the event has no valid kind.
function clean(raw, now, lists) {
  if (!raw || typeof raw !== 'object') return null;
  const kind = pick(raw.kind, KINDS); if (!kind) return null;
  const e = { t: Math.floor(now / 60000) * 60000, kind };
  const level = pick(raw.level, LEVELS); if (level) e.level = level;
  const L = lists || {}, family = known(raw.family, L.family); if (family) e.family = family;
  if (Array.isArray(raw.rules)) { const r = raw.rules.map(x => known(x, L.rules)).filter(Boolean).slice(0, 12); if (r.length) e.rules = r; }
  const ms = num(raw.ms, 600000); if (ms !== null) e.ms = ms;
  const nm = pick(raw.nameModel, MODEL_STATES); if (nm) e.nameModel = nm;
  const topic = known(raw.topic, L.topic); if (topic) e.topic = topic;
  const code = known(raw.code, L.code); if (code) e.code = code;
  if (raw.hot === true || raw.hot === false) e.hot = raw.hot;
  return e;
}

const percentile = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : null);
const bump = (obj, key) => { obj[key] = (obj[key] || 0) + 1; };

// env: { now(), storage (optional: a sessionStorage-like object), key, capacity, known: { family, rules, topic, code } (lists of the values the tool really uses) }
function createOps(env) {
  const now = (env && env.now) || Date.now, lists = (env && env.known) || null, storage = env && env.storage, key = (env && env.key) || 'fs_ops_v1', capacity = (env && env.capacity) || 300;
  let events = [], since = Math.floor(now() / 60000) * 60000;
  if (storage) { try { const saved = JSON.parse(storage.getItem(key)); if (saved && saved.schema === SCHEMA && Array.isArray(saved.events)) { events = saved.events.map(e => clean(e, e && e.t, lists)).filter(Boolean).slice(-capacity); since = typeof saved.since === 'number' ? saved.since : since; } } catch (e) { /* nothing saved, or damaged: start empty */ } }
  const save = () => { if (storage) { try { storage.setItem(key, JSON.stringify({ schema: SCHEMA, since, events })); } catch (e) { /* storage full or blocked: the buffer in memory still works */ } } };

  function record(raw) {
    const e = clean(raw, now(), lists); if (!e) return false;
    events.push(e); if (events.length > capacity) events = events.slice(-capacity);
    save(); return true;
  }

  // Everything a person (or a maintainer, if they are sent it) needs to judge how the tool is doing, with no message in it.
  function summary(extra) {
    const byKind = {}, byLevel = {}, byFamily = {}, byRule = {}, errors = {}, nameModel = {}, topics = {}, faq = {}, lat = [], ocrMs = []; let ocrRuns = 0, ocrHot = 0;
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
      latencyMs: { samples: lat.length, p50: percentile(lat, 0.5), p95, p99: percentile(lat, 0.99), max: lat.length ? lat[lat.length - 1] : null },
      slo: { p95BudgetMs: SLO_P95_MS, status: !enough ? 'not-enough-data' : p95 <= SLO_P95_MS ? 'met' : 'breached', samples: lat.length },
      nameModel, ocr: { runs: ocrRuns, hotShare: ocrRuns ? Math.round(1000 * ocrHot / ocrRuns) / 1000 : null, p50Ms: percentile(ocrMs, 0.5) },
      errors, ...(extra || {})
    };
  }

  function clear() { events = []; since = Math.floor(now() / 60000) * 60000; if (storage) { try { storage.removeItem(key); } catch (e) { /* ignore */ } } }
  return { record, summary, clear, get size() { return events.length; }, get events() { return events.slice(); } };
}

return { SCHEMA, KINDS, LEVELS, SLO_P95_MS, SLO_MIN_SAMPLES, LINK_CODES, ERROR_CODES, clean, createOps };
}));
