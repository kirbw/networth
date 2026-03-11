# NetWorth (Annual Finance Tracker)

NetWorth is a self-hosted personal finance web application for tracking income, giving, assets, liabilities, and net worth over time. It is built for individuals and families who want one place to maintain financial records, monitor trends, and generate lender-ready net worth summaries.

## Release status

**Current release: `v0.0.80`**  
This is the first release intended to be **deployment-ready**.

## What it does

NetWorth helps you:

- Record annual income, charitable giving, and net worth history
- Track a broad range of assets and liabilities
- Maintain investment details and monitor gain/loss performance
- Generate printable net worth reports (including condensed banker-friendly format)
- Visualize financial trends using dashboard charts
- Manage data securely in a multi-user environment

## Core capabilities

### 1) Financial record management
- Save one record per tax year and update existing years
- View historical records in tabular form
- Edit prior years and remove records when needed

### 2) Asset and investment tracking
- Investments: Stocks, Precious Metals, Real Estate, Business Ventures, Retirement Accounts
- Assets: Vehicles, Bank Accounts, Cash, and additional personal asset categories
- Investment-level calculations for current value and gain/loss where applicable
- Sorting and summary totals to quickly compare holdings

### 3) Liability tracking
- Liabilities by category, including mortgages, credit cards, and loans
- Enhanced loan details (secured, interest-only, payment frequency)
- Ownership-aware mortgage handling for properties with partial ownership

### 4) Net worth reporting
- Full and condensed report formats
- Category totals for assets/investments and liabilities
- Signature/date attestation section for printed reports
- Print-optimized layout for sharing with banks, lenders, or advisors

### 5) Dashboards and analytics
- Year-over-year charts for income and giving
- Net worth trend chart (when net worth values are available)
- Investments overview chart with category rollups
- Liabilities overview chart with largest-to-smallest category display
- Cumulative giving progress with goal tracking and on-track indicator

### 6) Multi-user and administration
- Username/password authentication
- Signup with email verification
- Password reset via emailed reset links
- Role-based admin controls for user lifecycle management
- Per-user data isolation

### 7) Security and operational foundations
- Server-side session validation with HTTP-only cookies
- Hashed reset tokens (no plaintext reset-token storage)
- Baseline security headers and guarded protected routes
- SMTP/email configuration for verification and recovery flows
- SQLite-backed persistence for straightforward self-hosting

## Typical use cases

- Preparing annual personal financial summaries
- Organizing documents for a loan or credit review
- Monitoring long-term giving goals against income
- Centralizing household financial visibility across years

## Run locally

```bash
python3 server.py
```

Then open: `http://localhost:3000`

## Deployment notes

- Run behind HTTPS (reverse proxy) in production
- Use strong unique passwords for all accounts
- Restrict network exposure (firewall/VPN)
- Set `ADMIN_USER` and `ADMIN_PASSWORD` before first startup
- Optional: set `FIELD_ENCRYPTION_KEY` for encryption-at-rest of selected fields

Example:

```bash
ADMIN_USER=myadmin ADMIN_PASSWORD='strong-password' python3 server.py
```
