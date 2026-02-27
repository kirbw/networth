import json
import sqlite3
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

DB_PATH = Path(__file__).with_name("finance.db")


def init_db():
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS annual_records (
                year INTEGER PRIMARY KEY,
                income REAL NOT NULL,
                donation REAL NOT NULL,
                netWorth REAL NOT NULL
            )
            """
        )


class FinanceHandler(SimpleHTTPRequestHandler):
    def _send_json(self, code: int, payload: dict | list):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/records":
            with sqlite3.connect(DB_PATH) as conn:
                conn.row_factory = sqlite3.Row
                rows = conn.execute(
                    "SELECT year, income, donation, netWorth FROM annual_records ORDER BY year ASC"
                ).fetchall()
            self._send_json(200, [dict(row) for row in rows])
            return

        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path != "/api/records":
            self._send_json(404, {"error": "Not found"})
            return

        try:
            data = self._read_json()
            year = int(data["year"])
            income = float(data["income"])
            donation = float(data["donation"])
            net_worth = float(data["netWorth"])
            if year <= 0 or income < 0 or donation < 0:
                raise ValueError
        except (KeyError, ValueError, TypeError, json.JSONDecodeError):
            self._send_json(400, {"error": "Invalid record data."})
            return

        with sqlite3.connect(DB_PATH) as conn:
            conn.execute(
                """
                INSERT INTO annual_records (year, income, donation, netWorth)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(year) DO UPDATE SET
                  income = excluded.income,
                  donation = excluded.donation,
                  netWorth = excluded.netWorth
                """,
                (year, income, donation, net_worth),
            )

        self._send_json(200, {"success": True})

    def do_DELETE(self):
        parsed = urlparse(self.path)

        if parsed.path == "/api/records":
            with sqlite3.connect(DB_PATH) as conn:
                conn.execute("DELETE FROM annual_records")
            self._send_json(200, {"success": True})
            return

        if parsed.path.startswith("/api/records/"):
            year_str = parsed.path.rsplit("/", 1)[-1]
            try:
                year = int(year_str)
            except ValueError:
                self._send_json(400, {"error": "Invalid year."})
                return

            with sqlite3.connect(DB_PATH) as conn:
                conn.execute("DELETE FROM annual_records WHERE year = ?", (year,))
            self._send_json(200, {"success": True})
            return

        self._send_json(404, {"error": "Not found"})


if __name__ == "__main__":
    init_db()
    server = ThreadingHTTPServer(("0.0.0.0", 3000), FinanceHandler)
    print("Finance tracker running at http://localhost:3000")
    server.serve_forever()
