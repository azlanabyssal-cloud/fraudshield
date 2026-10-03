'use strict';
// Usage: node mlops/run.js --data <csv> [--stage=s0|s1] [--detector=router_v0 | --detector-file <js>] [--baseline=always_scam]
//                          [--sealed <csv>] [--register] [--require-evidence] [--json]
// Exit: 0 unless FAIL. With --require-evidence, anything but PASS exits 1.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { parseCsv, validateRows } = require('../data_ops/holdout.js');
const { toExamples, evaluate, compare, driftReport } = require('./evaluate.js');
const { gate, findLeakage, verifyRegistry } = require('./gate.js');
const detectors = require('./detectors.js');

const args = process.argv.slice(2);
const opt = (name, dflt) => { const a = args.find(x => x.startsWith(`--${name}=`)); if (a) return a.split('=')[1]; const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : dflt; };
const flag = n => args.includes(`--${n}`);
const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');
const REG = process.env.FS_REGISTRY || path.join(__dirname, 'registry.json'); // override is for tests

const registry = JSON.parse(fs.readFileSync(REG, 'utf8'));
const regProblems = verifyRegistry(registry);
if (regProblems.length) { regProblems.forEach(p => console.error('registry: ' + p)); process.exit(1); }

const dataFile = opt('data', path.join(__dirname, '..', 'data_ops', 'golden_holdout.csv'));
const stage = opt('stage', 's0');
const baseName = opt('baseline', 'always_scam');
// --detector-file <path.js> evaluates a candidate that module.exports = (text) => boolean
const detectorFile = opt('detector-file');
let name = opt('detector', 'router_v0'), detect = detectors[name];
if (detectorFile) {
  detect = require(path.resolve(detectorFile));
  if (typeof detect !== 'function') { console.error(`${detectorFile} must export a function (text) => boolean`); process.exit(1); }
  name = path.basename(detectorFile, '.js');
}
if (!detect || !detectors[baseName]) { console.error(`unknown detector; choose from ${Object.keys(detectors).join(', ')}`); process.exit(1); }
const policy = JSON.parse(fs.readFileSync(path.join(__dirname, 'policy.json'), 'utf8'));

function finish(result, extra = {}) {
  if (flag('json')) console.log(JSON.stringify({ ...result, ...extra }, null, 2));
  else {
    console.log(`GATE ${result.status} (stage ${stage}, detector ${name})`);
    result.reasons.forEach(r => console.log('  - ' + r));
  }
  if (result.status === 'FAIL') process.exit(1);
  if (flag('require-evidence') && result.status !== 'PASS') process.exit(1);
  process.exit(0);
}

if (!fs.existsSync(dataFile)) {
  console.log(`no dataset at ${dataFile}`);
  finish(gate({ stats: null, stage, policy }));
}
const buf = fs.readFileSync(dataFile);
const csv = parseCsv(buf.toString('utf8'));
const { errors, stats } = validateRows(csv);
if (errors.length) { errors.slice(0, 20).forEach(e => console.error('error: ' + e)); console.error('dataset is invalid; fix it before evaluating'); process.exit(1); }

const examples = toExamples(csv);
const report = evaluate(examples, detect);
const baseline = evaluate(examples, detectors[baseName]);
const comparison = compare(examples, baseline.predictions, report.predictions);
let leakage = null;
if (opt('sealed')) leakage = findLeakage(examples, toExamples(parseCsv(fs.readFileSync(opt('sealed'), 'utf8'))), policy.nearDuplicateJaccard);

const result = gate({ stats, stage, report, comparison, leakage, policy });
const { predictions, ...reportOut } = report;
if (flag('register') && (result.status === 'PASS' || result.status === 'INCONCLUSIVE')) {
  registry.push({
    detector: name, detector_sha256: sha(fs.readFileSync(detectorFile ? path.resolve(detectorFile) : path.join(__dirname, '..', 'lib', 'core.js'))), data_sha256: sha(buf),
    stage, rows: stats.rows, date: new Date().toISOString().slice(0, 10), status: result.status,
    precision: report.precision, recall: report.recall, fpr: report.fpr, p95_ms: report.latencyMs.p95
  });
  fs.writeFileSync(REG, JSON.stringify(registry, null, 2) + '\n');
}
finish(result, { report: reportOut, comparison, drift: driftReport(examples), baseline: baseName });
