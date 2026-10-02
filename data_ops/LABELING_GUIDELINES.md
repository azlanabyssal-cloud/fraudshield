# Golden Holdout: Labeling SOP

This dataset is the only honest measure of whether FraudShield's detection works. If it is
contaminated, every accuracy number we publish is fiction. Follow this document exactly.

## 0. The five laws

1. **Real messages only.** Never write, generate, paraphrase or "clean up" a message. No AI-written
   examples, ever. A made-up scam teaches us how well we detect made-up scams.
2. **Scrub before you type.** Personal data is removed *before* a message reaches the CSV, a
   spreadsheet, a chat, or any AI tool. Never paste a raw message into any online tool.
3. **The holdout is sealed.** It is never used for training, threshold tuning, keyword writing, or
   debugging. Looking at it to "fix" a miss turns it into training data. After a model change you may
   read the aggregate score, not the individual failures. If a failure analysis is unavoidable, record
   it, and refresh part of the holdout with new messages.
4. **Newer than training.** Every holdout message must be dated *after* the newest training message
   (time split). Record the training cutoff date in your private log before you start.
5. **When unsure, leave it out.** An unverifiable message is worse than a missing one.

## 1. What to collect (target: 1,000 rows)

| Language | Target | Note |
|---|---|---|
| English | 30% | |
| Hindi | 40% | Devanagari script |
| Hinglish | 30% | Hindi in Roman script, or mixed script |

Also required at the end (`npm run data:final` enforces it): at least 20 rows in **each** scam category,
at least 25% `safe`, at least 10% adversarial (`contains_obfuscation=true`), and no single source above 40%.

Do **not** collect other languages (Telugu, Tamil, ...). The V1 model does not support them. Skip the
message and tally how many you skipped, so the gap is visible.

### Sources, in order of preference
1. **Messages you received yourself.** Best provenance. Safe messages (bank alerts, delivery updates,
   bills, appointments, genuine KYC reminders) come from here too.
2. **Messages a family member or friend chooses to forward**, with their permission. They are a third
   party: tell them what the data is for, and scrub it exactly the same way.
3. **Official advisories** that quote real scam texts (I4C / cybercrime.gov.in, RBI, CERT-In, bank
   fraud-awareness pages). Use `source_platform=advisory_quote`. Copy only the quoted message, not
   the advisory prose. **Check each site's terms before copying and keep it to short factual quotes
   [verify].** Do not use more than 25% advisory quotes: they are cleaner and more formulaic than what
   people actually receive, so they flatter the model.
4. **News reports** that print a scam message verbatim. Same rules as advisories.

### Do not
- **Scrape social media.** X/Twitter's terms prohibit scraping [verify], and people post their own numbers.
  Do not use screenshots from people's public posts either, as they identify the victim.
- Use forwarded-message groups where you do not know who is in them.
- Include anything where you are not confident of ground truth. Confirm a scam by: the source calling it
  a scam, the bank/regulator confirming it, or you verifying out-of-band (called the official number).
  Confirm `safe` the same way: it came from the genuine sender.

### Keep a private provenance log (never committed)
For every row keep: row id, where it came from, date accessed, URL if any, how ground truth was confirmed.
The CSV has no source URL column on purpose (URLs can identify people). Keep this log in a private file.

## 2. Scrubbing rules (do this first)

Replace personal data with a placeholder. The validator rejects the rest, but it cannot catch names:
**you are the last line of defence.**

| Data | Replace with | Notes |
|---|---|---|
| Any phone number, any format, incl. `+91`, spaces, hyphens, the scammer's, customer-care numbers | `[PHONE]` | Short public codes stay: `1930`, `112`, `181`, `155260` |
| UPI ID (`name@ybl`, `98765xxxxx@paytm`, `shop@okicici`) | `[UPI]` | |
| Email address | `[EMAIL]` | |
| Social handle (`@someone`) | `[HANDLE]` | |
| Bank account number | `[ACCOUNT]` | Masked partials like `XXXX1234` still reveal a suffix: use `[ACCOUNT]` |
| Debit/credit card number | `[CARD]` | |
| Aadhaar, passport, driving licence, voter ID, any 9+ digit ID | `[ID_NUMBER]` | |
| PAN (`ABCDE1234F`) | `[PAN]` | |
| OTP / verification code | `[OTP]` | |
| Person names (recipient, sender, a claimed "officer") | `[NAME]` | |
| Street address, flat, pincode that identifies a home | `[ADDRESS]` | |
| FIR / case / reference numbers under 9 digits that could identify a person | `[ID_NUMBER]` | Judgement call: if in doubt, mask |

**Keep** (these are the signal): bank and brand names (SBI, HDFC, Jio, BESCOM), organisations claimed
by the sender ("CBI", "TRAI"), amounts and currency, URLs and domains **exactly as written**, urgency
wording, typos, emoji, odd spacing and punctuation. Do not defang links.

URLs: keep the domain and path. Replace personal tokens after `?` or in the path with `[ID_NUMBER]`.

Amounts: write with Indian commas (`Rs 1,00,000`). The validator treats 9+ consecutive digits as an
identifier. Dates inside a message: use `12/10/2025`, not `12-10-2025 1430`.

Allowed placeholders are exactly: `[PHONE] [UPI] [EMAIL] [ACCOUNT] [ID_NUMBER] [PAN] [HANDLE] [NAME]
[ADDRESS] [CARD] [OTP]`. Anything else in square brackets is rejected (it is probably a typo that would
hide a real value).

