# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

## [v0.0.75] - 2026-03-07

### Added
- Marked `v0.0.75` as the first release considered ready to deploy.

### Changed
- Rewrote the README with a high-level product overview focused on features, capabilities, security posture, and deployment guidance.
- Updated release documentation for the `v0.0.75` milestone.

## [v0.0.6] - 2026-03-05

### Added
- Added Home dashboard **Liabilities Overview** chart with category totals sorted largest-to-smallest.
- Added print attestation statement with signature/date lines on Net Worth reports.

### Changed
- Condensed Net Worth report now renders each category on a single line (`Category | Total`) for cleaner banker-facing output.
- Added visual highlighting in condensed reports: light green for Assets/Investments and light red for Liabilities.
- Improved Home dashboard chart layout with responsive side-by-side cards and reduced chart heights to better fit common screen sizes.
- Updated mortgage liability reporting to scale linked mortgage balances by property ownership percentage and label ownership in report descriptions.
- Expanded Loans with secured flag, interest-only flag, and payment frequency support, including API/UI/schema updates.
- Updated project metadata/docs for `v0.0.6`.

## [v0.0.5] - 2026-03-04

### Added
- Investments subpages for **Real Estate** and **Business Ventures** with per-user CRUD APIs.
- Edit buttons/capability for all Investments subpages: Stocks, Precious Metals, Real Estate, and Business Ventures.
- Real Estate records now include a **Description** field.
- Stocks now persist company names and current prices in DB, refreshed only via the refresh button.

### Changed
- Real Estate "My Value" display is calculated as `current value * (percentage owned / 100)`.
- Updated Investments navigation to include Stocks, Precious Metals, Real Estate, and Business Ventures.
- Updated docs and release metadata for `v0.0.5`.
- Added last-refreshed timestamp display for stock prices and widened investment pages for responsive use of screen width.
- Gain/loss values now use green for positive and red for negative values.

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
