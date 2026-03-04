# Annual Finance Tracker

A simple web app for tracking yearly:

- Total annual income
- Charitable giving
- Net worth (optional per year)

## Release

Current release: **v0.0.4**

## Release Notes

### v0.0.4 highlights
- Promoted the multi-user authentication and admin-management build to an official release.
- Added formal release notes and changelog entries for deployment tracking.
- Kept all v0.0.3 functionality (auth, per-user data isolation, admin user management, user-scoped records) as the release baseline.

## Security and multi-user update

This version adds:

- Username/password login
- Public self-signup (create account) flow with email verification code
- Per-user data isolation (each user sees only their own records)
- Admin role with user management:
  - Create users
  - Reset passwords
  - Delete users (with confirmation in UI)
- Multi-page UI with left sidebar navigation:
  - Home (data entry + charts)
  - Records (saved records list + edit)
  - Admin (single menu entry) with sub-pages:
    - User Settings
    - Email Settings

### Default admin bootstrap

On first startup, the server creates an admin account if none exists:

- Username: `admin`
- Password: `change-me-now`

Change this immediately after first login, or set environment variables before starting:

```bash
ADMIN_USER=myadmin ADMIN_PASSWORD='strong-password' python3 server.py
```

## Features

- SMTP + host name settings for outbound email links and verification/reset emails
- Forgot password flow that emails reset links
- Version display in bottom-left footer for troubleshooting
- Dedicated Investments page to track ticker, shares, purchase price, and purchase date
- Live quote lookup endpoint and gain/loss calculation for each investment (quotes via Stooq)
- Investments table totals row for purchase value, current value, and gain/loss
- Smoother cross-page navigation by hiding login card until session check completes
- Server-side protection for app pages (`records`, `investments`, `admin`) with one-way redirects to login when session is invalid
- Session cookie is HTTP-only and validated against server-side session storage on every protected page request
- Login protection includes basic server-side rate limiting to reduce brute-force attempts
- Password reset tokens are stored as hashes in the database (not plaintext)
- Admin SMTP settings endpoint no longer returns stored SMTP passwords
- Added baseline security headers (CSP, frame deny, no-sniff, no-store cache)
- Save one record per tax year
- Update an existing year by re-submitting the same year
- Income and giving chart by year
- Separate net worth chart (only plots years where net worth is provided)
- Cumulative giving progress section with:
  - Editable goal percentage (defaults to 10% and is saved per user)
  - Cumulative income vs cumulative donations chart
  - Goal target line based on your selected percentage
  - On-track/off-track indicator based on lifetime giving rate
  - Amount still needed to reach your current giving goal
- Table view for all saved data
- Delete individual years or clear all records
- Persistent storage in SQLite (`finance.db`)

## Run locally

```bash
python3 server.py
```

Then open `http://localhost:3000`.

## Important production notes

- Run behind HTTPS (reverse proxy) so credentials and session cookies are encrypted in transit.
- Restrict network exposure (firewall/VPN) if this app is self-hosted.
- Use strong unique passwords for all users.
- Prefer adding CSRF protection and login rate limiting before internet exposure.
