# Annual Finance Tracker

A simple web app for tracking yearly:

- Total annual income
- Charitable giving
- Net worth (optional per year)

## Release

Current release: **v0.0.2**

## Features

- Save one record per tax year
- Update an existing year by re-submitting the same year
- Income and giving chart by year
- Separate net worth chart (only plots years where net worth is provided)
- Cumulative giving progress section with:
  - Cumulative income vs cumulative donations chart
  - 10% goal target line
  - On-track/off-track indicator based on lifetime giving rate
- Table view for all saved data
- Delete individual years or clear all records
- Persistent storage in SQLite (`finance.db`)

## Run locally

```bash
python3 server.py
```

Then open `http://localhost:3000`.
