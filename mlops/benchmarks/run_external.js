'use strict';
// Usage: node mlops/benchmarks/run_external.js   (downloads and hash-verifies both public datasets on first run)
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const sms = require('./fetch_sms.js'), mend = require('./fetch_mendeley.js');
const { runBenchmark, loadPolicy } = require('./pipeline.js');
const tm = require('./text_models.js');
const { prepareExternal, evaluateExternal, shortcutCheck } = require('./external.js');
const core = require('../../lib/core.js');

const pct = c => c.value === null ? 'n/a' : `${(100 * c.value).toFixed(1)}% [${(100 * c.lo).toFixed(1)}-${(100 * c.hi).toFixed(1)}]`;
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, f))).digest('hex');

(async () => {
  const policy = loadPolicy();
  const uci = sms.parseSms(await sms.load()), m = mend.parseMendeley(await mend.load());
  const { _model } = runBenchmark(uci, { policy });          // the UCI-trained model, exactly as in the first benchmark
  const prep = prepareExternal(m, uci, { nearDuplicateJaccard: policy.nearDuplicateJaccard });
  const results = evaluateExternal({ independent: prep.independent, full: prep.full }, policy, { uci_model: tm.predictor(_model) });

  const shortcut = { independent: shortcutCheck(prep.independent, t => tm.score(_model, t)), full: shortcutCheck(prep.full, t => tm.score(_model, t)) };
  // A property of the data, not a tuning step: how many messages carry a link at all. A link checker cannot catch a message that has none.
  const linkShare = set => { const has = y => { const rows = set.filter(e => e.y === y); return { rows: rows.length, withLink: rows.filter(e => core.findLinkIn(e.text)).length }; }; return { smishing: has(true), ham: has(false) }; };
  const linkPresence = { independent: linkShare(prep.independent), full: linkShare(prep.full) };
  const out = {
    benchmark: 'mendeley-smishing-external', proxy: true, claimable: false,
    warning: 'English SMS from public corpora. External-validation proxy for the evaluation pipeline, NOT a measure of FraudShield on real Indian scams. Never quote these numbers as the product\'s accuracy.',
    source: mend.SOURCE, license: 'CC BY 4.0', zip_sha256_published: mend.ZIP_SHA256, csv_sha256: mend.CSV_SHA256,
    reference_corpus: { name: 'uci-sms-spam', sha256: sms.TXT_SHA256 }, date: new Date().toISOString().slice(0, 10),
    protocol: 'Fixed before results: positives = smishing, negatives = ham, marketing spam excluded; conflicting-label texts dropped; independent slice removes every exact or near duplicate of the UCI corpus; detectors fixed in advance, never tuned on this data.',
    code_sha256: { 'external.js': sha('external.js'), 'pipeline.js': sha('pipeline.js'), 'text_models.js': sha('text_models.js') },
    counts: prep.counts, shortcutCheck: shortcut, linkPresence,
    caveat: 'Smishing here is long and genuine texts are short, so message length alone separates the classes (see shortcutCheck.aucLengthOnly). This slice has no hard negatives such as long genuine bank alerts, so a high score on it is weaker evidence than it looks.',
    results
  };
  const outDir = process.env.FS_BENCH_RESULTS || path.join(__dirname, 'results');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'mendeley_smishing_external.json'), JSON.stringify(out, null, 2) + '\n');

  const c = prep.counts;
  console.log(`EXTERNAL VALIDATION (proxy, not FraudShield): ${c.input} rows -> ${c.afterConflictsAndDuplicates} after dropping ${c.conflictingLabelGroups} conflicting-label texts and duplicates; ${c.spamExcluded} marketing spam excluded`);
  console.log(`full set: ${c.full.smishing} smishing / ${c.full.ham} ham | removed as exact/near duplicate of UCI: ${c.removedAsExactOrNearDuplicateOfReference.exact}/${c.removedAsExactOrNearDuplicateOfReference.near} | INDEPENDENT slice: ${c.independent.smishing} smishing / ${c.independent.ham} ham`);
  for (const set of ['independent', 'full']) {
    const sc = shortcut[set];
    console.log(`\n--- ${set.toUpperCase()} --- (median length: scam ${sc.medianLength.scam}, genuine ${sc.medianLength.genuine}; AUC length-only ${sc.aucLengthOnly.toFixed(3)}, AUC UCI model ${sc.aucModel.toFixed(3)})`);
    const lp = linkPresence[set]; console.log(`messages that contain a link: smishing ${lp.smishing.withLink}/${lp.smishing.rows} (${(100 * lp.smishing.withLink / lp.smishing.rows).toFixed(1)}%), genuine ${lp.ham.withLink}/${lp.ham.rows}`);
    for (const [name, r] of Object.entries(results[set])) {
      if (name.startsWith('_')) continue;
      console.log(`${name.padEnd(30)} recall ${pct(r.recall).padEnd(22)} false-alarm ${pct(r.fpr).padEnd(20)} adjusted precision @1%: ${r.gate.adjusted === null ? 'n/a' : (100 * r.gate.adjusted).toFixed(1) + '%'}  gate ${r.gate.verdict}`);
    }
    const v = results[set]._modelVsRouter; console.log(`UCI model vs router_v0 (McNemar): p=${v.p.toExponential(2)}, ${v.candidateOnlyCorrect} rows only the model got right, ${v.baselineOnlyCorrect} only the router`);
  }
})().catch(e => { console.error(e.message); process.exit(1); });
