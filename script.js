'use strict';

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
        '=== SAFEINDIA FRAUD REPORT ===',
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
        'Generated by SafeIndia — a free public resource',
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

}); // end DOMContentLoaded
