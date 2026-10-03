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
  // The domain-name model is a soft warning added to link checks. Its weights load after the page is usable; until they arrive the link
  // analyzer simply runs on its rules, so nothing waits on the download and a failed download costs nothing.
  function initUrlModel() {
    const Model = window.FraudShieldUrlModel;
    if (!Model || typeof fetch !== 'function') return;
    fetch('data/urlmodel.json').then(r => (r.ok ? r.json() : Promise.reject(new Error('model-unavailable')))).then(m => Model.install(m)).catch(() => {});
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
      el.textContent = prefix + (el.dataset.format === 'lakh' ? formatIndian(value) : value.toLocaleString('en-IN')) + suffix;
    }

    function animateCounter(el) {
      const target = parseInt(el.dataset.target, 10);
      if (!Motion || !Motion.engine) { render(el, target); return; }
      Motion.engine.tween(1900, ease, p => render(el, Math.floor(p * target)), () => render(el, target));   // reduced motion: lands at once
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
    new Chart(document.getElementById('casesChart'), {
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
    });

    const shares = seriesOf('typeChart');
    new Chart(document.getElementById('typeChart'), {
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
    });

    const states = seriesOf('stateChart');
    new Chart(document.getElementById('stateChart'), {
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
    });

    const losses = seriesOf('moneyChart');
    new Chart(document.getElementById('moneyChart'), {
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
    });
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
    isGeneralMoneyLoss, checkLink, findLinkIn, detectIntent,
    extractIntroducedName, matchSmallTalk, speechProvider
  } = window.FraudShieldCore;
  const { analyzeMessage } = window.FraudShieldMessage;

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
    return { flow: null, node: null, awaitingLink: false, voiceOut: false, voiceLang: 'en-IN', userName: null, log: [] };
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
  function speakText(text) {
    if (!window.speechSynthesis) return null;
    // Deliberately NOT calling cancel() here: bot replies arrive as several
    // lines paced ~0.5s apart, each triggering a speakText() call. Cancelling
    // on every call kills the previous line before it finishes — the browser's
    // speech queue already plays sequential utterances in order on its own,
    // so just queue this one.
    const v = pickIndianVoice();
    if (!v) return null;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = v.lang;
    u.rate = 0.95; u.pitch = 1;
    u.voice = v;
    window.speechSynthesis.speak(u);
    return u;
  }

  // ── The chat engine itself — mounted by both initChatbot() (floating widget)
  //    and initAssistantPage() (assistant.html), each passing its own DOM refs. ──
  function buildChatController(dom) {
    const state = loadChatState();
    function persist() { saveChatState(state); }

    let lastUtterance = null; // most recent bot-line utterance this turn, used to time the mic re-arm

    function scrollToBottom() { dom.messagesEl.scrollTop = dom.messagesEl.scrollHeight; }

    function addMessage(text, from, urgent) {
      const div = document.createElement('div');
      div.className = 'cb-msg cb-msg--' + from + (urgent ? ' cb-msg--urgent' : '');
      div.textContent = text;
      dom.messagesEl.appendChild(div);
      scrollToBottom();
      state.log.push({ text, from });
      persist();
      if (from === 'bot' && state.voiceOut) lastUtterance = speakText(text);
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
        if (state.voiceOut && lastUtterance && window.speechSynthesis.speaking) {
          lastUtterance.addEventListener('end', () => startListening(), { once: true });
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
    function respondToLink(raw) {
      const result = checkLink(raw), scam = result.level === 'scam';
      const icon = { official: '✅', scam: '🚫', suspicious: '⚠️', unverified: '❔' }[result.level] || '⚠️';
      botSay([
        icon + ' ' + result.headline,
        result.reasons.join(' ') + ' Never enter your OTP, UPI PIN, or password after clicking a link or scanning a code, even if it looks official.'
      ], { urgent: scam, cta: scam ? [{ label: '📞 Paid or shared details? Call 1930', href: 'tel:1930' }] : undefined });
    }
    // A pasted scam talks TO the reader ("your KYC expires"); a person describing what happened talks about themselves ("I got a call").
    const DESCRIBING_SELF = /^\s*(?:i|my|me|we|mera|meri|mujhe|hum)\b|\b(?:i|we)\s+(?:got|received|have|was|am|just|clicked|paid|shared|lost)\b/i;
    const justALink = (text, link) => !!link && link.length >= text.trim().length * 0.8;

    function respondToMessage(v) {
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
      botSay(['❔ ' + v.headline, v.next.join(' ')], { options: buildMainMenuOptions(), noMenuChip: true });
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

      const intent = detectIntent(text);
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
      botSay(["I couldn't quite match that to a scam type — tell me a bit more, or pick the closest below:"], { options: buildMainMenuOptions(), noMenuChip: true });
    }

    function greet() {
      botSay(["Hi — I'm the FraudShield Assistant. Type what happened, paste a link, or share a screenshot or QR code, and I'll guide you step by step."], { onDone: showMainMenu, noMenuChip: true });
    }

    function handleUserInput(rawText) {
      const text = rawText.trim();
      if (!text) return;
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
      scrollToBottom();
    }

    function handleImageFile(file) {
      if (!file || file.type.indexOf('image/') !== 0) return;
      if (file.size > 10 * 1024 * 1024) {
        botSay(['That image is quite large — try a tighter screenshot crop (under 10MB) and I\'ll read it.']);
        return;
      }
      const objectUrl = URL.createObjectURL(file);
      addImageMessage(objectUrl);
      const progressEl = showOcrProgress('🔍 Looking for a QR code…');
      const qr = window.FraudShieldQR;
      (qr ? qr.scan(file, { decoderUrl: QR_DECODER_URL }) : Promise.resolve(null)).catch(() => null).then(code => {
        if (!code) { readTextFromImage(objectUrl, progressEl); return; }
        progressEl.remove();
        botSay(['I found a QR code in that image. It contains: "' + code.replace(/\s+/g, ' ').slice(0, 200) + '"'], { noMenuChip: true, onDone: () => respondToLink(code) });
      });
    }

    function readTextFromImage(objectUrl, progressEl) {
      updateOcrProgress(progressEl, '🔍 Preparing image reader…');
      loadOcrEngine()
        .then(Tesseract => Tesseract.recognize(objectUrl, 'eng+hin', {
          workerPath: OCR_BASE + 'worker.min.js',
          corePath: OCR_BASE,
          langPath: OCR_BASE + 'lang',
          logger: m => {
            if (m.status === 'recognizing text') {
              updateOcrProgress(progressEl, '🔍 Reading image — ' + Math.round((m.progress || 0) * 100) + '%');
            } else if (m.status) {
              updateOcrProgress(progressEl, '🔍 ' + m.status.charAt(0).toUpperCase() + m.status.slice(1) + '…');
            }
          }
        }))
        .then(({ data }) => {
          progressEl.remove();
          const text = ((data && data.text) || '').trim();
          if (!text || text.length < 4) {
            botSay(["I couldn't read clear text from that image — could you type or say what it says instead?"]);
            return;
          }
          botSay(['Here\'s what I read from the image: "' + text.replace(/\s+/g, ' ').slice(0, 400) + '"'], {
            noMenuChip: true,
            onDone: () => respondToFreeText(text)
          });
        })
        .catch(() => {
          progressEl.remove();
          botSay(["I couldn't read that image right now — image analysis needs an internet connection the first time it's used on this device. You can type or say what the message said instead."]);
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
          voiceTurnPending = true;
          handleUserInput(finalTranscript);
        }
      };
      recognition.onstart = () => { dom.inputEl.placeholder = listeningLabel(); };
      recognition.onend = () => {
        dom.micBtn.classList.remove('cb-mic--live'); dom.micBtn.setAttribute('aria-pressed', 'false');
        dom.inputEl.placeholder = micPlaceholder;
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
        if (dom.micBtn.classList.contains('cb-mic--live') && recognition) { recognition.stop(); return; }
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
    if (dom.voiceToggleBtn) {
      if (!window.speechSynthesis) {
        dom.voiceToggleBtn.hidden = true;
      } else {
        dom.voiceToggleBtn.textContent = state.voiceOut ? '🔊' : '🔇';
        dom.voiceToggleBtn.classList.toggle('cb-header__btn--active', state.voiceOut);
        dom.voiceToggleBtn.addEventListener('click', () => {
          state.voiceOut = !state.voiceOut; persist();
          dom.voiceToggleBtn.classList.toggle('cb-header__btn--active', state.voiceOut);
          dom.voiceToggleBtn.textContent = state.voiceOut ? '🔊' : '🔇';
          if (!state.voiceOut && window.speechSynthesis) window.speechSynthesis.cancel();
        });
      }
    }

    // ── Text input wiring ──
    dom.sendBtn.addEventListener('click', () => handleUserInput(dom.inputEl.value));
    dom.inputEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); handleUserInput(dom.inputEl.value); } });

    // ── Attach (image or audio) — button + clipboard paste support ──
    if (dom.attachBtn && dom.fileInput) {
      dom.attachBtn.addEventListener('click', () => dom.fileInput.click());
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
          <input id="cbInput" class="cb-input" type="text" placeholder="Type, or paste a screenshot…" autocomplete="off" aria-label="Message to FraudShield Assistant">
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
        <input id="cbInput" class="cb-input" type="text" placeholder="Type, or paste a screenshot…" autocomplete="off" aria-label="Message to FraudShield Assistant">
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
  // INIT ALL
  // ═══════════════════════════════════════════════════════
  initHamburger();
  initCounters();
  initMagnetic();
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

}); // end DOMContentLoaded
