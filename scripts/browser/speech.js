#!/usr/bin/env node
'use strict';
/* Plays a long reply through the real speech engine and an on-device voice, one short chunk at a time via lib/speech.js, and reports how many
   chunks ended, how many errored, whether the watchdog had to cut one off, and how long the speech ran (past 15 seconds, the length at which
   some engines stall). Needs an on-device voice and a Chrome that may speak (the script clicks on the page's behalf). Usage: npm run bench:speech */
const { launch, serve } = require('./cdp.js');
(async () => {
  const site = await serve(), b = await launch(); await b.goto(site.base + '/assistant.html'); await b.sleep(1000);
  const info = JSON.parse(await b.eval(`JSON.stringify({ voices: speechSynthesis.getVoices().length, local: speechSynthesis.getVoices().filter(v => v.localService).length })`));
  if (!info.local) { console.log('no on-device voice here: nothing to measure'); b.close(); site.close(); process.exit(2); }
  const r = JSON.parse(await b.eval(`(async () => {
    const v = speechSynthesis.getVoices().filter(x => x.localService).find(x => /^en/.test(x.lang)); const events = [], t0 = performance.now(); let cuts = 0;
    const realSpeak = speechSynthesis.speak.bind(speechSynthesis), realCancel = speechSynthesis.cancel.bind(speechSynthesis);
    speechSynthesis.cancel = () => { cuts++; return realCancel(); };
    speechSynthesis.speak = u => { const e = u.onend, er = u.onerror; u.onend = () => { events.push('end'); e && e(); }; u.onerror = ev => { events.push('error:' + ev.error); er && er(ev); }; return realSpeak(u); };
    const sp = FraudShieldSpeech.createSpeaker({ synth: speechSynthesis, Utterance: SpeechSynthesisUtterance, pickVoice: () => v, rate: 1.8 });
    const text = '🚫 This looks like a scam link. Do not open it. Do not share any OTP. ' + 'If you already paid, call your bank now, and then call 1930, and file a report at cybercrime.gov.in, keep every message and screenshot as evidence, and tell someone you trust right away. '.repeat(3);
    const queued = sp.say(text), finished = await new Promise(res => { sp.whenIdle(() => res(true)); setTimeout(() => res(false), 90000); });
    return JSON.stringify({ voice: v.name + ' ' + v.lang, queued, ended: events.filter(e => e === 'end').length, errors: events.filter(e => e !== 'end'), finished, watchdogCuts: cuts, seconds: +((performance.now() - t0) / 1000).toFixed(1) });
  })()`, { gesture: true }));
  console.log(`voice ${r.voice}: ${r.queued} chunks queued, ${r.ended} ended, ${r.errors.length} errors, watchdog cut ${r.watchdogCuts}, finished ${r.finished}, ${r.seconds} s of continuous speech`);
  const ok = r.finished && r.ended === r.queued && !r.errors.length && r.watchdogCuts === 0 && r.seconds > 15;
  b.close(); site.close(); process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
