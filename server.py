import hashlib
import hmac
import json
import os
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from http import cookies
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

DB_PATH = Path(__file__).with_name("finance.db")
SESSION_COOKIE = "session_token"
SESSION_DAYS = 7
PBKDF2_ITERATIONS = 260000


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def hash_password(password: str, salt: bytes | None = None) -> str:
    if salt is None:
        salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return f"{salt.hex()}${digest.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        salt_hex, hash_hex = stored_hash.split("$", 1)
        salt = bytes.fromhex(salt_hex)
    except ValueError:
        return False
    expected = hash_password(password, salt)
    return hmac.compare_digest(expected, stored_hash)


def migrate_schema(conn: sqlite3.Connection):
    table_info = conn.execute("PRAGMA table_info(annual_records)").fetchall()
    if not table_info:
        return

    has_user_id = any(col[1] == "user_id" for col in table_info)
    net_worth_column = next((col for col in table_info if col[1] == "netWorth"), None)
    net_worth_not_null = bool(net_worth_column and net_worth_column[3] == 1)

    if has_user_id and not net_worth_not_null:
        return

    conn.execute("ALTER TABLE annual_records RENAME TO annual_records_old")
    conn.execute(
        """
        CREATE TABLE annual_records (
            user_id INTEGER NOT NULL,
            year INTEGER NOT NULL,
            income REAL NOT NULL,
            donation REAL NOT NULL,
            netWorth REAL,
            PRIMARY KEY (user_id, year),
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        )
        """
    )

    # legacy schema had one global set of records; map to admin user by default
    admin_user = conn.execute("SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1").fetchone()
    default_user_id = admin_user[0] if admin_user else 1

    old_cols = [col[1] for col in table_info]
    if "user_id" in old_cols:
        conn.execute(
            """
            INSERT INTO annual_records (user_id, year, income, donation, netWorth)
            SELECT user_id, year, income, donation, netWorth
            FROM annual_records_old
            """
        )
    else:
        conn.execute(
            """
            INSERT INTO annual_records (user_id, year, income, donation, netWorth)
            SELECT ?, year, income, donation, netWorth
            FROM annual_records_old
            """,
            (default_user_id,),
        )

    conn.execute("DROP TABLE annual_records_old")


def init_db():
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('admin', 'user')),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS annual_records (
                user_id INTEGER NOT NULL,
                year INTEGER NOT NULL,
                income REAL NOT NULL,
                donation REAL NOT NULL,
                netWorth REAL,
                PRIMARY KEY (user_id, year),
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )

        migrate_schema(conn)

        admin_exists = conn.execute("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").fetchone()
        if not admin_exists:
            username = os.getenv("ADMIN_USER", "admin")
            password = os.getenv("ADMIN_PASSWORD", "change-me-now")
            now = utc_now_iso()
            conn.execute(
                "INSERT INTO users (username, password_hash, role, created_at, updated_at) VALUES (?, ?, 'admin', ?, ?)",
                (username, hash_password(password), now, now),
            )


def parse_cookie_token(handler: SimpleHTTPRequestHandler) -> str | None:
    raw = handler.headers.get("Cookie")
    if not raw:
        return None
    jar = cookies.SimpleCookie()
    jar.load(raw)
    morsel = jar.get(SESSION_COOKIE)
    return morsel.value if morsel else None


