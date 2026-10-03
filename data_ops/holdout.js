'use strict';
/* Schema, CSV parsing and validation for the golden holdout dataset.
   Pure functions with no file or process access, so tests can exercise them. */

const COLUMNS = ['id', 'raw_text_scrubbed', 'language_tag', 'is_scam', 'attack_category',
  'source_platform', 'date_received', 'contains_obfuscation'];

const LANGUAGES = ['en', 'hi', 'hinglish'];
const SCAM_CATEGORIES = ['upi_collect', 'digital_arrest', 'kyc_pan_block', 'job_fraud',
  'electricity_disconnect', 'investment_scam', 'loan_app', 'sextortion', 'sim_swap', 'other_scam'];
const CATEGORIES = [...SCAM_CATEGORIES, 'safe'];
const SOURCES = ['sms', 'whatsapp', 'telegram', 'email', 'social_media', 'advisory_quote', 'other'];

// Placeholders a labeler may substitute for personal data.
const PLACEHOLDERS = ['PHONE', 'UPI', 'EMAIL', 'ACCOUNT', 'ID_NUMBER', 'PAN', 'HANDLE', 'NAME', 'ADDRESS', 'CARD', 'OTP'];

// Target language mix for the final dataset (percent) and the tolerance allowed.
const TARGET_MIX = { en: 30, hi: 40, hinglish: 30 };
const MIX_TOLERANCE = 5;

// Bank/PSP handles that follow "@" in UPI IDs (not exhaustive; see the structural rules in findPii).
const UPI_SUFFIXES = new Set(['ybl', 'ibl', 'axl', 'okicici', 'okhdfcbank', 'okaxis', 'oksbi', 'paytm', 'apl', 'upi',
  'sbi', 'hdfcbank', 'icici', 'axisbank', 'pnb', 'boi', 'cnrb', 'idfcbank', 'idfcfirst', 'kotak', 'ptsbi', 'pthdfc',
  'ptyes', 'yesbank', 'airtel', 'jio', 'postbank', 'fbl', 'rbl', 'aubank', 'federal', 'barodampay', 'freecharge',
  'ikwik', 'waicici', 'wahdfcbank', 'waaxis', 'wasbi', 'okbizaxis', 'abfspay', 'dbs', 'hsbc', 'sc', 'indus', 'uboi', 'allbank']);
const FINAL_MIN_ROWS = 1000;

/* ---------- CSV (RFC 4180: quoted fields, embedded commas/quotes/newlines) ---------- */
function parseCsv(text) {
  const rows = []; let row = []; let field = ''; let inQuotes = false;
  const src = text.replace(/^\ufeff/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (inQuotes) throw new Error('Unterminated quoted field in CSV');
  if (field !== '' || row.length) { row.push(field); if (row.length > 1 || row[0] !== '') rows.push(row); }
  return rows;
}

function toCsvLine(values) {
  return values.map(v => (/[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v)).join(',');
}

/* ---------- PII detection on raw_text_scrubbed ---------- */
// Every check is deliberately strict: a false alarm costs a labeler ten seconds,
// a missed phone number puts a stranger's data in a repo.
function findPii(text) {
  const problems = [];
  const t = text;
  // 9+ digits in a run, allowing single spaces/hyphens between digits: phone
  // numbers (with or without +91), account numbers, Aadhaar, card numbers.
  // Write amounts with commas ("1,00,000") so they are not caught.
  const digitRun = t.match(/\d(?:[ -]?\d){8,}/);
  if (digitRun) problems.push(`unmasked number (${digitRun[0].replace(/\D/g, '').length} digits): mask as [PHONE]/[ACCOUNT]/[ID_NUMBER]/[CARD]`);
  // "@" is allowed only as a character substitution inside a word (adversarial text like "p@nding").
  // Flag UPI IDs (known bank handle, or a digit/./_/- on the left), emails (dot on the right) and @handles.
  for (const m of t.matchAll(/([A-Za-z0-9._-]*)@([A-Za-z0-9.-]*)/g)) {
    const [whole, left, right] = m;
    const idx = m.index;
    const startsWord = idx === 0 || /[^A-Za-z0-9._-]/.test(t[idx - 1]);
    if (left === '' && startsWord && right !== '') problems.push(`"${whole}" looks like a handle: mask as [HANDLE]`);
    else if (left !== '' && (UPI_SUFFIXES.has(right.toLowerCase()) || /[\d._-]/.test(left) || right.includes('.')))
      problems.push(`"${whole}" looks like a UPI ID or email: mask as [UPI] or [EMAIL]`);
  }
  if (/\b[A-Z]{5}\d{4}[A-Z]\b/.test(t)) problems.push('looks like a PAN: mask as [PAN]');
  const known = new Set(PLACEHOLDERS);
  for (const m of t.matchAll(/\[([^\]]*)\]/g)) {
    if (!known.has(m[1])) problems.push(`unknown placeholder [${m[1]}] (allowed: ${PLACEHOLDERS.map(p => '[' + p + ']').join(' ')})`);
  }
  // "[HANDLE]_63" or "[PHONE]12": letters or digits glued right after a placeholder are the unmasked rest of the token
  for (const m of t.matchAll(/\[[A-Z_]+\]([A-Za-z0-9_])/g)) problems.push(`text glued to a placeholder ("${m[0]}"): mask the whole token`);
  return problems;
}

function normalizeForDedup(text) {
  return text.toLowerCase().replace(/\[[^\]]*\]/g, '').replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
}

/* ---------- Row-level and file-level validation ---------- */
function isRealIsoDate(s, today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return false;
  return s <= today;
}

