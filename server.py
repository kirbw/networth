import csv
import hashlib
import hmac
import io
import json
import os
import secrets
import smtplib
import sqlite3
import urllib.request
from datetime import datetime, timedelta, timezone
from email.mime.text import MIMEText
from http import cookies
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

DB_PATH = Path(__file__).with_name("finance.db")
VERSION_PATH = Path(__file__).with_name("VERSION")
SESSION_COOKIE = "session_token"
SESSION_DAYS = 7
PBKDF2_ITERATIONS = 260000
PROTECTED_PAGES = {"/records.html", "/investments.html", "/precious-metals.html", "/real-estate.html", "/business-ventures.html", "/admin-users.html", "/admin-email.html"}
ADMIN_PAGES = {"/admin-users.html", "/admin-email.html"}
LOGIN_WINDOW_SECONDS = 15 * 60
MAX_LOGIN_ATTEMPTS = 8
LOGIN_ATTEMPTS: dict[str, list[float]] = {}


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def utc_now_iso() -> str:
    return utc_now().isoformat()


def read_version() -> str:
    return VERSION_PATH.read_text().strip() if VERSION_PATH.exists() else "unknown"


def hash_password(password: str, salt: bytes | None = None) -> str:
    if salt is None:
        salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return f"{salt.hex()}${digest.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        salt_hex, _ = stored_hash.split("$", 1)
        salt = bytes.fromhex(salt_hex)
    except ValueError:
        return False
    expected = hash_password(password, salt)
    return hmac.compare_digest(expected, stored_hash)




def hash_reset_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def is_strong_password(password: str) -> bool:
    return len(password) >= 10


def is_login_allowed(key: str) -> bool:
    now = utc_now().timestamp()
    cutoff = now - LOGIN_WINDOW_SECONDS
    attempts = [ts for ts in LOGIN_ATTEMPTS.get(key, []) if ts >= cutoff]
    LOGIN_ATTEMPTS[key] = attempts
    return len(attempts) < MAX_LOGIN_ATTEMPTS


def register_login_failure(key: str):
    now = utc_now().timestamp()
    attempts = [ts for ts in LOGIN_ATTEMPTS.get(key, []) if ts >= now - LOGIN_WINDOW_SECONDS]
    attempts.append(now)
    LOGIN_ATTEMPTS[key] = attempts


def clear_login_failures(key: str):
    LOGIN_ATTEMPTS.pop(key, None)

def normalize_ticker(ticker: str) -> str:
    clean = ticker.strip().lower()
    if "." not in clean:
        clean = f"{clean}.us"
    return clean


def fetch_quote_price(ticker: str) -> float:
    symbol = normalize_ticker(ticker)
    url = f"https://stooq.com/q/l/?s={symbol}&f=sd2t2ohlcv&h&e=csv"
    with urllib.request.urlopen(url, timeout=10) as response:
        text = response.read().decode("utf-8", errors="ignore")
    reader = csv.DictReader(io.StringIO(text))
    row = next(reader, None)
    if not row:
        raise ValueError("No quote data returned.")
    close_value = row.get("Close")
    if not close_value or close_value == "N/D":
        raise ValueError("Ticker not found or unavailable.")
    return float(close_value)


def ensure_users_columns(conn: sqlite3.Connection):
    table_info = conn.execute("PRAGMA table_info(users)").fetchall()
    if not table_info:
        return
    col_names = {col[1] for col in table_info}
    if "full_name" not in col_names:
        conn.execute("ALTER TABLE users ADD COLUMN full_name TEXT NOT NULL DEFAULT ''")
    if "email" not in col_names:
        conn.execute("ALTER TABLE users ADD COLUMN email TEXT")
    if "is_verified" not in col_names:
        conn.execute("ALTER TABLE users ADD COLUMN is_verified INTEGER NOT NULL DEFAULT 0")
    if "verification_code" not in col_names:
        conn.execute("ALTER TABLE users ADD COLUMN verification_code TEXT")
    if "verification_expires_at" not in col_names:
        conn.execute("ALTER TABLE users ADD COLUMN verification_expires_at TEXT")


def ensure_users_email_unique(conn: sqlite3.Connection):
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users(email) WHERE email IS NOT NULL")