class FinanceHandler(SimpleHTTPRequestHandler):
    def _send_json(self, code: int, payload: dict | list, extra_headers: dict | None = None):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        if extra_headers:
            for key, value in extra_headers.items():
                self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    def _get_current_user(self):
        token = parse_cookie_token(self)
        if not token:
            return None

        with sqlite3.connect(DB_PATH) as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                """
                SELECT u.id, u.username, u.role, s.expires_at
                FROM sessions s
                JOIN users u ON u.id = s.user_id
                WHERE s.token = ?
                """,
                (token,),
            ).fetchone()

            if not row:
                return None

            expires_at = datetime.fromisoformat(row["expires_at"])
            if expires_at <= datetime.now(timezone.utc):
                conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
                return None

            return dict(row)

    def _require_auth(self):
        user = self._get_current_user()
        if not user:
            self._send_json(401, {"error": "Authentication required."})
            return None
        return user

    def _require_admin(self):
        user = self._require_auth()
        if not user:
            return None
        if user["role"] != "admin":
            self._send_json(403, {"error": "Admin access required."})
            return None
        return user

    def _session_cookie_header(self, token: str | None):
        if token is None:
            return f"{SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax"
        max_age = SESSION_DAYS * 24 * 60 * 60
        return f"{SESSION_COOKIE}={token}; HttpOnly; Path=/; Max-Age={max_age}; SameSite=Lax"

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == "/api/me":
            user = self._get_current_user()
            if not user:
                self._send_json(200, {"authenticated": False})
                return
            self._send_json(
                200,
                {
                    "authenticated": True,
                    "user": {
                        "id": user["id"],
                        "username": user["username"],
                        "role": user["role"],
                    },
                },
            )
            return

        if parsed.path == "/api/records":
            user = self._require_auth()
            if not user:
                return

            with sqlite3.connect(DB_PATH) as conn:
                conn.row_factory = sqlite3.Row
                rows = conn.execute(
                    """
                    SELECT year, income, donation, netWorth
                    FROM annual_records
                    WHERE user_id = ?
                    ORDER BY year ASC
                    """,
                    (user["id"],),
                ).fetchall()
            self._send_json(200, [dict(row) for row in rows])
            return

        if parsed.path == "/api/admin/users":
            admin = self._require_admin()
            if not admin:
                return

            with sqlite3.connect(DB_PATH) as conn:
                conn.row_factory = sqlite3.Row
                rows = conn.execute(
                    "SELECT id, username, role, created_at, updated_at FROM users ORDER BY username ASC"
                ).fetchall()
            self._send_json(200, [dict(row) for row in rows])
            return

        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)

        if parsed.path == "/api/login":
            try:
                data = self._read_json()
                username = str(data["username"]).strip()
                password = str(data["password"])
                if not username or not password:
                    raise ValueError
            except (KeyError, ValueError, TypeError, json.JSONDecodeError):
                self._send_json(400, {"error": "Invalid login data."})
                return

            with sqlite3.connect(DB_PATH) as conn:
                conn.row_factory = sqlite3.Row
                user = conn.execute(
                    "SELECT id, username, role, password_hash FROM users WHERE username = ?",
                    (username,),
                ).fetchone()

                if not user or not verify_password(password, user["password_hash"]):
                    self._send_json(401, {"error": "Invalid username or password."})
                    return

                token = secrets.token_urlsafe(32)
                expires_at = (datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS)).isoformat()
                created_at = utc_now_iso()
                conn.execute(
                    "INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
                    (token, user["id"], expires_at, created_at),
                )

            self._send_json(
                200,
                {
                    "success": True,
                    "user": {"id": user["id"], "username": user["username"], "role": user["role"]},
                },
                extra_headers={"Set-Cookie": self._session_cookie_header(token)},
            )
            return

        if parsed.path == "/api/logout":
            token = parse_cookie_token(self)
            if token:
                with sqlite3.connect(DB_PATH) as conn:
                    conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
            self._send_json(200, {"success": True}, extra_headers={"Set-Cookie": self._session_cookie_header(None)})
            return

        if parsed.path == "/api/records":
            user = self._require_auth()
            if not user:
                return

            try:
                data = self._read_json()
                year = int(data["year"])
                income = float(data["income"])
                donation = float(data["donation"])
                net_worth_raw = data.get("netWorth")
                net_worth = None if net_worth_raw in (None, "") else float(net_worth_raw)
                if year < 1970 or income < 0 or donation < 0:
                    raise ValueError
            except (KeyError, ValueError, TypeError, json.JSONDecodeError):
                self._send_json(400, {"error": "Invalid record data."})
                return

            with sqlite3.connect(DB_PATH) as conn:
                conn.execute(
                    """
                    INSERT INTO annual_records (user_id, year, income, donation, netWorth)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(user_id, year) DO UPDATE SET
                      income = excluded.income,
                      donation = excluded.donation,
                      netWorth = excluded.netWorth
                    """,
                    (user["id"], year, income, donation, net_worth),
                )

            self._send_json(200, {"success": True})
            return

        if parsed.path == "/api/admin/users":
            admin = self._require_admin()
            if not admin:
                return

            try:
                data = self._read_json()
                username = str(data["username"]).strip()
                password = str(data["password"])
                role = str(data.get("role", "user")).strip()
                if not username or not password or role not in ("admin", "user"):
                    raise ValueError
            except (KeyError, ValueError, TypeError, json.JSONDecodeError):
                self._send_json(400, {"error": "Invalid user data."})
                return

            now = utc_now_iso()
            try:
                with sqlite3.connect(DB_PATH) as conn:
                    conn.execute(
                        """
                        INSERT INTO users (username, password_hash, role, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?)
                        """,
                        (username, hash_password(password), role, now, now),
                    )
            except sqlite3.IntegrityError:
                self._send_json(409, {"error": "Username already exists."})
                return

            self._send_json(200, {"success": True})
            return

        if parsed.path.startswith("/api/admin/users/") and parsed.path.endswith("/reset-password"):
            admin = self._require_admin()
            if not admin:
                return

            parts = parsed.path.strip("/").split("/")
            if len(parts) != 5:
                self._send_json(404, {"error": "Not found"})
                return

            try:
                user_id = int(parts[3])
                data = self._read_json()
                new_password = str(data["password"])
                if not new_password:
                    raise ValueError
            except (ValueError, KeyError, TypeError, json.JSONDecodeError):
                self._send_json(400, {"error": "Invalid reset password request."})
                return

            now = utc_now_iso()
            with sqlite3.connect(DB_PATH) as conn:
                cursor = conn.execute(
                    "UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?",
                    (hash_password(new_password), now, user_id),
                )
                conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
                if cursor.rowcount == 0:
                    self._send_json(404, {"error": "User not found."})
                    return

            self._send_json(200, {"success": True})
            return

        self._send_json(404, {"error": "Not found"})

    def do_DELETE(self):
        parsed = urlparse(self.path)
        user = self._require_auth()
        if not user:
            return

        if parsed.path == "/api/records":
            with sqlite3.connect(DB_PATH) as conn:
                conn.execute("DELETE FROM annual_records WHERE user_id = ?", (user["id"],))
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
                conn.execute("DELETE FROM annual_records WHERE user_id = ? AND year = ?", (user["id"], year))
            self._send_json(200, {"success": True})
            return

        self._send_json(404, {"error": "Not found"})


if __name__ == "__main__":
    init_db()
    server = ThreadingHTTPServer(("0.0.0.0", 3000), FinanceHandler)
    print("Finance tracker running at http://localhost:3000")
    print("Default admin credentials (change immediately): admin / change-me-now")
    server.serve_forever()
