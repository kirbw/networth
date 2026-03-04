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
- Investments API endpoints (`GET/POST/DELETE /api/investments`) plus quote lookup endpoint (`GET /api/quote`).

### Changed
- Split admin area into subpages: Admin Users and Email Settings.
- Use a single Admin sidebar entry that reveals admin sub-navigation on admin pages.
- Moved primary app navigation to a left sidebar and session/logout controls to top-right.
- Split UI into dedicated pages: Home, Records, Admin Users, Email Settings, and Investments.
- Moved session + logout controls into the top navigation bar.

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
