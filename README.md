# FraudShield

**Digital fraud awareness platform for India.**  
Community service project by Azlan — second-year BTech student.

Live: [fraudshell.in](https://fraudshell.in) | Helpline: **1930** (Free · 24×7)

---

## Why this exists

My uncle got a call last year. Someone said they were from CBI. They said his Aadhaar was linked to a drug case. They kept him on video call for six hours. He transferred ₹3.4 lakh before my cousin stopped him.

He is a retired government employee. Educated. Careful. It still happened to him.

The problem is not intelligence — it is information. My uncle did not know that:
- No government agency arrests you over video call
- The number 1930 exists and can freeze the money if you call within the first hour
- The CFCFRMS system has already saved ₹8,690 crore for other victims (as of early 2026)

That information is on government websites. But it is buried in PDFs, written in legal language, and assumes the reader already knows where to look.

I built FraudShield because the information exists — it just does not reach the people who need it. Specifically Indian middle-class families: people who are online, who use UPI and WhatsApp every day, but who have never heard of cybercrime.gov.in or the 1930 helpline.

No budget. No team. Just the knowledge and the tools to build something real.

---

## What it covers

**The scams targeting Indian families right now:**

- **Digital Arrest** — fake CBI/ED/police calls, video call "custody", forced transfers
- **UPI fraud** — QR code scam (scan to receive = actually pay), fake payment screenshots
- **OTP scam** — bank impersonation, urgency, "your account will be blocked"
- **Investment fraud** — WhatsApp groups, fake Zerodha/SEBI portals, 40% monthly "returns"
- **Sextortion** — compromising video calls, blackmail, threats of sharing
- **Fake loan apps** — contact/photo access for blackmail, upfront "processing fees"

**What the site actually tells you:**

- PM Modi's exact words on Digital Arrest from Mann Ki Baat — because if your parent hears it from the PM, they believe it
- The 1930 helpline and what happens when you call — most people don't know CFCFRMS can freeze funds in real time
- Step-by-step what to do in the first 60 minutes after fraud — every minute matters for fund recovery
- Verified court cases with real verdicts — because people need to know criminals do get convicted
- Legal rights under the IT Act and RBI zero liability policy

---

## Six mascots

Each one is a character placed in a relevant section. Click them — they speak. Real messages, not filler.

- **Kavach** (कवच — armour) — English, hero section, explains the 1930 helpline
- **Dost** (दोस्त — friend) — Hindi, hero section, tells your parents not to share OTP
- **Chetavani** (चेतावनी — warning) — English, PM warning section, explains Digital Arrest
- **Sankhya** (संख्या — data) — English, statistics section, gives the actual numbers
- **Thag** (ठग — swindler) — English, fraud funnel, explains how scammers operate
- **Umeed** (उम्मीद — hope) — English, recovery section, tells victims what to do next

Hindi names because this is for Indian users. The names mean something. They are not decoration.

---

## Technical build

Static site — HTML, CSS, vanilla JavaScript. No frameworks, no dependencies.

- Web Speech API for creature voices — works on Chrome, Safari, Android, iOS
- Web Audio API for UI sounds — clean sine-wave tones, no harsh mechanical clicks
- All animations GPU-composited — transform and opacity only, no layout repaints
- IntersectionObserver for scroll reveal — with fallback for older browsers
- requestAnimationFrame for reading progress bar
- Mobile tested at 375px, 390px, 412px (common Indian phone widths)
- `-webkit-tap-highlight-color:transparent` — no blue flash on tap, clean mobile feel

**Fonts:** Playfair Display · DM Sans · JetBrains Mono  
**Data:** I4C 2024 · RBI Annual Report 2024 · NCRB Crime in India 2023 · NPCI · MHA · DoT 2024

All statistics on this site come from official Indian government publications. Not estimates. Not secondary sources.

---

## Emergency helplines on the site

| Helpline | Number |
|---|---|
| National Cyber Crime | **1930** — Free, 24×7 |
| Police | **112** |
| Women Safety | **181** |
| Online reporting | cybercrime.gov.in |

---

## What this project is

This is a community service project. It is not a startup. It is not monetised. There is no data collection, no login, no analytics.

The target user is a 55-year-old Indian parent who uses WhatsApp, pays with UPI, and has never filed a complaint online. The site is built around that person — plain language, no jargon, everything above the fold on mobile, emergency number always visible.

If someone calls 1930 in time because of this website, that is the whole point.

---

**Azlan**  
Second-year BTech student  
GitHub: [azlanabyssal-cloud](https://github.com/azlanabyssal-cloud)
