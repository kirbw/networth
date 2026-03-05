# Annual Finance Tracker

A simple web app for tracking yearly:

- Total annual income
- Charitable giving
- Net worth (optional per year)

## Release

Current release: **v0.0.6**

## Release Notes

### v0.0.6 highlights
- Condensed Net Worth report cleaned up to one line per category total, with asset rows in light green and liabilities rows in light red.
- Added a new Home-page Liabilities Overview chart, sorted largest-to-smallest by category, with combined liabilities total.
- Improved Home dashboard chart sizing/layout with a responsive multi-column grid so charts are less oversized.
- Added a print attestation statement with signature/date lines to the Net Worth report.

### v0.0.5 highlights
- Added edit capability across all Investments subpages (Stocks, Precious Metals, Real Estate, Business Ventures).
- Stocks now persist company name and current price in the database, and only refresh these when **Refresh Current Values** is clicked.
- Added Real Estate description field and fixed ownership-based My Value calculation (`current value × owned %`), plus gain/loss color coding and wider responsive investment layouts.
- Added gain/loss percentage columns to Stocks and Precious Metals.

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
- Investments section now has subpages for Stocks, Precious Metals, Real Estate, Business Ventures, and Retirement Accounts
- Dedicated Stocks page to track ticker, shares, purchase price, and purchase date
- Dedicated Precious Metals page for type, description, quantity, weight, where/date purchased, purchase price, and current value
- Dedicated Real Estate page for address, % owned, purchase/current value, and computed my-value (current × ownership %)
- Dedicated Business Ventures page for business name, % owned, business value, and computed my-value
- Dedicated Retirement Accounts page for description, type, broker, taxable flag, and account value
- Assets section with subpages for Vehicles, Guns, Bank Accounts, and Cash
- Liabilities section with subpages for Mortgages, Credit Cards, and Loans
- Live quote lookup endpoint and gain/loss calculation for each investment (quotes via Stooq)
- Stocks page stores company name + current price and shows a last refreshed timestamp
- Stocks totals now automatically exclude positions that do not have a current price (for unsupported tickers such as some OTC symbols)
- Stocks, Precious Metals, Real Estate, and Business Ventures tables support click-to-sort by key columns
- Investments table totals row for purchase value, current value, and gain/loss
- Home dashboard includes an investments summary chart (stocks, precious metals, real estate, business ventures, retirement accounts) plus combined total (sorted highest-to-lowest and without "My Value" wording in labels)
- Home dashboard now also includes a liabilities summary chart (mortgages, credit cards, loans) sorted highest-to-lowest with combined liabilities total
- Home charts use a responsive multi-column layout with reduced card heights for improved readability
- User profile page (click your name in the top-right) for updating full name, email, phone/contact info, street/city/state/zip, and password changes
- Net Worth Report header now includes statement owner and date
- Condensed (totals-only) checkbox on Net Worth Report for cleaner banker printouts
- Net Worth Report now includes Assets/Investments subtotal and Liabilities subtotal before total net worth
- Print styles tightened so report cards print back-to-back with reduced whitespace
- Liabilities section in Net Worth Report with category totals and subtraction from assets/investments for total net worth
- Mortgage liabilities linked to real estate are scaled by ownership percentage (and labeled with ownership %)
- Net Worth Report includes a signature attestation statement with signature/date lines for printing
- Loans now support secured yes/no, interest-only yes/no, and payment frequency (monthly/quarterly/annual)
- Edit on Records now scrolls directly to the edit form; deletes/clear actions now prompt for confirmation
- Smoother cross-page navigation by hiding login card until session check completes
- Server-side protection for app pages (`records`, `investments`, `assets`, `liabilities`, `admin`) with one-way redirects to login when session is invalid
- Sidebar navigation rendered server-side to avoid duplicating menu edits across every page
- Records link removed from sidebar; use "Edit Prior Years" button on Home next to "Save Year"
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
- Optional encryption-at-rest for selected fields: set `FIELD_ENCRYPTION_KEY` to a 32-byte key (raw 32 chars or base64url-encoded). When set, liability account number fields are encrypted with AES-GCM before writing to SQLite.
- Prefer adding CSRF protection and login rate limiting before internet exposure.
