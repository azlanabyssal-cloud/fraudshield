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
  function initCounters() {
    const container = document.getElementById('stat-counters');
    if (!container) return;
    if (!('IntersectionObserver' in window)) return;

    function easeOutQuad(t) { return t * (2 - t); }

    function animateCounter(el) {
      const target    = parseInt(el.dataset.target, 10);
      const prefix    = el.dataset.prefix  || '';
      const suffix    = el.dataset.suffix  || '';
      const format    = el.dataset.format  || 'plain';
      const duration  = 2200;
      const startTime = performance.now();

      function tick(now) {
        const elapsed  = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased    = easeOutQuad(progress);
        const value    = Math.floor(eased * target);

        if (format === 'lakh') {
          el.textContent = prefix + formatIndian(value) + suffix;
        } else {
          el.textContent = prefix + value.toLocaleString('en-IN') + suffix;
        }

        if (progress < 1) {
          requestAnimationFrame(tick);
        } else {
          if (format === 'lakh') {
            el.textContent = prefix + formatIndian(target) + suffix;
          } else {
            el.textContent = prefix + target.toLocaleString('en-IN') + suffix;
          }
        }
      }
      requestAnimationFrame(tick);
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
        explain: 'RBI, banks, and government bodies never call asking for your OTP or Aadhaar. This social engineering tactic is used in 12% of all fraud cases. Always hang up and call your bank directly on the number on your card — never on a number the caller provides.'
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
          'Refuse. Guaranteed returns above 12% annually are a Ponzi scheme warning sign.',
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
        1: { icon: '🚨', msg: 'High risk. These exact scenarios have cost Indians crores in 2024. Read the guide immediately.' },
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

    new Chart(document.getElementById('casesChart'), {
      type: 'bar',
      data: {
        labels: ['2018', '2019', '2020', '2021', '2022', '2023'],
        datasets: [{
          label: 'FIRs Registered',
          data: [27248, 44735, 50035, 52974, 65893, 86420],
          backgroundColor: [
            'rgba(11,31,58,0.5)',
            'rgba(11,31,58,0.6)',
            'rgba(11,31,58,0.65)',
            'rgba(11,31,58,0.7)',
            'rgba(232,93,4,0.75)',
            '#7B1D1D'
          ],
          borderRadius: 6,
          hoverBackgroundColor: '#E85D04'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => '  ' + formatIndian(ctx.parsed.y) + ' FIRs registered'
            }
          }
        },
        scales: baseScales
      }
    });

    new Chart(document.getElementById('typeChart'), {
      type: 'doughnut',
      data: {
        labels: ['UPI / Payment Fraud', 'OTP & SIM Swap', 'Phishing', 'Fake Loan Apps', 'Other'],
        datasets: [{
          data: [67, 12, 9, 7, 5],
          backgroundColor: ['#7B1D1D', '#E85D04', '#0B1F3A', '#556B2F', '#94a3b8'],
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
          tooltip: {
            callbacks: {
              label: ctx => '  ' + ctx.label + ': ' + ctx.parsed + '%'
            }
          }
        }
      }
    });

    new Chart(document.getElementById('stateChart'), {
      type: 'bar',
      data: {
        labels: ['Telangana', 'Uttar Pradesh', 'Karnataka', 'Maharashtra', 'Rajasthan'],
        datasets: [{
          label: 'FIRs',
          data: [15297, 10117, 8136, 7152, 6493],
          backgroundColor: ['#7B1D1D', '#9B2C2C', '#E85D04', '#0B1F3A', '#1A3A5C'],
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
          tooltip: {
            callbacks: {
              label: ctx => '  ' + formatIndian(ctx.parsed.x) + ' cases'
            }
          }
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

    new Chart(document.getElementById('moneyChart'), {
      type: 'line',
      data: {
        labels: ['2021', '2022', '2023', '2024', '2025'],
        datasets: [{
          label: '₹ Crore Lost',
          data: [551, null, 7465, 22845, 22495],
          borderColor: '#E85D04',
          backgroundColor: 'rgba(232,93,4,0.08)',
          fill: true,
          tension: 0.38,
          pointBackgroundColor: ['#556B2F', '#E85D04', '#E85D04', '#7B1D1D', '#556B2F'],
          pointRadius: 6,
          pointHoverRadius: 9,
          borderWidth: 2.5,
          spanGaps: false
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => ctx.parsed.y != null
                ? '  ₹' + formatIndian(ctx.parsed.y) + ' Crore'
                : '  Data not published'
            }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: tickColor } },
          y: {
            beginAtZero: true,
            grid: { color: gridColor },
            ticks: { color: tickColor, callback: v => '₹' + formatIndian(v) }
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
        '3. Call bank:   Ask for dispute under RBI Zero Liability Policy',
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
            'For reference: syndicates running this scam are prosecuted as organised crime under BNS Section 111, with extortion under Section 308 and forgery of the fake warrants they show you under Sections 336/338.'
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
            'Three facts worth remembering: PM Modi has publicly confirmed on Mann Ki Baat that digital arrest has no basis in Indian law. Real police never investigate over WhatsApp video call. And if it ever happens to you or family — hang up, then call 1930.',
            'Since July 2024, these syndicates are prosecuted under BNS Section 111 — India\'s new law explicitly recognising cyber-fraud rings as organised crime, not isolated cheating cases.'
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
            "Call your bank immediately and request a dispute under RBI's rules — UPI transactions can sometimes be reversed if reported within minutes. Then call 1930.",
            'This is prosecuted as cheating using a computer resource under BNS Section 318 — worth quoting if your bank or the police are slow to act.'
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
            'Phishing for financial details is cheating under BNS Section 318; if it used a spoofed bank or government page, that adds forgery under Sections 336/338.'
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
            'This is illegal blackmail, not debt collection — real recovery agents can\'t threaten to contact your family or morph your photos. Call 1930 immediately and mention "loan app harassment."',
            'This is extortion under BNS Section 308, and if they\'ve morphed or shared your photos, obscenity/deepfake provisions under Sections 294 and 77 also apply — say this explicitly when you report it.'
          ],
          cta: [
            { label: '📞 Call 1930 Now', href: 'tel:1930' },
            { label: '📋 File a Report →', href: 'report.html?type=Fake%20Loan%20App' }
          ]
        },
        noLoan: {
          say: ['That upfront-fee pattern is the scam itself — no legitimate lender ever charges a fee before disbursing a loan. Report it so the app can be taken down before it catches someone else.'],
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
            "Don't reply, don't pay, and don't delete the chat — it's evidence. Call 1930 immediately; this is handled confidentially under IT Act Section 66E, with a dedicated process for exactly this.",
            'It is also extortion under BNS Section 308, and if any image was morphed or shared, that adds Sections 294/77 (obscenity and synthetic/deepfake media) — the law treats this very seriously.'
          ],
          cta: [
            { label: '📞 Call 1930 (Confidential)', href: 'tel:1930' },
            { label: "👩 Women's Helpline 181", href: 'tel:181' }
          ]
        },
        before: {
          say: ['Same steps apply even after time has passed: save all messages as evidence, then call 1930. Reporting does not mean it becomes public — the process protects your identity.'],
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
          say: ['Number to remember: no genuine investment guarantees more than about 12% a year. Anything higher, especially with a friend\'s dashboard as "proof", is designed to look real right up until you can\'t withdraw. What\'s your situation?'],
          options: [
            { label: "I already invested and can't withdraw", goto: 'stuck' },
            { label: 'Someone is pitching me right now', goto: 'pitched' }
          ]
        },
        stuck: {
          urgent: true,
          say: [
            'Stop sending any more money — "unlock fees" or "tax payments" to release your funds are just another layer of the same scam. Save every chat and transaction screenshot, then report it.',
            'Fake trading platforms account for the largest single share of India\'s digital fraud losses — this is cheating under BNS Section 318, and organised ones fall under Section 111.'
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
          say: ["Real employers never ask you to pay a registration, training-kit, or refundable security fee before you start working. That request alone means it's a scam. What happened?"],
          options: [
            { label: 'I already paid a fee', goto: 'paid' },
            { label: 'They are asking me to pay now', goto: 'asking' }
          ]
        },
        paid: {
          say: [
            'Stop any further payments immediately — paying more never gets your money back or a real job. Report it so the listing can be taken down before it catches someone else.',
            'This is cheating under BNS Section 318 — mention that when filing, along with the exact account or UPI ID the fee went to.'
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
            "Go to a phone with internet access right now and call your bank's helpline to freeze your account — SIM swap is almost always paired with a bank fraud attempt within minutes. Then contact your telecom operator to block the port.",
            'SIM swap is prosecuted as identity theft/personation under BNS Sections 319(1) and 319(2) — file with your telecom operator and 1930 in parallel, don\'t wait for one before starting the other.'
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

  const CHAT_INTENT_KEYWORDS = {
    'Digital Arrest': ['cbi', 'digital arrest', 'video call', 'arrest warrant', 'court notice', 'narcotics case',
      'judge', 'police custody', 'aadhaar linked', 'aadhaar is linked', 'parcel case', 'customs case', 'trai',
      'courier scam', 'fedex scam', 'money laundering case', 'drug case', 'passport case', 'income tax notice'],
    'OTP Scam': ['otp', 'one time password', 'verification code', 'shared my otp', 'gave my otp', 'told them the otp'],
    'UPI Fraud': ['upi', 'qr code', 'scan the qr', 'gpay', 'phonepe', 'google pay', 'paytm fraud', 'scan and pay',
      'unauthorized upi', 'unauthorised upi'],
    'Phishing': ['phishing', 'click the link', 'clicked a link', 'clicked on a link', 'fake website', 'kyc update',
      'fake sms', 'suspicious link', 'fake link', 'malicious link'],
    'Fake Loan App': ['loan app', 'instant loan', 'loan approved', 'loan agent', 'loan recovery agent',
      'harassing me for loan', 'blackmailing me for loan'],
    'Sextortion': ['nude', 'private photo', 'blackmail', 'morphed', 'sextortion', 'obscene video',
      'threatening to leak', 'threatening to post', 'video call recorded', 'threatening to share my photo'],
    'Investment Scam': ['invest', 'trading tip', 'guaranteed return', 'crypto scheme', 'stock tip', 'demat',
      'ponzi', 'forex scam', 'binary trading', 'stock market fraud', 'trading app fraud'],
    'Job Fraud': ['job offer', 'work from home job', 'part time job', 'registration fee', 'fake job', 'job scam',
      'data entry job'],
    'SIM Swap': ['sim swap', 'sim stopped', 'no service suddenly', 'sim card blocked', 'duplicate sim',
      'number deactivated', 'sim deactivated']
  };

  // General "I've already been defrauded" phrasing that doesn't name a specific
  // scam type — this is how a lot of people actually describe it. Checked
  // AFTER the specific-type matcher above (which is more actionable when it
  // hits), but BEFORE giving up with the generic fallback.
  const GENERAL_LOSS_KEYWORDS = [
    'money is gone', 'money gone', 'lost my money', 'lost money', 'stolen my money', 'money was stolen',
    'took my money', 'scammed me', 'i got scammed', 'i was scammed', 'i got cheated', 'i was cheated',
    'get my money back', 'get back my money', 'recover my money', 'defrauded', 'someone cheated me',
    'sent money to a scammer', 'unauthorized transaction', 'unauthorised transaction', 'account was hacked',
    'money got deducted', 'amount deducted', 'wiped my account', 'emptied my account', 'drained my account'
  ];
  function isGeneralMoneyLoss(text) {
    const lower = text.toLowerCase();
    return GENERAL_LOSS_KEYWORDS.some(kw => lower.indexOf(kw) !== -1);
  }

  const CHAT_SAFE_DOMAINS = ['cybercrime.gov.in', 'rbi.org.in', 'npci.org.in', 'uidai.gov.in', 'incometax.gov.in',
    'sbi.co.in', 'onlinesbi.sbi', 'hdfcbank.com', 'icicibank.com', 'axisbank.com', 'paytm.com', 'phonepe.com',
    'google.com', 'whatsapp.com', 'indiapost.gov.in', 'irctc.co.in', 'digitalindia.gov.in', 'meity.gov.in'];
  const CHAT_SUSPICIOUS_TLDS = ['.tk', '.ml', '.ga', '.cf', '.xyz', '.top', '.icu', '.club', '.work', '.info'];
  const CHAT_SHORTENERS = ['bit.ly', 'tinyurl.com', 'cutt.ly', 'rebrand.ly', 'is.gd', 'shorturl.at', 'tiny.cc'];
  const CHAT_BRAND_LOOKALIKE = /\b(sbi|hdfc|icici|axis|paytm|kbc|rbi|kyc|upi)\b/i;

  function chatExtractHost(raw) {
    let s = raw.trim();
    if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
    try {
      return new URL(s).hostname.toLowerCase().replace(/^www\./, '');
    } catch (e) {
      const m = raw.match(/([a-z0-9-]+\.)+[a-z]{2,}/i);
      return m ? m[0].toLowerCase().replace(/^www\./, '') : null;
    }
  }

  function checkLink(raw) {
    const host = chatExtractHost(raw);
    if (!host) {
      return { verdict: 'caution', headline: "That doesn't look like a link I can check.", reasons: ["If it's a phone number or UPI ID, search it online with the word \"scam\" — many are already reported."] };
    }
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
      return { verdict: 'danger', headline: 'This is a raw IP address, not a real domain.', reasons: ['Legitimate banks and government sites never use a bare IP address as their link.'] };
    }
    if (CHAT_SAFE_DOMAINS.some(d => host === d || host.endsWith('.' + d)) || /\.gov\.in$|\.nic\.in$/.test(host)) {
      return { verdict: 'safe', headline: 'This matches a known official domain (' + host + ').', reasons: ['It still pays to type the address yourself next time instead of clicking a link.'] };
    }
    if (CHAT_SHORTENERS.some(d => host === d)) {
      return { verdict: 'caution', headline: 'This is a shortened link — the real destination is hidden.', reasons: ["Scammers use shorteners exactly to hide phishing pages. Don't click it unless you completely trust who sent it."] };
    }
    if (CHAT_SUSPICIOUS_TLDS.some(t => host.endsWith(t))) {
      return { verdict: 'danger', headline: 'This domain ending (' + host.slice(host.lastIndexOf('.')) + ') is heavily abused for scam sites.', reasons: ['Real Indian banks and government bodies never use this kind of domain ending.'] };
    }
    if (CHAT_BRAND_LOOKALIKE.test(host)) {
      return { verdict: 'danger', headline: 'This uses a bank/government name (' + host + ') but is not their real, official domain.', reasons: ['This exact lookalike-domain trick is behind most phishing SMS in India.'] };
    }
    return { verdict: 'caution', headline: "I can't confirm this domain (" + host + ') one way or the other.', reasons: ['Proceed carefully — when in doubt, go to the site by typing the address yourself instead of clicking.'] };
  }

  function findLinkIn(text) {
    const m = text.match(/(https?:\/\/[^\s]+)|(\bwww\.[^\s]+)|(\b[a-z0-9-]+\.(?:com|in|net|org|co\.in|gov\.in|xyz|info|tk|ml|ga|cf|top|icu|club)\b\S*)/i);
    return m ? m[0] : null;
  }

  function detectIntent(text) {
    const lower = text.toLowerCase();
    let best = null, bestScore = 0;
    Object.keys(CHAT_INTENT_KEYWORDS).forEach(key => {
      let score = 0;
      CHAT_INTENT_KEYWORDS[key].forEach(kw => { if (lower.indexOf(kw) !== -1) score++; });
      if (score > bestScore) { bestScore = score; best = key; }
    });
    return bestScore > 0 ? best : null;
  }

  // ── Small talk — a hand-authored conversational layer, NOT a general AI.
  //    This is a rule-based pattern matcher for common greetings/chit-chat so
  //    the bot doesn't dead-end on "hello" or "how are you". It cannot answer
  //    arbitrary open-ended questions the way a real LLM could — that would
  //    need an API key and a small ongoing cost, which this project runs
  //    without by design. ──
  const NAME_PATTERN = /\b(?:i'?m|i am|my name is|myself)\s+([a-z][a-z'-]{1,19})\b/i;
  const NAME_STOPWORDS = new Set(['not', 'worried', 'scared', 'afraid', 'confused', 'trying', 'asking',
    'wondering', 'calling', 'writing', 'here', 'sure', 'sorry', 'fine', 'good', 'ok', 'okay', 'well',
    'still', 'also', 'just', 'really', 'very', 'so', 'done', 'back', 'new', 'a', 'an', 'the', 'having']);

  function extractIntroducedName(text) {
    const m = text.match(NAME_PATTERN);
    if (!m) return null;
    const raw = m[1].toLowerCase();
    if (NAME_STOPWORDS.has(raw)) return null;
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }

  const SMALL_TALK = [
    {
      test: /^\s*(hi+|hello+|hey+|yo|namaste|helo)\b/i,
      reply: name => ['Hello' + (name ? ', ' + name : '') + '! Good to hear from you. I\'m here to help with anything fraud-related — or ask me anything else too.']
    },
    {
      test: /\bhow are you\b/i,
      reply: () => ["I'm doing well, thanks for asking! More importantly — how are you doing? Anything fraud-related I can help with today?"]
    },
    {
      test: /\b(good|safe|digital|online)\s+habits?\b|\bhow (can|do) i (stay|keep myself) safe\b|\bhow to stay safe\b/i,
      reply: () => [
        'Good question — a few habits genuinely keep you safer than any single warning: never share your OTP or UPI PIN with anyone, verify unexpected urgent calls by hanging up and calling back on an official number, never click links in SMS or WhatsApp from unknown senders, and remember no real official ever asks for money to "verify" or "clear" your name.',
        'Want the full guide, or is something specific worrying you right now?'
      ]
    },
    {
      test: /\b(thank you|thanks|thx|thankyou)\b/i,
      reply: () => ["You're welcome! I'm here anytime you need help."]
    },
    {
      test: /\bwhat can you (do|help)|\bwho are you\b|\bwhat are you\b/i,
      reply: () => ["I'm the FraudShield Assistant — I guide you step by step through common scams (digital arrest, OTP, UPI, phishing, and more), check suspicious links, read screenshots of scam messages, and connect you straight to the 1930 helpline. Type, speak, or paste a screenshot anytime."]
    },
    {
      test: /\b(bye|goodbye|good ?night|see you)\b/i,
      reply: () => ['Take care! Remember — 1930 is always free, day or night, if you ever need it.'],
      noMenu: true
    }
  ];

  function matchSmallTalk(text) {
    for (const rule of SMALL_TALK) {
      if (rule.test.test(text)) return rule;
    }
    return null;
  }

  // ── Shared session state (sessionStorage — survives navigating between pages
  //    AND switching between the floating widget and the full assistant page) ──
  function loadChatState() {
    try {
      const raw = sessionStorage.getItem('fs_cb_state');
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore corrupt state */ }
    return { flow: null, node: null, awaitingLink: false, voiceOut: false, userName: null, log: [] };
  }
  function saveChatState(state) {
    try { sessionStorage.setItem('fs_cb_state', JSON.stringify(state)); } catch (e) { /* storage unavailable */ }
  }

  // ── Lazy-loaded OCR engine (Tesseract.js) — fetched only the first time
  //    someone attaches or pastes a screenshot. 100% client-side, MIT-licensed,
  //    no API key, no server round-trip for the image itself. ──
  let ocrEnginePromise = null;
  function loadOcrEngine() {
    if (ocrEnginePromise) return ocrEnginePromise;
    ocrEnginePromise = new Promise((resolve, reject) => {
      if (window.Tesseract) { resolve(window.Tesseract); return; }
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
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
  function pickIndianVoice() {
    // 1. Known-good named voices first (best quality on the platforms that ship them)
    const prefer = ['Rishi', 'Veena', 'Microsoft Ravi - English (India)', 'Microsoft Heera - English (India)', 'Google UK English Female', 'Google UK English Male'];
    for (const name of prefer) {
      const v = cbCachedVoices.find(vv => vv.name === name);
      if (v) return v;
    }
    // 2. Any en-IN voice, preferring network/cloud voices — they're consistently
    //    higher quality than a device's bundled offline voice.
    const enIN = cbCachedVoices.filter(v => v.lang === 'en-IN');
    if (enIN.length) return enIN.find(v => !v.localService) || enIN[0];
    // 3. Any English voice at all, same network-quality preference
    const en = cbCachedVoices.filter(v => v.lang.indexOf('en') === 0);
    if (en.length) return en.find(v => !v.localService) || en[0];
    return null;
  }
  function speakText(text) {
    if (!window.speechSynthesis) return null;
    // Deliberately NOT calling cancel() here: bot replies arrive as several
    // lines paced ~0.5s apart, each triggering a speakText() call. Cancelling
    // on every call kills the previous line before it finishes — the browser's
    // speech queue already plays sequential utterances in order on its own,
    // so just queue this one.
    const u = new SpeechSynthesisUtterance(text);
    const v = pickIndianVoice();
    u.lang = v ? v.lang : 'en-IN';
    u.rate = 0.95; u.pitch = 1;
    if (v) u.voice = v;
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

    function addAudioMessage(objectUrl, fileName) {
      const div = document.createElement('div');
      div.className = 'cb-msg cb-msg--user cb-msg--audio';
      const label = document.createElement('p');
      label.textContent = '🎧 ' + (fileName || 'Audio clip');
      const audio = document.createElement('audio');
      audio.controls = true;
      audio.src = objectUrl;
      div.appendChild(label);
      div.appendChild(audio);
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
      botSay(['What would you like help with' + who + '? You can also paste a screenshot, or attach an audio clip.'], { options: buildMainMenuOptions(), noMenuChip: true });
    }
    function askForLink() {
      state.awaitingLink = true; persist();
      botSay(['Paste the link, phone number, or UPI ID you want me to check.'], { noMenuChip: true });
    }
    function respondToLink(raw) {
      const result = checkLink(raw);
      const icon = result.verdict === 'safe' ? '✅' : result.verdict === 'danger' ? '🚫' : '⚠️';
      botSay([
        icon + ' ' + result.headline,
        result.reasons.join(' ') + ' Never enter your OTP, UPI PIN, or password after clicking a link, even if it looks official.'
      ], { urgent: result.verdict === 'danger' });
    }
    function respondToGeneralLoss() {
      botSay([
        "I'm sorry this happened — let's move fast, every minute matters. Call your bank's helpline right now and say exactly this: \"unauthorised transaction, please freeze and dispute it.\" That triggers RBI's Zero Liability process. Then call 1930 immediately and describe it as financial fraud — reporting within the first hour gives the best chance of freezing the money before it moves further.",
        'To get you more specific next steps, what caused it — a phone call, a link, a QR code, or something else? Or pick the closest match below.'
      ], { urgent: true, cta: [{ label: '📞 Call 1930 Now', href: 'tel:1930' }], options: buildMainMenuOptions() });
    }
    function respondToFreeText(text) {
      if (state.awaitingLink) {
        state.awaitingLink = false; persist();
        respondToLink(text);
        return;
      }
      const linkMatch = findLinkIn(text);
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

      botSay(["I couldn't quite match that to a scam type — tell me a bit more, or pick the closest below:"], { options: buildMainMenuOptions(), noMenuChip: true });
    }

    function greet() {
      botSay(["Hi — I'm the FraudShield Assistant. Type, speak, or paste a screenshot of what happened, and I'll guide you step by step."], { onDone: showMainMenu, noMenuChip: true });
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
      const progressEl = showOcrProgress('🔍 Preparing image reader…');
      loadOcrEngine()
        .then(Tesseract => Tesseract.recognize(objectUrl, 'eng', {
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

    // ── Audio (voice note / call recording) handling — honest about a real
    //    browser limitation: there is no way to feed an uploaded audio FILE
    //    into speech recognition (only a live microphone stream is supported
    //    by any browser's Web Speech API). Rather than fake a transcription,
    //    we keep the clip for evidence and route the user to the mic, which
    //    genuinely works, for real-time narration. ──
    function handleAudioFile(file) {
      if (!file || file.type.indexOf('audio/') !== 0) return;
      if (file.size > 20 * 1024 * 1024) {
        botSay(['That audio file is quite large (over 20MB) — a shorter clip of the key part would work better here.']);
        return;
      }
      const objectUrl = URL.createObjectURL(file);
      addAudioMessage(objectUrl, file.name);
      botSay([
        "Got the audio — you can play it back anytime, and I'd recommend saving the original file as evidence for your report.",
        "I can't transcribe audio files automatically yet (that needs a paid speech service) — but tap the mic and tell me in your own words what was said, and I'll guide you from there."
      ]);
    }

    // ── Voice input (live mic — real speech-to-text via the browser) ──
    const SRClass = window.SpeechRecognition || window.webkitSpeechRecognition;
    let recognition = null;
    let micBlocked = false;
    // Set right before a voice-submitted message is handled; consumed the
    // moment the bot's reply finishes rendering (see addChips below) to
    // re-open the mic automatically — a real back-and-forth conversation
    // instead of click-talk-click-talk every turn. Never armed while the
    // bot is mid-speech, so the mic can't hear the bot's own voice and
    // trigger itself (no feedback loop).
    let voiceTurnPending = false;

    function ensureRecognition() {
      if (recognition || !SRClass) return recognition;
      const micPlaceholder = dom.inputEl.placeholder;
      recognition = new SRClass();
      recognition.lang = 'en-IN';
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
      recognition.onstart = () => { dom.inputEl.placeholder = 'Listening…'; };
      recognition.onend = () => {
        dom.micBtn.classList.remove('cb-mic--live');
        dom.inputEl.placeholder = micPlaceholder;
      };
      recognition.onerror = e => {
        dom.micBtn.classList.remove('cb-mic--live');
        dom.inputEl.placeholder = micPlaceholder;
        // Every branch here ends in a message — a voice feature that fails
        // with zero explanation is indistinguishable from "broken", which
        // is exactly what was happening for error codes this didn't cover.
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          micBlocked = true;
          botSay(['Microphone access was blocked — check the 🔒 icon next to the address bar, allow microphone for this site, then try again. You can still type any time.']);
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

    function startListening() {
      const rec = ensureRecognition();
      if (!rec || micBlocked) return;
      try {
        rec.start();
        dom.micBtn.classList.add('cb-mic--live');
      } catch (e) {
        // InvalidStateError just means it's already running — safe to ignore.
        // Anything else was failing completely silently before this fix.
        if (e.name !== 'InvalidStateError') {
          botSay(['Voice input could not start — you can still type your message.']);
        }
      }
    }

    if (dom.micBtn) {
      dom.micBtn.addEventListener('click', () => {
        if (!SRClass) {
          // Never fail silently — a hidden/dead button with no explanation
          // looks exactly like "voice doesn't work" when it's really just
          // unsupported here. Say so plainly instead.
          botSay(["Voice input isn't supported in this browser — it needs Chrome, Edge, or Safari on iOS 14.5+. You can still type, or paste a screenshot."]);
          return;
        }
        ensureRecognition();
        if (dom.micBtn.classList.contains('cb-mic--live')) { recognition.stop(); return; }
        startListening();
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
        else if (file.type.indexOf('audio/') === 0) handleAudioFile(file);
        else botSay(["I can read images (screenshots) or play audio clips — that file type isn't supported."]);
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
            <p class="cb-header__sub">Voice · text · screenshots — 100% free</p>
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
          <input id="cbInput" class="cb-input" type="text" placeholder="Type, paste a screenshot, or tap the mic…" autocomplete="off" aria-label="Message to FraudShield Assistant">
          <button id="cbAttach" class="cb-attach" type="button" aria-label="Attach a screenshot or audio clip" title="Attach image/audio">📎</button>
          <input id="cbFile" type="file" accept="image/*,audio/*" hidden>
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
          <p class="cb-header__sub">Voice · text · screenshots · audio — 100% free, nothing leaves your device</p>
        </div>
        <button id="cbVoiceToggle" class="cb-header__btn" type="button" aria-label="Toggle spoken replies" title="Read replies aloud">🔊</button>
      </div>
      <div class="cb-quickbar">
        <a href="tel:1930" class="cb-quickbar__sos">📞 1930</a>
        <button id="cbMenuBtn" type="button">🏠 Main Menu</button>
      </div>
      <div id="cbMessages" class="cb-messages cb-messages--big" aria-live="polite"></div>
      <div class="cb-inputrow">
        <input id="cbInput" class="cb-input" type="text" placeholder="Type, paste a screenshot, or tap the mic…" autocomplete="off" aria-label="Message to FraudShield Assistant">
        <button id="cbAttach" class="cb-attach" type="button" aria-label="Attach a screenshot or audio clip" title="Attach image/audio">📎</button>
        <input id="cbFile" type="file" accept="image/*,audio/*" hidden>
        <button id="cbMic" class="cb-mic" type="button" aria-label="Speak your message" title="Speak">🎤</button>
        <button id="cbSend" class="cb-send" type="button" aria-label="Send message">➤</button>
      </div>
    `;

    const menuBtn = document.getElementById('cbMenuBtn');
    const controller = buildChatController({
      messagesEl: document.getElementById('cbMessages'),
      inputEl: document.getElementById('cbInput'),
      micBtn: document.getElementById('cbMic'),
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