def migrate_records_schema(conn: sqlite3.Connection):
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
    admin_user = conn.execute("SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1").fetchone()
    default_user_id = admin_user[0] if admin_user else 1
    old_cols = [col[1] for col in table_info]
    if "user_id" in old_cols:
        conn.execute(
            "INSERT INTO annual_records (user_id, year, income, donation, netWorth) SELECT user_id, year, income, donation, netWorth FROM annual_records_old"
        )
    else:
        conn.execute(
            "INSERT INTO annual_records (user_id, year, income, donation, netWorth) SELECT ?, year, income, donation, netWorth FROM annual_records_old",
            (default_user_id,),
        )
    conn.execute("DROP TABLE annual_records_old")


def get_setting(conn: sqlite3.Connection, key: str, default: str = "") -> str:
    row = conn.execute("SELECT value FROM app_settings WHERE key = ?", (key,)).fetchone()
    return row[0] if row else default


def set_setting(conn: sqlite3.Connection, key: str, value: str):
    conn.execute(
        "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, value),
    )


def init_default_settings(conn: sqlite3.Connection):
    defaults = {
        "smtp_host": "",
        "smtp_port": "587",
        "smtp_username": "",
        "smtp_password": "",
        "smtp_from_email": "",
        "smtp_use_ssl": "0",
        "website_host": "http://localhost:3000",
    }
    for key, value in defaults.items():
        set_setting(conn, key, get_setting(conn, key, value) or value)


def send_email(conn: sqlite3.Connection, to_email: str, subject: str, body: str):
    host = get_setting(conn, "smtp_host", "")
    port = int(get_setting(conn, "smtp_port", "587") or "587")
    username = get_setting(conn, "smtp_username", "")
    password = get_setting(conn, "smtp_password", "")
    from_email = get_setting(conn, "smtp_from_email", username)
    use_ssl = get_setting(conn, "smtp_use_ssl", "0") == "1"

    if not host or not from_email:
        raise ValueError("SMTP is not configured. Set SMTP host and from email in admin settings.")

    msg = MIMEText(body)
    msg["Subject"] = subject
    msg["From"] = from_email
    msg["To"] = to_email

    if use_ssl:
        with smtplib.SMTP_SSL(host, port, timeout=15) as server:
            if username:
                server.login(username, password)
            server.send_message(msg)
    else:
        with smtplib.SMTP(host, port, timeout=15) as server:
            server.ehlo()
            try:
                server.starttls()
                server.ehlo()
            except Exception:
                pass
            if username:
                server.login(username, password)
            server.send_message(msg)


