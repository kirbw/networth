# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

## [v0.1.0] - 2026-04-09

### Added
- Added the **Sandy Lake Retreat** workspace with goals, deer harvest, food plot history, expenses, and solar electric usage tracking.
- Added **Solar Electric Usage** records, API support, and database persistence for monthly generation and meter usage history.
- Added **Equipment** as an Assets subtab with full CRUD support and totals integration.
- Added support for linking **Loans** to vehicles or equipment for better collateral tracking.
- Added a lightweight frontend asset pipeline with `npm run check:frontend` and `npm run build:assets` for release preparation.

### Changed
- Promoted the project to **`v0.1.0`** as the first release with a fully redesigned frontend shell and release-aligned documentation.
- Rebuilt the frontend into a more modern multi-page interface with shared shell assets, modular JavaScript entrypoints, and a formal design-token layer.
- Redesigned dashboard, workspace, report, profile, admin, and Sandy Lake surfaces with stronger typography, calmer density, improved hierarchy, and better responsive behavior from mobile through desktop.
- Reworked the Home experience so unauthenticated visits now render a dedicated **login-only public landing page**, while authenticated users receive the full application shell after sign-in.
- Upgraded theme handling from a boolean dark-mode toggle to **`system` / `light` / `dark` theme preference** support, while keeping backward compatibility with existing dark-mode settings.
- Moved chart loading to an on-demand flow so report and dashboard charting only loads when needed.
- Consolidated repeated auth UI into a shared login/signup/verification/reset surface served consistently across pages.
- Improved mobile responsiveness across the app with a slide-out navigation pattern, refined topbar controls, overflow fixes, better table actions, and clearer sub-navigation behavior.
- Refreshed visual styling with a more deliberate lightweight system and improved dark-mode navigation contrast.
- Updated release metadata and docs to capture all changes shipped since `v0.0.80`.

## [v0.0.80] - 2026-03-11

### Added
- Added an **Admin Updates prerelease channel** with richer progress/status messaging during update checks and installs.
- Added an **Investment Calculator report** with growth projection charting and a yearly projection breakdown table.
- Added a **Loan Amortization report** with payment inputs and a printable amortization schedule.

### Changed
- Improved responsive/mobile layout behavior across the app and report pages.
- Tightened prerelease update selection so prerelease checks only resolve prerelease tags.
- Updated release metadata and documentation for the `v0.0.80` milestone.

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
