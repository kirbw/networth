# Annual Finance Tracker

A simple web app for tracking yearly:

- Total annual income
- Charitable giving
- Net worth (optional per year)

## Release

Current release: **v0.0.3**

## Security and multi-user update

This version adds:

- Username/password login
- Per-user data isolation (each user sees only their own records)
- Admin role with user management:
  - Create users
  - Reset passwords

### Default admin bootstrap

On first startup, the server creates an admin account if none exists:

- Username: `admin`
- Password: `change-me-now`

Change this immediately after first login, or set environment variables before starting:

```bash
ADMIN_USER=myadmin ADMIN_PASSWORD='strong-password' python3 server.py
```

## Features

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
