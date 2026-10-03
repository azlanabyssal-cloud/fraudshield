# Claims register

Every factual claim the chatbot and recovery flow make, with its source and status. A wrong fact is the
most harmful failure this product can have: a victim acts on it. Rules: a claim ships only with a
source; "VERIFIED" means I read the source named, on the date given; anything else says so.

Audit date: 2026-10-03. Scope: the chatbot flows, the general-loss reply, the quiz, and the claims on
index.html and tips.html that these touched. **Not yet audited:** the rest of tips.html, data.html charts and
their percentage breakdowns, report.html copy, and most index.html statistics.

## Verified

| ID | Claim | Source | Status |
|---|---|---|---|
| C-01 | Under RBI's 6 July 2017 circular, zero liability applies to third-party breaches reported within 3 working days; limited liability for 4-7 days; a customer who shares credentials bears the loss until they report, and loss after reporting is the bank's; banks must resolve complaints within 90 days | rbi.org.in circular RBI/2017-18/15 (Scripts/BS_CircularIndexDisplay.aspx?Id=11040), read 2026-10-03 | VERIFIED (primary) |
| C-02 | PM Modi said on Mann Ki Baat, 27 October 2024, that there is no such thing as "digital arrest" in the law and that investigative agencies do not question people by phone or video call | PIB release PRID=2068698; The Week, 27 Oct 2024. The broadcast is in Hindi, so quoted English is a translation | VERIFIED (secondary for wording) |
| C-03 | BNS 318 = cheating, 319 = cheating by personation, 308 = extortion, 111 = organised crime including cyber-crimes | Lexology, Vakilsearch (legal explainers) | VERIFIED (secondary). Confirm against the official text before any formal use |

## Pending: sources conflict or were not read

| ID | Claim | Issue | Action |
|---|---|---|---|
| C-06 | RBI's June 2026 amendment: compensation of 85% of net loss up to Rs 25,000, once per lifetime, for losses up to Rs 50,000, covering transactions made under pressure or deception; report to bank AND the cyber portal/helpline within 5 days | Sources disagree on cost split (65/10/10 in the March draft vs 70/15 elsewhere). Final text not read. data.html still says "proposed" | Read the amendment on rbi.org.in. Until then the chatbot does not state figures or the 5-day rule |
| C-07 | Investment scams 76% of 2025 losses, digital arrest 9%, sextortion 4% | Via the user's PDF, which cites secondary articles | Trace to an I4C or PIB release |
| C-08 | CFCFRMS saved or froze Rs 8,690 Cr | Via the PDF. It is cumulative as of Jan 2026, not "January alone" (fixed) | Trace to the PIB release |
| C-09 | Fraud type shares (UPI 67%, OTP/SIM 12%, phishing 9%, loan apps 7%) | Provenance unknown; not in the PDF | Find the original source or remove |
| C-10 | 5.4% of complaints become FIRs (2023) | Derived in the PDF (86,420 FIRs vs ~15.96 lakh complaints) | Check the arithmetic and sources |
| C-11 | 1930, 112, 181 numbers; cybercrime.gov.in | Widely documented, not re-checked this session | Confirm on cybercrime.gov.in |
| C-12 | BNS 336/338 (forgery), 294/77 (obscenity/voyeurism), IT Act 66E | Removed from the product: unverified, and the deepfake and "confidential" readings were not supported | Re-add only with a primary source |

## Removed (were shipped, unsourced or wrong)

- "Calling your bank triggers RBI's Zero Liability process": only true for unauthorised transactions reported
  within 3 working days, and false for a customer who shared an OTP (C-01).
- Mann Ki Baat dated 27 October **2023** (it was 2024), and a paraphrase shown in quotation marks as the PM's
  own words with a Doordarshan credit.
- "No genuine investment guarantees returns above 12%": an invented threshold, repeated on seven pages
  and in the quiz. Replaced with "real investments carry risk; guaranteed returns are a red flag".
- "Recovery probability falls below ten percent after sixty minutes" and "only within the first hour":
  no source. Replaced with "the sooner you report, the better the chance".
- "UPI transactions can sometimes be reversed if reported within minutes": vague and unsourced.
- "No legitimate lender ever charges a fee before disbursing a loan": false as stated (processing fees exist).
- "Handled confidentially under IT Act Section 66E" and "the process protects your identity": a promise
  about police process we cannot make.
- "Is prosecuted as ...": charges are decided by police and courts. Now "can be charged as ...".
- "Used in 12% of all fraud cases" (OTP quiz): no source.
- "Frozen in January 2026 alone": the figure is cumulative.
- **C-13: absolute legal promises to sextortion victims** ("completely confidential by law (IT Act Sec 66E)",
  "IT Act Sec 66E and Sec 67 guarantee complete victim privacy", "the police cannot reveal your identity under any
  circumstance", "100% confidential"). The Act sections do not say this and the product cannot promise police behaviour.
  Replaced with "call 1930 and say it is a sensitive case".

## Maintenance rule
Before adding any number, deadline, legal section or "never/always" to the product, add it here with a
source. tests/claims.test.js blocks the removed wording and any BNS section not listed as verified.