## 3. The columns

`id, raw_text_scrubbed, language_tag, is_scam, attack_category, source_platform, date_received, contains_obfuscation`

- **id**: `GH-0001`, `GH-0002`, ... unique, never reused.
- **raw_text_scrubbed**: the message as received, scrubbed per section 2. Nothing else added.
- **language_tag**: `en`, `hi` (mostly Devanagari), `hinglish` (Hindi in Roman script, or Hindi and English
  mixed). Judge the *whole* message. A Hindi sentence with a few English words (`OTP`, `bank`) is still `hi`;
  an English sentence with `ji` or `aapka` is `hinglish` only if Hindi carries real meaning.
- **is_scam**: `1` if the sender is trying to deceive the recipient for money, credentials or data.
  `0` otherwise. Unsolicited marketing is not a scam: label it `0`/`safe`, but only if it is honest.
- **attack_category**: see section 4. Must be `safe` exactly when `is_scam=0`.
- **source_platform**: `sms`, `whatsapp`, `telegram`, `email`, `social_media`, `advisory_quote`, `other`.
- **date_received**: when *you or the source* received it, `YYYY-MM-DD`. Must be a real date, not in the
  future. For advisories use the advisory's publication date. This drives the time split, so do not guess:
  if you cannot date it, leave it out.
- **contains_obfuscation**: `true` if the text deliberately disguises words to evade filters: dots/spaces
  between letters (`U.P.I`, `K Y C`), symbol or digit swaps (`p@nding`, `0TP`, `bl0cked`), lookalike
  Unicode, zero-width characters. Ordinary typos and Hinglish spelling are **not** obfuscation. If the text
  contains `@` used as a letter, this must be `true` (the validator enforces it).

## 4. Categories and tie-breaking

| Category | The message is mainly... |
|---|---|
| `upi_collect` | asking you to approve a collect request, scan a QR to "receive" money, or pay a small amount for a refund/prize |
| `digital_arrest` | claiming police/CBI/ED/customs/TRAI, a parcel with drugs, a warrant, or demanding you stay on a call/video |
| `kyc_pan_block` | saying your KYC/PAN/Aadhaar/bank account/SIM will be blocked unless you update via a link or number |
| `job_fraud` | offering easy/work-from-home/part-time work, or a job that needs a registration/training fee |
| `electricity_disconnect` | threatening power disconnection tonight unless you call a number or pay |
| `investment_scam` | promising guaranteed or unusually high returns, trading/crypto/IPO groups, "tips" |
| `loan_app` | pushing an instant loan app, or harassing over a loan |
| `sextortion` | threatening to share intimate images or recordings |
| `sim_swap` | trying to get you to approve a SIM change/duplicate SIM or share its details |
| `other_scam` | a scam that fits none of the above (prize/lottery, fake refund, romance, fake customer-care...) |
| `safe` | genuine or harmless |

If a message fits several, label the **main thing it asks you to do**, not the pretext. "CBI officer
says your KYC is pending, pay a fine" = `digital_arrest`. "Your SBI KYC expires, click here" = `kyc_pan_block`.
Still stuck: use `other_scam` and add the row id to your private edge-case log.

### Edge cases
- **Hard negatives are as valuable as scams.** Genuine bank KYC reminders, real OTP alerts, electricity
  bills, courier OTPs, EMI due notices and government SMS look scam-like but are `safe`. Collect them
  deliberately. A detector that flags all of them is useless.
- **Legitimate but pushy** (a real bank warning you about phishing): `safe`.
- **Scam warnings that quote a scam** (an advisory saying "do not trust messages that say..."): `safe`,
  since the sender is not deceiving you. Do not label the quoted scam text inside it.
- **Transliteration**: label Hinglish as it is typed. Never "correct" `aapka account band ho jayega`.
- **Mixed scripts / lookalikes** (Cyrillic `а` in "bаnk"): keep exactly, mark `contains_obfuscation=true`.
- **Message is only a link** or is an image: skip it. OCR text is not a received message.
- **Near-duplicates.** The same scam template sent with a different name or number is **one** row. The
  validator rejects text that differs only in digits and placeholders. Keep the best-sourced copy.

## 5. Workflow

1. `node data_ops/generate_template.js` once, then copy the file to `data_ops/golden_holdout.csv`
   (it is gitignored: it contains real messages).
2. Scrub in a private place, then add rows. Aim for 50-100 per day with a break each hour: error rate
   climbs with fatigue.
3. After every batch: `npm run data:validate`. Fix everything it reports. It checks the schema, dates,
   duplicates and any leftover phone number, UPI ID, email, handle or PAN.
4. For counts against targets: `node data_ops/validate_csv.js data_ops/golden_holdout.csv --report`.
5. When you believe you are done: `npm run data:final`. It must pass.
6. Second-labeler check: a different person independently labels a random 100 rows (hide the existing labels).
   Report agreement (Cohen's kappa). If it is low, the guidelines are ambiguous: fix this document, then relabel.
7. Seal the file: record its SHA-256 and the date, then do not edit it. New data goes in a new version.

## 6. What the validator cannot do

It catches formats, not meaning. It cannot find a person's name, an address, a company that identifies
someone, or a message you copied without permission. It also cannot tell whether your label is right.
That is what steps 2, 5 and 6 are for.
