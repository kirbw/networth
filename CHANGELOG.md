# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Added
- Authentication with username/password login and logout endpoints.
- Multi-user data isolation so each user sees only their own annual records.
- Admin user management APIs and UI (create users and reset passwords).

### Changed
- `annual_records` schema updated to be user-scoped (`user_id`, `year` primary key).
- Legacy single-user records are migrated to the first admin account.


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
