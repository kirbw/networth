# Annual Finance Tracker

A simple web app for tracking yearly:

- Total annual income
- Charitable giving
- Net worth

## Simplest persistent storage approach

The app now uses a **SQLite database** (`finance.db`) via a small built-in Python web server (`server.py`).

Why this is simple:
- No external database server required
- No third-party dependencies to install
- Data persists on disk between restarts

## Features

- Save one record per tax year
- Update an existing year by re-submitting the same year
- Visual trend graph using Chart.js
- Table view for all saved data
- Delete individual years or clear all records
- Persistent storage in SQLite (`finance.db`)

## Run locally

```bash
python3 server.py
```

Then open `http://localhost:3000`.
