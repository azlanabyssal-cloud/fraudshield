'use strict';
/* Release gate CLI. Every path can be set by flag or environment variable (flag wins):
     --data <csv>          FS_DATA       dataset to evaluate (default data_ops/golden_holdout.csv)
     --sealed <csv>        FS_SEALED     sealed set to check for leakage against the dev data
     --policy <json>       FS_POLICY     thresholds (default mlops/policy.json)
     --registry <json>     FS_REGISTRY   model registry (default mlops/registry.json)
     --stage=s0|s1  --detector=<name> | --detector-file <js>  --baseline=<name>  --register  --json  --strict
   Exit 1 on: FAIL, missing / insufficient / corrupt data, invalid policy or registry, any thrown error.
   Exit 0 on PASS, and on INCONCLUSIVE unless --strict. Nothing is caught just to print a message and exit 0. */
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { parseCsv, validateRows } = require('../data_ops/holdout.js');
const { toExamples, evaluate, compare, driftReport } = require('./evaluate.js');
const { gate, findLeakage, verifyRegistry, validatePolicy } = require('./gate.js');
const detectors = require('./detectors.js');

const args = process.argv.slice(2);
const opt = (name, env, dflt) => {
  const a = args.find(x => x.startsWith(`--${name}=`)); if (a) return a.split('=').slice(1).join('=');
  const i = args.indexOf(`--${name}`); if (i >= 0 && args[i + 1] && !args[i + 1].startsWith('--')) return args[i + 1];
  return (env && process.env[env]) || dflt;
};
const flag = n => args.includes(`--${n}`);
const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');
const die = msg => { console.error(`GATE ERROR: ${msg}`); process.exit(1); };

const REG = opt('registry', 'FS_REGISTRY', path.join(__dirname, 'registry.json'));
const policy = validatePolicy(JSON.parse(fs.readFileSync(opt('policy', 'FS_POLICY', path.join(__dirname, 'policy.json')), 'utf8')));
const registry = JSON.parse(fs.readFileSync(REG, 'utf8'));
const regProblems = verifyRegistry(registry);
if (regProblems.length) { regProblems.forEach(p => console.error('registry: ' + p)); die(`registry ${REG} is invalid`); }

const dataFile = opt('data', 'FS_DATA', path.join(__dirname, '..', 'data_ops', 'golden_holdout.csv'));
const stage = opt('stage', null, 's0');
const baseName = opt('baseline', null, 'always_scam');
const detectorFile = opt('detector-file', null, null);
let name = opt('detector', null, 'router_v0'), detect = detectors[name];
if (detectorFile) {
  detect = require(path.resolve(detectorFile));
  if (typeof detect !== 'function') die(`${detectorFile} must export a function (text) => boolean`);
  name = path.basename(detectorFile, '.js');
}
if (!detect || !detectors[baseName]) die(`unknown detector; choose from ${Object.keys(detectors).join(', ')}`);

function finish(result, extra = {}) {
  if (flag('json')) console.log(JSON.stringify({ ...result, ...extra }, null, 2));
  else {
    console.log(`GATE ${result.status} (stage ${stage}, detector ${name})`);
    result.reasons.forEach(r => console.log('  - ' + r));
    if (result.adjusted && result.adjusted.point !== null) console.log(`  adjusted precision at ${policy.prevalence * 100}% scam share: ${(100 * result.adjusted.point).toFixed(1)}% (worst case ${(100 * result.adjusted.conservative).toFixed(1)}%), target ${policy.minPrecision * 100}%`);
  }
  if (result.status === 'FAIL' || result.status === 'NO_EVIDENCE') process.exit(1);
  if (result.status === 'INCONCLUSIVE') { console.error('WARNING: not proven at this sample size'); if (flag('strict')) process.exit(1); }
  process.exit(0);
}

if (!fs.existsSync(dataFile)) { console.error(`no dataset at ${dataFile}`); finish(gate({ stats: null, stage, policy })); }
const buf = fs.readFileSync(dataFile);
const csv = parseCsv(buf.toString('utf8'));
const { errors, stats } = validateRows(csv);
if (errors.length) { errors.slice(0, 20).forEach(e => console.error('error: ' + e)); die('dataset is invalid; fix it before evaluating'); }

const examples = toExamples(csv);
const report = evaluate(examples, detect);
const baseline = evaluate(examples, detectors[baseName]);
const comparison = compare(examples, baseline.predictions, report.predictions);
const sealed = opt('sealed', 'FS_SEALED', null);
const leakage = sealed ? findLeakage(examples, toExamples(parseCsv(fs.readFileSync(sealed, 'utf8'))), policy.nearDuplicateJaccard) : null;

const result = gate({ stats, stage, report, comparison, leakage, policy });
const { predictions, ...reportOut } = report;
if (flag('register') && (result.status === 'PASS' || result.status === 'INCONCLUSIVE')) {
  registry.push({
    detector: name, detector_sha256: sha(fs.readFileSync(detectorFile ? path.resolve(detectorFile) : path.join(__dirname, '..', 'lib', 'core.js'))), data_sha256: sha(buf),
    stage, rows: stats.rows, date: new Date().toISOString().slice(0, 10), status: result.status,
    precision: report.precision, recall: report.recall, fpr: report.fpr, adjusted_precision: result.adjusted, p95_ms: report.latencyMs.p95
  });
  fs.writeFileSync(REG, JSON.stringify(registry, null, 2) + '\n');
}
finish(result, { report: reportOut, comparison, drift: driftReport(examples), baseline: baseName });