function validateRows(rows, opts = {}) {
  const errors = []; const warnings = [];
  const today = opts.today || new Date().toISOString().slice(0, 10);
  if (!rows.length) return { errors: ['file is empty (no header row)'], warnings, stats: null };

  const header = rows[0];
  if (header.length !== COLUMNS.length || header.some((h, i) => h !== COLUMNS[i])) {
    return { errors: [`header must be exactly: ${COLUMNS.join(',')}`], warnings, stats: null };
  }

  const ids = new Set(); const seenText = new Map();
  const stats = { rows: 0, language: {}, category: {}, source: {}, obfuscated: 0, dates: [] };
  const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };

  rows.slice(1).forEach((r, idx) => {
    const line = idx + 2; // 1-based file line, header is line 1
    const err = msg => errors.push(`line ${line}: ${msg}`);
    if (r.length !== COLUMNS.length) { err(`expected ${COLUMNS.length} columns, found ${r.length}`); return; }
    const [id, text, lang, isScam, cat, src, date, obf] = r;
    stats.rows++;

    if (!/^[A-Za-z0-9_-]+$/.test(id)) err(`id "${id}" must be non-empty letters, digits, _ or -`);
    else if (ids.has(id)) err(`duplicate id "${id}"`); else ids.add(id);

    if (text.trim().length < 10) err('raw_text_scrubbed is empty or shorter than 10 characters');
    for (const p of findPii(text)) err(p);

    if (!LANGUAGES.includes(lang)) err(`language_tag "${lang}" must be one of ${LANGUAGES.join('/')}`);
    if (!['0', '1'].includes(isScam)) err(`is_scam "${isScam}" must be 0 or 1`);
    if (!CATEGORIES.includes(cat)) err(`attack_category "${cat}" is not in the taxonomy`);
    else if (isScam === '1' && cat === 'safe') err('is_scam=1 but attack_category=safe');
    else if (isScam === '0' && cat !== 'safe') err(`is_scam=0 but attack_category=${cat} (must be safe)`);
    if (!SOURCES.includes(src)) err(`source_platform "${src}" must be one of ${SOURCES.join('/')}`);
    if (!isRealIsoDate(date, today)) err(`date_received "${date}" must be a real YYYY-MM-DD date, not in the future`);
    if (!['true', 'false'].includes(obf)) err(`contains_obfuscation "${obf}" must be true or false`);

    if (text.includes('@') && obf !== 'true') err('text contains "@" so contains_obfuscation must be true; if it is a real identifier, mask it instead');

    const key = normalizeForDedup(text);
    if (key.length >= 10) {
      if (seenText.has(key)) err(`duplicate of line ${seenText.get(key)} (same text after ignoring digits and placeholders)`);
      else seenText.set(key, line);
    }

    bump(stats.language, lang); bump(stats.category, cat); bump(stats.source, src);
    if (obf === 'true') stats.obfuscated++;
    if (isRealIsoDate(date, today)) stats.dates.push(date);
  });

  if (stats.rows) {
    for (const [s, n] of Object.entries(stats.source)) {
      if (n / stats.rows > 0.4 && stats.rows >= 50) warnings.push(`source_platform "${s}" is ${(100 * n / stats.rows).toFixed(0)}% of rows; a single-source holdout generalises poorly`);
    }
  }
  return { errors, warnings, stats };
}

// Stage gates. S0 = regression set (inspectable, gates CI). S1 = sealed holdout (the finished dataset).
const STAGES = {
  s0: { minRows: 200, minLangPct: 15, minSafePct: 25, minObfuscatedPct: 5, minPerCategory: 0 },
  s1: { minRows: FINAL_MIN_ROWS, minLangPct: null, minSafePct: 25, minObfuscatedPct: 10, minPerCategory: 20 }
};

function finalChecks(stats, stage = 's1') {
  const cfg = STAGES[stage];
  if (!cfg) return [`unknown stage "${stage}" (use s0 or s1)`];
  const problems = [];
  if (!stats || stats.rows < cfg.minRows) problems.push(`stage ${stage} needs at least ${cfg.minRows} rows, has ${stats ? stats.rows : 0}`);
  if (stats && stats.rows) {
    for (const [lang, target] of Object.entries(TARGET_MIX)) {
      const pct = 100 * (stats.language[lang] || 0) / stats.rows;
      if (cfg.minLangPct !== null) {
        if (pct < cfg.minLangPct) problems.push(`language "${lang}" is ${pct.toFixed(1)}% (stage ${stage} needs at least ${cfg.minLangPct}%)`);
      } else if (Math.abs(pct - target) > MIX_TOLERANCE) {
        problems.push(`language "${lang}" is ${pct.toFixed(1)}% (target ${target}% ±${MIX_TOLERANCE})`);
      }
    }
    if (cfg.minPerCategory) for (const c of SCAM_CATEGORIES) {
      if ((stats.category[c] || 0) < cfg.minPerCategory) problems.push(`category "${c}" has ${stats.category[c] || 0} rows (need >= ${cfg.minPerCategory} to measure it)`);
    }
    if ((stats.category.safe || 0) / stats.rows * 100 < cfg.minSafePct) problems.push(`"safe" is under ${cfg.minSafePct}% of rows; precision cannot be measured honestly without enough legitimate messages`);
    if (100 * stats.obfuscated / stats.rows < cfg.minObfuscatedPct) problems.push(`under ${cfg.minObfuscatedPct}% adversarial/obfuscated rows`);
  }
  return problems;
}

module.exports = { UPI_SUFFIXES, COLUMNS, LANGUAGES, CATEGORIES, SCAM_CATEGORIES, SOURCES, PLACEHOLDERS, TARGET_MIX,
  FINAL_MIN_ROWS, STAGES, parseCsv, toCsvLine, findPii, normalizeForDedup, isRealIsoDate, validateRows, finalChecks };
