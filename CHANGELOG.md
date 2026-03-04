# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Added
- Public self-signup with email verification codes.
- Forgot-password flow with email reset links and a dedicated reset password page.
- SMTP settings + website host configuration in admin email settings subpage.
- User delete action in admin user settings with confirmation prompt.
- Global version footer shown in bottom-left for troubleshooting.
- New Investments page for tracking ticker, shares, purchase price, and purchase date.
- Precious Metals subpage under Investments with collection-specific fields and totals.
- Real Estate subpage under Investments with ownership-based my-value calculation and map links.
- Business Ventures subpage under Investments with ownership-based my-value calculation.
- Investments API endpoints (`GET/POST/DELETE /api/investments`) plus quote lookup endpoint (`GET /api/quote`).
- Investments table now shows Gain/Loss per holding and a totals row.
- Stocks, Precious Metals, Real Estate, and Business Ventures tables are sortable by clicking key column headers.
- Server-side protected page redirects now enforce valid sessions before protected pages render.

- Security hardening: login rate limiting, hashed password-reset tokens, and stricter minimum password length.
- Admin SMTP settings reads now redact stored SMTP password values.
- Added baseline secure response headers (CSP, no-store cache, frame deny, no-sniff).

### Changed
- Split admin area into subpages: Admin Users and Email Settings.
- Use a single Admin sidebar entry that reveals admin sub-navigation on admin pages.
- Moved primary app navigation to a left sidebar and session/logout controls to top-right.
- Split UI into dedicated pages: Home, Records, Admin Users, Email Settings, and Investments.
- Moved session + logout controls into the top navigation bar.
- Prevent login-card flash on page switches by keeping auth UI hidden until session state loads.
- Added `next` redirect support after login for smoother server-initiated login flow.

## [v0.0.5] - 2026-03-04

### Added
- Investments subpages for **Real Estate** and **Business Ventures** with per-user CRUD APIs.
- Edit buttons/capability for all Investments subpages: Stocks, Precious Metals, Real Estate, and Business Ventures.
- Real Estate records now include a **Description** field.

### Changed
- Real Estate "My Value" display is calculated as `current value * (percentage owned / 100)`.
- Updated Investments navigation to include Stocks, Precious Metals, Real Estate, and Business Ventures.
- Updated docs and release metadata for `v0.0.5`.

## [v0.0.4] - 2026-03-04

### Added
- Released the multi-user authentication and admin-management functionality as stable.
- Added finalized release documentation and version metadata for deployment.

### Changed
- Promoted the prior unreleased auth/admin/data-isolation changes into the `v0.0.4` release record.

## [v0.0.3] - 2026-02-27

### Added
- Record editing support from the saved records table via an **Edit** button.
- Tax year picker suggestions (starting at 1970) using a datalist while keeping manual entry.
- Editable cumulative giving goal percentage input (default 10%) with local persistence.
- Goal progress details showing the additional donation amount needed to reach the selected target.

### Changed
- Net worth label formatting/alignment improvements in the data entry form.
- Cumulative giving chart target line now follows the selected goal percentage.

## [v0.0.2] - 2026-02-26

### Added
- Initial Annual Finance Tracker web app with SQLite-backed backend and Chart.js frontend.
- Annual income, donations, and optional net worth tracking with table + chart views.
- Cumulative giving progress chart and on-track/off-track status indicator.
- CRUD API (`GET/POST/DELETE`) and schema migration support for nullable `netWorth`.
