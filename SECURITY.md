# Security policy

## Supported versions

Only the latest release gets security fixes.

| Version | Supported |
|---|---|
| latest 2.x | yes |
| < 2.0 | no |

## Reporting a vulnerability

Please don't put details in a public issue. Use GitHub's private reporting
(the repository's **Security** tab → *Report a vulnerability*) when it is
offered; otherwise open an issue that only asks for a private channel, with
no details, and you'll get one.

Include the version (the About dialog shows it), what an attacker can do,
and the steps to reproduce. The maintainer aims to reply within a week; a
fix for a confirmed issue ships as a patch release, credited in the
changelog unless you ask otherwise.

## Scope

PiTasker edits a real crontab and runs shell commands as its user, so these
matter most:

- authentication or session bypass on any `/api` route;
- cross-site request forgery against a state-changing route;
- a way to write the crontab or start a command without the diff/confirm path;
- reading files outside `LOG_DIR` through the logs routes;
- a fleet agent that answers without a valid token, accepts anything but
  `GET`, or sends a secret that redaction should have removed.

Out of scope: attacks that need the operator's own login or shell access,
and the content of jobs the operator schedules.

## Design notes

- Every `/api` route except login and the public auth config needs a
  session (a test walks the router); sessions are Secure, HttpOnly,
  SameSite=Lax cookies, regenerated at login.
- State-changing requests must be same-origin JSON (`Origin`/`Referer` and
  `Sec-Fetch-Site` checks).
- Google sign-in accepts only verified emails on `FIREBASE_ALLOWED_EMAILS`;
  tokens are verified server-side with revocation checks.
- Crontab writes go through `crontab -` without a shell, after a diff, with
  a backup before and a read-back after.
- Fleet agents bind to a LAN or tunnel address, store only the SHA-256 of
  their token, have no request parameters, and run with an empty capability
  bounding set (no sudo).
