'use strict';

// ═══════════════════════════════════════════════════════
// PWA — register the service worker (offline support, installable)
// Registered on window 'load' (not DOMContentLoaded) so it never
// competes with the page's own assets for bandwidth on first visit.
// ═══════════════════════════════════════════════════════
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {
      // Offline support just won't be available this session — the
      // site still works fully online without it, so fail silently.
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {

  // ═══════════════════════════════════════════════════════
  // UTILITY — Indian number formatting
  // ═══════════════════════════════════════════════════════
  function formatIndian(n) {
    if (n >= 10000000) return (n / 10000000).toFixed(2) + ' Cr';
    if (n >= 100000)   return (n / 100000).toFixed(2) + ' Lakh';
    if (n >= 1000) {
      let s = Math.floor(n).toString();
      let result = s.slice(-3);
      s = s.slice(0, -3);
      while (s.length > 2) { result = s.slice(-2) + ',' + result; s = s.slice(0, -2); }
      if (s.length) result = s + ',' + result;
      return result;
    }
    return Math.floor(n).toString();
  }

  // ═══════════════════════════════════════════════════════
  // HAMBURGER MENU
  // ═══════════════════════════════════════════════════════
  function initHamburger() {
    const hamburger = document.getElementById('hamburger');
    const mobileNav = document.getElementById('mobileNav');
    if (!hamburger || !mobileNav) return;

    hamburger.addEventListener('click', () => {
      const isOpen = mobileNav.classList.toggle('open');
      hamburger.classList.toggle('open', isOpen);
      hamburger.setAttribute('aria-expanded', String(isOpen));
      mobileNav.setAttribute('aria-hidden', String(!isOpen));
    });

    document.addEventListener('click', (e) => {
      if (!hamburger.contains(e.target) && !mobileNav.contains(e.target)) {
        mobileNav.classList.remove('open');
        hamburger.classList.remove('open');
        hamburger.setAttribute('aria-expanded', 'false');
        mobileNav.setAttribute('aria-hidden', 'true');
      }
    });

    mobileNav.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', () => {
        mobileNav.classList.remove('open');
        hamburger.classList.remove('open');
        hamburger.setAttribute('aria-expanded', 'false');
        mobileNav.setAttribute('aria-hidden', 'true');
      });
    });
  }

  // ═══════════════════════════════════════════════════════
  // ANIMATED COUNTERS
  // ═══════════════════════════════════════════════════════
  // The domain-name model is a soft warning added to link checks. Its weights load after the page is usable, so nothing waits on the
  // download, but a failed or corrupt download is never silent: it is retried, validated before use, announced on the page
  // (data-name-model, the fs:model event, the console) and said out loud in every link verdict that it would have informed.
  // The rules keep working without it, and no verdict ever reads as "safe", so a missing model makes the answer weaker and says so.
  const modelState = window.FraudShieldModelState = { status: 'loading', attempts: 0, error: null };
  const MODEL_RETRY_MS = window.FraudShieldModelRetryMs || [1500, 4000, 9000];   // a global so a test need not wait 14 seconds
  function setModelStatus(status, error) {
    modelState.status = status; modelState.error = error || null;
    if (status === 'failed') track({ kind: 'model', code: error && /^urlmodel:/.test(error.message || '') ? 'model-invalid' : 'model-failed' });
    document.documentElement.setAttribute('data-name-model', status);
    try { window.dispatchEvent(new CustomEvent('fs:model', { detail: { status, attempts: modelState.attempts } })); } catch (e) { /* no CustomEvent */ }
  }
  function initUrlModel() {
    const Model = window.FraudShieldUrlModel;
    if (!Model || typeof fetch !== 'function') { setModelStatus('failed', new Error('unsupported')); return; }
    function attempt() {
      modelState.attempts++;
      fetch('data/urlmodel.json', { cache: 'no-cache' })
        .then(r => (r.ok ? r.json() : Promise.reject(new Error('http-' + r.status))))
        .then(m => { Model.install(m); setModelStatus('ready'); })
        .catch(err => {
          if (modelState.attempts <= MODEL_RETRY_MS.length) { setTimeout(attempt, MODEL_RETRY_MS[modelState.attempts - 1]); return; }
          setModelStatus('failed', err);
          console.error('FraudShield: the domain-name check could not be loaded (' + (err && err.message) + '). Link checks are running on the written rules only.');
        });
    }
    modelState.retry = () => { modelState.attempts = 0; setModelStatus('loading'); attempt(); };
    setModelStatus('loading'); attempt();
  }
  // The sentence a link verdict carries when the name check was not part of it. Empty when it was, or when it would not have mattered.
  function modelNotice(result) {
    if (!result || result.nameModel !== 'not-loaded') return '';
    return modelState.status === 'failed'
      ? ' Note: the domain-name check could not load on this device, so this result uses the written rules only. Reload the page to try again.'
      : ' Note: the domain-name check is still loading, so this result uses the written rules only. Check again in a few seconds.';
  }

  // One event tells the characters how the page feels: { reaction: 'scam' | 'curious' | 'cheer' | 'numbers' } or { mood, who }. See lib/emotion.js.
  function emitMood(detail) { try { window.dispatchEvent(new CustomEvent('fs:mood', { detail })); } catch (e) { /* the characters simply do not react */ } }

  // The characters' idle life: gaze, blinking, hopping, speaking. A no-op without the module or under Reduce Motion.
  function initCreatures() {
    const Creatures = window.FraudShieldCreatures;
    if (Creatures) Creatures.mountAll(document, { win: window });
  }

  // Sequenced sections ("How criminals trap you in 4 steps") fill like water as you scroll. A no-op without the module or under Reduce Motion.
  function initFlow() {
    const Flow = window.FraudShieldFlow;
    if (!Flow) return;
    document.querySelectorAll('.funnel-grid').forEach(grid => Flow.mount(grid, { Motion: window.FraudShieldMotion, win: window }));
  }

  // Primary calls to action lean towards a nearby pointer (fine pointers only; a no-op on touch and under reduced motion).
  function initMagnetic() {
    const Motion = window.FraudShieldMotion;
    if (!Motion) return;
    document.querySelectorAll('[data-magnetic]').forEach(el => Motion.magnetic(el));
  }

  function initCounters() {
    const container = document.getElementById('stat-counters');
    if (!container) return;
    if (!('IntersectionObserver' in window)) return;

    const Motion = window.FraudShieldMotion;
    // The intro's own rise curve: fast off the line, a long soft landing. A number must never overshoot, so a curve and not a spring.
    const ease = Motion ? Motion.bezier.apply(null, Motion.CURVES.out) : t => t * (2 - t);

    function render(el, value) {
      const prefix = el.dataset.prefix || '', suffix = el.dataset.suffix || '';
      // the final frame must read exactly as the page was built ("28.15 lakh"), so lakh values use the same formatter the build used
      const F = window.FraudShieldFormat, big = el.dataset.format === 'lakh' && value >= 100000 && F && F.formatStat;
      el.textContent = prefix + (el.dataset.format === 'lakh' ? (big ? F.formatStat(value, 'lakh') : formatIndian(value)) : value.toLocaleString('en-IN')) + suffix;
    }

    function animateCounter(el) {
      const target = parseInt(el.dataset.target, 10);
      if (!Motion || !Motion.engine) { render(el, target); return; }
      Motion.engine.tween(1900, ease, p => render(el, Math.floor(p * target)), () => { render(el, target); emitMood({ reaction: 'numbers', hold: 3.5 }); });   // reduced motion: lands at once
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          animateCounter(entry.target);
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.4 });

    container.querySelectorAll('.counter-number').forEach(el => observer.observe(el));
  }

  // Every page: cards, headings and photos rise into place as they scroll in. Nothing is hidden unless this runs, and it never runs
  // under Reduce Motion, so a visitor who asked for stillness (or has no scripts) simply sees the page.
  function initArrivals() {
    if (document.getElementById('heroScene')) return;   // the home page has its own, older choreography
    if (!('IntersectionObserver' in window)) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const picks = '.fraud-card, .cm-card, .chart-card, .evo-era, .section-head, .golden-rule, .victim-section, .form-card, .action-box, .accordion-item, .assistant-frame, .about-card, .about-person, .fw-photo, .about-section h2, .about-lead, .share-card';
    const els = Array.from(document.querySelectorAll(picks)).filter(el => !el.closest('.csp-weeks, .csp-gaps, .csp-sdgs, .csp-rules, .csp-nums, .share-bars'));
    if (!els.length) return;
    const peers = new Map();
    els.forEach(el => { const k = el.parentElement; const n = peers.get(k) || 0; peers.set(k, n + 1); el.style.setProperty('--rv-d', Math.min(n, 5) * 70 + 'ms'); el.classList.add('rv'); });
    document.documentElement.classList.add('rv-on');
    const io = new IntersectionObserver(entries => entries.forEach(e => {
      if (e.isIntersecting || e.boundingClientRect.bottom < 0) { e.target.classList.add('rv-in'); io.unobserve(e.target); }
    }), { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    els.forEach(el => io.observe(el));
  }

  // About page: counts, the eight-week rail and the card reveals run once, when they scroll into view. Without
  // IntersectionObserver, or under Reduce Motion, everything is simply there.
  function initCampaign() {
    const blocks = document.querySelectorAll('.csp-nums, .csp-weeks, .csp-gaps, .csp-sdgs, .csp-rules, .share-bars');
    if (!blocks.length) return;
    const calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!('IntersectionObserver' in window) || calm) return;
    const Motion = window.FraudShieldMotion, River = window.FraudShieldRiver;
    const ease = Motion ? Motion.bezier.apply(null, Motion.CURVES.out) : t => t * (2 - t);

    function countUp(el) {
      const target = parseInt(el.dataset.count, 10);
      if (!Motion || !Motion.engine || !(target > 0)) return;
      el.textContent = '0';
      Motion.engine.tween(1500 + target * 12, ease, p => { el.textContent = String(Math.floor(p * target)); }, () => { el.textContent = String(target); });
    }
    const countAll = root => root.querySelectorAll('[data-count]').forEach(countUp);

    // The eight-week rail is one column of water that follows the scroll; it replaces the card-by-card reveal when it can run.
    const rail = document.querySelector('.csp-weeks');
    const railRiver = rail && River ? River.mount(rail, { items: Array.from(rail.children), Motion, win: window, litClass: 'is-on', drop: true, centre: it => it.querySelector('.csp-week__n').offsetHeight / 2 }) : null;

    // The 48 days fill as the same water reaches them, and a readout names the day it is at.
    const days = document.querySelector('.csp-river');
    if (days && River) {
      const ro = k => days.querySelector('[data-ro="' + k + '"]'), tickBox = days.querySelector('.csp-readout__day');
      River.mount(days, { items: Array.from(days.querySelectorAll('.csp-day')), Motion, win: window, onLit: (count, total, last) => {
        ro('day').textContent = String(count);
        ro('date').textContent = last ? last.dataset.date : 'Scroll to start';
        ro('tag').textContent = last ? last.dataset.tag : '';
        ro('title').textContent = last ? last.dataset.title : '';
        tickBox.classList.remove('tick'); void tickBox.offsetWidth; tickBox.classList.add('tick');
      } });
    }

    blocks.forEach(b => { if (!(b === rail && railRiver)) b.classList.add('is-armed'); });
    const once = new IntersectionObserver(entries => entries.forEach(e => {
      if (!e.isIntersecting) return;
      once.unobserve(e.target); e.target.classList.add('is-in');
      if (e.target.classList.contains('csp-nums')) { countAll(e.target); emitMood({ reaction: 'numbers', hold: 3 }); }
    }), { threshold: 0.25 });
    blocks.forEach(b => { if (b !== rail) once.observe(b); });

    if (rail && !railRiver) {
      const lit = new IntersectionObserver(entries => entries.forEach(e => {
        if (!e.isIntersecting) return;
        lit.unobserve(e.target); e.target.classList.add('is-on');
        const reach = e.target.offsetTop + 30;
        rail.style.setProperty('--fill', String(Math.min(1, Math.max(parseFloat(rail.style.getPropertyValue('--fill')) || 0, reach / rail.offsetHeight))));
      }), { threshold: 0.4, rootMargin: '0px 0px -12% 0px' });
      Array.from(rail.children).forEach(li => lit.observe(li));
    }
    document.querySelectorAll('.csp-sdg__count [data-count]').forEach(el => {
      const o = new IntersectionObserver(es => { if (es[0].isIntersecting) { o.disconnect(); countUp(el); } }, { threshold: 0.6 });
      o.observe(el);
    });
  }

  // Click a field photo to open the whole picture. The link underneath still works without scripts (it opens the image itself).
  function initLightbox() {
    const links = Array.from(document.querySelectorAll('a[data-lightbox]'));
    if (!links.length) return;
    const root = document.createElement('div');
    root.className = 'lb'; root.hidden = true; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Photo viewer');
    const many = links.length > 1;
    root.innerHTML = '<div class="lb__scrim" data-close></div>' +
      '<figure class="lb__fig"><div class="lb__stage"><img class="lb__img" alt=""></div><figcaption class="lb__cap"></figcaption></figure>' +
      '<button class="lb__btn lb__zoom" type="button" aria-pressed="false" aria-label="Show at actual size">&#10529;</button>' +
      '<button class="lb__btn lb__close" type="button" aria-label="Close photo" data-close>&#10005;</button>' +
      (many ? '<button class="lb__btn lb__prev" type="button" aria-label="Previous photo">&#8592;</button><button class="lb__btn lb__next" type="button" aria-label="Next photo">&#8594;</button><p class="lb__count" aria-live="polite"></p>' : '');
    document.body.appendChild(root);
    const img = root.querySelector('.lb__img'), cap = root.querySelector('.lb__cap'), count = root.querySelector('.lb__count');
    const buttons = () => Array.from(root.querySelectorAll('button'));
    const zoomBtn = root.querySelector('.lb__zoom');
    let at = -1, opener = null, touchX = null;
    function zoom(on) {
      root.classList.toggle('is-zoom', on); zoomBtn.setAttribute('aria-pressed', String(on));
      zoomBtn.setAttribute('aria-label', on ? 'Fit the photo to the screen' : 'Show at actual size');
      const stage = root.querySelector('.lb__stage'); stage.scrollLeft = (stage.scrollWidth - stage.clientWidth) / 2; stage.scrollTop = (stage.scrollHeight - stage.clientHeight) / 2;
    }

    function show(i) {
      at = (i + links.length) % links.length; zoom(false);
      const a = links[at], thumb = a.querySelector('img'), fig = a.closest('figure'), note = fig && fig.querySelector('figcaption');
      img.src = a.getAttribute('href'); img.alt = thumb ? thumb.alt : '';
      img.width = +a.dataset.w || 0; img.height = +a.dataset.h || 0;
      cap.textContent = '';
      if (note) Array.from(note.childNodes).forEach(n => { const el = n.nodeType === 3 ? document.createElement('span') : n.cloneNode(true); if (n.nodeType === 3) { el.className = 'lb__line'; el.textContent = n.textContent; } cap.appendChild(el); });
      if (count) count.textContent = (at + 1) + ' / ' + links.length;
    }
    function setInert(on) { Array.from(document.body.children).forEach(el => { if (el === root) return; try { el.inert = on; } catch (e) { /* older browsers: the focus trap still holds */ } }); }
    function open(i, from) {
      opener = from; show(i); root.hidden = false; setInert(true);
      document.documentElement.classList.add('lb-lock');
      void root.offsetWidth; root.classList.add('is-open');
      root.querySelector('.lb__close').focus();
    }
    function close() {
      if (root.hidden) return;
      root.classList.remove('is-open'); setInert(false); document.documentElement.classList.remove('lb-lock');
      const done = () => { root.hidden = true; img.removeAttribute('src'); };
      const calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (calm) done(); else setTimeout(done, 260);
      if (opener) opener.focus();
    }
    links.forEach((a, i) => a.addEventListener('click', ev => {
      if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button) return;   // let "open in new tab" do what the visitor asked
      ev.preventDefault(); open(i, a);
    }));
    root.addEventListener('click', ev => {
      if (ev.target.closest('[data-close]')) close();
      else if (ev.target.closest('.lb__zoom') || ev.target.closest('.lb__img')) zoom(!root.classList.contains('is-zoom'));
      else if (ev.target.closest('.lb__prev')) show(at - 1);
      else if (ev.target.closest('.lb__next')) show(at + 1);
    });
    root.addEventListener('keydown', ev => {
      if (ev.key === 'Escape') { ev.preventDefault(); close(); }
      else if (ev.key === 'ArrowLeft' && many) show(at - 1);
      else if (ev.key === 'ArrowRight' && many) show(at + 1);
      else if (ev.key === 'Tab') {
        const b = buttons(), first = b[0], last = b[b.length - 1];
        if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
        else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
      }
    });
    root.addEventListener('touchstart', ev => { touchX = ev.touches.length === 1 ? ev.touches[0].clientX : null; }, { passive: true });
    root.addEventListener('touchend', ev => {
      if (touchX === null || !many) return;
      const dx = ev.changedTouches[0].clientX - touchX; touchX = null;
      if (Math.abs(dx) > 60) show(at + (dx < 0 ? 1 : -1));
    }, { passive: true });
  }

  // ═══════════════════════════════════════════════════════
  // AWARENESS QUIZ
  // ═══════════════════════════════════════════════════════
  function initQuiz() {
    const qContent = document.getElementById('quizContent');
    const qResult  = document.getElementById('quizResult');
    if (!qContent || !qResult) return;

    const questions = [
      {
        q: 'An RBI officer calls you and says your bank account will be frozen in 2 hours unless you share your Aadhaar number and OTP to verify your identity. What do you do?',
        options: [
          'Share both — you cannot risk your account being frozen',
          'Ask for their employee ID then share if it seems valid',
          'Hang up immediately. Call your bank on the number printed on your card.',
          'Share the Aadhaar but not the OTP'
        ],
        correct: 2,
        explain: 'RBI, banks, and government bodies never call asking for your OTP or Aadhaar. This social engineering tactic is behind a large share of fraud cases. Always hang up and call your bank directly on the number on your card — never on a number the caller provides.'
      },
      {
        q: 'You want to receive ₹8,000 from an OLX buyer. He sends you a QR code and says "scan this to receive your payment." What do you do?',
        options: [
          'Scan it — it looks real',
          'Scan it but do not enter your PIN to be safe',
          'Refuse — QR codes only send money from your account. You never scan to receive.',
          'Call your bank first to check if it is legitimate'
        ],
        correct: 2,
        explain: 'This is one of India\'s most common UPI scams. Scanning a QR code debits your account. You will NEVER need to scan anything to receive money. To receive payment, simply share your UPI ID or mobile number with the sender.'
      },
      {
        q: 'You get this SMS: "Your SBI account is blocked. Update KYC now: sbi-kyc-update.net or lose access in 24 hours." What do you do?',
        options: [
          'Click the link and update KYC immediately',
          'Forward it to your bank to check if it is real',
          'Delete it. SBI\'s real domain is sbi.co.in. Banks never send KYC links via SMS.',
          'Reply STOP to opt out'
        ],
        correct: 2,
        explain: 'This is a phishing SMS. The domain "sbi-kyc-update.net" is fake. SBI\'s only real domain is sbi.co.in. Government sites end in .gov.in. Banks never send KYC links by SMS. Always type the URL yourself and never click links in messages.'
      },
      {
        q: 'Your contact\'s WhatsApp sends: "I\'m stuck at Delhi airport, phone died, borrowed this number. Send ₹5,000 to this UPI ID — I\'ll return it tonight." What do you do?',
        options: [
          'Send immediately — your contact is in trouble',
          'Send half the amount to be cautious',
          'Call your contact directly on their actual phone number to verify before doing anything',
          'Ask them to video call first to confirm their identity'
        ],
        correct: 2,
        explain: 'WhatsApp accounts are regularly hacked. Money requests via chat — even from known contacts — must always be verified by a direct phone call to the person\'s actual number. This exact scenario is used in thousands of cases annually across India.'
      },
      {
        q: 'An investment platform guarantees 40% monthly returns. A friend shows you his dashboard displaying ₹50,000 in profit. The app has great reviews on Google. What do you do?',
        options: [
          'Invest a small amount to test if it works',
          'Invest — your friend\'s proof is convincing',
          'Refuse. Any guarantee of high returns is a Ponzi scheme warning sign.',
          'Research it carefully on Google then decide'
        ],
        correct: 2,
        explain: 'In 2025, investment scams caused 76% of all cyber fraud losses in India despite being only 35% of cases. Your friend\'s dashboard is generated by software to lure more victims. Reviews can be faked. No legitimate investment ever guarantees returns. If it promises guaranteed profit — it is a scam.'
      }
    ];

    let current = 0;
    let score   = 0;

    function renderQuestion() {
      const q = questions[current];
      const progressPct = (current / questions.length) * 100;
      qContent.innerHTML = `
        <div class="quiz-progress-bar">
          <div class="quiz-progress-bar__fill" style="--fill-width:${progressPct}%"></div>
        </div>
        <div class="quiz-body">
          <p class="quiz-q-num">Question ${current + 1} of ${questions.length}</p>
          <p class="quiz-q-text">${q.q}</p>
          <div class="quiz-options">
            ${q.options.map((opt, i) =>
              `<button class="quiz-opt" data-idx="${i}" aria-label="Option ${i + 1}: ${opt}">${opt}</button>`
            ).join('')}
          </div>
          <div class="quiz-feedback" hidden></div>
        </div>
      `;
      qContent.querySelectorAll('.quiz-opt').forEach(btn => {
        btn.addEventListener('click', handleAnswer);
      });
    }

    function handleAnswer(e) {
      const chosen   = parseInt(e.target.dataset.idx, 10);
      const q        = questions[current];
      const feedback = qContent.querySelector('.quiz-feedback');
      const allBtns  = qContent.querySelectorAll('.quiz-opt');

      allBtns.forEach(b => { b.disabled = true; });

      if (chosen === q.correct) {
        score++;
        e.target.classList.add('quiz-opt--correct');
        feedback.className = 'quiz-feedback quiz-feedback--correct';
        feedback.innerHTML = '✅ Correct! ' + q.explain;
      } else {
        e.target.classList.add('quiz-opt--wrong');
        allBtns[q.correct].classList.add('quiz-opt--correct');
        feedback.className = 'quiz-feedback quiz-feedback--wrong';
        feedback.innerHTML = '❌ Not quite. ' + q.explain;
      }
      feedback.hidden = false;

      setTimeout(() => {
        current++;
        if (current < questions.length) {
          renderQuestion();
        } else {
          showResult();
        }
      }, 3000);
    }

    function showResult() {
      const messages = {
        5: { icon: '🏆', msg: 'Outstanding. You are fully fraud-aware. Share this quiz with your family and colleagues right now.' },
        4: { icon: '✅', msg: 'Great awareness. Review the one you missed on the Protect Yourself page.' },
        3: { icon: '📚', msg: 'Good start. Read the full fraud prevention guide to fill the gaps in your knowledge.' },
        2: { icon: '⚠️', msg: 'You are at risk. Please read the Protect Yourself page carefully — it could save you lakhs.' },
        1: { icon: '🚨', msg: 'High risk. These are real tricks that criminals use. Read the guide now.' },
        0: { icon: '🚨', msg: 'High risk. Scammers specifically exploit this gap in awareness. Read the full guide now.' }
      };
      const m = messages[score] || messages[0];
      qContent.hidden = true;
      qResult.hidden  = false;
      qResult.innerHTML = `
        <div class="quiz-result">
          <p class="quiz-result__emoji">${m.icon}</p>
          <p class="quiz-result__score">${score} / ${questions.length}</p>
          <p class="quiz-result__msg">${m.msg}</p>
          <a href="tips.html" class="btn-primary">Read the Full Safety Guide →</a>
        </div>
      `;
    }

    renderQuestion();
  }

  // ═══════════════════════════════════════════════════════
  // DATA PAGE TABS
  // ═══════════════════════════════════════════════════════
  function initTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    if (!tabBtns.length) return;

    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        tabBtns.forEach(b => {
          b.classList.remove('active');
          b.setAttribute('aria-selected', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');

        document.querySelectorAll('.tab-panel').forEach(panel => {
          panel.hidden = true;
        });
        const target = document.getElementById('tab-' + btn.dataset.tab);
        if (target) target.hidden = false;
      });
    });
  }

  // ═══════════════════════════════════════════════════════
  // TIPS PAGE FILTERS
  // ═══════════════════════════════════════════════════════
  function initFilters() {
    const filterBtns = document.querySelectorAll('.filter-btn');
    if (!filterBtns.length) return;

    filterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        filterBtns.forEach(b => {
          b.classList.remove('active');
          b.setAttribute('aria-pressed', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-pressed', 'true');

        const filter = btn.dataset.filter;
        document.querySelectorAll('.fraud-card').forEach(card => {
          if (filter === 'all' || card.dataset.category === filter) {
            card.style.display = '';
          } else {
            card.style.display = 'none';
          }
        });
      });
    });
  }

  // ═══════════════════════════════════════════════════════
  // ACCORDION
  // ═══════════════════════════════════════════════════════
  function initAccordion() {
    const headers = document.querySelectorAll('.accordion-header');
    if (!headers.length) return;

    headers.forEach(header => {
      header.addEventListener('click', () => {
        const body   = header.nextElementSibling;
        const isOpen = body.classList.contains('open');

        document.querySelectorAll('.accordion-body').forEach(b => b.classList.remove('open'));
        document.querySelectorAll('.accordion-header').forEach(h => {
          h.setAttribute('aria-expanded', 'false');
        });

        if (!isOpen) {
          body.classList.add('open');
          header.setAttribute('aria-expanded', 'true');
        }
      });
    });
  }

  // ═══════════════════════════════════════════════════════
  // CHARTS (data.html only)
  // ═══════════════════════════════════════════════════════
  function initCharts() {
    if (!document.getElementById('casesChart')) return;
    if (typeof Chart === 'undefined') return;

    Chart.defaults.font.family = "'DM Sans', sans-serif";
    Chart.defaults.font.size   = 13;
    Chart.defaults.color       = '#4A5568';
    Chart.defaults.borderColor = '#E2E8F0';

    // A chart is drawn when it scrolls into view (or its tab opens), so its entrance is seen and not spent off-screen.
    // Under Reduce Motion, or without IntersectionObserver, it is drawn at once and does not animate.
    const calm = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (calm) Chart.defaults.animation = false;
    else Chart.defaults.animation = { duration: 1400, easing: 'easeOutQuart', delay: ctx => (ctx.type === 'data' && ctx.mode === 'default' ? ctx.dataIndex * 90 : 0) };
    const whenSeen = (id, make) => {
      const canvas = document.getElementById(id);
      if (calm || !('IntersectionObserver' in window)) { make(canvas); return; }
      const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); make(canvas); } }, { threshold: 0.2 });
      io.observe(canvas);
    };

    const gridColor = '#E2E8F0';
    const tickColor = '#718096';

    const baseScales = {
      x: { grid: { display: false }, ticks: { color: tickColor } },
      y: {
        beginAtZero: true,
        grid: { color: gridColor },
        ticks: { color: tickColor, callback: v => formatIndian(v) }
      }
    };

    // Chart data is written into each canvas (data-series) by scripts/sync_site.js from data/stats.json.
    // Nothing is typed in here, so a chart can never disagree with the page text next to it.
    const seriesOf = id => {
      const raw = document.getElementById(id).getAttribute('data-series');
      if (!raw) throw new Error('canvas #' + id + ' has no data-series: run "npm run site:sync"');
      return JSON.parse(raw);
    };
    const exact = n => (window.FraudShieldFormat ? window.FraudShieldFormat.indian(n) : String(n));

    const cases = seriesOf('casesChart');
    whenSeen('casesChart', canvas => new Chart(canvas, {
      type: 'bar',
      data: {
        labels: cases.labels,
        datasets: [{
          label: 'Cases registered',
          data: cases.values,
          backgroundColor: cases.values.map((_, i) => (i === cases.values.length - 1 ? '#7B1D1D' : 'rgba(11,31,58,' + (0.5 + 0.1 * i).toFixed(2) + ')')),
          borderRadius: 6,
          hoverBackgroundColor: '#E85D04'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => '  ' + exact(ctx.parsed.y) + ' cases registered' } }
        },
        scales: baseScales
      }
    }));

    const shares = seriesOf('typeChart');
    whenSeen('typeChart', canvas => new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: shares.labels,
        datasets: [{
          data: shares.values,
          backgroundColor: ['#7B1D1D', '#E85D04', '#0B1F3A', '#94a3b8'],
          borderWidth: 0,
          hoverOffset: 12
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        cutout: '68%',
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => '  ' + ctx.label + ': ' + ctx.parsed + '% of the money' } }
        }
      }
    }));

    const states = seriesOf('stateChart');
    whenSeen('stateChart', canvas => new Chart(canvas, {
      type: 'bar',
      data: {
        labels: states.labels,
        datasets: [{
          label: 'Cases',
          data: states.values,
          backgroundColor: ['#7B1D1D', '#E85D04'],
          borderRadius: 6,
          hoverBackgroundColor: '#E85D04'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        indexAxis: 'y',
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => '  ' + exact(ctx.parsed.x) + ' cases' } }
        },
        scales: {
          x: {
            beginAtZero: true,
            grid: { color: gridColor },
            ticks: { color: tickColor, callback: v => formatIndian(v) }
          },
          y: { grid: { display: false }, ticks: { color: tickColor } }
        }
      }
    }));

    const losses = seriesOf('moneyChart');
    whenSeen('moneyChart', canvas => new Chart(canvas, {
      type: 'line',
      data: {
        labels: losses.labels,
        datasets: [{
          label: '₹ Crore lost',
          data: losses.values,
          borderColor: '#E85D04',
          backgroundColor: 'rgba(232,93,4,0.08)',
          fill: true,
          tension: 0.3,
          pointBackgroundColor: ['#E85D04', '#7B1D1D', '#556B2F'],
          pointRadius: 6,
          pointHoverRadius: 9,
          borderWidth: 2.5
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => '  ₹' + exact(ctx.parsed.y) + ' Crore' } }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: tickColor } },
          y: {
            beginAtZero: true,
            grid: { color: gridColor },
            ticks: { color: tickColor, callback: v => '₹' + exact(v) }
          }
        }
      }
    }));
  }

  // ═══════════════════════════════════════════════════════
  // COPY REPORT (report.html only)
  // ═══════════════════════════════════════════════════════
  function initCopyReport() {
    const btn = document.getElementById('copyBtn');
    if (!btn) return;

    btn.addEventListener('click', () => {
      const val = id => {
        const el = document.getElementById(id);
        return el ? (el.value.trim() || 'Not provided') : 'Not provided';
      };

      const amountEl = document.getElementById('inputAmount');
      const rawAmount = amountEl ? amountEl.value : '';
      const amountStr = rawAmount && rawAmount !== '0'
        ? '₹' + parseInt(rawAmount, 10).toLocaleString('en-IN')
        : 'Not provided';

      const today = new Date();
      const dateStr = today.toLocaleDateString('en-IN', {
        day: '2-digit', month: '2-digit', year: 'numeric'
      });

      const report = [
        '=== FRAUDSHIELD FRAUD REPORT ===',
        'Date Generated: ' + dateStr,
        '',
        'VICTIM DETAILS',
        'Name:           ' + val('inputName'),
        'State / UT:     ' + val('inputState'),
        '',
        'INCIDENT DETAILS',
        'Type of Fraud:  ' + val('inputType'),
        'Date of Fraud:  ' + val('inputDate'),
        'Amount Lost:    ' + amountStr,
        'Bank / App:     ' + val('inputBank'),
        '',
        'WHAT HAPPENED',
        val('inputDescription'),
        '',
        '=== NEXT STEPS ===',
        '1. File at:     https://cybercrime.gov.in',
        '2. Call:        1930 (Free · 24x7 National Helpline)',
        '3. Call bank:   Report it as a fraudulent transaction and ask which RBI rules apply',
        '4. Evidence:    Save all SMS, screenshots, transaction IDs',
        '',
        '==============================',
        'Generated by FraudShield — a free public resource',
        'Not affiliated with any government body',
        '=============================='
      ].join('\n');

      const successEl = document.getElementById('copySuccess');

      if (!navigator.clipboard) {
        alert('Please copy this manually:\n\n' + report);
        return;
      }

      navigator.clipboard.writeText(report)
        .then(() => {
          const original = btn.textContent;
          btn.textContent = '✅ Copied Successfully!';
          btn.style.background = 'var(--olive)';
          if (successEl) successEl.hidden = false;
          setTimeout(() => {
            btn.textContent = original;
            btn.style.background = '';
            if (successEl) successEl.hidden = true;
          }, 3000);
        })
        .catch(() => {
          alert('Copy failed. Please select and copy this text:\n\n' + report);
        });
    });
  }

  // ═══════════════════════════════════════════════════════
  // REPORT PAGE — pre-fill fraud type from chatbot handoff
  // (report.html?type=UPI%20Fraud)
  // ═══════════════════════════════════════════════════════
  function initReportPrefill() {
    const typeSelect = document.getElementById('inputType');
    if (!typeSelect) return;

    const params = new URLSearchParams(window.location.search);
    const type = params.get('type');
    if (!type) return;

    const match = Array.from(typeSelect.options).find(o => o.value === type);
    if (match) typeSelect.value = type;
  }

  // ═══════════════════════════════════════════════════════
  // FRAUDSHIELD ASSISTANT — shared guided-chat engine
  // One engine, two mounts: the floating widget (every page)
  // and the full-page experience (assistant.html). Both share
  // the same flows, same session state, same OCR/voice code —
  // so behaviour can never drift between the two surfaces.
  // 100% client-side: no server, no API key, no data leaves
  // the device (matches the report page's own privacy promise).
  //
  // Legal citations reference the Bharatiya Nyaya Sanhita (BNS),
  // 2023 — the code that replaced the IPC on 1 July 2024 — plus
  // the IT Act, 2000 provisions that remain in force alongside it.
  // ═══════════════════════════════════════════════════════
  const CHAT_FLOWS = {
    'Digital Arrest': {
      start: 'entry',
      nodes: {
        entry: {
          say: [
            "That's called a \"digital arrest\" scam, and I can tell you with total certainty: no such power exists anywhere in Indian law. No police officer, court, or CBI official can ever arrest you over a video call.",
            "Is this happening right now, on a call?"
          ],
          options: [
            { label: 'Yes, still on the call', goto: 'onCallNow' },
            { label: 'It already happened, call has ended', goto: 'ended' },
            { label: 'No — just want the facts', goto: 'facts' }
          ]
        },
        onCallNow: {
          say: [
            "Do this right now: hang up. Don't explain, don't apologise — just end the call. There is nothing to lose by hanging up, because this is 100% fake.",
            "Tell me once you've disconnected."
          ],
          options: [{ label: "I've hung up", goto: 'ended' }]
        },
        ended: {
          say: ['Good. Important question — was any money transferred to anyone during this call?'],
          options: [
            { label: 'Yes, money was sent', goto: 'moneySent' },
            { label: 'No money was sent', goto: 'noMoney' }
          ]
        },
        moneySent: {
          urgent: true,
          say: [
            'Every minute matters. Call 1930 right now and describe it as a digital-arrest fraud so they act fast. Then call your bank and ask them to freeze the transaction.',
            'For reference: rings running this scam can be charged under BNS Section 111 (organised crime, which includes cyber-crimes) and Section 308 (extortion). The police and courts decide the charges.'
          ],
          cta: [
            { label: '📞 Call 1930 Now', href: 'tel:1930' },
            { label: '📋 File a Report →', href: 'report.html?type=Digital%20Arrest' }
          ]
        },
        noMoney: {
          say: ["That's the best possible outcome. Please still report it — every reported number helps I4C block the racket faster. Save the caller's number and any screenshots first."],
          cta: [
            { label: '📋 File a Report →', href: 'report.html?type=Digital%20Arrest' },
            { label: '🌐 cybercrime.gov.in', href: 'https://cybercrime.gov.in' }
          ]
        },
        facts: {
          say: [
            'Three facts worth remembering: on Mann Ki Baat (27 October 2024) PM Modi said there is no such thing as "digital arrest" in the law. No investigative agency questions or arrests people over a phone or video call. And if it ever happens to you or family — hang up, then call 1930.',
            'Since July 2024, BNS Section 111 defines organised crime to include cyber-crimes, so a fraud ring can be charged as a syndicate, not just as isolated cases of cheating.'
          ],
          options: [{ label: 'What if it happens to my parents?', goto: 'elderly' }]
        },
        elderly: {
          say: ["Save 1930 in their phone under a name they'll recognise in a panic, like \"CYBER HELP\". And tell them the one rule that matters most: no real officer ever asks for money to \"verify\" or \"clear\" your name. If anyone asks for that, it's fake, no matter how convincing they sound."],
          cta: [{ label: '📖 Full Protection Guide', href: 'tips.html' }]
        }
      }
    },

    'OTP Scam': {
      start: 'entry',
      nodes: {
        entry: {
          say: ['Your OTP works exactly like your ATM PIN — nobody legitimate ever asks for it. Not your bank, not RBI, not anyone. Have you already shared an OTP with someone?'],
          options: [
            { label: 'Yes, I shared it', goto: 'shared' },
            { label: 'No, they just asked', goto: 'justAsked' }
          ]
        },
        shared: {
          urgent: true,
          say: ['Act fast. Call your bank\'s official helpline — the number on your card, not one anyone gave you — and say: "block my card and freeze my account, unauthorised transaction." Then call 1930.'],
          cta: [
            { label: '📞 Call 1930 Now', href: 'tel:1930' },
            { label: '📋 File a Report →', href: 'report.html?type=OTP%20Scam' }
          ]
        },
        justAsked: {
          say: ['Good instinct not sharing it. Hang up — real banks resolve everything without ever needing your OTP read aloud. If they call again, block the number and report it.'],
          cta: [{ label: '📋 Report This Number →', href: 'report.html?type=OTP%20Scam' }]
        }
      }
    },

    'UPI Fraud': {
      start: 'entry',
      nodes: {
        entry: {
          say: ['Rule that stops most UPI scams: scanning a QR code or entering your UPI PIN only ever sends money, never receives it. If someone asked you to scan or enter a PIN "to receive payment", that\'s the scam. What happened?'],
          options: [
            { label: 'I scanned/entered PIN and lost money', goto: 'lost' },
            { label: 'Someone is asking me to scan right now', goto: 'asking' },
            { label: 'Just checking, nothing happened', goto: 'none' }
          ]
        },
        lost: {
          urgent: true,
          say: [
            "Call your bank immediately and report it as a fraudulent transaction, then call 1930 so a freeze can be requested on the receiving account. UPI payments are hard to reverse, so speed is the one thing you control.",
            'This can be charged as cheating under BNS Section 318 — worth quoting if your bank or the police are slow to act.'
          ],
          cta: [
            { label: '📞 Call 1930 Now', href: 'tel:1930' },
            { label: '📋 File a Report →', href: 'report.html?type=UPI%20Fraud' }
          ]
        },
        asking: {
          say: ['Do not scan anything or enter your PIN. Tell them: "send me your UPI ID instead, I\'ll transfer manually." If they refuse or get aggressive, that confirms it\'s a scam.'],
          options: [{ label: "They're getting aggressive, what now?", goto: 'block' }]
        },
        block: {
          say: ["Block them and stop responding. If this was for an online sale, report the listing too — this exact trick is one of India's most common frauds."],
          cta: [{ label: '📋 Report It →', href: 'report.html?type=UPI%20Fraud' }]
        },
        none: {
          say: ['Good — keep this rule in mind: to receive money you only ever share your UPI ID, never scan or type a PIN.'],
          cta: [{ label: '📖 Full Protection Guide', href: 'tips.html' }]
        }
      }
    },

    'Phishing': {
      start: 'entry',
      nodes: {
        entry: {
          say: ["Paste the link or SMS text here anytime and I'll check it for phishing red flags — or tell me what happened if you already clicked it. You can also paste a screenshot of the message and I'll read it for you."],
          options: [
            { label: 'I already clicked it / entered details', goto: 'clicked' },
            { label: "I haven't clicked anything", goto: 'notYet' }
          ]
        },
        clicked: {
          urgent: true,
          say: [
            'If you entered your bank login, card number, or OTP, call your bank right now and ask them to block or freeze your account, then change that password everywhere else you used it. This is time-sensitive.',
            'Phishing for financial details can be charged as cheating under BNS Section 318.'
          ],
          cta: [
            { label: '📞 Call 1930 Now', href: 'tel:1930' },
            { label: '📋 File a Report →', href: 'report.html?type=Phishing' }
          ]
        },
        notYet: {
          say: ['Good. Paste a link or screenshot here anytime and I\'ll check it — or remember the one rule: real banks and government sites never send links by SMS. Type the address yourself instead of clicking.'],
          cta: [{ label: '📖 Full Protection Guide', href: 'tips.html' }]
        }
      }
    },

    'Fake Loan App': {
      start: 'entry',
      nodes: {
        entry: {
          say: ['Biggest red flag with loan apps: any app that wants access to your contacts, gallery, or SMS before approving a loan is built for blackmail, not lending. Has this already happened?'],
          options: [
            { label: "Yes, they're threatening me now", goto: 'threatening' },
            { label: 'I paid a fee but got no loan', goto: 'noLoan' },
            { label: 'Just researching an app', goto: 'research' }
          ]
        },
        threatening: {
          urgent: true,
          say: [
            'This is illegal blackmail, not debt collection — lenders and their agents are not allowed to harass or threaten you. Call 1930 immediately and mention "loan app harassment."',
            'Threats like this can amount to extortion (BNS Section 308). If photos were morphed or shared, say so when you report it.'
          ],
          cta: [
            { label: '📞 Call 1930 Now', href: 'tel:1930' },
            { label: '📋 File a Report →', href: 'report.html?type=Fake%20Loan%20App' }
          ]
        },
        noLoan: {
          say: ['Being asked to pay before the loan is released, especially to a personal account or UPI ID, is a classic scam pattern. Report it so the app can be taken down before it catches someone else.'],
          cta: [{ label: '📋 File a Report →', href: 'report.html?type=Fake%20Loan%20App' }]
        },
        research: {
          say: ["Before installing any loan app, check whether it's listed by an RBI-registered NBFC on the RBI website. If it's only available as a random APK link and not on the Play Store, that alone is a red flag."],
          cta: [{ label: '📖 Full Protection Guide', href: 'tips.html' }]
        }
      }
    },

    'Sextortion': {
      start: 'entry',
      nodes: {
        entry: {
          say: [
            "I'm glad you're telling me this. You are not in trouble, and this happens to people from every background. The most important rule: do not pay, and do not panic — payment only leads to more demands, never to deletion.",
            'Is this happening to you right now?'
          ],
          options: [
            { label: "Yes, they're threatening me now", goto: 'now' },
            { label: 'It happened before, I need to know what to do', goto: 'before' }
          ]
        },
        now: {
          urgent: true,
          say: [
            "Don't reply, don't pay, and don't delete the chat — it's evidence. Call 1930 immediately and say this is a sensitive case.",
            'Threatening to share images to get money can amount to extortion (BNS Section 308). Tell the officer if any image was morphed or already shared.'
          ],
          cta: [
            { label: '📞 Call 1930 (Confidential)', href: 'tel:1930' },
            { label: "👩 Women's Helpline 181", href: 'tel:181' }
          ]
        },
        before: {
          say: ['Same steps apply even after time has passed: save all messages as evidence, then call 1930 or report at cybercrime.gov.in.'],
          cta: [
            { label: '📞 Call 1930 (Confidential)', href: 'tel:1930' },
            { label: '📋 File a Report →', href: 'report.html?type=Sextortion' }
          ]
        }
      }
    },

    'Investment Scam': {
      start: 'entry',
      nodes: {
        entry: {
          say: ['Rule to remember: real investments carry risk, so anyone promising guaranteed returns is a red flag. A friend\'s dashboard showing big profits is not proof: the app itself can fabricate it. What\'s your situation?'],
          options: [
            { label: "I already invested and can't withdraw", goto: 'stuck' },
            { label: 'Someone is pitching me right now', goto: 'pitched' }
          ]
        },
        stuck: {
          urgent: true,
          say: [
            'Stop sending any more money — "unlock fees" or "tax payments" to release your funds are just another layer of the same scam. Save every chat and transaction screenshot, then report it.',
            'Fake trading platforms account for the largest single share of India\'s digital fraud losses, per I4C figures reported for 2025. This can be charged as cheating (BNS Section 318), and organised rings under Section 111.'
          ],
          cta: [
            { label: '📞 Call 1930 Now', href: 'tel:1930' },
            { label: '📋 File a Report →', href: 'report.html?type=Investment%20Scam' }
          ]
        },
        pitched: {
          say: ["Ask one question: is this SEBI-registered? If they can't give a clear, checkable registration number, walk away. Fake trading apps mimicking real brokers are extremely common right now."],
          cta: [{ label: '📖 Full Protection Guide', href: 'tips.html' }]
        }
      }
    },

    'Job Fraud': {
      start: 'entry',
      nodes: {
        entry: {
          say: ["Genuine employers do not charge you a registration, training-kit or refundable security fee to give you a job. That request alone is a strong sign of a scam. What happened?"],
          options: [
            { label: 'I already paid a fee', goto: 'paid' },
            { label: 'They are asking me to pay now', goto: 'asking' }
          ]
        },
        paid: {
          say: [
            'Stop any further payments immediately — paying more never gets your money back or a real job. Report it so the listing can be taken down before it catches someone else.',
            'This can be charged as cheating under BNS Section 318 — mention that when filing, along with the exact account or UPI ID the fee went to.'
          ],
          cta: [{ label: '📋 File a Report →', href: 'report.html?type=Job%20Fraud' }]
        },
        asking: {
          say: ["Don't pay. Ask instead for the company's official HR email on their real company domain, and verify independently by calling the company's listed number, not one the recruiter gives you."],
          cta: [{ label: '📖 Full Protection Guide', href: 'tips.html' }]
        }
      }
    },

    'SIM Swap': {
      start: 'entry',
      nodes: {
        entry: {
          say: ['If your phone suddenly shows "No Service" with no explanation, that\'s the single biggest warning sign of a SIM swap in progress. Is that happening right now?'],
          options: [
            { label: 'Yes, my SIM just stopped working', goto: 'active' },
            { label: 'No, just want to know the signs', goto: 'signs' }
          ]
        },
        active: {
          urgent: true,
          say: [
            "Go to a phone with internet access right now and call your bank's helpline to freeze your account — SIM swap is often followed quickly by an attempt to drain your bank account. Then contact your telecom operator to block the port.",
            'This can be charged as cheating by personation (BNS Section 319) — file with your telecom operator and 1930 in parallel, don\'t wait for one before starting the other.'
          ],
          cta: [
            { label: '📞 Call 1930 Now', href: 'tel:1930' },
            { label: '📋 File a Report →', href: 'report.html?type=SIM%20Swap' }
          ]
        },
        signs: {
          say: ['Watch for: sudden "No Service", a call asking you to "confirm" a SIM upgrade you didn\'t request, or an OTP for a SIM swap you didn\'t initiate. If any of those happen, act within minutes, not hours.'],
          cta: [{ label: '📖 Full Protection Guide', href: 'tips.html' }]
        }
      }
    }
  };

  const CHAT_TOP_CHIPS = [
    { label: '📞 Suspicious call (CBI/police/arrest)', goto: 'Digital Arrest' },
    { label: '🔢 Someone asked for my OTP', goto: 'OTP Scam' },
    { label: '📱 UPI / QR code fraud', goto: 'UPI Fraud' },
    { label: '🔗 Suspicious link or SMS', goto: 'Phishing' },
    { label: '💰 Fake loan app', goto: 'Fake Loan App' },
    { label: '🔒 Being blackmailed with photos', goto: 'Sextortion' },
    { label: '📈 Investment / trading scam', goto: 'Investment Scam' },
    { label: '💼 Fake job offer', goto: 'Job Fraud' },
    { label: '📵 SIM stopped working suddenly', goto: 'SIM Swap' },
    { label: '🔎 Just check a link for me', goto: '__checklink__' }
  ];

  const {
    isGeneralMoneyLoss, checkLink: checkLinkRaw, findLinkIn, detectIntent,
    extractIntroducedName, matchSmallTalk, speechProvider
  } = window.FraudShieldCore;
  const { analyzeMessage: analyzeMessageRaw } = window.FraudShieldMessage;

  // ── Observability, on this device only (lib/ops.js) ──
  // Every verdict leaves an event with fixed, enumerated facts (level, family, which rules fired, how long it took) and never the text. The summary is shown on the
  // assistant page and copied only if the person chooses; nothing here is transmitted (the page's security policy would refuse it).
  const Ops = window.FraudShieldOps || null;
  const ops = Ops ? (() => {
    let store; try { store = window.sessionStorage; } catch (e) { store = null; }
    const msg = window.FraudShieldMessage, topics = (window.FraudShieldFollowUp ? window.FraudShieldFollowUp.TOPICS.map(t => t[0]) : []).concat(window.FraudShieldKnowledge ? window.FraudShieldKnowledge.ENTRIES.map(e => e.id.replace(/_/g, '-')) : []);
    return Ops.createOps({ storage: store, known: { family: Object.keys(msg.FAMILIES), rules: msg.RULES.map(r => r.id).concat(['link-scam', 'link-suspicious', 'link-unverified'], Ops.LINK_CODES), topic: topics, code: Ops.ERROR_CODES } });
  })() : null;
  window.FraudShieldOpsInstance = ops;
  function track(event) { if (!ops) return; try { ops.record(event); window.dispatchEvent(new CustomEvent('fs:ops')); } catch (e) { /* observability must never break a verdict */ } }
  let lastMessageMs = null, lastLinkMs = null;
  const analyzeMessage = text => { const t0 = performance.now(), v = analyzeMessageRaw(text); lastMessageMs = performance.now() - t0; return v; };
  const checkLink = raw => { const t0 = performance.now(), r = checkLinkRaw(raw); lastLinkMs = performance.now() - t0; return r; };

  // Voice input. A browser's speech recognition normally sends the audio to its maker (Google for Chrome, Microsoft for Edge, Apple
  // for Safari), which would break "nothing you share leaves your device". So the microphone works in one of two honest ways:
  // on this device, when the browser offers local recognition (nothing leaves, no question asked), or after an explicit one-time choice
  // that names who receives the audio. FraudShield itself never receives it either way.
  const VOICE_CONSENT_KEY = 'fs_voice_consent_v1';

  // ── Shared session state (sessionStorage — survives navigating between pages
  //    AND switching between the floating widget and the full assistant page) ──
  function loadChatState() {
    try {
      const raw = sessionStorage.getItem('fs_cb_state');
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore corrupt state */ }
    return { flow: null, node: null, awaitingLink: false, voiceOut: false, voiceLang: 'en-IN', userName: null, last: null, log: [] };
  }
  function saveChatState(state) {
    try { sessionStorage.setItem('fs_cb_state', JSON.stringify(state)); } catch (e) { /* storage unavailable */ }
  }

  // ── Lazy-loaded OCR engine (Tesseract.js) — fetched only the first time
  //    someone attaches or pastes a screenshot. 100% client-side, MIT-licensed,
  //    no API key, no server round-trip for the image itself. ──
  let ocrEnginePromise = null;
  // OCR code and language data are served from this site (vendor/tesseract/),
  // not a CDN, so the screenshot never reaches a third party and OCR works offline.
  const OCR_BASE = new URL('vendor/tesseract/', document.baseURI).href;
  const QR_DECODER_URL = new URL('vendor/jsqr/jsQR.js', document.baseURI).href;
  function loadOcrEngine() {
    if (ocrEnginePromise) return ocrEnginePromise;
    ocrEnginePromise = new Promise((resolve, reject) => {
      if (window.Tesseract) { resolve(window.Tesseract); return; }
      const s = document.createElement('script');
      s.src = OCR_BASE + 'tesseract.min.js';
      s.onload = () => (window.Tesseract ? resolve(window.Tesseract) : reject(new Error('tesseract-missing')));
      s.onerror = () => reject(new Error('tesseract-load-failed'));
      document.head.appendChild(s);
    });
    return ocrEnginePromise;
  }

  // The one text-reading engine, kept hot between pictures and ended when idle, when the chat closes or when the page is hidden (lib/ocrworker.js).
  const ocr = window.FraudShieldOcr
    ? window.FraudShieldOcr.createOcr({ load: loadOcrEngine, langs: 'eng+hin', idleMs: 120000, options: { workerPath: OCR_BASE + 'worker.min.js', corePath: OCR_BASE, langPath: OCR_BASE + 'lang' } })
    : null;
  window.addEventListener('pagehide', () => { if (ocr) ocr.release(); if (speaker) speaker.stop(); });

  // ── Voice output — shared Indian-voice picker + speak() for both mounts ──
  let cbCachedVoices = [];
  function loadCbVoices() {
    const v = window.speechSynthesis && window.speechSynthesis.getVoices();
    if (v && v.length) cbCachedVoices = v;
  }
  if (window.speechSynthesis) {
    loadCbVoices();
    window.speechSynthesis.onvoiceschanged = loadCbVoices;
  }
  // Only on-device voices. A network voice (e.g. Chrome's "Google ..." voices)
  // sends the reply text to a server to be synthesised, which breaks the privacy
  // promise. If no local voice exists, spoken replies are simply unavailable.
  function pickIndianVoice() {
    const local = cbCachedVoices.filter(v => v.localService);
    const prefer = ['Rishi', 'Veena', 'Microsoft Ravi - English (India)', 'Microsoft Heera - English (India)'];
    for (const name of prefer) {
      const v = local.find(vv => vv.name === name);
      if (v) return v;
    }
    return local.find(v => v.lang === 'en-IN') || local.find(v => v.lang.indexOf('en') === 0) || null;
  }
  // One speaker for the page: the queue lives in JS and the engine gets one short chunk at a time (see lib/speech.js for why).
  const speaker = window.FraudShieldSpeech && window.speechSynthesis && typeof window.SpeechSynthesisUtterance === 'function'
    ? window.FraudShieldSpeech.createSpeaker({ synth: window.speechSynthesis, Utterance: window.SpeechSynthesisUtterance, pickVoice: pickIndianVoice, rate: 0.95 })
    : null;
  function speakText(text) { return speaker ? speaker.say(text) : 0; }

  // ── The chat engine itself — mounted by both initChatbot() (floating widget)
  //    and initAssistantPage() (assistant.html), each passing its own DOM refs. ──
  const FollowUp = window.FraudShieldFollowUp || null, Msg = window.FraudShieldMessage || null, Know = window.FraudShieldKnowledge || null, Utter = window.FraudShieldUtterance || null;
  function buildChatController(dom) {
    const state = loadChatState();
    function persist() { saveChatState(state); }


    function scrollToBottom() { dom.messagesEl.scrollTop = dom.messagesEl.scrollHeight; }

    function addMessage(text, from, urgent) {
      const div = document.createElement('div');
      div.className = 'cb-msg cb-msg--' + from + (urgent ? ' cb-msg--urgent' : '');
      div.textContent = text;
      dom.messagesEl.appendChild(div);
      scrollToBottom();
      state.log.push({ text, from });
      persist();
      if (from === 'bot' && state.voiceOut) speakText(text);
    }

    function addImageMessage(objectUrl) {
      const div = document.createElement('div');
      div.className = 'cb-msg cb-msg--user cb-msg--image';
      const img = document.createElement('img');
      img.src = objectUrl;
      img.alt = 'Screenshot you shared';
      div.appendChild(img);
      dom.messagesEl.appendChild(div);
      scrollToBottom();
    }

    function addChips(options) {
      const row = document.createElement('div');
      row.className = 'cb-chips';
      options.forEach(opt => {
        const el = document.createElement(opt.href ? 'a' : 'button');
        el.className = 'cb-chip' + (opt.cta ? ' cb-chip--cta' : '');
        el.textContent = opt.label;
        if (opt.href) {
          el.href = opt.href;
          if (/^https?:/i.test(opt.href)) { el.target = '_blank'; el.rel = 'noopener'; }
        } else {
          el.type = 'button';
          el.addEventListener('click', () => { row.remove(); opt.action(); });
        }
        row.appendChild(el);
      });
      dom.messagesEl.appendChild(row);
      scrollToBottom();

      // The bot's turn just genuinely ended (it's showing options and waiting
      // on the user again) — if this reply was triggered by voice, re-open
      // the mic now for a real back-and-forth conversation. Never while the
      // bot is still speaking: wait for its last line to finish first, so
      // the mic can't hear the bot's own voice and reply to itself.
      if (voiceTurnPending) {
        voiceTurnPending = false;
        if (state.voiceOut && speaker && speaker.busy) {
          speaker.whenIdle(() => startListening());
        } else {
          startListening();
        }
      }
    }

    function showTyping() {
      const t = document.createElement('div');
      t.className = 'cb-typing';
      t.dataset.cbTyping = '1';
      t.innerHTML = '<span></span><span></span><span></span>';
      dom.messagesEl.appendChild(t);
      scrollToBottom();
    }
    function hideTyping() {
      const t = dom.messagesEl.querySelector('[data-cb-typing]');
      if (t) t.remove();
    }

    function botSay(lines, opts) {
      opts = opts || {};
      const arr = Array.isArray(lines) ? lines.slice() : [lines];
      function next() {
        if (!arr.length) {
          const acts = [];
          (opts.options || []).forEach(o => acts.push(o));
          (opts.cta || []).forEach(c => acts.push({ label: c.label, href: c.href, cta: true }));
          if (!opts.noMenuChip) acts.push({ label: '🏠 Main Menu', action: showMainMenu });
          if (acts.length) addChips(acts);
          if (opts.onDone) opts.onDone();
          return;
        }
        const line = arr.shift();
        showTyping();
        setTimeout(() => {
          hideTyping();
          addMessage(line, 'bot', opts.urgent);
          next();
        }, 420 + Math.random() * 260);
      }
      next();
    }

    function buildOptionsForNode(flowKey, node) {
      return (node.options || []).map(o => ({ label: o.label, action: () => goToNode(flowKey, o.goto) }));
    }
    function goToNode(flowKey, nodeId) {
      const node = CHAT_FLOWS[flowKey].nodes[nodeId];
      state.flow = flowKey; state.node = nodeId; persist();
      botSay(node.say, { urgent: node.urgent, options: buildOptionsForNode(flowKey, node), cta: node.cta });
    }
    function buildMainMenuOptions() {
      return CHAT_TOP_CHIPS.map(c => ({
        label: c.label,
        action: () => { c.goto === '__checklink__' ? askForLink() : goToNode(c.goto, CHAT_FLOWS[c.goto].start); }
      }));
    }
    function showMainMenu() {
      state.flow = null; state.node = null; persist();
      const who = state.userName ? ', ' + state.userName : '';
      botSay(['What would you like help with' + who + '? You can also paste a screenshot.'], { options: buildMainMenuOptions(), noMenuChip: true });
    }
    function askForLink() {
      state.awaitingLink = true; persist();
      botSay(['Paste the link, phone number or UPI ID you want me to check, or attach a photo of the QR code.'], { noMenuChip: true });
    }
    // The chat remembers its last verdict so that "how do I block this number?" or "is it safe?" is answered about it (lib/followup.js).
    function remember(verdict) { if (FollowUp) { state.last = FollowUp.remember(verdict, Date.now()); persist(); } }
    function respondToLink(raw) {
      const result = checkLink(raw), scam = result.level === 'scam';
      remember({ kind: result.kind || 'url', level: result.level, headline: result.headline, evidence: (result.reasons || []).map(r => ({ quote: '', label: r })) });
      track({ kind: 'link', level: result.level, rules: result.codes, ms: lastLinkMs, nameModel: result.nameModel });
      emitMood({ reaction: scam ? 'scam' : 'curious' });
      const icon = { official: '✅', scam: '🚫', suspicious: '⚠️', unverified: '❔' }[result.level] || '⚠️';
      botSay([
        icon + ' ' + result.headline,
        result.reasons.join(' ') + ' Never enter your OTP, UPI PIN, or password after clicking a link or scanning a code, even if it looks official.' + modelNotice(result)
      ], { urgent: scam, cta: scam ? [{ label: '📞 Paid or shared details? Call 1930', href: 'tel:1930' }] : undefined });
    }
    // A pasted scam talks TO the reader ("your KYC expires"); a person describing what happened talks about themselves ("I got a call").
    const DESCRIBING_SELF = /^\s*(?:i|my|me|we|mera|meri|mujhe|hum)\b|\b(?:i|we)\s+(?:got|received|have|was|am|just|clicked|paid|shared|lost)\b/i;
    const justALink = (text, link) => !!link && link.length >= text.trim().length * 0.8;

    function respondToMessage(v) {
      remember({ kind: 'message', level: v.level, family: v.family, intent: v.intent, headline: v.headline, evidence: v.evidence });
      track({ kind: 'message', level: v.level, family: v.family, rules: v.codes, ms: lastMessageMs });
      emitMood({ reaction: v.level === 'scam' ? 'scam' : 'curious' });
      const scam = v.level === 'scam', why = v.evidence.slice(0, 4).map(e => '• "' + e.quote + '": ' + e.label).join('\n');
      botSay([
        (scam ? '🚫 ' : '⚠️ ') + v.headline,
        'What gave it away:\n' + why,
        v.next.join(' ')
      ], {
        urgent: scam, noMenuChip: true,
        cta: scam ? [{ label: '📞 Paid or shared details? Call 1930', href: 'tel:1930' }] : undefined,
        options: [
          ...(v.intent ? [{ label: '🧭 Walk me through what to do', action: () => goToNode(v.intent, CHAT_FLOWS[v.intent].start) }] : []),
          { label: '😟 I already clicked, paid or shared', action: respondToGeneralLoss },
          { label: '🏠 Main Menu', action: showMainMenu }
        ]
      });
    }

    function respondToNothingFound(v) {
      remember({ kind: 'message', level: 'nothing', headline: v.headline, evidence: [] });
      track({ kind: 'message', level: 'nothing', ms: lastMessageMs });
      botSay(['❔ ' + v.headline, v.next.join(' ')], { options: buildMainMenuOptions(), noMenuChip: true });
    }

    function answerFollowUp(f) {
      track({ kind: 'followup', topic: f.topic });
      const buttons = {
        call1930: { label: '📞 Call 1930', href: 'tel:1930', cta: true }, report: { label: '📝 Report online', href: 'report.html' },
        menu: { label: '🏠 Main Menu', action: showMainMenu }, loss: { label: '😟 I already clicked, paid or shared', action: respondToGeneralLoss },
        steps: { label: '🧭 What should I do?', action: () => answerFollowUp(FollowUp.route('what do I do now', state.last, Msg && Msg.FAMILIES, Date.now())) }
      };
      const acts = f.options.map(k => buttons[k]).filter(Boolean);
      botSay(f.lines, { urgent: f.topic === 'paid', noMenuChip: true, options: acts.filter(a => !a.cta), cta: acts.filter(a => a.cta).map(a => ({ label: a.label, href: a.href })) });
    }

    function respondToGeneralLoss() {
      botSay([
        "I'm sorry this happened — let's move fast. Call your bank's helpline right now and report it as a fraudulent transaction. Ask them to block your card or account, and note the complaint number. Under RBI's rules you are generally protected from losses that happen after you report an unauthorised transaction, and delay can cost you that protection. Then call 1930 and report at cybercrime.gov.in too: the sooner the report, the better the chance of freezing the money before it moves on. If any of it is frozen, you can later apply to get it back through the Money Restoration Module on cybercrime.gov.in, using your complaint number.",
        'To get you more specific next steps, what caused it — a phone call, a link, a QR code, or something else? Or pick the closest match below.'
      ], { urgent: true, cta: [{ label: '📞 Call 1930 Now', href: 'tel:1930' }], options: buildMainMenuOptions() });
    }
    function respondToFreeText(text) {
      const linkMatch = findLinkIn(text);
      if (state.awaitingLink) {
        state.awaitingLink = false; persist();
        const asked = justALink(text, linkMatch) ? null : analyzeMessage(text);
        if (asked && asked.level !== 'nothing') respondToMessage(asked); else respondToLink(text);
        return;
      }
      if (justALink(text, linkMatch)) { respondToLink(linkMatch); return; }
      const pasted = DESCRIBING_SELF.test(text) ? null : analyzeMessage(text);
      if (pasted && pasted.level !== 'nothing') { respondToMessage(pasted); return; }
      if (linkMatch) { respondToLink(linkMatch); return; }

      // A question about the tool, a scam in general or the official routes (lib/knowledge.js). Half a sentence is not answered, and someone describing what happened to them ("I got a call and ...") still goes to the guided flow.
      const intent = detectIntent(text);
      const know = Know && !(Utter && Utter.isIncomplete(text)) && Know.route(text);
      const knowAnswers = know && (Know.isQuestion(text) || !(intent || isGeneralMoneyLoss(text)));

      // A short question right after a verdict is about that verdict, not a new message to scan. A question the knowledge layer can answer ("who made this?", "is my data safe here?", "what is 1930?") is about the tool or the topic, so it wins, except
      // "I already paid / clicked / shared": that is about the person's own loss and always gets the steps.
      const follow = FollowUp && FollowUp.route(text, state.last, Msg && Msg.FAMILIES, Date.now());
      if (follow && !(knowAnswers && follow.topic !== 'paid')) { answerFollowUp(follow); return; }
      if (knowAnswers) { answerKnowledge(know.entry); return; }
      if (intent) {
        botSay(['That sounds like ' + intent + " — let's go through it step by step."], { noMenuChip: true, onDone: () => goToNode(intent, CHAT_FLOWS[intent].start) });
        return;
      }

      if (isGeneralMoneyLoss(text)) { respondToGeneralLoss(); return; }

      const introducedName = extractIntroducedName(text);
      if (introducedName) {
        state.userName = introducedName; persist();
        botSay(['Nice to meet you, ' + introducedName + "! I'll remember that for our chat."], { options: buildMainMenuOptions(), noMenuChip: true });
        return;
      }

      const smallTalk = matchSmallTalk(text);
      if (smallTalk) {
        botSay(smallTalk.reply(state.userName), smallTalk.noMenu ? { noMenuChip: true } : { options: buildMainMenuOptions(), noMenuChip: true });
        return;
      }

      if (text.length >= 60) {
        const late = analyzeMessage(text);
        if (late.level !== 'nothing') { respondToMessage(late); return; }
        respondToNothingFound(late);
        return;
      }
      respondToUnanswered(text);
    }

    // The answer to a question the tool does know: the text, the official links that go with it, a guided flow when the question is about one scam, and two follow-up questions.
    function answerKnowledge(entry) {
      track({ kind: 'faq', topic: entry.id.replace(/_/g, '-') });
      const options = [];
      (entry.links || []).forEach(l => options.push({ label: l.label, href: l.href, cta: !!l.cta }));
      if (entry.act === 'check') options.push({ label: '🔎 Check a link, number or UPI ID', action: askForLink });
      if (entry.flow && CHAT_FLOWS[entry.flow]) options.push({ label: 'Walk me through it', action: () => goToNode(entry.flow, CHAT_FLOWS[entry.flow].start) });
      (entry.rel || []).slice(0, 2).forEach(id => { const r = Know.byId(id); if (r) options.push({ label: r.q, action: () => handleUserInput(r.q) }); });
      botSay(entry.a, { urgent: entry.id === 'emergency', options });
    }
    // Nothing matched. Say so, say what this tool is, and offer questions it can answer; never a guess and never a bare menu.
    function respondToUnanswered(text) {
      track({ kind: 'unanswered' });
      const cut = Utter && Utter.isIncomplete(text);
      const options = (Know ? Know.suggest(text, 3) : []).map(e => ({ label: e.q, action: () => handleUserInput(e.q) }));
      options.push({ label: 'Describe what happened', action: showMainMenu });
      botSay([cut
        ? 'That sounds cut off, so I did not try to answer it. Say or type the whole question, or pick one of these:'
        : "I don't have an answer for that. I am a rules-based assistant, so I only know how to check a message, link or QR code, the common scams, and where to report fraud in India. These are things I can answer:"], { options, noMenuChip: true });
    }

    function greet() {
      botSay(["Hi — I'm the FraudShield Assistant. Type what happened, paste a link, or share a screenshot or QR code, and I'll guide you step by step."], { onDone: showMainMenu, noMenuChip: true });
    }

    function handleUserInput(rawText) {
      const text = rawText.trim();
      if (!text) return;
      voiceCarry = ''; voiceHolds = 0; voiceHold = false;
      addMessage(text, 'user');
      dom.inputEl.value = '';
      respondToFreeText(text);
    }

    // ── Image (screenshot) handling — client-side OCR, no server, no API key ──
    function showOcrProgress(label) {
      const div = document.createElement('div');
      div.className = 'cb-msg cb-msg--bot cb-msg--ocr';
      div.textContent = label;
      dom.messagesEl.appendChild(div);
      scrollToBottom();
      return div;
    }
    function updateOcrProgress(el, label) {
      if (!el || !el.isConnected) return;
      el.textContent = label;
      el.setAttribute('aria-hidden', 'true');   // announced once when it appeared; a percentage that changes every moment must not be read out each time
      scrollToBottom();
    }

    // One picture at a time, and never the raw camera frame: lib/imageprep.js reads the size from the file header, asks the browser for a
    // reduced decode, and hands back a JPEG inside a 2.8 megapixel budget. That blob is what the chat shows, what the QR scan reads and
    // what the text reader gets, so a 48 megapixel photo never sits in memory in full anywhere in this path.
    let imageJobActive = false;
    function handleImageFile(file) {
      if (!file || file.type.indexOf('image/') !== 0) return;
      if (imageJobActive) { botSay(['One picture at a time, please. Let me finish reading the last one first.']); return; }
      if (file.size > 25 * 1024 * 1024) {
        botSay(['That file is over 25 MB. Take a screenshot of the message instead of sending the original photo, and I\'ll read it.']);
        return;
      }
      const Prep = window.FraudShieldImagePrep;
      if (!Prep) { botSay(['The image reader did not load on this page. Reload the page, or type or say what the message says.']); return; }
      imageJobActive = true;
      const progressEl = showOcrProgress('🖼️ Preparing the picture…');
      Prep.prepare(file).then(blob => {
        addImageMessage(URL.createObjectURL(blob));
        updateOcrProgress(progressEl, '🔍 Looking for a QR code…');
        const qr = window.FraudShieldQR, none = { text: null, structure: { qr: false, certainty: null } };
        return (qr && qr.inspect ? qr.inspect(blob, { decoderUrl: QR_DECODER_URL }) : Promise.resolve(none)).catch(() => none).then(found => {
          if (found.text) {
            progressEl.remove();
            botSay(['I found a QR code in that image. It contains: "' + found.text.replace(/\s+/g, ' ').slice(0, 200) + '"'], { noMenuChip: true, onDone: () => respondToLink(found.text) });
          } else if (found.structure && found.structure.qr) {
            respondToUnreadableQr(progressEl, found.structure);   // a code is there and cannot be read: never fall back to the words around it
          } else {
            return readTextFromImage(blob, progressEl);
          }
        });
      }).catch(err => {
        progressEl.remove();
        track({ kind: 'error', code: err && err.code === 'too-large' ? 'prepare-too-large' : 'prepare-unreadable' });
        botSay([err && err.code === 'too-large'
          ? 'That picture is enormous (over 150 megapixels), which is not a normal photo. Take a screenshot of the message instead.'
          : 'I could not open that picture. It may be damaged or not an image this browser can read. Try a screenshot, or type or say what the message says.']);
      }).then(() => { imageJobActive = false; });
    }

    // A QR code is in the picture but could not be read (covered by a logo, torn, glared over, blurred, at a hard angle). The text around it ("Scan to pay Rs 5000")
    // says nothing about where a scan would send the money, so the picture is NOT passed on to the text reader and there is no verdict from it, only a stop.
    function respondToUnreadableQr(progressEl, structure) {
      progressEl.remove();
      const part = structure && structure.certainty === 'partial';
      const headline = part ? 'I can see part of what looks like a QR code, but I cannot read it.' : 'I can see a QR code in this picture, but I cannot read it.';
      track({ kind: 'qr', level: 'unverified' });
      remember({ kind: 'qr', level: 'unverified', headline, evidence: [{ quote: '', label: 'The picture has the corner markers of a QR code, but its content could not be decoded.' }] });
      emitMood({ reaction: 'curious' });
      botSay(['⚠️ ' + headline + ' It may be covered by a logo or sticker, torn, blurred, shiny, or photographed at a hard angle.',
        'Do not scan it. I cannot tell where it would send your money, and I will not guess from the words around it.',
        'If you need to pay, ask for the UPI ID or the payment link in writing and send that to me, or take the photo again: straight on, close up, in good light.'],
      { urgent: true, options: [{ label: '📷 Try another picture', action: () => { if (dom.fileInput) dom.fileInput.click(); } }] });
    }

    function readTextFromImage(blob, progressEl) {
      updateOcrProgress(progressEl, '🔍 Preparing image reader…');
      const wasHot = !!(ocr && ocr.hot), t0 = performance.now();
      return (ocr ? ocr.recognize(blob, m => {
        if (m.status === 'recognizing text') updateOcrProgress(progressEl, '🔍 Reading image — ' + Math.round((m.progress || 0) * 100) + '%');
        else if (m.status) updateOcrProgress(progressEl, '🔍 ' + m.status.charAt(0).toUpperCase() + m.status.slice(1) + '…');
      }) : Promise.reject(new Error('ocr-module-missing')))
        .then(({ data }) => {
          progressEl.remove();
          track({ kind: 'ocr', ms: performance.now() - t0, hot: wasHot });
          const text = ((data && data.text) || '').trim();
          if (!text || text.length < 4) {
            botSay(["I couldn't read clear text from that image — could you type or say what it says instead?"]);
            return;
          }
          botSay(['Here\'s what I read from the image (no QR code found in it): "' + text.replace(/\s+/g, ' ').slice(0, 400) + '"'], {
            noMenuChip: true,
            onDone: () => respondToFreeText(text)
          });
        })
        .catch(err => {
          progressEl.remove();
          track({ kind: 'error', code: ocr ? 'ocr-failed' : 'ocr-module-missing' });
          console.error('FraudShield: the text reader failed (' + (err && err.message ? err.message : err) + ').');
          botSay(["The image reader could not run on this device (the page may not have finished loading it, or the browser ran out of memory). Reload the page and try a smaller screenshot, or type or say what the message said."]);
        });
    }

    // ── Voice input: on this device when the browser can, otherwise only after an explicit choice ──
    const SRClass = window.SpeechRecognition || window.webkitSpeechRecognition;
    let recognition = null;
    let voiceModeInUse = null;      // 'device' or 'cloud', set when the person starts the microphone
    let skipDevice = false;         // the browser said it has no on-device model for this language
    let consentThisVisit = false;
    // Set right before a voice-submitted message is handled; consumed the
    // moment the bot's reply finishes rendering (see addChips below) to
    // re-open the mic automatically — a real back-and-forth conversation
    // instead of click-talk-click-talk every turn. Never armed while the
    // bot is mid-speech, so the mic can't hear the bot's own voice and
    // trigger itself (no feedback loop).
    let voiceTurnPending = false;
    // A recognised result that stops mid-sentence ("What is the main purpose of") is held and the microphone reopened, so the rest is added instead of answering half a question.
    let voiceCarry = '', voiceHolds = 0, voiceHold = false;
    const MAX_VOICE_HOLDS = 2;

    const voiceLang = () => (state.voiceLang === 'hi-IN' ? 'hi-IN' : 'en-IN');
    const readConsent = () => { try { return localStorage.getItem(VOICE_CONSENT_KEY) === 'cloud'; } catch (e) { return false; } };
    const saveConsent = () => { consentThisVisit = true; try { localStorage.setItem(VOICE_CONSENT_KEY, 'cloud'); } catch (e) { /* the choice then lasts for this visit only */ } };
    const listeningLabel = () => (voiceModeInUse === 'device' ? 'Listening… (on this device)' : 'Listening… (audio goes to ' + speechProvider(navigator.userAgent) + ')');

    // 'device' when the browser can recognise speech locally (nothing leaves), 'cloud' once the person has agreed, otherwise 'ask'.
    async function voiceMode() {
      if (!skipDevice && typeof SRClass.available === 'function') {
        try { if ((await SRClass.available({ langs: [voiceLang()], processLocally: true })) === 'available') return 'device'; } catch (e) { /* not offered here: fall through */ }
      }
      return consentThisVisit || readConsent() ? 'cloud' : 'ask';
    }

    function ensureRecognition() {
      if (recognition || !SRClass) return recognition;
      const micPlaceholder = dom.inputEl.placeholder;
      recognition = new SRClass();
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      recognition.onresult = e => {
        let finalTranscript = '', interimTranscript = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const transcript = e.results[i][0].transcript;
          if (e.results[i].isFinal) finalTranscript += transcript;
          else interimTranscript += transcript;
        }
        // Show live captions in the input as you speak, so it never feels
        // like a silent black box — this is the visible feedback loop
        // most voice UIs give you and this one was missing.
        dom.inputEl.value = finalTranscript || interimTranscript;
        if (finalTranscript) {
          const joined = (voiceCarry + ' ' + finalTranscript).trim();
          if (Utter && Utter.isIncomplete(joined) && voiceHolds < MAX_VOICE_HOLDS) {
            voiceCarry = joined; voiceHolds++; voiceHold = true;
            dom.inputEl.value = joined;
            return;
          }
          voiceCarry = ''; voiceHolds = 0; voiceHold = false;
          voiceTurnPending = true;
          handleUserInput(joined);
        }
      };
      recognition.onstart = () => { dom.inputEl.placeholder = listeningLabel(); };
      recognition.onend = () => {
        dom.micBtn.classList.remove('cb-mic--live'); dom.micBtn.setAttribute('aria-pressed', 'false');
        dom.inputEl.placeholder = micPlaceholder;
        if (voiceHold) { voiceHold = false; setTimeout(() => startListening(), 120); }   // the sentence was cut off: keep listening for the rest
      };
      recognition.onerror = e => {
        dom.micBtn.classList.remove('cb-mic--live'); dom.micBtn.setAttribute('aria-pressed', 'false');
        dom.inputEl.placeholder = micPlaceholder;
        // Every branch ends in a message and none latches: a denied permission can be fixed in the browser, so the next tap must be
        // allowed to try again. (Before, one denial switched the microphone off until the page was reloaded.)
        if (e.error === 'not-allowed') {
          botSay(['The microphone is blocked. Click the 🔒 (or site settings) next to the address bar and allow the microphone for this site. On a Mac also open System Settings → Privacy & Security → Microphone and tick your browser. Then tap 🎤 again, or just type.']);
        } else if (e.error === 'service-not-allowed') {
          botSay(["Voice recognition is switched off for this browser. On a Mac using Safari, turn on Dictation in System Settings → Keyboard → Dictation, then tap 🎤 again. You can still type any time."]);
        } else if (e.error === 'language-not-supported') {
          skipDevice = true;
          botSay(["That language isn't available for on-device voice in this browser. Tap 🎤 again to use your browser's speech service instead (I'll ask first), or type."]);
        } else if (e.error === 'no-speech') {
          // Nothing more was said after a held, cut-off sentence: answer what there is rather than lose it.
          if (voiceCarry) { const held = voiceCarry; voiceCarry = ''; voiceHolds = 0; voiceHold = false; voiceTurnPending = false; handleUserInput(held); return; }
          botSay(["I didn't catch that — try again, or type your message."]);
        } else if (e.error === 'audio-capture') {
          botSay(["I can't reach a microphone on this device — check nothing else (another app or tab) is already using it, or type your message."]);
        } else if (e.error === 'network') {
          botSay(['Voice recognition needs an internet connection — check your connection and try again, or type your message.']);
        } else if (e.error === 'aborted') {
          // User- or system-initiated stop — not a failure, no message needed.
        } else {
          botSay(["Voice input hit an unexpected problem (" + e.error + ") — you can still type your message."]);
        }
      };
      return recognition;
    }

    function startListening(mode) {
      const rec = ensureRecognition();
      if (!rec) return;
      if (mode) voiceModeInUse = mode;
      if (!voiceModeInUse) return;                    // never open the microphone before a mode, and so a consent, exists
      rec.lang = voiceLang();
      if ('processLocally' in rec) rec.processLocally = voiceModeInUse === 'device';
      try {
        rec.start();
        dom.micBtn.classList.add('cb-mic--live'); dom.micBtn.setAttribute('aria-pressed', 'true');
      } catch (e) {
        // InvalidStateError just means it's already running — safe to ignore.
        // Anything else was failing completely silently before this fix.
        if (e.name !== 'InvalidStateError') {
          botSay(['Voice input could not start — you can still type your message.']);
        }
      }
    }

    function askVoiceConsent() {
      const who = speechProvider(navigator.userAgent);
      botSay(['🎤 Voice needs one decision from you. To turn speech into text, this browser sends your audio to ' + who + ". FraudShield never receives it, and nothing else on this site uses your microphone. If you'd rather not, type instead: everything else here stays on your device."], {
        noMenuChip: true,
        options: [
          { label: '🎤 Allow voice (audio goes to ' + who + ')', action: () => { saveConsent(); startListening('cloud'); } },
          { label: '⌨️ No, I will type', action: () => botSay(['Understood. Nothing was recorded.'], { noMenuChip: true }) }
        ]
      });
    }

    if (dom.micBtn) {
      dom.micBtn.setAttribute('aria-pressed', 'false');
      dom.micBtn.addEventListener('click', async () => {
        if (!SRClass) {
          // Never fail silently — a hidden/dead button with no explanation
          // looks exactly like "voice doesn't work" when it's really just
          // unsupported here. Say so plainly instead.
          botSay(["Voice input isn't supported in this browser — it needs Chrome, Edge, or Safari. You can still type, or paste a screenshot."]);
          return;
        }
        if (dom.micBtn.classList.contains('cb-mic--live') && recognition) { voiceHold = false; voiceCarry = ''; voiceHolds = 0; recognition.stop(); return; }
        voiceCarry = ''; voiceHolds = 0; voiceHold = false;
        const mode = await voiceMode();
        if (mode === 'ask') { askVoiceConsent(); return; }
        startListening(mode);
      });
    }
    if (dom.langBtn) {
      const paint = () => {
        const hindi = voiceLang() === 'hi-IN';
        dom.langBtn.textContent = hindi ? 'हिं' : 'EN';
        dom.langBtn.setAttribute('aria-label', 'Voice language: ' + (hindi ? 'Hindi' : 'English') + '. Tap to switch to ' + (hindi ? 'English' : 'Hindi'));
        dom.langBtn.title = dom.langBtn.getAttribute('aria-label');
      };
      paint();
      dom.langBtn.addEventListener('click', () => {
        state.voiceLang = voiceLang() === 'hi-IN' ? 'en-IN' : 'hi-IN'; persist(); skipDevice = false; paint();
        if (recognition && dom.micBtn.classList.contains('cb-mic--live')) recognition.stop();
      });
    }

    // ── Voice output toggle ──
    // A screen reader announces new messages in this log (aria-live), and spoken replies would say them a second time, in a different voice, at
    // the same moment. So the two are never on together: while spoken replies are on the log stays silent to screen readers, and when they are
    // switched off it is announced again. A separate status line says which is in force, so nobody is left guessing.
    const liveNote = document.createElement('p');
    liveNote.className = 'sr-only'; liveNote.setAttribute('role', 'status');
    dom.messagesEl.insertAdjacentElement('afterend', liveNote);
    function syncVoiceOut(announce) {
      dom.messagesEl.setAttribute('aria-live', state.voiceOut ? 'off' : 'polite');
      if (dom.voiceToggleBtn) {
        dom.voiceToggleBtn.setAttribute('aria-pressed', String(!!state.voiceOut));
        dom.voiceToggleBtn.textContent = state.voiceOut ? '🔊' : '🔇';
        dom.voiceToggleBtn.classList.toggle('cb-header__btn--active', !!state.voiceOut);
      }
      if (announce) liveNote.textContent = state.voiceOut
        ? 'Spoken replies on. The assistant now speaks new messages, so your screen reader will not read them out a second time.'
        : 'Spoken replies off. New messages are announced by your screen reader.';
    }
    if (dom.voiceToggleBtn) {
      if (!window.speechSynthesis) {
        dom.voiceToggleBtn.hidden = true;
        if (state.voiceOut) { state.voiceOut = false; persist(); }
        syncVoiceOut(false);
      } else {
        dom.voiceToggleBtn.setAttribute('aria-label', 'Spoken replies');
        syncVoiceOut(false);
        dom.voiceToggleBtn.addEventListener('click', () => {
          state.voiceOut = !state.voiceOut; persist();
          if (!state.voiceOut && speaker) speaker.stop();
          syncVoiceOut(true);
        });
      }
    } else syncVoiceOut(false);

    // ── Text input wiring ──
    dom.sendBtn.addEventListener('click', () => handleUserInput(dom.inputEl.value));
    dom.inputEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); handleUserInput(dom.inputEl.value); } });

    // ── Attach (image or audio) — button + clipboard paste support ──
    if (dom.attachBtn && dom.fileInput) {
      dom.attachBtn.addEventListener('click', () => { if (ocr) ocr.warm(); dom.fileInput.click(); });   // the reader starts while the picture is being chosen
      dom.fileInput.addEventListener('change', () => {
        const file = dom.fileInput.files && dom.fileInput.files[0];
        dom.fileInput.value = '';
        if (!file) return;
        if (file.type.indexOf('image/') === 0) handleImageFile(file);
        else botSay(["I can read screenshots (images) — that file type isn't supported."]);
      });
    }
    dom.inputEl.addEventListener('paste', e => {
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.indexOf('image/') === 0) {
          const file = item.getAsFile();
          if (file) { e.preventDefault(); handleImageFile(file); }
          return;
        }
      }
    });

    function restore() {
      if (!state.log.length) return false;
      state.log.forEach(m => {
        const div = document.createElement('div');
        div.className = 'cb-msg cb-msg--' + m.from;
        div.textContent = m.text;
        dom.messagesEl.appendChild(div);
      });
      scrollToBottom();
      if (state.flow && state.node && CHAT_FLOWS[state.flow] && CHAT_FLOWS[state.flow].nodes[state.node]) {
        const node = CHAT_FLOWS[state.flow].nodes[state.node];
        const acts = buildOptionsForNode(state.flow, node);
        (node.cta || []).forEach(c => acts.push({ label: c.label, href: c.href, cta: true }));
        acts.push({ label: '🏠 Main Menu', action: showMainMenu });
        addChips(acts);
      } else if (!state.awaitingLink) {
        addChips(buildMainMenuOptions());
      }
      return true;
    }

    return { state, restore, greet, showMainMenu };
  }

  // ═══════════════════════════════════════════════════════
  // Floating widget mount — every page except assistant.html
  // ═══════════════════════════════════════════════════════
  function initChatbot() {
    if (document.getElementById('assistantRoot')) return;
    if (document.getElementById('cbFab')) return;

    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <button id="cbFab" class="cb-fab" aria-label="Open FraudShield Assistant" aria-expanded="false">
        <span id="cbFabIcon">🛡️</span><span class="cb-fab__dot" id="cbDot" hidden></span>
      </button>
      <div id="cbPanel" class="cb-panel" role="dialog" aria-modal="false" aria-label="FraudShield Assistant chat">
        <div class="cb-header">
          <span class="cb-header__icon">🛡️</span>
          <div class="cb-header__text">
            <p class="cb-header__title">FraudShield Assistant</p>
            <p class="cb-header__sub">Text · screenshots · QR codes — free and private</p>
          </div>
          <button id="cbVoiceToggle" class="cb-header__btn" type="button" aria-label="Toggle spoken replies" title="Read replies aloud">🔊</button>
          <button id="cbClose" class="cb-header__btn" type="button" aria-label="Close assistant">✕</button>
        </div>
        <div class="cb-quickbar">
          <a href="tel:1930" class="cb-quickbar__sos">📞 1930</a>
          <button id="cbMenuBtn" type="button">🏠 Main Menu</button>
          <a href="assistant.html" class="cb-quickbar__expand" title="Open full-screen assistant">⤢ Full Screen</a>
        </div>
        <div id="cbMessages" class="cb-messages" aria-live="polite"></div>
        <div class="cb-inputrow">
          <input id="cbInput" class="cb-input" type="text" placeholder="Type or paste here…" autocomplete="off" aria-label="Message to FraudShield Assistant">
          <button id="cbAttach" class="cb-attach" type="button" aria-label="Attach a screenshot or QR code" title="Attach a screenshot or QR code">📎</button>
          <input id="cbFile" type="file" accept="image/*" hidden>
          <button id="cbLang" class="cb-attach cb-lang" type="button">EN</button>
        <button id="cbMic" class="cb-mic" type="button" aria-label="Speak your message" title="Speak">🎤</button>
          <button id="cbSend" class="cb-send" type="button" aria-label="Send message">➤</button>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);

    const fab = document.getElementById('cbFab');
    const fabIcon = document.getElementById('cbFabIcon');
    const dot = document.getElementById('cbDot');
    const panel = document.getElementById('cbPanel');
    const closeBtn = document.getElementById('cbClose');
    const menuBtn = document.getElementById('cbMenuBtn');

    if (!localStorage.getItem('fs_cb_seen')) dot.hidden = false;

    const controller = buildChatController({
      messagesEl: document.getElementById('cbMessages'),
      inputEl: document.getElementById('cbInput'),
      micBtn: document.getElementById('cbMic'),
      langBtn: document.getElementById('cbLang'),
      sendBtn: document.getElementById('cbSend'),
      voiceToggleBtn: document.getElementById('cbVoiceToggle'),
      attachBtn: document.getElementById('cbAttach'),
      fileInput: document.getElementById('cbFile')
    });
    menuBtn.addEventListener('click', () => controller.showMainMenu());

    let greeted = controller.restore();

    function openPanel() {
      panel.classList.add('cb-panel--open');
      fab.classList.add('cb-fab--open');
      fab.setAttribute('aria-expanded', 'true');
      fabIcon.textContent = '✕';
      dot.hidden = true;
      localStorage.setItem('fs_cb_seen', '1');
      document.getElementById('cbInput').focus();
      if (!greeted) { greeted = true; controller.greet(); }
    }
    function closePanel() {
      panel.classList.remove('cb-panel--open');
      fab.classList.remove('cb-fab--open');
      fab.setAttribute('aria-expanded', 'false');
      fabIcon.textContent = '🛡️';
      if (speaker) speaker.stop();   // a closed chat does not keep talking
      if (ocr) ocr.release();        // and gives its memory back once any read in progress is done
    }
    fab.addEventListener('click', () => { panel.classList.contains('cb-panel--open') ? closePanel() : openPanel(); });
    closeBtn.addEventListener('click', closePanel);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && panel.classList.contains('cb-panel--open')) closePanel(); });
  }

  // ═══════════════════════════════════════════════════════
  // Full-page mount — assistant.html only (#assistantRoot)
  // ═══════════════════════════════════════════════════════
  function initAssistantPage() {
    const root = document.getElementById('assistantRoot');
    if (!root) return;

    root.innerHTML = `
      <div class="cb-header cb-header--big">
        <span class="cb-header__icon">🛡️</span>
        <div class="cb-header__text">
          <p class="cb-header__title">FraudShield Assistant</p>
          <p class="cb-header__sub">Text · screenshots · QR codes — read on your device, never sent to our servers</p>
        </div>
        <button id="cbVoiceToggle" class="cb-header__btn" type="button" aria-label="Toggle spoken replies" title="Read replies aloud">🔊</button>
      </div>
      <div class="cb-quickbar">
        <a href="tel:1930" class="cb-quickbar__sos">📞 1930</a>
        <button id="cbMenuBtn" type="button">🏠 Main Menu</button>
      </div>
      <div id="cbMessages" class="cb-messages cb-messages--big" aria-live="polite"></div>
      <div class="cb-inputrow">
        <input id="cbInput" class="cb-input" type="text" placeholder="Type or paste here…" autocomplete="off" aria-label="Message to FraudShield Assistant">
        <button id="cbAttach" class="cb-attach" type="button" aria-label="Attach a screenshot or QR code" title="Attach a screenshot or QR code">📎</button>
        <input id="cbFile" type="file" accept="image/*" hidden>
        <button id="cbLang" class="cb-attach cb-lang" type="button">EN</button>
        <button id="cbMic" class="cb-mic" type="button" aria-label="Speak your message" title="Speak">🎤</button>
        <button id="cbSend" class="cb-send" type="button" aria-label="Send message">➤</button>
      </div>
    `;

    const menuBtn = document.getElementById('cbMenuBtn');
    const controller = buildChatController({
      messagesEl: document.getElementById('cbMessages'),
      inputEl: document.getElementById('cbInput'),
      micBtn: document.getElementById('cbMic'),
      langBtn: document.getElementById('cbLang'),
      sendBtn: document.getElementById('cbSend'),
      voiceToggleBtn: document.getElementById('cbVoiceToggle'),
      attachBtn: document.getElementById('cbAttach'),
      fileInput: document.getElementById('cbFile')
    });
    menuBtn.addEventListener('click', () => controller.showMainMenu());

    const hadHistory = controller.restore();
    if (!hadHistory) controller.greet();
  }

  // ═══════════════════════════════════════════════════════
  // On-device diagnostics and erasure — assistant.html only. What the tool has done in this tab, read off the local event buffer; nothing is sent anywhere.
  // ═══════════════════════════════════════════════════════
  const LOCAL_KEYS = ['fs_cb_state', 'fs_ops_v1'], PERSISTENT_KEYS = [VOICE_CONSENT_KEY, 'fs_cb_seen'];
  // Removes everything this tool has stored on this device: the chat and its memory, the diagnostics buffer, the remembered voice choice.
  function eraseLocalData() {
    let removed = 0;
    for (const [store, keys] of [[() => window.sessionStorage, LOCAL_KEYS], [() => window.localStorage, PERSISTENT_KEYS]]) {
      try { const st = store(); for (const k of keys) if (st.getItem(k) !== null) { st.removeItem(k); removed++; } } catch (e) { /* storage blocked: nothing was stored */ }
    }
    if (ops) ops.clear();
    return removed;
  }
  function initDiagnostics() {
    const root = document.getElementById('assistantRoot');
    if (!root || !ops) return;
    const box = document.createElement('section');
    box.className = 'diag'; box.setAttribute('aria-labelledby', 'diagTitle');
    const details = document.createElement('details'), summary = document.createElement('summary'), body = document.createElement('div'), status = document.createElement('p');
    summary.id = 'diagTitle'; summary.textContent = 'How this tool is doing on this device';
    body.className = 'diag__body'; status.className = 'diag__status'; status.setAttribute('role', 'status');
    details.append(summary, body); box.append(details);
    // after the page's wrapper, never inside it: the wrapper is a flex container, and a second child there squeezes the chat into a sliver on a phone
    (root.closest('.assistant-page-wrap') || root).insertAdjacentElement('afterend', box);

    const row = (k, v) => { const r = document.createElement('div'), a = document.createElement('dt'), b = document.createElement('dd'); r.className = 'diag__row'; a.textContent = k; b.textContent = v; r.append(a, b); return r; };
    const list = o => (Object.keys(o).length ? Object.entries(o).sort((x, y) => y[1] - x[1]).map(([k, v]) => k + ' ' + v).join(', ') : 'none yet');
    const ms = x => (x === null || x === undefined ? 'no data' : x < 0.1 ? 'under 0.1 ms' : (x < 10 ? x.toFixed(1) : Math.round(x)) + ' ms');
    function render() {
      const s = ops.summary({ model: modelState.status }), dl = document.createElement('dl'); dl.className = 'diag__list';
      const sloText = s.slo.status === 'met' ? 'met (p95 ' + ms(s.latencyMs.p95) + ', budget 50 ms)' : s.slo.status === 'breached' ? 'BREACHED: p95 ' + ms(s.latencyMs.p95) + ' against a 50 ms budget' : 'not enough checks yet (needs ' + Ops.SLO_MIN_SAMPLES + ', has ' + s.slo.samples + ')';
      dl.append(row('Checks this session', s.verdicts + (s.verdicts ? ' (' + Math.round(100 * s.flaggedShare) + '% flagged as scam or suspicious)' : '')), row('By result', list(s.byLevel)), row('Kind of scam named', list(s.byFamily)),
        row('Rules that fired most', s.topRules.length ? s.topRules.slice(0, 5).map(r => r.rule + ' ' + r.count).join(', ') : 'none yet'), row('Check speed', 'median ' + ms(s.latencyMs.p50) + ', slowest ' + ms(s.latencyMs.max)), row('Speed target', sloText),
        row('Domain-name check', s.model === 'ready' ? 'loaded' : s.model === 'failed' ? 'FAILED to load: link checks use the written rules only' : 'loading'), row('Picture reader', s.ocr.runs ? s.ocr.runs + ' reads, median ' + ms(s.ocr.p50Ms) + ', ' + Math.round(100 * s.ocr.hotShare) + '% on a warm worker' : 'not used yet'),
        row('Follow-up questions answered', list(s.followUps)), row('Errors', list(s.errors)));
      body.replaceChildren(dl, buttons, status);
    }
    const buttons = document.createElement('div'); buttons.className = 'diag__buttons';
    const copy = document.createElement('button'), erase = document.createElement('button'), note = document.createElement('p');
    copy.type = erase.type = 'button'; copy.className = erase.className = 'diag__btn'; copy.textContent = 'Copy this summary'; erase.textContent = 'Erase everything this tool stored on this device';
    note.className = 'diag__note'; note.textContent = 'This is a count of results and timings. It holds no message, link, number or file name, and it is never sent anywhere. The copy button puts it on your clipboard so you can share it if you choose.';
    copy.addEventListener('click', () => { const text = JSON.stringify(ops.summary({ model: modelState.status }), null, 2); (navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(text) : Promise.reject(new Error('no clipboard'))).then(() => { status.textContent = 'Copied.'; }, () => { status.textContent = 'Could not copy automatically. Here it is:\n' + text; }); });
    erase.addEventListener('click', () => { const n = eraseLocalData(); status.textContent = n ? 'Erased. The chat will reload empty.' : 'Nothing was stored.'; render(); setTimeout(() => { if (n) window.location.reload(); }, 900); });
    buttons.append(copy, erase, note);
    details.addEventListener('toggle', () => { if (details.open) render(); });
    window.addEventListener('fs:ops', () => { if (details.open) render(); });
    window.addEventListener('fs:model', () => { if (details.open) render(); });
  }

  // ═══════════════════════════════════════════════════════
  // Warm-up. The first verdict after a page loads paid for compiling the Hindi, Hinglish and Telugu lexicon and for the JavaScript engine's first pass over the
  // checkers: about 25 ms at full speed and about 52 ms with the CPU slowed 6x, over the 50 ms budget, on exactly the verdict a worried person is waiting for. The
  // diagnostics panel showed it. So the work is done in small slices while the browser is idle, a moment after the page is up, and the first real check is as fast as the rest.
  // ═══════════════════════════════════════════════════════
  function warmUp() {
    const Hin = window.FraudShieldHinglish;
    const steps = [...(Hin ? Object.keys(Hin.LEX).map(id => () => Hin.phrases(id)) : []),
      () => analyzeMessageRaw('Bhai tumhara account block ho gaya hai, KYC update karo is link pe. Your OTP is 482913. Pay Rs 500 now to claim.'), () => checkLinkRaw('https://sbi-kyc-update.tk/login?next=https://example.com/'), () => checkLinkRaw('upi://pay?pa=shop@okaxis&pn=Shop&am=100')];
    const idle = window.requestIdleCallback ? cb => window.requestIdleCallback(cb, { timeout: 2000 }) : cb => setTimeout(() => cb({ timeRemaining: () => 10 }), 30);
    (function slice() { idle(deadline => { try { while (steps.length && deadline.timeRemaining() > 2) steps.shift()(); } catch (e) { steps.length = 0; /* a failed warm-up is only a slower first verdict */ } if (steps.length) slice(); }); })();
  }

  // ═══════════════════════════════════════════════════════
  // INIT ALL
  // ═══════════════════════════════════════════════════════
  initHamburger();
  initCounters();
  initMagnetic();
  initArrivals();
  initCampaign();
  initLightbox();
  initFlow();
  initCreatures();
  initUrlModel();
  initQuiz();
  initTabs();
  initFilters();
  initAccordion();
  initCharts();
  initCopyReport();
  initReportPrefill();
  initChatbot();
  initAssistantPage();
  initDiagnostics();
  setTimeout(warmUp, 700);

}); // end DOMContentLoaded
