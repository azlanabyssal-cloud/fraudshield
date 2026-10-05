# Security

FraudShield runs entirely in the browser: there is no server, no account and no stored user data, and a Content-Security-Policy stops the pages talking to any other host (see `docs/PRIVACY.md` and ADR-0015).

## Reporting a vulnerability

Please use GitHub's private reporting: **Security → Report a vulnerability** on this repository. Do not open a public issue for a security problem.

Useful reports say which page or file, what an attacker can do, and the smallest steps to reproduce. Please do not include anyone's real personal data.

## What is in scope

- A way to make a page send what a person typed or pasted to another host, or run script from outside the site.
- A way to make the checker call a scam "safe" (it never says safe; that would be a bug).
- Anything that weakens the model-loading checks, the service worker, or the policy in `partials/csp.txt`.

## Supply chain

Dependencies are pinned and installed without lifecycle scripts; CI actions are pinned to commit hashes and updated by Dependabot with a 7-day delay; CodeQL runs on every push.