def init_db():
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                full_name TEXT NOT NULL DEFAULT '',
                username TEXT UNIQUE NOT NULL,
                email TEXT UNIQUE,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('admin', 'user')),
                is_verified INTEGER NOT NULL DEFAULT 0,
                verification_code TEXT,
                verification_expires_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        ensure_users_columns(conn)
        ensure_users_email_unique(conn)

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
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS investments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                ticker TEXT NOT NULL,
                shares REAL NOT NULL,
                purchase_price REAL NOT NULL,
                purchase_date TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS precious_metals (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                metal_type TEXT NOT NULL,
                description TEXT NOT NULL,
                quantity REAL NOT NULL,
                weight REAL NOT NULL,
                purchase_date TEXT NOT NULL,
                where_purchased TEXT NOT NULL,
                purchase_price REAL NOT NULL,
                current_value REAL NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS real_estate (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                address TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                percentage_owned REAL NOT NULL,
                purchase_price REAL NOT NULL,
                current_value REAL NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS business_ventures (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                business_name TEXT NOT NULL,
                percentage_owned REAL NOT NULL,
                business_value REAL NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS password_reset_tokens (
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
            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
            """
        )

        table_info_real_estate = conn.execute("PRAGMA table_info(real_estate)").fetchall()
        if table_info_real_estate and not any(col[1] == "description" for col in table_info_real_estate):
            conn.execute("ALTER TABLE real_estate ADD COLUMN description TEXT NOT NULL DEFAULT ''")

        migrate_records_schema(conn)
        init_default_settings(conn)

        admin_exists = conn.execute("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").fetchone()
        if not admin_exists:
            username = os.getenv("ADMIN_USER", "admin")
            password = os.getenv("ADMIN_PASSWORD", "change-me-now")
            email = os.getenv("ADMIN_EMAIL")
            full_name = os.getenv("ADMIN_FULL_NAME", "Administrator")
            now = utc_now_iso()
            conn.execute(
                """
                INSERT INTO users (full_name, username, email, password_hash, role, is_verified, created_at, updated_at)
                VALUES (?, ?, ?, ?, 'admin', 1, ?, ?)
                """,
                (full_name, username, email, hash_password(password), now, now),
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
    def _is_secure_request(self) -> bool:
        if self.request_version.upper().startswith("HTTPS"):
            return True
        return self.headers.get("X-Forwarded-Proto", "").lower() == "https"

    def _redirect(self, location: str):
        self.send_response(302)
        self.send_header("Location", location)
        self.end_headers()

    def _protected_page_redirect(self, parsed_path: str):
        if parsed_path not in PROTECTED_PAGES:
            return False
        user = self._get_current_user()
        if not user:
            self._redirect(f"/?next={parsed_path}")
            return True
        if parsed_path in ADMIN_PAGES and user["role"] != "admin":
            self._redirect("/")
            return True
        return False

    def end_headers(self):
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Pragma", "no-cache")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
        super().end_headers()

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

    def _session_cookie_header(self, token: str | None):
        secure = "; Secure" if self._is_secure_request() else ""
        if token is None:
            return f"{SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax{secure}"
        max_age = SESSION_DAYS * 24 * 60 * 60
        return f"{SESSION_COOKIE}={token}; HttpOnly; Path=/; Max-Age={max_age}; SameSite=Lax{secure}"

    def _get_current_user(self):
        token = parse_cookie_token(self)
        if not token:
            return None
        with sqlite3.connect(DB_PATH) as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                """
                SELECT u.id, u.full_name, u.username, u.email, u.role, u.is_verified, s.expires_at
                FROM sessions s JOIN users u ON u.id = s.user_id
                WHERE s.token = ?
                """,
                (token,),
            ).fetchone()
            if not row:
                return None
            if datetime.fromisoformat(row["expires_at"]) <= utc_now():
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

    def _extract_user_payload(self, data: dict, require_password: bool):
        full_name = str(data.get("fullName", "")).strip()
        username = str(data.get("username", "")).strip()
        email_raw = str(data.get("email", "")).strip()
        email = email_raw if email_raw else None
        password = str(data.get("password", ""))
        role = str(data.get("role", "user")).strip()
        if not full_name or not username or (require_password and not password):
            raise ValueError("Missing required user fields.")
        if role not in ("user", "admin"):
            raise ValueError("Invalid role.")
        if email is not None and "@" not in email:
            raise ValueError("Invalid email.")
        if password and not is_strong_password(password):
            raise ValueError("Password must be at least 10 characters.")
        return full_name, username, email, password, role

    def do_GET(self):
        parsed = urlparse(self.path)

        if self._protected_page_redirect(parsed.path):
            return

        if parsed.path == "/api/version":
            self._send_json(200, {"version": read_version()})
            return

        if parsed.path == "/api/me":
            user = self._get_current_user()
            if not user:
                self._send_json(200, {"authenticated": False})
                return
            self._send_json(200, {"authenticated": True, "user": {"id": user["id"], "fullName": user["full_name"], "username": user["username"], "email": user["email"], "role": user["role"]}})
            return

        if parsed.path == "/api/quote":
            user = self._require_auth()
            if not user:
                return
            params = parse_qs(parsed.query)
            ticker = params.get("ticker", [""])[0].strip()
            if not ticker:
                self._send_json(400, {"error": "Ticker is required."})
                return
            try:
                price = fetch_quote_price(ticker)
            except Exception as error:
                self._send_json(400, {"error": str(error)})
                return
            self._send_json(200, {"ticker": ticker.upper(), "currentPrice": price, "source": "Stooq"})
            return

        if parsed.path == "/api/records":
            user = self._require_auth()
            if not user:
                return
            with sqlite3.connect(DB_PATH) as conn:
                conn.row_factory = sqlite3.Row
                rows = conn.execute("SELECT year, income, donation, netWorth FROM annual_records WHERE user_id = ? ORDER BY year ASC", (user["id"],)).fetchall()
            self._send_json(200, [dict(row) for row in rows])
            return

        if parsed.path == "/api/investments":
            user = self._require_auth()
            if not user:
                return
            with sqlite3.connect(DB_PATH) as conn:
                conn.row_factory = sqlite3.Row
                rows = conn.execute(
                    "SELECT id, ticker, shares, purchase_price, purchase_date, created_at, updated_at FROM investments WHERE user_id = ? ORDER BY purchase_date DESC, id DESC",
                    (user["id"],),
                ).fetchall()
            self._send_json(200, [dict(row) for row in rows])
            return

        if parsed.path == "/api/precious-metals":
            user = self._require_auth()
            if not user:
                return
            with sqlite3.connect(DB_PATH) as conn:
                conn.row_factory = sqlite3.Row
                rows = conn.execute(
                    "SELECT id, metal_type, description, quantity, weight, purchase_date, where_purchased, purchase_price, current_value, created_at, updated_at FROM precious_metals WHERE user_id = ? ORDER BY purchase_date DESC, id DESC",
                    (user["id"],),
                ).fetchall()
            self._send_json(200, [dict(row) for row in rows])
            return

        if parsed.path == "/api/real-estate":
            user = self._require_auth()
            if not user:
                return
            with sqlite3.connect(DB_PATH) as conn:
                conn.row_factory = sqlite3.Row
                rows = conn.execute(
                    "SELECT id, address, description, percentage_owned, purchase_price, current_value, created_at, updated_at FROM real_estate WHERE user_id = ? ORDER BY id DESC",
                    (user["id"],),
                ).fetchall()
            self._send_json(200, [dict(row) for row in rows])
            return

        if parsed.path == "/api/business-ventures":
            user = self._require_auth()
            if not user:
                return
            with sqlite3.connect(DB_PATH) as conn:
                conn.row_factory = sqlite3.Row
                rows = conn.execute(
                    "SELECT id, business_name, percentage_owned, business_value, created_at, updated_at FROM business_ventures WHERE user_id = ? ORDER BY id DESC",
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
                rows = conn.execute("SELECT id, full_name, username, email, role, is_verified, created_at, updated_at FROM users ORDER BY username ASC").fetchall()
            self._send_json(200, [{"id": r["id"], "fullName": r["full_name"], "username": r["username"], "email": r["email"], "role": r["role"], "isVerified": bool(r["is_verified"]), "createdAt": r["created_at"], "updatedAt": r["updated_at"]} for r in rows])
            return

        if parsed.path == "/api/admin/smtp-settings":
            admin = self._require_admin()
            if not admin:
                return
            with sqlite3.connect(DB_PATH) as conn:
                settings = {
                    "smtpHost": get_setting(conn, "smtp_host", ""),
                    "smtpPort": get_setting(conn, "smtp_port", "587"),
                    "smtpUsername": get_setting(conn, "smtp_username", ""),
                    "smtpPassword": "",
                    "smtpFromEmail": get_setting(conn, "smtp_from_email", ""),
                    "smtpUseSsl": get_setting(conn, "smtp_use_ssl", "0") == "1",
                    "websiteHost": get_setting(conn, "website_host", "http://localhost:3000"),
                }
            self._send_json(200, settings)
            return

        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)

        if parsed.path == "/api/signup":
            try:
                data = self._read_json()
                full_name, username, email, password, _ = self._extract_user_payload(data, require_password=True)
                if not email:
                    raise ValueError("Email is required for account verification.")
            except (ValueError, KeyError, TypeError, json.JSONDecodeError) as error:
                self._send_json(400, {"error": str(error)})
                return

            code = f"{secrets.randbelow(1000000):06d}"
            expires_at = (utc_now() + timedelta(minutes=15)).isoformat()
            now = utc_now_iso()
            try:
                with sqlite3.connect(DB_PATH) as conn:
                    conn.execute(
                        "INSERT INTO users (full_name, username, email, password_hash, role, is_verified, verification_code, verification_expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'user', 0, ?, ?, ?, ?)",
                        (full_name, username, email, hash_password(password), code, expires_at, now, now),
                    )
                    send_email(conn, email, "Verify your Annual Finance Tracker account", f"Your verification code is: {code}\n\nThis code expires in 15 minutes.")
            except sqlite3.IntegrityError:
                self._send_json(409, {"error": "Username or email already exists."})
                return
            except Exception as error:
                self._send_json(500, {"error": f"Unable to send verification email: {error}"})
                return
            self._send_json(200, {"success": True, "message": "Account created. Check your email for verification code."})
            return

        if parsed.path == "/api/verify-account":
            try:
                data = self._read_json()
                username = str(data.get("username", "")).strip()
                code = str(data.get("code", "")).strip()
                if not username or not code:
                    raise ValueError("Username and code are required.")
            except (ValueError, TypeError, json.JSONDecodeError) as error:
                self._send_json(400, {"error": str(error)})
                return
            with sqlite3.connect(DB_PATH) as conn:
                conn.row_factory = sqlite3.Row
                user = conn.execute("SELECT id, verification_code, verification_expires_at FROM users WHERE username = ?", (username,)).fetchone()
                if not user:
                    self._send_json(404, {"error": "User not found."})
                    return
                if user["verification_code"] != code:
                    self._send_json(400, {"error": "Invalid verification code."})
                    return
                if not user["verification_expires_at"] or datetime.fromisoformat(user["verification_expires_at"]) < utc_now():
                    self._send_json(400, {"error": "Verification code expired."})
                    return
                conn.execute("UPDATE users SET is_verified = 1, verification_code = NULL, verification_expires_at = NULL, updated_at = ? WHERE id = ?", (utc_now_iso(), user["id"]))
            self._send_json(200, {"success": True})
            return

        if parsed.path == "/api/forgot-password":
            try:
                data = self._read_json()
                identifier = str(data.get("identifier", "")).strip()
                if not identifier:
                    raise ValueError("Email or username is required.")
            except (ValueError, TypeError, json.JSONDecodeError) as error:
                self._send_json(400, {"error": str(error)})
                return
            with sqlite3.connect(DB_PATH) as conn:
                conn.row_factory = sqlite3.Row
                user = conn.execute("SELECT id, email, username, full_name FROM users WHERE username = ? OR email = ?", (identifier, identifier)).fetchone()
                if user and user["email"]:
                    token = secrets.token_urlsafe(32)
                    token_hash = hash_reset_token(token)
                    conn.execute(
                        "INSERT INTO password_reset_tokens (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
                        (token_hash, user["id"], (utc_now() + timedelta(hours=1)).isoformat(), utc_now_iso()),
                    )
                    host = get_setting(conn, "website_host", "http://localhost:3000")
                    link = f"{host.rstrip('/')}/reset-password.html?token={token}"
                    try:
                        send_email(conn, user["email"], "Reset your Annual Finance Tracker password", f"Hello {user['full_name'] or user['username']},\n\nUse this link to reset your password:\n{link}\n\nThis link expires in 1 hour.")
                    except Exception as error:
                        self._send_json(500, {"error": f"Unable to send reset email: {error}"})
                        return
            self._send_json(200, {"success": True, "message": "If an account exists, a reset email has been sent."})
            return

        if parsed.path == "/api/reset-password":
            try:
                data = self._read_json()
                token = str(data.get("token", "")).strip()
                password = str(data.get("password", ""))
                if not token or not is_strong_password(password):
                    raise ValueError("Token and password (min 10 chars) are required.")
            except (ValueError, TypeError, json.JSONDecodeError) as error:
                self._send_json(400, {"error": str(error)})
                return
            with sqlite3.connect(DB_PATH) as conn:
                conn.row_factory = sqlite3.Row
                token_hash = hash_reset_token(token)
                reset_row = conn.execute("SELECT token, user_id, expires_at FROM password_reset_tokens WHERE token = ?", (token_hash,)).fetchone()
                if not reset_row:
                    self._send_json(400, {"error": "Invalid reset token."})
                    return
                if datetime.fromisoformat(reset_row["expires_at"]) < utc_now():
                    conn.execute("DELETE FROM password_reset_tokens WHERE token = ?", (token_hash,))
                    self._send_json(400, {"error": "Reset token expired."})
                    return
                conn.execute("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?", (hash_password(password), utc_now_iso(), reset_row["user_id"]))
                conn.execute("DELETE FROM password_reset_tokens WHERE user_id = ?", (reset_row["user_id"],))
                conn.execute("DELETE FROM sessions WHERE user_id = ?", (reset_row["user_id"],))
            self._send_json(200, {"success": True})
            return

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
            remote_ip = self.client_address[0] if self.client_address else "unknown"
            login_key = f"{remote_ip}:{username.lower()}"
            if not is_login_allowed(login_key):
                self._send_json(429, {"error": "Too many login attempts. Please wait and try again."})
                return
            with sqlite3.connect(DB_PATH) as conn:
                conn.row_factory = sqlite3.Row
                user = conn.execute("SELECT id, full_name, username, email, role, is_verified, password_hash FROM users WHERE username = ?", (username,)).fetchone()
                if not user or not verify_password(password, user["password_hash"]):
                    register_login_failure(login_key)
                    self._send_json(401, {"error": "Invalid username or password."})
                    return
                clear_login_failures(login_key)
                if user["role"] != "admin" and not user["is_verified"]:
                    self._send_json(403, {"error": "Account not verified. Please verify with the emailed code."})
                    return
                token = secrets.token_urlsafe(32)
                conn.execute("INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)", (token, user["id"], (utc_now() + timedelta(days=SESSION_DAYS)).isoformat(), utc_now_iso()))
            self._send_json(200, {"success": True, "user": {"id": user["id"], "fullName": user["full_name"], "username": user["username"], "email": user["email"], "role": user["role"]}}, extra_headers={"Set-Cookie": self._session_cookie_header(token)})
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
                    "INSERT INTO annual_records (user_id, year, income, donation, netWorth) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, year) DO UPDATE SET income = excluded.income, donation = excluded.donation, netWorth = excluded.netWorth",
                    (user["id"], year, income, donation, net_worth),
                )
            self._send_json(200, {"success": True})
            return

        if parsed.path == "/api/investments":
            user = self._require_auth()
            if not user:
                return
            try:
                data = self._read_json()
                record_id_raw = data.get("id")
                record_id = None if record_id_raw in (None, "") else int(record_id_raw)
                ticker = str(data.get("ticker", "")).upper().strip()
                shares = float(data.get("shares", 0))
                purchase_price = float(data.get("purchasePrice", 0))
                purchase_date = str(data.get("purchaseDate", "")).strip()
                if not ticker or shares <= 0 or purchase_price < 0 or not purchase_date:
                    raise ValueError
            except (ValueError, TypeError, json.JSONDecodeError):
                self._send_json(400, {"error": "Invalid investment data."})
                return
            now = utc_now_iso()
            with sqlite3.connect(DB_PATH) as conn:
                if record_id is None:
                    conn.execute(
                        "INSERT INTO investments (user_id, ticker, shares, purchase_price, purchase_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                        (user["id"], ticker, shares, purchase_price, purchase_date, now, now),
                    )
                else:
                    cursor = conn.execute(
                        "UPDATE investments SET ticker = ?, shares = ?, purchase_price = ?, purchase_date = ?, updated_at = ? WHERE id = ? AND user_id = ?",
                        (ticker, shares, purchase_price, purchase_date, now, record_id, user["id"]),
                    )
                    if cursor.rowcount == 0:
                        self._send_json(404, {"error": "Stock record not found."})
                        return
            self._send_json(200, {"success": True})
            return

        if parsed.path == "/api/precious-metals":
            user = self._require_auth()
            if not user:
                return
            try:
                data = self._read_json()
                record_id_raw = data.get("id")
                record_id = None if record_id_raw in (None, "") else int(record_id_raw)
                metal_type = str(data.get("type", "")).strip()
                description = str(data.get("description", "")).strip()
                quantity = float(data.get("quantity", 0))
                weight = float(data.get("weight", 0))
                purchase_date = str(data.get("datePurchased", "")).strip()
                where_purchased = str(data.get("wherePurchased", "")).strip()
                purchase_price = float(data.get("purchasePrice", 0))
                current_value = float(data.get("currentValue", 0))
                if not metal_type or not description or quantity < 0 or weight < 0 or not purchase_date or not where_purchased or purchase_price < 0 or current_value < 0:
                    raise ValueError
            except (ValueError, TypeError, json.JSONDecodeError):
                self._send_json(400, {"error": "Invalid precious metal data."})
                return
            now = utc_now_iso()
            with sqlite3.connect(DB_PATH) as conn:
                if record_id is None:
                    conn.execute(
                        "INSERT INTO precious_metals (user_id, metal_type, description, quantity, weight, purchase_date, where_purchased, purchase_price, current_value, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (user["id"], metal_type, description, quantity, weight, purchase_date, where_purchased, purchase_price, current_value, now, now),
                    )
                else:
                    cursor = conn.execute(
                        "UPDATE precious_metals SET metal_type = ?, description = ?, quantity = ?, weight = ?, purchase_date = ?, where_purchased = ?, purchase_price = ?, current_value = ?, updated_at = ? WHERE id = ? AND user_id = ?",
                        (metal_type, description, quantity, weight, purchase_date, where_purchased, purchase_price, current_value, now, record_id, user["id"]),
                    )
                    if cursor.rowcount == 0:
                        self._send_json(404, {"error": "Precious metals record not found."})
                        return
            self._send_json(200, {"success": True})
            return

        if parsed.path == "/api/real-estate":
            user = self._require_auth()
            if not user:
                return
            try:
                data = self._read_json()
                record_id_raw = data.get("id")
                record_id = None if record_id_raw in (None, "") else int(record_id_raw)
                address = str(data.get("address", "")).strip()
                description = str(data.get("description", "")).strip()
                percentage_owned = float(data.get("percentageOwned", 0))
                purchase_price = float(data.get("purchasePrice", 0))
                current_value = float(data.get("currentValue", 0))
                if not address or percentage_owned < 0 or percentage_owned > 100 or purchase_price < 0 or current_value < 0:
                    raise ValueError
            except (ValueError, TypeError, json.JSONDecodeError):
                self._send_json(400, {"error": "Invalid real estate data."})
                return
            now = utc_now_iso()
            with sqlite3.connect(DB_PATH) as conn:
                if record_id is None:
                    conn.execute(
                        "INSERT INTO real_estate (user_id, address, description, percentage_owned, purchase_price, current_value, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                        (user["id"], address, description, percentage_owned, purchase_price, current_value, now, now),
                    )
                else:
                    cursor = conn.execute(
                        "UPDATE real_estate SET address = ?, description = ?, percentage_owned = ?, purchase_price = ?, current_value = ?, updated_at = ? WHERE id = ? AND user_id = ?",
                        (address, description, percentage_owned, purchase_price, current_value, now, record_id, user["id"]),
                    )
                    if cursor.rowcount == 0:
                        self._send_json(404, {"error": "Real estate record not found."})
                        return
            self._send_json(200, {"success": True})
            return

        if parsed.path == "/api/business-ventures":
            user = self._require_auth()
            if not user:
                return
            try:
                data = self._read_json()
                record_id_raw = data.get("id")
                record_id = None if record_id_raw in (None, "") else int(record_id_raw)
                business_name = str(data.get("businessName", "")).strip()
                percentage_owned = float(data.get("percentageOwned", 0))
                business_value = float(data.get("businessValue", 0))
                if not business_name or percentage_owned < 0 or percentage_owned > 100 or business_value < 0:
                    raise ValueError
            except (ValueError, TypeError, json.JSONDecodeError):
                self._send_json(400, {"error": "Invalid business venture data."})
                return
            now = utc_now_iso()
            with sqlite3.connect(DB_PATH) as conn:
                if record_id is None:
                    conn.execute(
                        "INSERT INTO business_ventures (user_id, business_name, percentage_owned, business_value, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                        (user["id"], business_name, percentage_owned, business_value, now, now),
                    )
                else:
                    cursor = conn.execute(
                        "UPDATE business_ventures SET business_name = ?, percentage_owned = ?, business_value = ?, updated_at = ? WHERE id = ? AND user_id = ?",
                        (business_name, percentage_owned, business_value, now, record_id, user["id"]),
                    )
                    if cursor.rowcount == 0:
                        self._send_json(404, {"error": "Business venture record not found."})
                        return
            self._send_json(200, {"success": True})
            return

        if parsed.path == "/api/admin/users":
            admin = self._require_admin()
            if not admin:
                return
            try:
                data = self._read_json()
                full_name, username, email, password, role = self._extract_user_payload(data, require_password=True)
            except (ValueError, KeyError, TypeError, json.JSONDecodeError) as error:
                self._send_json(400, {"error": str(error)})
                return
            try:
                with sqlite3.connect(DB_PATH) as conn:
                    now = utc_now_iso()
                    conn.execute("INSERT INTO users (full_name, username, email, password_hash, role, is_verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)", (full_name, username, email, hash_password(password), role, now, now))
            except sqlite3.IntegrityError:
                self._send_json(409, {"error": "Username or email already exists."})
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
                if not is_strong_password(new_password):
                    raise ValueError
            except (ValueError, KeyError, TypeError, json.JSONDecodeError):
                self._send_json(400, {"error": "Password must be at least 10 characters."})
                return
            with sqlite3.connect(DB_PATH) as conn:
                cursor = conn.execute("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?", (hash_password(new_password), utc_now_iso(), user_id))
                conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
                if cursor.rowcount == 0:
                    self._send_json(404, {"error": "User not found."})
                    return
            self._send_json(200, {"success": True})
            return

        if parsed.path == "/api/admin/smtp-settings":
            admin = self._require_admin()
            if not admin:
                return
            try:
                data = self._read_json()
                smtp_host = str(data.get("smtpHost", "")).strip()
                smtp_port = str(data.get("smtpPort", "587")).strip()
                smtp_username = str(data.get("smtpUsername", "")).strip()
                smtp_password = str(data.get("smtpPassword", "")).strip()
                smtp_from = str(data.get("smtpFromEmail", "")).strip()
                smtp_use_ssl = "1" if bool(data.get("smtpUseSsl", False)) else "0"
                website_host = str(data.get("websiteHost", "http://localhost:3000")).strip()
                int(smtp_port)
            except (ValueError, TypeError, json.JSONDecodeError) as error:
                self._send_json(400, {"error": str(error)})
                return
            with sqlite3.connect(DB_PATH) as conn:
                set_setting(conn, "smtp_host", smtp_host)
                set_setting(conn, "smtp_port", smtp_port)
                set_setting(conn, "smtp_username", smtp_username)
                if smtp_password:
                    set_setting(conn, "smtp_password", smtp_password)
                set_setting(conn, "smtp_from_email", smtp_from)
                set_setting(conn, "smtp_use_ssl", smtp_use_ssl)
                set_setting(conn, "website_host", website_host)
            self._send_json(200, {"success": True})
            return

        self._send_json(404, {"error": "Not found"})

    def do_DELETE(self):
        parsed = urlparse(self.path)

        if parsed.path.startswith("/api/admin/users/"):
            admin = self._require_admin()
            if not admin:
                return
            parts = parsed.path.strip("/").split("/")
            if len(parts) != 4:
                self._send_json(404, {"error": "Not found"})
                return
            try:
                user_id = int(parts[3])
            except ValueError:
                self._send_json(400, {"error": "Invalid user id."})
                return
            if user_id == admin["id"]:
                self._send_json(400, {"error": "You cannot delete your own admin account."})
                return
            with sqlite3.connect(DB_PATH) as conn:
                cursor = conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
                if cursor.rowcount == 0:
                    self._send_json(404, {"error": "User not found."})
                    return
            self._send_json(200, {"success": True})
            return

        user = self._require_auth()
        if not user:
            return

        if parsed.path.startswith("/api/investments/"):
            try:
                investment_id = int(parsed.path.rsplit("/", 1)[-1])
            except ValueError:
                self._send_json(400, {"error": "Invalid investment id."})
                return
            with sqlite3.connect(DB_PATH) as conn:
                conn.execute("DELETE FROM investments WHERE id = ? AND user_id = ?", (investment_id, user["id"]))
            self._send_json(200, {"success": True})
            return

        if parsed.path.startswith("/api/precious-metals/"):
            try:
                item_id = int(parsed.path.rsplit("/", 1)[-1])
            except ValueError:
                self._send_json(400, {"error": "Invalid precious metal id."})
                return
            with sqlite3.connect(DB_PATH) as conn:
                conn.execute("DELETE FROM precious_metals WHERE id = ? AND user_id = ?", (item_id, user["id"]))
            self._send_json(200, {"success": True})
            return

        if parsed.path.startswith("/api/real-estate/"):
            try:
                item_id = int(parsed.path.rsplit("/", 1)[-1])
            except ValueError:
                self._send_json(400, {"error": "Invalid real estate id."})
                return
            with sqlite3.connect(DB_PATH) as conn:
                conn.execute("DELETE FROM real_estate WHERE id = ? AND user_id = ?", (item_id, user["id"]))
            self._send_json(200, {"success": True})
            return

        if parsed.path.startswith("/api/business-ventures/"):
            try:
                item_id = int(parsed.path.rsplit("/", 1)[-1])
            except ValueError:
                self._send_json(400, {"error": "Invalid business venture id."})
                return
            with sqlite3.connect(DB_PATH) as conn:
                conn.execute("DELETE FROM business_ventures WHERE id = ? AND user_id = ?", (item_id, user["id"]))
            self._send_json(200, {"success": True})
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
