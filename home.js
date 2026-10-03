/* The home page's own behaviour: the hero scene mount, the cinematic intro, the sounds and the creature voices.
   It lived inline in index.html; it is a file now so the page can run under a Content-Security-Policy with no 'unsafe-inline' for scripts. */
document.addEventListener('DOMContentLoaded', function () {
  var host = document.getElementById('heroScene');
  if (host && window.FraudShieldHeroScene) window.FraudShieldHeroScene.mount(host);
});
document.addEventListener('DOMContentLoaded', function () {

  /* ════════════════════════════════════════════════════════
     0.  CINEMATIC INTRO — FraudShield film-title entrance
         Visual: clip-path wipe reveal + shield pop + tagline
         Sound: deep bass thud + harmonic on user interaction
  ════════════════════════════════════════════════════════ */
  var introEl = document.getElementById('introOverlay');
  if (introEl) {
    var introDone = false;

    function dismissIntro(playSound) {
      if (introDone) return;
      introDone = true;
      if (playSound) {
        /* Deep cinematic thud + harmonic shimmer
           Uses shared getCtx() — no duplicate AudioContext */
        try {
          var c = getCtx();
          if (c.state === 'suspended') c.resume();
          var o1 = c.createOscillator(), g1 = c.createGain();
          o1.connect(g1); g1.connect(c.destination);
          o1.type = 'sine'; o1.frequency.value = 68;
          g1.gain.setValueAtTime(0, c.currentTime);
          g1.gain.linearRampToValueAtTime(0.44, c.currentTime + 0.05);
          g1.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 1.0);
          o1.start(c.currentTime); o1.stop(c.currentTime + 1.1);
          var o2 = c.createOscillator(), g2 = c.createGain();
          o2.connect(g2); g2.connect(c.destination);
          o2.type = 'sine'; o2.frequency.value = 440;
          g2.gain.setValueAtTime(0, c.currentTime + 0.07);
          g2.gain.linearRampToValueAtTime(0.055, c.currentTime + 0.13);
          g2.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.65);
          o2.start(c.currentTime + 0.07); o2.stop(c.currentTime + 0.75);
        } catch(e){ /* sound is optional: the page works without it */ }
      }
      introEl.classList.add('exit');
      setTimeout(function() { introEl.style.display = 'none'; }, 850);
    }

    /* Auto-dismiss at 3.5s — underline animation ends at 3.04s, give 460ms to breathe */
    setTimeout(function() { dismissIntro(false); }, 3900);

    /* Click/touch overlay to skip + trigger sound */
    introEl.addEventListener('click', function() { dismissIntro(true); });
    introEl.addEventListener('touchstart', function() { dismissIntro(true); }, { passive:true });
  }

  /* ════════════════════════════════════════════════════════
     1.  WEB AUDIO — clean UI sounds (no harsh mechanical tones)
  ════════════════════════════════════════════════════════ */
  var audioCtx = null;
  function getCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  }

  function playTone(freq, type, dur, vol, freqEnd) {
    try {
      var c = getCtx();
      if (c.state === 'suspended') c.resume();
      var o = c.createOscillator(), g = c.createGain();
      o.connect(g); g.connect(c.destination);
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, c.currentTime);
      if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, c.currentTime + dur);
      g.gain.setValueAtTime(vol, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
      o.start(c.currentTime); o.stop(c.currentTime + dur);
    } catch(e){ /* sound is optional: the page works without it */ }
  }

  /* Premium button tap — replaces all harsh click sounds.
     Soft sine pop: barely noticeable, confirms the tap cleanly. */
  function playTap() { playTone(880, 'sine', 0.055, 0.055, 520); }

  /* Correct quiz answer — ascending chime */
  function playCorrect() {
    playTone(880,  'sine', 0.12, 0.09);
    setTimeout(function(){ playTone(1320, 'sine', 0.15, 0.07); }, 90);
  }

  /* Wrong quiz answer — soft descending thud, not harsh */
  function playWrong() { playTone(320, 'sine', 0.18, 0.09, 140); }

  /* ── Tap on all interactive elements — minimal clean feedback ── */
  document.addEventListener('click', function (e) {
    /* Creatures handle their own sound + state — skip */
    if (e.target.closest('.creature')) return;
    /* Skip quiz options (have their own correct/wrong sounds) */
    if (e.target.closest('.quiz-opt')) return;
    /* Skip sit-btn (has own playTap in sit handler) */
    if (e.target.closest('.sit-btn')) return;
    /* Skip fviz-share (has own playTap in share handler) */
    if (e.target.closest('.fviz-share')) return;
    /* Play tap for any button, link, or [data-snd="click"] element */
    var t = e.target.closest('a, button, [data-snd="click"]');
    if (t) playTap();
  });

  /* ── Quiz audio feedback ── */
  var qBox = document.getElementById('quizContent');
  if (qBox) {
    qBox.addEventListener('click', function (e) {
      var btn = e.target.closest('.quiz-opt');
      if (!btn || btn.disabled) return;
      setTimeout(function () {
        if (btn.classList.contains('quiz-opt--correct')) playCorrect();
        else if (btn.classList.contains('quiz-opt--wrong')) playWrong();
      }, 12);
    });
  }

  /* ════════════════════════════════════════════════════════
     2.  WEB SPEECH API — each creature speaks a real
         fraud-awareness message in a deep male or female voice
         when the user clicks it.
  ════════════════════════════════════════════════════════ */

  /* ═══════════════════════════════════════════════════════════════
     CREATURE VOICE SYSTEM — 4 archetypes, deeply tuned

     HOW VOICE WORKS IN BROWSERS:
     • macOS Chrome  → uses built-in Apple voices (Rishi=Indian male,
                        Veena=Indian female, Fred=robotic, Daniel=UK deep)
     • Windows Chrome → uses Microsoft voices (Ravi=Indian male,
                         Heera=Indian female, David/Mark=EN male)
     • Android Chrome → uses Google TTS (en-IN available)
     • All browsers fallback gracefully — no crashes, no silence

     PITCH RULES (Web Speech API):
     • 1.0  = voice's natural pitch — always sounds human
     • 1.08 = slightly younger/brighter (female warmth)
     • 0.90 = older, measured — still 100% clear (safe lower bound)
     • NEVER below 0.88 — causes distortion on some systems

     RATE RULES:
     • 0.90 = natural conversation pace (young man)
     • 0.82 = deliberate robotic cadence
     • 0.75 = slow menacing villain
     • 0.72 = wise elder — every word lands separately
  ═══════════════════════════════════════════════════════════════ */

  /*
   * ARCHETYPE 1: YOUNG INDIAN MAN (Kavach)
   * Like your IT-educated younger brother giving safety advice.
   * Warm, direct, uses "uncle ji" naturally. NOT lecture-tone.
   * Voice: Rishi (macOS Indian EN male) → Microsoft Ravi (Windows)
   *        → Daniel (UK male) → any en-IN
   */
  /*
   * ARCHETYPE 2: INDIAN WOMAN — THE BEE (Chetavani)
   * Like your bhabhi or elder sister. Urgency + deep concern.
   * Says "Suniye" naturally. Emotional but controlled.
   * Voice: Veena (macOS Indian EN female) → Microsoft Heera (Windows)
   *        → Karen (Australian female) → any en-IN
   */
  /*
   * ARCHETYPE 3: ROBOTIC DATA BOT (Sankhya)
   * Factual, slightly mechanical, but every number is clear.
   * Fred (macOS) has a genuinely robotic quality. Slower rate.
   * Voice: Fred (macOS robotic) → Albert (macOS quirky)
   *        → Microsoft Mark (Windows) → Daniel → any male
   */
  /*
   * ARCHETYPE 4: CRIMINAL DEVIL (Thag)
   * Villain confessing his own trick. Deep, slow, deliberate.
   * Daniel (UK male) sounds authoritative and slightly sinister.
   * Pitch 0.90 = depth without distortion.
   * Voice: Daniel (UK) → Microsoft David (Windows deep male)
   *        → Rishi with pitch adj → any male fallback
   */

  var creatureData = {

    /* KAVACH — Young Indian man, clear rules, like a younger brother talking to family */
    'c-shield': {
      arch   : 'young-male',
      rate   : 0.88,
      pitch  : 1.0,
      voices : ['Rishi','Microsoft Ravi - English (India)','Microsoft Ravi',
                'Google UK English Male','Daniel'],
      lang   : 'en-IN',
      msg    : 'Hello. I am Kavach, your digital protector. ' +
               'I want to tell you three things that can save your family from being cheated. ' +
               'First — your O T P is like your A T M pin. Never tell it to anyone. Not your bank. Not C B I. Not anyone. ' +
               'Second — no police, no court, no C B I will ever call you on video to arrest you. If this happens to you or your family, put the phone down immediately. This is always a fraud. Always. ' +
               'Third — if money is gone, call nineteen thirty right now. It is completely free. Day or night. They can freeze stolen money very quickly. ' +
               'Please — tell your parents, your grandparents, your neighbours today. One conversation can protect an entire family.'
    },

    /* CHETAVANI — Indian woman, the bee, urgent concern, like an elder sister */
    'c-bee': {
      arch   : 'female',
      rate   : 0.92,
      pitch  : 1.08,
      voices : ['Veena','Microsoft Heera - English (India)','Microsoft Heera',
                'Google UK English Female','Karen','Moira'],
      lang   : 'en-IN',
      msg    : 'Please listen carefully. I am Chetavani — I warn you before it is too late. ' +
               'I am very worried about you and your family. ' +
               'If someone calls and says your Aadhaar card is in a crime case — do not panic. Their whole plan depends on your fear. ' +
               'Our Prime Minister Modi said clearly on Mann Ki Baat — Digital Arrest does not exist in any Indian law. Not one law. Not anywhere. ' +
               'No C B I officer calls on WhatsApp. No real court sends a video call. No government officer demands secret money transfers. Never. ' +
               'The moment this happens — stay calm. Hang up. Then call nineteen thirty. It is free, any time. ' +
               'And please — call your mother, your father, your grandparents right now. Today. Not tomorrow. ' +
               'Because the fraudsters are calling elderly people every single day. Your family needs to hear this from you.'
    },

    /* SANKHYA — Robotic data bot, clear mechanical cadence, each number lands separately */
    'c-bot': {
      arch   : 'robotic',
      rate   : 0.78,
      pitch  : 0.92,
      voices : ['Fred','Albert','Microsoft Mark - English (United States)','Microsoft Mark',
                'Google UK English Male','Daniel','Rishi'],
      lang   : 'en-US',
      msg    : 'I am Sankhya. Data report begins. ' +
               'India. Year twenty twenty five. Cyber fraud cases recorded: twenty eight lakh fifteen thousand. That is up twenty four percent on the year before. ' +
               'Reported losses: twenty two thousand four hundred ninety five crore rupees. ' +
               'Money saved or frozen by the C F C F R M S system, up to thirty June twenty twenty six: more than eleven thousand one hundred fifty eight crore rupees. ' +
               'Frozen money is not the same as returned money. A restoration module now lets victims apply to get frozen money back. ' +
               'Report speed matters: the sooner you report, the better the chance of freezing the money. ' +
               'Required action: call one nine three zero. It is free and open twenty four hours. Data report complete.'
    },

    /* THAG — Criminal devil, slow, menacing, revealing his own script */
    'c-ghost': {
      arch   : 'villain',
      rate   : 0.74,
      pitch  : 0.90,
      voices : ['Daniel','Microsoft David - English (United States)','Microsoft David',
                'Alex','Google UK English Male','Rishi'],
      lang   : 'en-GB',
      msg    : 'I will tell you how I try to cheat your family, so that you can stop me. ' +
               'I call and say I am from the police or a government agency. I say your name is linked to a crime, maybe a parcel with something illegal inside. ' +
               'I tell you to stay on the video call and not to tell anyone. I want you frightened and alone. ' +
               'Then I say there is a way to clear your name: move your money to a safe account. ' +
               'There is no safe account. No real officer arrests anyone on a video call. The Prime Minister has said so himself. ' +
               'The moment you hang up and tell someone, my plan falls apart. ' +
               'So now you know my script. Tell your parents today. Tell your neighbours. And if I ever call you, put the phone down and call nineteen thirty.'
    },

    /* DOST — Friendly Hindi-speaking guardian, warm trustworthy male voice */
    'c-dost': {
      arch   : 'friendly-male',
      rate   : 0.90,
      pitch  : 1.0,
      voices : ['Microsoft Hemant - Hindi (India)','Microsoft Hemant',
                'Lekha','Microsoft Swara - Hindi (India)','Microsoft Swara','Google हिन्दी'],
      lang   : 'hi-IN',
      msg    : 'नमस्ते। मैं दोस्त हूँ — आपका डिजिटल दोस्त। ' +
               'पहली बात — अपना ओटीपी कभी किसी को मत बताएं। बैंक हो, पुलिस हो, या कोई सरकारी अफसर हो — कोई भी ओटीपी नहीं माँगता। जो माँगे, वो ठग है। ' +
               'दूसरी बात — वीडियो कॉल पर कोई गिरफ्तारी नहीं होती। यह डिजिटल अरेस्ट का धोखा है। प्रधानमंत्री मोदी जी ने खुद यह बात कही है। ' +
               'तीसरी बात — अगर पैसे चले गए, तो घबराएं नहीं। तुरंत उन्नीस तीस पर कॉल करें। बिल्कुल मुफ्त। चौबीस घंटे। ' +
               'यह नंबर याद रखें — उन्नीस तीस। और आज ही अपने घर में सबको बताएं।'
    },

    /* UMEED — Female counsellor, warm, calm, hopeful recovery voice */
    'c-star': {
      arch   : 'female',
      rate   : 0.87,
      pitch  : 1.06,
      voices : ['Veena','Microsoft Heera - English (India)','Microsoft Heera',
                'Karen','Samantha','Google UK English Female'],
      lang   : 'en-IN',
      msg    : 'Please hear me. I know this may be a very difficult time. ' +
               'If fraud has happened to you, you are not weak and you are not stupid. ' +
               'These criminals are professionals, and they have fooled careful, educated people, including a retired scientist and a retired executive in cases reported by Indian media. ' +
               'You were targeted by experts. It is not your fault. ' +
               'Now let us act together, quickly. ' +
               'One — call nineteen thirty. It is free, any time of day. Tell them what happened and keep the complaint number they give you. ' +
               'Two — call your bank right now and report it as a fraudulent transaction. ' +
               'Three — save every screenshot and message, and file them at cybercrime dot gov dot in. ' +
               'If your money was frozen, you can apply to get it back through the restoration module on the same portal, using your complaint number. ' +
               'It is not guaranteed, but speed gives you the best chance. You are not alone. Umeed hai. There is always hope.'
    }
  };

  /* ─────────────────────────────────────────────────────────
     VOICE LOADER — Chrome loads voices async; we use 3 strategies
     to ensure voices are always available when creature is clicked
  ───────────────────────────────────────────────────────── */
  var cachedVoices = [];

  function loadVoices() {
    var v = window.speechSynthesis.getVoices();
    if (v && v.length) cachedVoices = v;
  }
  loadVoices();
  if ('onvoiceschanged' in window.speechSynthesis) {
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }
  setTimeout(loadVoices, 200);
  setTimeout(loadVoices, 800);

  /* ─────────────────────────────────────────────────────────
     VOICE PICKER — ordered priority list, exact name match first
     Works on: macOS Chrome, Windows Chrome, Android, Safari
  ───────────────────────────────────────────────────────── */
  function pickVoice(data) {
    var voices = cachedVoices.length ? cachedVoices : window.speechSynthesis.getVoices();
    if (!voices || !voices.length) return null;

    /* Step 1: Exact name match from priority list */
    var names = data.voices || [];
    for (var n = 0; n < names.length; n++) {
      for (var v = 0; v < voices.length; v++) {
        if (voices[v].name === names[n]) return voices[v];
      }
    }

    /* Step 2: Partial name match */
    for (var n2 = 0; n2 < names.length; n2++) {
      for (var v2 = 0; v2 < voices.length; v2++) {
        if (voices[v2].name.indexOf(names[n2]) !== -1) return voices[v2];
      }
    }

    /* Step 3: Language match for Indian voices */
    var preferLang = data.lang || 'en-IN';
    for (var v3 = 0; v3 < voices.length; v3++) {
      if (voices[v3].lang === preferLang) return voices[v3];
    }

    /* Step 4: Any English voice — never fail silently */
    for (var v4 = 0; v4 < voices.length; v4++) {
      if (voices[v4].lang.indexOf('en') === 0) return voices[v4];
    }
    return voices[0] || null;
  }

  /* Track which creature is currently speaking — enables toggle-stop */
  var speakingKey = null;

  function clearAllSpeakingUI() {
    document.querySelectorAll('.creature').forEach(function(cr) {
      cr.classList.remove('creature--speaking');
      var tip = cr.querySelector('.creature-tip');
      if (tip && tip.dataset.origText) tip.textContent = tip.dataset.origText;
    });
  }

  function updateSpeakingUI(key, isSpeaking) {
    var el = document.querySelector('.creature.' + key);
    var tip = el ? el.querySelector('.creature-tip') : null;
    if (isSpeaking) {
      clearAllSpeakingUI();
      if (el) {
        el.classList.add('creature--speaking');
        if (tip) {
          if (!tip.dataset.origText) tip.dataset.origText = tip.textContent;
          tip.textContent = '🔊 Click again to stop';
        }
      }
    } else {
      if (el) {
        el.classList.remove('creature--speaking');
        if (tip && tip.dataset.origText) tip.textContent = tip.dataset.origText;
      }
    }
  }

  function speakCreature(data, key) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();

    var utter = new SpeechSynthesisUtterance(data.msg);
    utter.lang   = data.lang || 'en-IN';
    utter.rate   = data.rate;
    utter.pitch  = data.pitch;
    utter.volume = 1;
    var voice = pickVoice(data);
    if (voice) utter.voice = voice;

    speakingKey = key;
    updateSpeakingUI(key, true);

    /* Guard: only clear state if THIS utterance is still the active one,
       so switching creatures doesn't corrupt the new creature's speaking state */
    utter.onend   = function() { if (speakingKey === key) { speakingKey = null; updateSpeakingUI(key, false); } };
    utter.onerror = function() { if (speakingKey === key) { speakingKey = null; updateSpeakingUI(key, false); } };

    window.speechSynthesis.speak(utter);
  }


  /* ── Creature click handler ── */
  document.querySelectorAll('.creature').forEach(function (cr) {
    var key = null;
    ['c-shield','c-bee','c-bot','c-ghost','c-star','c-dost'].forEach(function(k){
      if (cr.classList.contains(k)) key = k;
    });

    cr.addEventListener('click', function (e) {
      e.stopPropagation();

      cr.classList.remove('creature--bouncing');
      void cr.offsetWidth;
      cr.classList.add('creature--bouncing');
      setTimeout(function () { cr.classList.remove('creature--bouncing'); }, 420);

      /* iOS Safari: speechSynthesis.speaking is unreliable — check speakingKey only */
      if (speakingKey === key) {
        window.speechSynthesis && window.speechSynthesis.cancel();
        speakingKey = null;
        updateSpeakingUI(key, false);
        return;
      }
      if (key && creatureData[key]) speakCreature(creatureData[key], key);
    });
  });

  /* ════════════════════════════════════════════════════════
     3.  READING PROGRESS BAR
  ════════════════════════════════════════════════════════ */
  var prog = document.getElementById('readProgress');
  if (prog) {
    var _rafProg = null;
    window.addEventListener('scroll', function () {
      if (_rafProg) return;
      _rafProg = requestAnimationFrame(function () {
        var d = document.documentElement;
        var s = d.scrollTop || document.body.scrollTop;
        prog.style.width = (d.scrollHeight - d.clientHeight > 0
          ? (s / (d.scrollHeight - d.clientHeight)) * 100 : 0) + '%';
        _rafProg = null;
      });
    }, { passive: true });
  }

  /* ════════════════════════════════════════════════════════
     4.  SCROLL REVEAL
  ════════════════════════════════════════════════════════ */
  var revEls = document.querySelectorAll('.reveal');
  if (revEls.length && window.IntersectionObserver) {
    var revObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('revealed'); revObs.unobserve(en.target); }
      });
    }, { threshold: 0.12 });
    revEls.forEach(function (el) { revObs.observe(el); });
  } else {
    revEls.forEach(function (el) { el.classList.add('revealed'); });
  }

  /* ════════════════════════════════════════════════════════
     5.  SITUATION HELPER BUTTONS
         "What Just Happened?" — select situation, show panel
  ════════════════════════════════════════════════════════ */
  document.querySelectorAll('.sit-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var sit = btn.dataset.sit;
      var panel = document.getElementById('sit-' + sit);
      var wasActive = btn.classList.contains('active');

      /* Close all */
      document.querySelectorAll('.sit-btn').forEach(function(b) { b.classList.remove('active'); });
      document.querySelectorAll('.sit-panel').forEach(function(p) { p.classList.remove('active'); });

      /* Toggle: open panel if it wasn't open */
      if (!wasActive && panel) {
        btn.classList.add('active');
        panel.classList.add('active');
        setTimeout(function() {
          panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 60);
      }
      playTap();
    });
  });

  /* ════════════════════════════════════════════════════════
     6.  WHATSAPP SHARE BUTTONS — auto-generated on fraud cards
         Each card gets a "Share Warning" button; copies a
         pre-crafted family-safe WhatsApp message to clipboard.
  ════════════════════════════════════════════════════════ */
  var shareMessages = {
    'UPI Fraud'        : '📱 UPI Fraud Alert from FraudShield: QR codes ONLY debit your account — they can never credit money. If anyone asks you to scan a QR code to receive money, it is a scam. Hang up immediately. Call 1930 (free, 24×7) if targeted. Stay safe! — azlanabyssal-cloud.github.io/fraudshield',
    'OTP Scam'         : '🔒 OTP Safety Alert from FraudShield: No bank, RBI, or government body ever asks for your OTP. If anyone calls asking for your OTP — hang up immediately. Your OTP is like your ATM PIN. Sharing it gives full account access. Call 1930 (free). — azlanabyssal-cloud.github.io/fraudshield',
    'Phishing'         : '🎣 Phishing Alert from FraudShield: Never click bank links sent via SMS or WhatsApp. Type the bank website address yourself every time. One fake letter in the URL (like sbi-update.com) can steal your login. When in doubt, call your bank directly. — azlanabyssal-cloud.github.io/fraudshield',
    'Fake Loan Apps'   : '💰 Fake Loan App Alert from FraudShield: Any loan app that asks for access to your contacts or photos is a blackmail trap. Delete it immediately. Report at cybercrime.gov.in. No real lender charges a fee before giving a loan. Call 1930 (free). — azlanabyssal-cloud.github.io/fraudshield',
    'Sextortion'       : '🚫 Important Safety Alert from FraudShield: If someone is threatening to share private photos — do NOT pay money. Payment guarantees they will ask for more. Call 1930 immediately and say it is a sensitive case. — azlanabyssal-cloud.github.io/fraudshield',
    'Investment Fraud' : '💼 Investment Fraud Alert from FraudShield: Be wary of anything that promises guaranteed returns: real investments carry risk. The profit shown in WhatsApp investment groups is fake software. Stop sending money immediately. Call 1930 (free, 24×7). — azlanabyssal-cloud.github.io/fraudshield'
  };

  document.querySelectorAll('.fviz-card').forEach(function(card) {
    var titleEl = card.querySelector('.fviz-title');
    if (!titleEl) return;
    var title = titleEl.textContent.trim();
    var msg = shareMessages[title] || 'Stay safe from digital fraud. If you are cheated — call 1930 (free, 24×7). — azlanabyssal-cloud.github.io/fraudshield';
    var btn = document.createElement('button');
    btn.className = 'fviz-share';
    btn.setAttribute('aria-label', 'Copy ' + title + ' warning message to share with family');
    btn.textContent = '📤 Share Warning';
    btn.dataset.msg = msg;
    card.appendChild(btn);
  });

  document.addEventListener('click', function(e) {
    var shareBtn = e.target.closest('.fviz-share');
    if (!shareBtn) return;
    e.stopPropagation();
    var msg = shareBtn.dataset.msg || '';
    var orig = shareBtn.textContent;

    function showCopied() {
      shareBtn.textContent = '✅ Copied! Share on WhatsApp';
      shareBtn.classList.add('copied');
      setTimeout(function() {
        shareBtn.textContent = orig;
        shareBtn.classList.remove('copied');
      }, 2400);
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(msg).then(showCopied).catch(function() {
        fallbackCopy(msg); showCopied();
      });
    } else {
      fallbackCopy(msg); showCopied();
    }
    playTap();
  });

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    try { document.execCommand('copy'); } catch(e){ /* sound is optional: the page works without it */ }
    document.body.removeChild(ta);
  }

  /* ════════════════════════════════════════════════════════
     7.  AVERAGE REPORTED-LOSS COUNTER
         Rate comes from data/stats.json (written into data-target by scripts/sync_site.js).
         It is an average of reported losses across 2025, not a live feed, and the page says so.
  ════════════════════════════════════════════════════════ */
  var costEl = document.getElementById('costSince');
  if (costEl && window.FraudShieldFormat) {
    var pageOpenTime = Date.now();
    var costPerSec = Number(costEl.getAttribute('data-target')) || 0;
    var fmtRupees = window.FraudShieldFormat.rupeesCompact;

    setInterval(function() {
      var elapsed = (Date.now() - pageOpenTime) / 1000;
      costEl.textContent = fmtRupees(Math.floor(costPerSec * elapsed));
    }, 1000);
  }

});
