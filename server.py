import base64
import binascii
import csv
import hashlib
import hmac
import io
import json
import os
import re
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
PROTECTED_PAGES = {"/records.html", "/investments.html", "/precious-metals.html", "/real-estate.html", "/business-ventures.html", "/retirement-accounts.html", "/assets-vehicles.html", "/assets-guns.html", "/assets-bank-accounts.html", "/assets-cash.html", "/liabilities-mortgages.html", "/liabilities-credit-cards.html", "/liabilities-loans.html", "/profile.html", "/net-worth-report.html", "/monthly-payments-report.html", "/liquid-cash-report.html", "/admin-users.html", "/admin-email.html", "/admin-backups.html", "/admin-notifications.html", "/notifications.html"}
ADMIN_PAGES = {"/admin-users.html", "/admin-email.html", "/admin-backups.html", "/admin-notifications.html"}
LOGIN_WINDOW_SECONDS = 15 * 60
MAX_LOGIN_ATTEMPTS = 8
LOGIN_ATTEMPTS: dict[str, list[float]] = {}

FIELD_ENCRYPTION_KEY = os.getenv("FIELD_ENCRYPTION_KEY", "").strip()
FIELD_ENCRYPTION_PREFIX = "enc:v1:"
_AES_GCM = None
BACKUP_DIR = Path(__file__).with_name("backups")


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




def _format_bytes(num_bytes: int) -> str:
    units = ["B", "KB", "MB", "GB", "TB"]
    value = float(max(0, num_bytes))
    unit = units[0]
    for u in units:
        unit = u
        if value < 1024 or u == units[-1]:
            break
        value /= 1024.0
    if unit == "B":
        return f"{int(value)} {unit}"
    return f"{value:.2f} {unit}"

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


def fetch_quote_details(ticker: str) -> tuple[float, str]:
    symbol = normalize_ticker(ticker)
    url = f"https://stooq.com/q/l/?s={symbol}&f=sd2t2ohlcvn&h&e=csv"
    with urllib.request.urlopen(url, timeout=10) as response:
        text = response.read().decode("utf-8", errors="ignore")
    reader = csv.DictReader(io.StringIO(text))
    row = next(reader, None)
    if not row:
        raise ValueError("No quote data returned.")
    close_value = row.get("Close")
    if not close_value or close_value == "N/D":
        raise ValueError("Ticker not found or unavailable.")
    name = (row.get("Name") or ticker.upper()).strip()
    return float(close_value), name


def ensure_users_columns(conn: sqlite3.Connection):
    table_info = conn.execute("PRAGMA table_info(users)").fetchall()
    if not table_info:
        return
    col_names = {col[1] for col in table_info}
    if "full_name" not in col_names:
        conn.execute("ALTER TABLE users ADD COLUMN full_name TEXT NOT NULL DEFAULT ''")
    if "email" not in col_names:
        conn.execute("ALTER TABLE users ADD COLUMN email TEXT")
    if "phone" not in col_names:
        conn.execute("ALTER TABLE users ADD COLUMN phone TEXT")
    if "street_address" not in col_names:
        conn.execute("ALTER TABLE users ADD COLUMN street_address TEXT")
    if "city" not in col_names:
        conn.execute("ALTER TABLE users ADD COLUMN city TEXT")
    if "state" not in col_names:
        conn.execute("ALTER TABLE users ADD COLUMN state TEXT")
    if "zip" not in col_names:
        conn.execute("ALTER TABLE users ADD COLUMN zip TEXT")
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


def get_user_setting(conn: sqlite3.Connection, user_id: int, key: str, default: str = "") -> str:
    row = conn.execute("SELECT value FROM user_settings WHERE user_id = ? AND key = ?", (user_id, key)).fetchone()
    return row[0] if row else default


def set_user_setting(conn: sqlite3.Connection, user_id: int, key: str, value: str):
    conn.execute(
        "INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value",
        (user_id, key, value),
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
        "backup_schedule_enabled": "0",
        "backup_schedule_interval_hours": "24",
        "backup_keep_count": "10",
        "backup_next_run_at": "",
    }
    for key, value in defaults.items():
        set_setting(conn, key, get_setting(conn, key, value) or value)


def safe_int(raw: str, default: int) -> int:
    try:
        return int(str(raw).strip())
    except (TypeError, ValueError):
        return default


def safe_float(raw: str, default: float) -> float:
    try:
        return float(str(raw).strip())
    except (TypeError, ValueError):
        return default


def backup_filename_prefix() -> str:
    return "finance-backup-"


def create_backup_snapshot() -> Path:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    destination = BACKUP_DIR / f"{backup_filename_prefix()}{timestamp}.sqlite3"
    temp_path = destination.with_suffix(".tmp")

    with sqlite3.connect(DB_PATH) as src, sqlite3.connect(temp_path) as dst:
        src.backup(dst)

    temp_path.replace(destination)
    return destination


def enforce_backup_retention(keep_count: int):
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    keep = max(1, keep_count)
    backups = sorted(BACKUP_DIR.glob(f"{backup_filename_prefix()}*.sqlite3"), reverse=True)
    for extra in backups[keep:]:
        extra.unlink(missing_ok=True)


def compute_next_backup_run(now: datetime, interval_hours: int) -> str:
    interval = max(1, interval_hours)
    return (now + timedelta(hours=interval)).isoformat()


def run_scheduled_backup_if_due(conn: sqlite3.Connection):
    enabled = get_setting(conn, "backup_schedule_enabled", "0") == "1"
    if not enabled:
        return
    interval_hours = safe_int(get_setting(conn, "backup_schedule_interval_hours", "24"), 24)
    keep_count = safe_int(get_setting(conn, "backup_keep_count", "10"), 10)
    now = utc_now()
    next_run_at_raw = get_setting(conn, "backup_next_run_at", "")
    try:
        next_run_at = datetime.fromisoformat(next_run_at_raw) if next_run_at_raw else now
    except ValueError:
        next_run_at = now
    if next_run_at.tzinfo is None:
        next_run_at = next_run_at.replace(tzinfo=timezone.utc)
    if next_run_at > now:
        return

    create_backup_snapshot()
    enforce_backup_retention(keep_count)
    set_setting(conn, "backup_next_run_at", compute_next_backup_run(now, interval_hours))


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
                phone TEXT,
                street_address TEXT,
                city TEXT,
                state TEXT,
                zip TEXT,
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
                company_name TEXT,
                shares REAL NOT NULL,
                purchase_price REAL NOT NULL,
                current_price REAL,
                price_refreshed_at TEXT,
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
            CREATE TABLE IF NOT EXISTS retirement_accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                description TEXT NOT NULL,
                account_type TEXT NOT NULL,
                broker TEXT NOT NULL,
                taxable INTEGER NOT NULL,
                value REAL NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS asset_vehicles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                description TEXT NOT NULL,
                make TEXT NOT NULL,
                model TEXT NOT NULL,
                model_year INTEGER,
                value REAL NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS asset_guns (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                description TEXT NOT NULL,
                gun_type TEXT NOT NULL,
                manufacturer TEXT NOT NULL DEFAULT '',
                model TEXT NOT NULL DEFAULT '',
                year_acquired INTEGER,
                notes TEXT,
                value REAL NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS asset_bank_accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                description TEXT NOT NULL,
                institution TEXT NOT NULL,
                account_type TEXT NOT NULL,
                balance REAL NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS asset_cash (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                description TEXT NOT NULL,
                amount REAL NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS liability_mortgages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                description TEXT NOT NULL,
                real_estate_id INTEGER,
                interest_rate REAL NOT NULL,
                monthly_payment REAL NOT NULL,
                start_date TEXT,
                initial_amount REAL NOT NULL,
                current_balance REAL NOT NULL,
                end_date TEXT,
                interest_change_date TEXT,
                account_number TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY(real_estate_id) REFERENCES real_estate(id) ON DELETE SET NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS liability_credit_cards (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                description TEXT NOT NULL,
                interest_rate REAL NOT NULL,
                special_interest_rate REAL,
                special_rate_end_date TEXT,
                monthly_payment REAL NOT NULL,
                start_date TEXT,
                initial_amount REAL NOT NULL,
                current_balance REAL NOT NULL,
                end_date TEXT,
                credit_limit REAL NOT NULL,
                account_number_last4 TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS liability_loans (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                description TEXT NOT NULL,
                loan_type TEXT NOT NULL,
                is_private INTEGER NOT NULL,
                vehicle_id INTEGER,
                interest_rate REAL NOT NULL,
                monthly_payment REAL NOT NULL,
                payment_amount REAL NOT NULL,
                payment_frequency TEXT NOT NULL DEFAULT 'monthly',
                is_secured INTEGER NOT NULL DEFAULT 0,
                interest_only INTEGER NOT NULL DEFAULT 0,
                start_date TEXT,
                initial_amount REAL NOT NULL,
                current_balance REAL NOT NULL,
                end_date TEXT,
                account_number TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY(vehicle_id) REFERENCES asset_vehicles(id) ON DELETE SET NULL
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
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS user_settings (
                user_id INTEGER NOT NULL,
                key TEXT NOT NULL,
                value TEXT NOT NULL,
                PRIMARY KEY (user_id, key),
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS notifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                type TEXT NOT NULL,
                title TEXT NOT NULL,
                message TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'unread',
                dedupe_key TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )
        conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_user_dedupe ON notifications(user_id, dedupe_key) WHERE dedupe_key IS NOT NULL")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS notification_broadcasts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sender_user_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                message TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(sender_user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )

        table_info_real_estate = conn.execute("PRAGMA table_info(real_estate)").fetchall()
        if table_info_real_estate and not any(col[1] == "description" for col in table_info_real_estate):
            conn.execute("ALTER TABLE real_estate ADD COLUMN description TEXT NOT NULL DEFAULT ''")

        table_info_liability_loans = conn.execute("PRAGMA table_info(liability_loans)").fetchall()
        loan_cols = {col[1] for col in table_info_liability_loans}
        if table_info_liability_loans and "payment_amount" not in loan_cols:
            conn.execute("ALTER TABLE liability_loans ADD COLUMN payment_amount REAL NOT NULL DEFAULT 0")
        if table_info_liability_loans and "monthly_payment" not in loan_cols:
            conn.execute("ALTER TABLE liability_loans ADD COLUMN monthly_payment REAL NOT NULL DEFAULT 0")
        if table_info_liability_loans and "payment_frequency" not in loan_cols:
            conn.execute("ALTER TABLE liability_loans ADD COLUMN payment_frequency TEXT NOT NULL DEFAULT 'monthly'")
        if table_info_liability_loans and "is_secured" not in loan_cols:
            conn.execute("ALTER TABLE liability_loans ADD COLUMN is_secured INTEGER NOT NULL DEFAULT 0")
        if table_info_liability_loans and "interest_only" not in loan_cols:
            conn.execute("ALTER TABLE liability_loans ADD COLUMN interest_only INTEGER NOT NULL DEFAULT 0")
        if table_info_liability_loans and "monthly_payment" in loan_cols and "payment_amount" in loan_cols:
            conn.execute("UPDATE liability_loans SET payment_amount = monthly_payment WHERE payment_amount = 0")
            conn.execute("UPDATE liability_loans SET monthly_payment = payment_amount WHERE monthly_payment = 0")

        table_info_liability_mortgages = conn.execute("PRAGMA table_info(liability_mortgages)").fetchall()
        mortgage_cols = {col[1] for col in table_info_liability_mortgages}
        if table_info_liability_mortgages and "account_number" not in mortgage_cols:
            conn.execute("ALTER TABLE liability_mortgages ADD COLUMN account_number TEXT")

        table_info_liability_credit_cards = conn.execute("PRAGMA table_info(liability_credit_cards)").fetchall()
        credit_card_cols = {col[1] for col in table_info_liability_credit_cards}
        if table_info_liability_credit_cards and "account_number_last4" not in credit_card_cols:
            conn.execute("ALTER TABLE liability_credit_cards ADD COLUMN account_number_last4 TEXT")

        if table_info_liability_loans and "account_number" not in loan_cols:
            conn.execute("ALTER TABLE liability_loans ADD COLUMN account_number TEXT")

        table_info_investments = conn.execute("PRAGMA table_info(investments)").fetchall()
        inv_cols = {col[1] for col in table_info_investments}
        if table_info_investments and "company_name" not in inv_cols:
            conn.execute("ALTER TABLE investments ADD COLUMN company_name TEXT")
        if table_info_investments and "current_price" not in inv_cols:
            conn.execute("ALTER TABLE investments ADD COLUMN current_price REAL")
        if table_info_investments and "price_refreshed_at" not in inv_cols:
            conn.execute("ALTER TABLE investments ADD COLUMN price_refreshed_at TEXT")
        if table_info_investments and "broker" not in inv_cols:
            conn.execute("ALTER TABLE investments ADD COLUMN broker TEXT NOT NULL DEFAULT ''")
        if table_info_investments and "manual_quote" not in inv_cols:
            conn.execute("ALTER TABLE investments ADD COLUMN manual_quote INTEGER NOT NULL DEFAULT 0")

        table_info_asset_guns = conn.execute("PRAGMA table_info(asset_guns)").fetchall()
        gun_cols = {col[1] for col in table_info_asset_guns}
        if table_info_asset_guns and "manufacturer" not in gun_cols:
            conn.execute("ALTER TABLE asset_guns ADD COLUMN manufacturer TEXT NOT NULL DEFAULT ''")
        if table_info_asset_guns and "model" not in gun_cols:
            conn.execute("ALTER TABLE asset_guns ADD COLUMN model TEXT NOT NULL DEFAULT ''")
        if table_info_asset_guns and "year_acquired" not in gun_cols:
            conn.execute("ALTER TABLE asset_guns ADD COLUMN year_acquired INTEGER")
        if table_info_asset_guns and "notes" not in gun_cols:
            conn.execute("ALTER TABLE asset_guns ADD COLUMN notes TEXT")

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


def _get_field_cipher():
    global _AES_GCM
    if not FIELD_ENCRYPTION_KEY:
        return None
    if _AES_GCM is not None:
        return _AES_GCM
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    except Exception as exc:
        raise RuntimeError("FIELD_ENCRYPTION_KEY is set but cryptography is not installed.") from exc

    raw = FIELD_ENCRYPTION_KEY.encode("utf-8")
    key = None
    if len(raw) == 32:
        key = raw
    else:
        try:
            key = base64.urlsafe_b64decode(FIELD_ENCRYPTION_KEY + "===")
        except (ValueError, binascii.Error) as exc:
            raise RuntimeError("Invalid FIELD_ENCRYPTION_KEY format; use 32 raw bytes or base64url-encoded 32-byte key.") from exc
    if len(key) != 32:
        raise RuntimeError("Invalid FIELD_ENCRYPTION_KEY length; expected 32-byte key.")
    _AES_GCM = AESGCM(key)
    return _AES_GCM


def encrypt_field_value(value: str | None) -> str | None:
    if value is None:
        return None
    if value.startswith(FIELD_ENCRYPTION_PREFIX):
        return value
    cipher = _get_field_cipher()
    if cipher is None:
        return value
    nonce = secrets.token_bytes(12)
    ciphertext = cipher.encrypt(nonce, value.encode("utf-8"), None)
    payload = base64.urlsafe_b64encode(nonce + ciphertext).decode("ascii")
    return f"{FIELD_ENCRYPTION_PREFIX}{payload}"


def decrypt_field_value(value: str | None) -> str | None:
    if value is None:
        return None
    if not value.startswith(FIELD_ENCRYPTION_PREFIX):
        return value
    cipher = _get_field_cipher()
    if cipher is None:
        raise RuntimeError("Encrypted data present but FIELD_ENCRYPTION_KEY is not configured.")
    payload = value[len(FIELD_ENCRYPTION_PREFIX):]
    try:
        packed = base64.urlsafe_b64decode(payload.encode("ascii"))
    except (ValueError, binascii.Error) as exc:
        raise RuntimeError("Encrypted field payload is invalid.") from exc
    nonce, ciphertext = packed[:12], packed[12:]
    plaintext = cipher.decrypt(nonce, ciphertext, None)
    return plaintext.decode("utf-8")


def normalize_account_number(value: object) -> str | None:
    text = str(value or "").strip()
    return text or None


def normalize_credit_card_last4(value: object) -> str | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    digits = "".join(ch for ch in raw if ch.isdigit())
    if len(digits) != 4:
        raise ValueError("Credit card account number must be exactly 4 digits.")
    return digits


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
                SELECT u.id, u.full_name, u.username, u.email, u.phone, u.street_address, u.city, u.state, u.zip, u.role, u.is_verified, s.expires_at
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

    def _estimate_user_storage_bytes(self, conn: sqlite3.Connection, user_id: int):
        total = 0

        def add(query: str, params=()):
            nonlocal total
            row = conn.execute(query, params).fetchone()
            if row and row[0] is not None:
                total += int(row[0])

        add("SELECT COALESCE(SUM(LENGTH(COALESCE(full_name,'')) + LENGTH(COALESCE(username,'')) + LENGTH(COALESCE(email,'')) + LENGTH(COALESCE(phone,'')) + LENGTH(COALESCE(street_address,'')) + LENGTH(COALESCE(city,'')) + LENGTH(COALESCE(state,'')) + LENGTH(COALESCE(zip,'')) + LENGTH(COALESCE(password_hash,'')) + 96), 0) FROM users WHERE id = ?", (user_id,))
        add("SELECT COALESCE(SUM(LENGTH(COALESCE(token,'')) + LENGTH(COALESCE(expires_at,'')) + LENGTH(COALESCE(created_at,'')) + 48), 0) FROM sessions WHERE user_id = ?", (user_id,))
        add("SELECT COALESCE(SUM(LENGTH(CAST(year AS TEXT)) + LENGTH(CAST(income AS TEXT)) + LENGTH(CAST(donation AS TEXT)) + LENGTH(COALESCE(CAST(netWorth AS TEXT), '')) + 48), 0) FROM annual_records WHERE user_id = ?", (user_id,))
        add("SELECT COALESCE(SUM(LENGTH(COALESCE(ticker,'')) + LENGTH(COALESCE(company_name,'')) + LENGTH(CAST(shares AS TEXT)) + LENGTH(CAST(purchase_price AS TEXT)) + LENGTH(COALESCE(CAST(current_price AS TEXT), '')) + LENGTH(COALESCE(price_refreshed_at,'')) + LENGTH(COALESCE(purchase_date,'')) + 64), 0) FROM investments WHERE user_id = ?", (user_id,))
        add("SELECT COALESCE(SUM(LENGTH(COALESCE(metal_type,'')) + LENGTH(COALESCE(description,'')) + LENGTH(CAST(quantity AS TEXT)) + LENGTH(CAST(weight AS TEXT)) + LENGTH(COALESCE(purchase_date,'')) + LENGTH(COALESCE(where_purchased,'')) + LENGTH(CAST(purchase_price AS TEXT)) + LENGTH(CAST(current_value AS TEXT)) + 64), 0) FROM precious_metals WHERE user_id = ?", (user_id,))
        add("SELECT COALESCE(SUM(LENGTH(COALESCE(description,'')) + LENGTH(COALESCE(address,'')) + LENGTH(CAST(percentage_owned AS TEXT)) + LENGTH(CAST(purchase_price AS TEXT)) + LENGTH(CAST(current_value AS TEXT)) + 64), 0) FROM real_estate WHERE user_id = ?", (user_id,))
        add("SELECT COALESCE(SUM(LENGTH(COALESCE(business_name,'')) + LENGTH(CAST(percentage_owned AS TEXT)) + LENGTH(CAST(business_value AS TEXT)) + 48), 0) FROM business_ventures WHERE user_id = ?", (user_id,))
        add("SELECT COALESCE(SUM(LENGTH(COALESCE(description,'')) + LENGTH(COALESCE(account_type,'')) + LENGTH(COALESCE(broker,'')) + LENGTH(CAST(taxable AS TEXT)) + LENGTH(CAST(value AS TEXT)) + 48), 0) FROM retirement_accounts WHERE user_id = ?", (user_id,))
        add("SELECT COALESCE(SUM(LENGTH(COALESCE(description,'')) + LENGTH(COALESCE(make,'')) + LENGTH(COALESCE(model,'')) + LENGTH(COALESCE(CAST(model_year AS TEXT), '')) + LENGTH(CAST(value AS TEXT)) + 48), 0) FROM asset_vehicles WHERE user_id = ?", (user_id,))
        add("SELECT COALESCE(SUM(LENGTH(COALESCE(description,'')) + LENGTH(COALESCE(gun_type,'')) + LENGTH(COALESCE(manufacturer,'')) + LENGTH(COALESCE(model,'')) + LENGTH(COALESCE(CAST(year_acquired AS TEXT), '')) + LENGTH(COALESCE(notes,'')) + LENGTH(CAST(value AS TEXT)) + 72), 0) FROM asset_guns WHERE user_id = ?", (user_id,))
        add("SELECT COALESCE(SUM(LENGTH(COALESCE(description,'')) + LENGTH(COALESCE(institution,'')) + LENGTH(COALESCE(account_type,'')) + LENGTH(CAST(balance AS TEXT)) + 48), 0) FROM asset_bank_accounts WHERE user_id = ?", (user_id,))
        add("SELECT COALESCE(SUM(LENGTH(COALESCE(description,'')) + LENGTH(CAST(amount AS TEXT)) + 32), 0) FROM asset_cash WHERE user_id = ?", (user_id,))
        add("SELECT COALESCE(SUM(LENGTH(COALESCE(description,'')) + LENGTH(CAST(interest_rate AS TEXT)) + LENGTH(CAST(monthly_payment AS TEXT)) + LENGTH(COALESCE(start_date,'')) + LENGTH(CAST(initial_amount AS TEXT)) + LENGTH(CAST(current_balance AS TEXT)) + LENGTH(COALESCE(end_date,'')) + LENGTH(COALESCE(interest_change_date,'')) + LENGTH(COALESCE(account_number,'')) + 64), 0) FROM liability_mortgages WHERE user_id = ?", (user_id,))
        add("SELECT COALESCE(SUM(LENGTH(COALESCE(description,'')) + LENGTH(CAST(interest_rate AS TEXT)) + LENGTH(COALESCE(CAST(special_interest_rate AS TEXT), '')) + LENGTH(COALESCE(special_rate_end_date,'')) + LENGTH(CAST(monthly_payment AS TEXT)) + LENGTH(COALESCE(start_date,'')) + LENGTH(CAST(initial_amount AS TEXT)) + LENGTH(CAST(current_balance AS TEXT)) + LENGTH(COALESCE(end_date,'')) + LENGTH(CAST(credit_limit AS TEXT)) + LENGTH(COALESCE(account_number_last4,'')) + 64), 0) FROM liability_credit_cards WHERE user_id = ?", (user_id,))
        add("SELECT COALESCE(SUM(LENGTH(COALESCE(description,'')) + LENGTH(COALESCE(loan_type,'')) + LENGTH(CAST(is_private AS TEXT)) + LENGTH(CAST(is_secured AS TEXT)) + LENGTH(CAST(interest_only AS TEXT)) + LENGTH(CAST(interest_rate AS TEXT)) + LENGTH(CAST(payment_amount AS TEXT)) + LENGTH(COALESCE(payment_frequency,'')) + LENGTH(COALESCE(start_date,'')) + LENGTH(CAST(initial_amount AS TEXT)) + LENGTH(CAST(current_balance AS TEXT)) + LENGTH(COALESCE(end_date,'')) + LENGTH(COALESCE(account_number,'')) + 72), 0) FROM liability_loans WHERE user_id = ?", (user_id,))

        return total

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

    def _nav_group_for_path(self, path: str) -> str:
        if path in ("/", "/index.html"):
            return "home"
        if path == "/records.html":
            return "records"
        if path in ("/investments.html", "/precious-metals.html", "/real-estate.html", "/business-ventures.html", "/retirement-accounts.html"):
            return "investments"
        if path in ("/assets-vehicles.html", "/assets-guns.html", "/assets-bank-accounts.html", "/assets-cash.html"):
            return "assets"
        if path in ("/liabilities-mortgages.html", "/liabilities-credit-cards.html", "/liabilities-loans.html"):
            return "liabilities"
        if path in ("/net-worth-report.html", "/monthly-payments-report.html", "/liquid-cash-report.html"):
            return "reports"
        if path == "/profile.html":
            return "profile"
        if path == "/notifications.html":
            return "notifications"
        if path in ("/admin-users.html", "/admin-email.html", "/admin-backups.html", "/admin-notifications.html"):
            return "admin"
        return ""

    def _render_sidebar(self, path: str) -> str:
        group = self._nav_group_for_path(path)
        def active(name: str) -> str:
            return ' class="active"' if group == name else ''
        return (
            '<aside class="sidebar">'
            '<h2>Finance Tracker</h2>'
            '<nav class="side-menu">'
            f'<a href="/"{active("home")}>Home</a>'
            f'<a href="/investments.html"{active("investments")}>Investments</a>'
            f'<a href="/assets-vehicles.html"{active("assets")}>Assets</a>'
            f'<a href="/liabilities-mortgages.html"{active("liabilities")}>Liabilities</a>'
            f'<a href="/net-worth-report.html"{active("reports")}>Reports</a>'
            f'<a href="/profile.html"{active("profile")}>My Profile</a>'
            f'<a href="/notifications.html"{active("notifications")}>Notifications</a>'
            f'<a id="nav-admin" href="/admin-users.html" class="hidden{(" active" if group == "admin" else "")}">Admin</a>'
            '</nav></aside>'
        )

    def _upsert_credit_card_promo_notifications(self, user_id: int):
        now = utc_now()
        window_end = now + timedelta(days=30)
        with sqlite3.connect(DB_PATH) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute("SELECT id, description, special_rate_end_date FROM liability_credit_cards WHERE user_id = ? AND special_interest_rate IS NOT NULL AND special_rate_end_date IS NOT NULL", (user_id,)).fetchall()
            for row in rows:
                try:
                    end_dt = datetime.fromisoformat((row["special_rate_end_date"] or "")[:10])
                    end_dt = end_dt.replace(tzinfo=timezone.utc)
                except ValueError:
                    continue
                if now <= end_dt <= window_end:
                    dedupe_key = f"cc-promo-expiry:{row['id']}:{end_dt.date().isoformat()}"
                    title = "Credit card promo rate ending soon"
                    message = f"{row['description']} promo rate ends on {end_dt.date().isoformat()}."
                    ts = utc_now_iso()
                    exists = conn.execute("SELECT 1 FROM notifications WHERE user_id = ? AND dedupe_key = ?", (user_id, dedupe_key)).fetchone()
                    if not exists:
                        conn.execute("INSERT INTO notifications (user_id, type, title, message, status, dedupe_key, created_at, updated_at) VALUES (?, 'credit-card-promo-expiry', ?, ?, 'unread', ?, ?, ?)", (user_id, title, message, dedupe_key, ts, ts))

    def _serve_templated_html(self, path: str) -> bool:
        if path == "/":
            file_path = "index.html"
        else:
            file_path = path.lstrip("/")
        if not file_path.endswith('.html') or not os.path.exists(file_path):
            return False
        if file_path == "reset-password.html":
            return False
        html = Path(file_path).read_text(encoding='utf-8')
        sidebar = self._render_sidebar(path)
        html = re.sub(r'<aside class="sidebar">.*?</aside>', sidebar, html, flags=re.S)
        body = html.encode('utf-8')
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        return True

    def do_GET(self):
        parsed = urlparse(self.path)

        with sqlite3.connect(DB_PATH) as conn:
            run_scheduled_backup_if_due(conn)

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
            self._upsert_credit_card_promo_notifications(user["id"])
            with sqlite3.connect(DB_PATH) as conn:
                unread_count = conn.execute("SELECT COUNT(1) FROM notifications WHERE user_id = ? AND status = 'unread'", (user["id"],)).fetchone()[0]
                giving_goal = safe_float(get_user_setting(conn, user["id"], "giving_goal_percent", "10"), 10.0)
            self._send_json(200, {"authenticated": True, "user": {"id": user["id"], "fullName": user["full_name"], "username": user["username"], "email": user["email"], "phone": user["phone"], "streetAddress": user["street_address"], "city": user["city"], "state": user["state"], "zip": user["zip"], "role": user["role"], "unreadNotifications": int(unread_count), "givingGoalPercent": giving_goal}})
            return

        if parsed.path == "/api/user-settings":
            user = self._require_auth()
            if not user:
                return
            with sqlite3.connect(DB_PATH) as conn:
                giving_goal = safe_float(get_user_setting(conn, user["id"], "giving_goal_percent", "10"), 10.0)
            self._send_json(200, {"givingGoalPercent": giving_goal})
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
                price, name = fetch_quote_details(ticker)
            except Exception as error:
                self._send_json(400, {"error": str(error)})
                return
            self._send_json(200, {"ticker": ticker.upper(), "companyName": name, "currentPrice": price, "source": "Stooq"})
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
                    "SELECT id, ticker, broker, company_name, shares, purchase_price, current_price, manual_quote, price_refreshed_at, purchase_date, created_at, updated_at FROM investments WHERE user_id = ? ORDER BY purchase_date DESC, id DESC",
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

        if parsed.path == "/api/retirement-accounts":
            user = self._require_auth()
            if not user:
                return
            with sqlite3.connect(DB_PATH) as conn:
                conn.row_factory = sqlite3.Row
                rows = conn.execute(
                    "SELECT id, description, account_type, broker, taxable, value, created_at, updated_at FROM retirement_accounts WHERE user_id = ? ORDER BY id DESC",
                    (user["id"],),
                ).fetchall()
            self._send_json(200, [dict(row) for row in rows])
            return

        if parsed.path == "/api/investments/summary":
            user = self._require_auth()
            if not user:
                return
            with sqlite3.connect(DB_PATH) as conn:
                stocks = conn.execute("SELECT COALESCE(SUM(shares * current_price), 0) FROM investments WHERE user_id = ? AND current_price IS NOT NULL", (user["id"],)).fetchone()[0]
                metals = conn.execute("SELECT COALESCE(SUM(current_value), 0) FROM precious_metals WHERE user_id = ?", (user["id"],)).fetchone()[0]
                real_estate = conn.execute("SELECT COALESCE(SUM(current_value * (percentage_owned / 100.0)), 0) FROM real_estate WHERE user_id = ?", (user["id"],)).fetchone()[0]
                business = conn.execute("SELECT COALESCE(SUM(business_value * (percentage_owned / 100.0)), 0) FROM business_ventures WHERE user_id = ?", (user["id"],)).fetchone()[0]
                retirement = conn.execute("SELECT COALESCE(SUM(value), 0) FROM retirement_accounts WHERE user_id = ?", (user["id"],)).fetchone()[0]
            combined = float(stocks) + float(metals) + float(real_estate) + float(business) + float(retirement)
            self._send_json(200, {
                "stocks": float(stocks),
                "preciousMetals": float(metals),
                "realEstateMyValue": float(real_estate),
                "businessVenturesMyValue": float(business),
                "retirementAccounts": float(retirement),
                "combinedTotal": combined,
            })
            return

        if parsed.path == "/api/liabilities/summary":
            user = self._require_auth()
            if not user:
                return
            with sqlite3.connect(DB_PATH) as conn:
                mortgages = conn.execute(
                    "SELECT COALESCE(SUM(m.current_balance * COALESCE(r.percentage_owned, 100) / 100.0), 0) FROM liability_mortgages m LEFT JOIN real_estate r ON r.id = m.real_estate_id WHERE m.user_id = ?",
                    (user["id"],),
                ).fetchone()[0]
                credit_cards = conn.execute("SELECT COALESCE(SUM(current_balance), 0) FROM liability_credit_cards WHERE user_id = ?", (user["id"],)).fetchone()[0]
                loans = conn.execute("SELECT COALESCE(SUM(current_balance), 0) FROM liability_loans WHERE user_id = ?", (user["id"],)).fetchone()[0]
            combined = float(mortgages) + float(credit_cards) + float(loans)
            self._send_json(200, {
                "mortgages": float(mortgages),
                "creditCards": float(credit_cards),
                "loans": float(loans),
                "combinedTotal": combined,
            })
            return


        if parsed.path == "/api/assets/vehicles":
            user = self._require_auth()
            if not user:
                return
            with sqlite3.connect(DB_PATH) as conn:
                conn.row_factory = sqlite3.Row
                rows = conn.execute("SELECT id, description, make, model, model_year, value, created_at, updated_at FROM asset_vehicles WHERE user_id = ? ORDER BY id DESC", (user["id"],)).fetchall()
            self._send_json(200, [dict(row) for row in rows])
            return

        if parsed.path == "/api/assets/guns":
            user = self._require_auth()
            if not user:
                return
            with sqlite3.connect(DB_PATH) as conn:
                conn.row_factory = sqlite3.Row
                rows = conn.execute("SELECT id, description, gun_type, manufacturer, model, year_acquired, notes, value, created_at, updated_at FROM asset_guns WHERE user_id = ? ORDER BY id DESC", (user["id"],)).fetchall()
            self._send_json(200, [dict(row) for row in rows])
            return

        if parsed.path == "/api/assets/bank-accounts":
            user = self._require_auth()
            if not user:
                return
            with sqlite3.connect(DB_PATH) as conn:
                conn.row_factory = sqlite3.Row
                rows = conn.execute("SELECT id, description, institution, account_type, balance, created_at, updated_at FROM asset_bank_accounts WHERE user_id = ? ORDER BY id DESC", (user["id"],)).fetchall()
            self._send_json(200, [dict(row) for row in rows])
            return

        if parsed.path == "/api/assets/cash":
            user = self._require_auth()
            if not user:
                return
            with sqlite3.connect(DB_PATH) as conn:
                conn.row_factory = sqlite3.Row
                rows = conn.execute("SELECT id, description, amount, created_at, updated_at FROM asset_cash WHERE user_id = ? ORDER BY id DESC", (user["id"],)).fetchall()
            self._send_json(200, [dict(row) for row in rows])
            return

        if parsed.path == "/api/liabilities/mortgages":
            user = self._require_auth()
            if not user:
                return
            with sqlite3.connect(DB_PATH) as conn:
                conn.row_factory = sqlite3.Row
                rows = conn.execute(
                    "SELECT m.id, m.description, m.real_estate_id, r.description AS real_estate_description, r.address AS real_estate_address, r.percentage_owned AS real_estate_percentage_owned, m.interest_rate, m.monthly_payment, m.start_date, m.initial_amount, m.current_balance, m.end_date, m.interest_change_date, m.account_number, m.created_at, m.updated_at FROM liability_mortgages m LEFT JOIN real_estate r ON r.id = m.real_estate_id WHERE m.user_id = ? ORDER BY m.id DESC",
                    (user["id"],),
                ).fetchall()
            payload = []
            for row in rows:
                item = dict(row)
                item["account_number"] = decrypt_field_value(item.get("account_number"))
                payload.append(item)
            self._send_json(200, payload)
            return

        if parsed.path == "/api/liabilities/credit-cards":
            user = self._require_auth()
            if not user:
                return
            with sqlite3.connect(DB_PATH) as conn:
                conn.row_factory = sqlite3.Row
                rows = conn.execute("SELECT id, description, interest_rate, special_interest_rate, special_rate_end_date, monthly_payment, start_date, initial_amount, current_balance, end_date, credit_limit, account_number_last4, created_at, updated_at FROM liability_credit_cards WHERE user_id = ? ORDER BY id DESC", (user["id"],)).fetchall()
            payload = []
            for row in rows:
                item = dict(row)
                item["account_number_last4"] = decrypt_field_value(item.get("account_number_last4"))
                payload.append(item)
            self._send_json(200, payload)
            return

        if parsed.path == "/api/liabilities/loans":
            user = self._require_auth()
            if not user:
                return
            with sqlite3.connect(DB_PATH) as conn:
                conn.row_factory = sqlite3.Row
                rows = conn.execute(
                    "SELECT l.id, l.description, l.loan_type, l.is_private, l.vehicle_id, v.description AS vehicle_description, v.make AS vehicle_make, v.model AS vehicle_model, l.interest_rate, l.payment_amount, l.payment_frequency, l.is_secured, l.interest_only, l.start_date, l.initial_amount, l.current_balance, l.end_date, l.account_number, l.created_at, l.updated_at FROM liability_loans l LEFT JOIN asset_vehicles v ON v.id = l.vehicle_id WHERE l.user_id = ? ORDER BY l.id DESC",
                    (user["id"],),
                ).fetchall()
            payload = []
            for row in rows:
                item = dict(row)
                item["account_number"] = decrypt_field_value(item.get("account_number"))
                payload.append(item)
            self._send_json(200, payload)
            return

        if parsed.path == "/api/reports/liquid-cash":
            user = self._require_auth()
            if not user:
                return
            with sqlite3.connect(DB_PATH) as conn:
                conn.row_factory = sqlite3.Row
                bank_rows = conn.execute("SELECT description, institution, account_type, balance FROM asset_bank_accounts WHERE user_id = ? ORDER BY description ASC", (user["id"],)).fetchall()
                cash_rows = conn.execute("SELECT description, amount FROM asset_cash WHERE user_id = ? ORDER BY description ASC", (user["id"],)).fetchall()
            self._send_json(200, {
                "bankAccounts": [dict(r) for r in bank_rows],
                "cashAccounts": [dict(r) for r in cash_rows],
            })
            return

        if parsed.path == "/api/notifications":
            user = self._require_auth()
            if not user:
                return
            self._upsert_credit_card_promo_notifications(user["id"])
            with sqlite3.connect(DB_PATH) as conn:
                conn.row_factory = sqlite3.Row
                rows = conn.execute("SELECT id, type, title, message, status, created_at, updated_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC", (user["id"],)).fetchall()
            self._send_json(200, [dict(r) for r in rows])
            return

        if parsed.path == "/api/reports/monthly-payments":
            user = self._require_auth()
            if not user:
                return
            params = parse_qs(parsed.query)
            month_raw = params.get("month", [""])[0].strip()
            try:
                month_start = datetime.strptime(month_raw, "%Y-%m") if month_raw else datetime.now()
                year = month_start.year
                month = month_start.month
            except ValueError:
                self._send_json(400, {"error": "Invalid month format. Use YYYY-MM."})
                return

            monthly_items = []
            periodic_items = []

            def parse_day(date_value: str | None) -> int:
                if not date_value:
                    return 1
                try:
                    return max(1, min(28, datetime.strptime(date_value[:10], "%Y-%m-%d").day))
                except ValueError:
                    return 1

            with sqlite3.connect(DB_PATH) as conn:
                conn.row_factory = sqlite3.Row
                mortgages = conn.execute("SELECT description, monthly_payment, start_date FROM liability_mortgages WHERE user_id = ?", (user["id"],)).fetchall()
                cards = conn.execute("SELECT description, monthly_payment, start_date FROM liability_credit_cards WHERE user_id = ?", (user["id"],)).fetchall()
                loans = conn.execute("SELECT description, payment_amount, payment_frequency, start_date, loan_type FROM liability_loans WHERE user_id = ?", (user["id"],)).fetchall()

            for row in mortgages:
                day = parse_day(row["start_date"])
                monthly_items.append({"category": "Mortgage", "description": row["description"], "amount": float(row["monthly_payment"] or 0), "dueDate": f"{year:04d}-{month:02d}-{day:02d}"})
            for row in cards:
                day = parse_day(row["start_date"])
                monthly_items.append({"category": "Credit Card", "description": row["description"], "amount": float(row["monthly_payment"] or 0), "dueDate": f"{year:04d}-{month:02d}-{day:02d}"})

            for row in loans:
                frequency = (row["payment_frequency"] or "monthly").lower()
                start_date = row["start_date"]
                day = parse_day(start_date)
                amount = float(row["payment_amount"] or 0)
                if frequency == "monthly":
                    monthly_items.append({"category": "Loan", "description": row["description"], "amount": amount, "dueDate": f"{year:04d}-{month:02d}-{day:02d}"})
                    continue

                due_in_month = True
                if start_date:
                    try:
                        start_dt = datetime.strptime(start_date[:10], "%Y-%m-%d")
                        month_index = (year - start_dt.year) * 12 + (month - start_dt.month)
                        if month_index < 0:
                            due_in_month = False
                        elif frequency == "quarterly":
                            due_in_month = month_index % 3 == 0
                        elif frequency == "annual":
                            due_in_month = month_index % 12 == 0
                    except ValueError:
                        pass

                if due_in_month:
                    periodic_items.append({"category": "Loan", "description": row["description"], "loanType": row["loan_type"], "frequency": frequency, "amount": amount, "dueDate": f"{year:04d}-{month:02d}-{day:02d}"})

            monthly_items.sort(key=lambda item: (item["dueDate"], item["category"], item["description"].lower()))
            periodic_items.sort(key=lambda item: (item["frequency"], item["dueDate"], item["description"].lower()))

            self._send_json(200, {
                "month": f"{year:04d}-{month:02d}",
                "monthlyPayments": monthly_items,
                "periodicPayments": periodic_items,
            })
            return

        if parsed.path == "/api/notifications/mark":
            user = self._require_auth()
            if not user:
                return
            try:
                data = self._read_json()
                notif_id = int(data.get("id"))
                status = str(data.get("status", "")).strip().lower()
                if status not in ("read", "unread"):
                    raise ValueError
            except (ValueError, TypeError, json.JSONDecodeError):
                self._send_json(400, {"error": "Invalid notification update."})
                return
            with sqlite3.connect(DB_PATH) as conn:
                conn.execute("UPDATE notifications SET status = ?, updated_at = ? WHERE id = ? AND user_id = ?", (status, utc_now_iso(), notif_id, user["id"]))
            self._send_json(200, {"success": True})
            return

        if parsed.path == "/api/profile":
            user = self._require_auth()
            if not user:
                return
            try:
                data = self._read_json()
                full_name = str(data.get("fullName", "")).strip()
                email_raw = str(data.get("email", "")).strip()
                email = email_raw if email_raw else None
                phone_raw = str(data.get("phone", "")).strip()
                phone = phone_raw if phone_raw else None
                street_address = str(data.get("streetAddress", "")).strip() or None
                city = str(data.get("city", "")).strip() or None
                state = str(data.get("state", "")).strip() or None
                zip_code = str(data.get("zip", "")).strip() or None
                current_password = str(data.get("currentPassword", ""))
                new_password = str(data.get("newPassword", ""))
                if not full_name:
                    raise ValueError("Full name is required.")
                if email is not None and "@" not in email:
                    raise ValueError("Email must be valid.")
                if new_password and len(new_password) < 10:
                    raise ValueError("New password must be at least 10 characters.")
            except (ValueError, TypeError, json.JSONDecodeError) as error:
                self._send_json(400, {"error": str(error)})
                return
            try:
                with sqlite3.connect(DB_PATH) as conn:
                    conn.row_factory = sqlite3.Row
                    if new_password:
                        row = conn.execute("SELECT password_hash FROM users WHERE id = ?", (user["id"],)).fetchone()
                        if not row or not verify_password(current_password, row["password_hash"]):
                            self._send_json(400, {"error": "Current password is incorrect."})
                            return
                        conn.execute("UPDATE users SET full_name = ?, email = ?, phone = ?, street_address = ?, city = ?, state = ?, zip = ?, password_hash = ?, updated_at = ? WHERE id = ?", (full_name, email, phone, street_address, city, state, zip_code, hash_password(new_password), utc_now_iso(), user["id"]))
                    else:
                        conn.execute("UPDATE users SET full_name = ?, email = ?, phone = ?, street_address = ?, city = ?, state = ?, zip = ?, updated_at = ? WHERE id = ?", (full_name, email, phone, street_address, city, state, zip_code, utc_now_iso(), user["id"]))
            except sqlite3.IntegrityError:
                self._send_json(409, {"error": "Email already in use."})
                return
            self._send_json(200, {"success": True})
            return

        if parsed.path == "/api/assets/vehicles":
            user = self._require_auth()
            if not user:
                return
            try:
                data = self._read_json()
                record_id_raw = data.get("id")
                record_id = None if record_id_raw in (None, "") else int(record_id_raw)
                description = str(data.get("description", "")).strip()
                make = str(data.get("make", "")).strip()
                model = str(data.get("model", "")).strip()
                model_year_raw = data.get("year")
                model_year = None if model_year_raw in (None, "") else int(model_year_raw)
                value = float(data.get("value", 0))
                if not description or not make or not model or value < 0:
                    raise ValueError
            except (ValueError, TypeError, json.JSONDecodeError):
                self._send_json(400, {"error": "Invalid vehicle data."})
                return
            now = utc_now_iso()
            with sqlite3.connect(DB_PATH) as conn:
                if record_id is None:
                    conn.execute("INSERT INTO asset_vehicles (user_id, description, make, model, model_year, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (user["id"], description, make, model, model_year, value, now, now))
                else:
                    cursor = conn.execute("UPDATE asset_vehicles SET description = ?, make = ?, model = ?, model_year = ?, value = ?, updated_at = ? WHERE id = ? AND user_id = ?", (description, make, model, model_year, value, now, record_id, user["id"]))
                    if cursor.rowcount == 0:
                        self._send_json(404, {"error": "Vehicle not found."})
                        return
            self._send_json(200, {"success": True})
            return

        if parsed.path == "/api/assets/guns":
            user = self._require_auth()
            if not user:
                return
            try:
                data = self._read_json()
                record_id_raw = data.get("id")
                record_id = None if record_id_raw in (None, "") else int(record_id_raw)
                description = str(data.get("description", "")).strip()
                gun_type = str(data.get("type", "")).strip()
                manufacturer = str(data.get("manufacturer", "")).strip()
                model = str(data.get("model", "")).strip()
                year_raw = data.get("yearAcquired")
                year_acquired = None if year_raw in (None, "") else int(year_raw)
                notes = str(data.get("notes", "")).strip() or None
                value = float(data.get("value", 0))
                allowed = {"Handgun", "Rifle", "Shotgun", "Air Rifle"}
                if not description or gun_type not in allowed or value < 0:
                    raise ValueError
            except (ValueError, TypeError, json.JSONDecodeError):
                self._send_json(400, {"error": "Invalid gun data."})
                return
            now = utc_now_iso()
            with sqlite3.connect(DB_PATH) as conn:
                if record_id is None:
                    conn.execute("INSERT INTO asset_guns (user_id, description, gun_type, manufacturer, model, year_acquired, notes, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", (user["id"], description, gun_type, manufacturer, model, year_acquired, notes, value, now, now))
                else:
                    cursor = conn.execute("UPDATE asset_guns SET description = ?, gun_type = ?, manufacturer = ?, model = ?, year_acquired = ?, notes = ?, value = ?, updated_at = ? WHERE id = ? AND user_id = ?", (description, gun_type, manufacturer, model, year_acquired, notes, value, now, record_id, user["id"]))
                    if cursor.rowcount == 0:
                        self._send_json(404, {"error": "Gun entry not found."})
                        return
            self._send_json(200, {"success": True})
            return

        if parsed.path == "/api/assets/bank-accounts":
            user = self._require_auth()
            if not user:
                return
            try:
                data = self._read_json()
                record_id_raw = data.get("id")
                record_id = None if record_id_raw in (None, "") else int(record_id_raw)
                description = str(data.get("description", "")).strip()
                institution = str(data.get("institution", "")).strip()
                account_type = str(data.get("type", "")).strip()
                balance = float(data.get("balance", 0))
                if not description or not institution or not account_type or balance < 0:
                    raise ValueError
            except (ValueError, TypeError, json.JSONDecodeError):
                self._send_json(400, {"error": "Invalid bank account data."})
                return
            now = utc_now_iso()
            with sqlite3.connect(DB_PATH) as conn:
                if record_id is None:
                    conn.execute("INSERT INTO asset_bank_accounts (user_id, description, institution, account_type, balance, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", (user["id"], description, institution, account_type, balance, now, now))
                else:
                    cursor = conn.execute("UPDATE asset_bank_accounts SET description = ?, institution = ?, account_type = ?, balance = ?, updated_at = ? WHERE id = ? AND user_id = ?", (description, institution, account_type, balance, now, record_id, user["id"]))
                    if cursor.rowcount == 0:
                        self._send_json(404, {"error": "Bank account not found."})
                        return
            self._send_json(200, {"success": True})
            return

        if parsed.path == "/api/assets/cash":
            user = self._require_auth()
            if not user:
                return
            try:
                data = self._read_json()
                record_id_raw = data.get("id")
                record_id = None if record_id_raw in (None, "") else int(record_id_raw)
                description = str(data.get("description", "")).strip()
                amount = float(data.get("amount", 0))
                if not description or amount < 0:
                    raise ValueError
            except (ValueError, TypeError, json.JSONDecodeError):
                self._send_json(400, {"error": "Invalid cash data."})
                return
            now = utc_now_iso()
            with sqlite3.connect(DB_PATH) as conn:
                if record_id is None:
                    conn.execute("INSERT INTO asset_cash (user_id, description, amount, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", (user["id"], description, amount, now, now))
                else:
                    cursor = conn.execute("UPDATE asset_cash SET description = ?, amount = ?, updated_at = ? WHERE id = ? AND user_id = ?", (description, amount, now, record_id, user["id"]))
                    if cursor.rowcount == 0:
                        self._send_json(404, {"error": "Cash entry not found."})
                        return
            self._send_json(200, {"success": True})
            return

        if parsed.path == "/api/liabilities/mortgages":
            user = self._require_auth()
            if not user:
                return
            try:
                data = self._read_json()
                record_id_raw = data.get("id")
                record_id = None if record_id_raw in (None, "") else int(record_id_raw)
                description = str(data.get("description", "")).strip()
                real_estate_id_raw = data.get("realEstateId")
                real_estate_id = None if real_estate_id_raw in (None, "") else int(real_estate_id_raw)
                interest_rate = float(data.get("interestRate", 0))
                monthly_payment = float(data.get("monthlyPayment", 0))
                start_date = str(data.get("startDate", "")).strip() or None
                initial_amount = float(data.get("initialAmount", 0))
                current_balance = float(data.get("currentBalance", 0))
                end_date = str(data.get("endDate", "")).strip() or None
                interest_change_date = str(data.get("interestChangeDate", "")).strip() or None
                account_number = normalize_account_number(data.get("accountNumber"))
                account_number_stored = encrypt_field_value(account_number)
                if not description or interest_rate < 0 or monthly_payment < 0 or initial_amount < 0 or current_balance < 0:
                    raise ValueError
            except (ValueError, TypeError, json.JSONDecodeError):
                self._send_json(400, {"error": "Invalid mortgage data."})
                return
            now = utc_now_iso()
            with sqlite3.connect(DB_PATH) as conn:
                if record_id is None:
                    conn.execute("INSERT INTO liability_mortgages (user_id, description, real_estate_id, interest_rate, monthly_payment, start_date, initial_amount, current_balance, end_date, interest_change_date, account_number, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", (user["id"], description, real_estate_id, interest_rate, monthly_payment, start_date, initial_amount, current_balance, end_date, interest_change_date, account_number_stored, now, now))
                else:
                    cursor = conn.execute("UPDATE liability_mortgages SET description = ?, real_estate_id = ?, interest_rate = ?, monthly_payment = ?, start_date = ?, initial_amount = ?, current_balance = ?, end_date = ?, interest_change_date = ?, account_number = ?, updated_at = ? WHERE id = ? AND user_id = ?", (description, real_estate_id, interest_rate, monthly_payment, start_date, initial_amount, current_balance, end_date, interest_change_date, account_number_stored, now, record_id, user["id"]))
                    if cursor.rowcount == 0:
                        self._send_json(404, {"error": "Mortgage not found."})
                        return
            self._send_json(200, {"success": True})
            return

        if parsed.path == "/api/liabilities/credit-cards":
            user = self._require_auth()
            if not user:
                return
            try:
                data = self._read_json()
                record_id_raw = data.get("id")
                record_id = None if record_id_raw in (None, "") else int(record_id_raw)
                description = str(data.get("description", "")).strip()
                interest_rate = float(data.get("interestRate", 0))
                special_interest_rate_raw = data.get("specialInterestRate")
                special_interest_rate = None if special_interest_rate_raw in (None, "") else float(special_interest_rate_raw)
                special_rate_end_date = str(data.get("specialRateEndDate", "")).strip() or None
                monthly_payment = float(data.get("monthlyPayment", 0))
                start_date = str(data.get("startDate", "")).strip() or None
                initial_amount = float(data.get("initialAmount", 0))
                current_balance = float(data.get("currentBalance", 0))
                end_date = str(data.get("endDate", "")).strip() or None
                credit_limit = float(data.get("creditLimit", 0))
                account_number_last4 = normalize_credit_card_last4(data.get("accountNumberLast4"))
                account_number_last4_stored = encrypt_field_value(account_number_last4)
                if not description or interest_rate < 0 or monthly_payment < 0 or initial_amount < 0 or current_balance < 0 or credit_limit < 0:
                    raise ValueError
            except (ValueError, TypeError, json.JSONDecodeError):
                self._send_json(400, {"error": "Invalid credit card data."})
                return
            now = utc_now_iso()
            with sqlite3.connect(DB_PATH) as conn:
                if record_id is None:
                    conn.execute("INSERT INTO liability_credit_cards (user_id, description, interest_rate, special_interest_rate, special_rate_end_date, monthly_payment, start_date, initial_amount, current_balance, end_date, credit_limit, account_number_last4, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", (user["id"], description, interest_rate, special_interest_rate, special_rate_end_date, monthly_payment, start_date, initial_amount, current_balance, end_date, credit_limit, account_number_last4_stored, now, now))
                else:
                    cursor = conn.execute("UPDATE liability_credit_cards SET description = ?, interest_rate = ?, special_interest_rate = ?, special_rate_end_date = ?, monthly_payment = ?, start_date = ?, initial_amount = ?, current_balance = ?, end_date = ?, credit_limit = ?, account_number_last4 = ?, updated_at = ? WHERE id = ? AND user_id = ?", (description, interest_rate, special_interest_rate, special_rate_end_date, monthly_payment, start_date, initial_amount, current_balance, end_date, credit_limit, account_number_last4_stored, now, record_id, user["id"]))
                    if cursor.rowcount == 0:
                        self._send_json(404, {"error": "Credit card not found."})
                        return
            self._send_json(200, {"success": True})
            return

        if parsed.path == "/api/liabilities/loans":
            user = self._require_auth()
            if not user:
                return
            try:
                data = self._read_json()
                record_id_raw = data.get("id")
                record_id = None if record_id_raw in (None, "") else int(record_id_raw)
                description = str(data.get("description", "")).strip()
                loan_type = str(data.get("loanType", "")).strip()
                is_private_raw = str(data.get("isPrivate", "no")).strip().lower()
                is_private = 1 if is_private_raw in ("1", "true", "yes") else 0
                vehicle_id_raw = data.get("vehicleId")
                vehicle_id = None if vehicle_id_raw in (None, "") else int(vehicle_id_raw)
                interest_rate = float(data.get("interestRate", 0))
                payment_amount = float(data.get("paymentAmount", data.get("monthlyPayment", 0)))
                start_date = str(data.get("startDate", "")).strip() or None
                initial_amount = float(data.get("initialAmount", 0))
                current_balance = float(data.get("currentBalance", 0))
                end_date = str(data.get("endDate", "")).strip() or None
                is_secured_raw = str(data.get("isSecured", "no")).strip().lower()
                is_secured = 1 if is_secured_raw in ("1", "true", "yes") else 0
                interest_only_raw = str(data.get("interestOnly", "no")).strip().lower()
                interest_only = 1 if interest_only_raw in ("1", "true", "yes") else 0
                payment_frequency = str(data.get("paymentFrequency", "monthly")).strip().lower()
                account_number = normalize_account_number(data.get("accountNumber"))
                account_number_stored = encrypt_field_value(account_number)
                if payment_frequency not in ("monthly", "quarterly", "annual"):
                    raise ValueError
                if not description or not loan_type or interest_rate < 0 or payment_amount < 0 or initial_amount < 0 or current_balance < 0:
                    raise ValueError
            except (ValueError, TypeError, json.JSONDecodeError):
                self._send_json(400, {"error": "Invalid loan data."})
                return
            now = utc_now_iso()
            with sqlite3.connect(DB_PATH) as conn:
                if record_id is None:
                    conn.execute("INSERT INTO liability_loans (user_id, description, loan_type, is_private, is_secured, interest_only, vehicle_id, interest_rate, monthly_payment, payment_amount, payment_frequency, start_date, initial_amount, current_balance, end_date, account_number, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", (user["id"], description, loan_type, is_private, is_secured, interest_only, vehicle_id, interest_rate, payment_amount, payment_amount, payment_frequency, start_date, initial_amount, current_balance, end_date, account_number_stored, now, now))
                else:
                    cursor = conn.execute("UPDATE liability_loans SET description = ?, loan_type = ?, is_private = ?, is_secured = ?, interest_only = ?, vehicle_id = ?, interest_rate = ?, monthly_payment = ?, payment_amount = ?, payment_frequency = ?, start_date = ?, initial_amount = ?, current_balance = ?, end_date = ?, account_number = ?, updated_at = ? WHERE id = ? AND user_id = ?", (description, loan_type, is_private, is_secured, interest_only, vehicle_id, interest_rate, payment_amount, payment_amount, payment_frequency, start_date, initial_amount, current_balance, end_date, account_number_stored, now, record_id, user["id"]))
                    if cursor.rowcount == 0:
                        self._send_json(404, {"error": "Loan not found."})
                        return
            self._send_json(200, {"success": True})
            return

        if parsed.path == "/api/admin/users":
            admin = self._require_admin()
            if not admin:
                return
            payload = []
            with sqlite3.connect(DB_PATH) as conn:
                conn.row_factory = sqlite3.Row
                rows = conn.execute("SELECT id, full_name, username, email, role, is_verified, created_at, updated_at FROM users ORDER BY username ASC").fetchall()
                for r in rows:
                    usage_bytes = self._estimate_user_storage_bytes(conn, r["id"])
                    payload.append({
                        "id": r["id"],
                        "fullName": r["full_name"],
                        "username": r["username"],
                        "email": r["email"],
                        "role": r["role"],
                        "isVerified": bool(r["is_verified"]),
                        "createdAt": r["created_at"],
                        "updatedAt": r["updated_at"],
                        "dbUsageBytes": usage_bytes,
                        "dbUsageHuman": _format_bytes(usage_bytes),
                    })
            self._send_json(200, payload)
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

        if parsed.path == "/api/admin/backup-settings":
            admin = self._require_admin()
            if not admin:
                return
            with sqlite3.connect(DB_PATH) as conn:
                settings = {
                    "enabled": get_setting(conn, "backup_schedule_enabled", "0") == "1",
                    "intervalHours": safe_int(get_setting(conn, "backup_schedule_interval_hours", "24"), 24),
                    "keepCount": safe_int(get_setting(conn, "backup_keep_count", "10"), 10),
                    "nextRunAt": get_setting(conn, "backup_next_run_at", ""),
                }
            self._send_json(200, settings)
            return

        if parsed.path == "/api/admin/notifications-broadcasts":
            admin = self._require_admin()
            if not admin:
                return
            with sqlite3.connect(DB_PATH) as conn:
                conn.row_factory = sqlite3.Row
                rows = conn.execute("SELECT b.id, b.title, b.message, b.created_at, u.username AS sender_username FROM notification_broadcasts b JOIN users u ON u.id = b.sender_user_id ORDER BY b.id DESC LIMIT 100").fetchall()
            self._send_json(200, [dict(r) for r in rows])
            return

        if parsed.path == "/api/admin/backups":
            admin = self._require_admin()
            if not admin:
                return
            BACKUP_DIR.mkdir(parents=True, exist_ok=True)
            files = sorted(BACKUP_DIR.glob(f"{backup_filename_prefix()}*.sqlite3"), reverse=True)
            payload = []
            for f in files:
                stat = f.stat()
                payload.append({"name": f.name, "size": stat.st_size, "sizeHuman": _format_bytes(stat.st_size), "createdAt": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat()})
            self._send_json(200, payload)
            return

        if parsed.path == "/api/admin/backups/download":
            admin = self._require_admin()
            if not admin:
                return
            params = parse_qs(parsed.query)
            file_name = params.get("name", [""])[0]
            if not re.fullmatch(r"finance-backup-\d{8}T\d{6}Z\.sqlite3", file_name):
                self._send_json(400, {"error": "Invalid backup file name."})
                return
            backup_file = BACKUP_DIR / file_name
            if not backup_file.exists() or not backup_file.is_file():
                self._send_json(404, {"error": "Backup not found."})
                return
            body = backup_file.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Disposition", f'attachment; filename="{file_name}"')
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if self._serve_templated_html(parsed.path):
            return
        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)

        with sqlite3.connect(DB_PATH) as conn:
            run_scheduled_backup_if_due(conn)

        if parsed.path == "/api/user-settings":
            user = self._require_auth()
            if not user:
                return
            try:
                data = self._read_json()
                giving_goal = float(data.get("givingGoalPercent", 10))
                if giving_goal < 0 or giving_goal > 100:
                    raise ValueError
            except (ValueError, TypeError, json.JSONDecodeError):
                self._send_json(400, {"error": "Invalid user settings."})
                return
            with sqlite3.connect(DB_PATH) as conn:
                set_user_setting(conn, user["id"], "giving_goal_percent", str(giving_goal))
            self._send_json(200, {"success": True, "givingGoalPercent": giving_goal})
            return

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
                user = conn.execute("SELECT id, full_name, username, email, phone, street_address, city, state, zip, role, is_verified, password_hash FROM users WHERE username = ?", (username,)).fetchone()
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
            self._send_json(200, {"success": True, "user": {"id": user["id"], "fullName": user["full_name"], "username": user["username"], "email": user["email"], "phone": user["phone"], "streetAddress": user["street_address"], "city": user["city"], "state": user["state"], "zip": user["zip"], "role": user["role"]}}, extra_headers={"Set-Cookie": self._session_cookie_header(token)})
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
                broker = str(data.get("broker", "")).strip()
                company_name = str(data.get("companyName", "")).strip() or None
                current_price_raw = data.get("currentPrice")
                current_price = None if current_price_raw in (None, "") else float(current_price_raw)
                manual_quote = 1 if bool(data.get("manualQuote", False)) else 0
                shares = float(data.get("shares", 0))
                purchase_price = float(data.get("purchasePrice", 0))
                purchase_date = str(data.get("purchaseDate", "")).strip()
                if not ticker or shares <= 0 or purchase_price < 0 or not purchase_date:
                    raise ValueError
                if current_price is not None and current_price < 0:
                    raise ValueError
            except (ValueError, TypeError, json.JSONDecodeError):
                self._send_json(400, {"error": "Invalid investment data."})
                return
            now = utc_now_iso()
            with sqlite3.connect(DB_PATH) as conn:
                if record_id is None:
                    conn.execute(
                        "INSERT INTO investments (user_id, ticker, broker, company_name, shares, purchase_price, current_price, manual_quote, purchase_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (user["id"], ticker, broker, company_name, shares, purchase_price, current_price, manual_quote, purchase_date, now, now),
                    )
                else:
                    cursor = conn.execute(
                        "UPDATE investments SET ticker = ?, broker = ?, company_name = ?, shares = ?, purchase_price = ?, current_price = ?, manual_quote = ?, purchase_date = ?, updated_at = ? WHERE id = ? AND user_id = ?",
                        (ticker, broker, company_name, shares, purchase_price, current_price, manual_quote, purchase_date, now, record_id, user["id"]),
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

        if parsed.path == "/api/retirement-accounts":
            user = self._require_auth()
            if not user:
                return
            try:
                data = self._read_json()
                record_id_raw = data.get("id")
                record_id = None if record_id_raw in (None, "") else int(record_id_raw)
                description = str(data.get("description", "")).strip()
                account_type = str(data.get("type", "")).strip()
                broker = str(data.get("broker", "")).strip()
                taxable_raw = str(data.get("taxable", "")).strip().lower()
                value = float(data.get("value", 0))
                if taxable_raw not in ("yes", "no"):
                    raise ValueError
                taxable = 1 if taxable_raw == "yes" else 0
                if not description or not account_type or not broker or value < 0:
                    raise ValueError
            except (ValueError, TypeError, json.JSONDecodeError):
                self._send_json(400, {"error": "Invalid retirement account data."})
                return
            now = utc_now_iso()
            with sqlite3.connect(DB_PATH) as conn:
                if record_id is None:
                    conn.execute(
                        "INSERT INTO retirement_accounts (user_id, description, account_type, broker, taxable, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                        (user["id"], description, account_type, broker, taxable, value, now, now),
                    )
                else:
                    cursor = conn.execute(
                        "UPDATE retirement_accounts SET description = ?, account_type = ?, broker = ?, taxable = ?, value = ?, updated_at = ? WHERE id = ? AND user_id = ?",
                        (description, account_type, broker, taxable, value, now, record_id, user["id"]),
                    )
                    if cursor.rowcount == 0:
                        self._send_json(404, {"error": "Retirement account record not found."})
                        return
            self._send_json(200, {"success": True})
            return

        if parsed.path == "/api/investments/refresh":
            user = self._require_auth()
            if not user:
                return
            refreshed_at = utc_now_iso()
            updated = 0
            failed = 0
            with sqlite3.connect(DB_PATH) as conn:
                conn.row_factory = sqlite3.Row
                rows = conn.execute("SELECT id, ticker, manual_quote FROM investments WHERE user_id = ?", (user["id"],)).fetchall()
                for row in rows:
                    try:
                        price, company_name = fetch_quote_details(row["ticker"])
                    except Exception:
                        if int(row["manual_quote"] or 0) == 1:
                            continue
                        failed += 1
                        continue
                    conn.execute(
                        "UPDATE investments SET company_name = ?, current_price = ?, manual_quote = 0, price_refreshed_at = ?, updated_at = ? WHERE id = ? AND user_id = ?",
                        (company_name, price, refreshed_at, refreshed_at, row["id"], user["id"]),
                    )
                    updated += 1
            self._send_json(200, {"success": True, "updated": updated, "failed": failed, "refreshedAt": refreshed_at})
            return

        if parsed.path == "/api/notifications/mark":
            user = self._require_auth()
            if not user:
                return
            try:
                data = self._read_json()
                notif_id = int(data.get("id"))
                status = str(data.get("status", "")).strip().lower()
                if status not in ("read", "unread"):
                    raise ValueError
            except (ValueError, TypeError, json.JSONDecodeError):
                self._send_json(400, {"error": "Invalid notification update."})
                return
            with sqlite3.connect(DB_PATH) as conn:
                conn.execute("UPDATE notifications SET status = ?, updated_at = ? WHERE id = ? AND user_id = ?", (status, utc_now_iso(), notif_id, user["id"]))
            self._send_json(200, {"success": True})
            return

        if parsed.path == "/api/profile":
            user = self._require_auth()
            if not user:
                return
            try:
                data = self._read_json()
                full_name = str(data.get("fullName", "")).strip()
                email_raw = str(data.get("email", "")).strip()
                email = email_raw if email_raw else None
                phone_raw = str(data.get("phone", "")).strip()
                phone = phone_raw if phone_raw else None
                street_address = str(data.get("streetAddress", "")).strip() or None
                city = str(data.get("city", "")).strip() or None
                state = str(data.get("state", "")).strip() or None
                zip_code = str(data.get("zip", "")).strip() or None
                current_password = str(data.get("currentPassword", ""))
                new_password = str(data.get("newPassword", ""))
                if not full_name:
                    raise ValueError("Full name is required.")
                if email is not None and "@" not in email:
                    raise ValueError("Email must be valid.")
                if new_password and len(new_password) < 10:
                    raise ValueError("New password must be at least 10 characters.")
            except (ValueError, TypeError, json.JSONDecodeError) as error:
                self._send_json(400, {"error": str(error)})
                return
            try:
                with sqlite3.connect(DB_PATH) as conn:
                    conn.row_factory = sqlite3.Row
                    if new_password:
                        row = conn.execute("SELECT password_hash FROM users WHERE id = ?", (user["id"],)).fetchone()
                        if not row or not verify_password(current_password, row["password_hash"]):
                            self._send_json(400, {"error": "Current password is incorrect."})
                            return
                        conn.execute("UPDATE users SET full_name = ?, email = ?, phone = ?, street_address = ?, city = ?, state = ?, zip = ?, password_hash = ?, updated_at = ? WHERE id = ?", (full_name, email, phone, street_address, city, state, zip_code, hash_password(new_password), utc_now_iso(), user["id"]))
                    else:
                        conn.execute("UPDATE users SET full_name = ?, email = ?, phone = ?, street_address = ?, city = ?, state = ?, zip = ?, updated_at = ? WHERE id = ?", (full_name, email, phone, street_address, city, state, zip_code, utc_now_iso(), user["id"]))
            except sqlite3.IntegrityError:
                self._send_json(409, {"error": "Email already in use."})
                return
            self._send_json(200, {"success": True})
            return

        if parsed.path == "/api/assets/vehicles":
            user = self._require_auth()
            if not user:
                return
            try:
                data = self._read_json()
                record_id_raw = data.get("id")
                record_id = None if record_id_raw in (None, "") else int(record_id_raw)
                description = str(data.get("description", "")).strip()
                make = str(data.get("make", "")).strip()
                model = str(data.get("model", "")).strip()
                model_year_raw = data.get("year")
                model_year = None if model_year_raw in (None, "") else int(model_year_raw)
                value = float(data.get("value", 0))
                if not description or not make or not model or value < 0:
                    raise ValueError
            except (ValueError, TypeError, json.JSONDecodeError):
                self._send_json(400, {"error": "Invalid vehicle data."})
                return
            now = utc_now_iso()
            with sqlite3.connect(DB_PATH) as conn:
                if record_id is None:
                    conn.execute("INSERT INTO asset_vehicles (user_id, description, make, model, model_year, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (user["id"], description, make, model, model_year, value, now, now))
                else:
                    cursor = conn.execute("UPDATE asset_vehicles SET description = ?, make = ?, model = ?, model_year = ?, value = ?, updated_at = ? WHERE id = ? AND user_id = ?", (description, make, model, model_year, value, now, record_id, user["id"]))
                    if cursor.rowcount == 0:
                        self._send_json(404, {"error": "Vehicle not found."})
                        return
            self._send_json(200, {"success": True})
            return

        if parsed.path == "/api/assets/guns":
            user = self._require_auth()
            if not user:
                return
            try:
                data = self._read_json()
                record_id_raw = data.get("id")
                record_id = None if record_id_raw in (None, "") else int(record_id_raw)
                description = str(data.get("description", "")).strip()
                gun_type = str(data.get("type", "")).strip()
                manufacturer = str(data.get("manufacturer", "")).strip()
                model = str(data.get("model", "")).strip()
                year_raw = data.get("yearAcquired")
                year_acquired = None if year_raw in (None, "") else int(year_raw)
                notes = str(data.get("notes", "")).strip() or None
                value = float(data.get("value", 0))
                allowed = {"Handgun", "Rifle", "Shotgun", "Air Rifle"}
                if not description or gun_type not in allowed or value < 0:
                    raise ValueError
            except (ValueError, TypeError, json.JSONDecodeError):
                self._send_json(400, {"error": "Invalid gun data."})
                return
            now = utc_now_iso()
            with sqlite3.connect(DB_PATH) as conn:
                if record_id is None:
                    conn.execute("INSERT INTO asset_guns (user_id, description, gun_type, manufacturer, model, year_acquired, notes, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", (user["id"], description, gun_type, manufacturer, model, year_acquired, notes, value, now, now))
                else:
                    cursor = conn.execute("UPDATE asset_guns SET description = ?, gun_type = ?, manufacturer = ?, model = ?, year_acquired = ?, notes = ?, value = ?, updated_at = ? WHERE id = ? AND user_id = ?", (description, gun_type, manufacturer, model, year_acquired, notes, value, now, record_id, user["id"]))
                    if cursor.rowcount == 0:
                        self._send_json(404, {"error": "Gun entry not found."})
                        return
            self._send_json(200, {"success": True})
            return

        if parsed.path == "/api/assets/bank-accounts":
            user = self._require_auth()
            if not user:
                return
            try:
                data = self._read_json()
                record_id_raw = data.get("id")
                record_id = None if record_id_raw in (None, "") else int(record_id_raw)
                description = str(data.get("description", "")).strip()
                institution = str(data.get("institution", "")).strip()
                account_type = str(data.get("type", "")).strip()
                balance = float(data.get("balance", 0))
                if not description or not institution or not account_type or balance < 0:
                    raise ValueError
            except (ValueError, TypeError, json.JSONDecodeError):
                self._send_json(400, {"error": "Invalid bank account data."})
                return
            now = utc_now_iso()
            with sqlite3.connect(DB_PATH) as conn:
                if record_id is None:
                    conn.execute("INSERT INTO asset_bank_accounts (user_id, description, institution, account_type, balance, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", (user["id"], description, institution, account_type, balance, now, now))
                else:
                    cursor = conn.execute("UPDATE asset_bank_accounts SET description = ?, institution = ?, account_type = ?, balance = ?, updated_at = ? WHERE id = ? AND user_id = ?", (description, institution, account_type, balance, now, record_id, user["id"]))
                    if cursor.rowcount == 0:
                        self._send_json(404, {"error": "Bank account not found."})
                        return
            self._send_json(200, {"success": True})
            return

        if parsed.path == "/api/assets/cash":
            user = self._require_auth()
            if not user:
                return
            try:
                data = self._read_json()
                record_id_raw = data.get("id")
                record_id = None if record_id_raw in (None, "") else int(record_id_raw)
                description = str(data.get("description", "")).strip()
                amount = float(data.get("amount", 0))
                if not description or amount < 0:
                    raise ValueError
            except (ValueError, TypeError, json.JSONDecodeError):
                self._send_json(400, {"error": "Invalid cash data."})
                return
            now = utc_now_iso()
            with sqlite3.connect(DB_PATH) as conn:
                if record_id is None:
                    conn.execute("INSERT INTO asset_cash (user_id, description, amount, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", (user["id"], description, amount, now, now))
                else:
                    cursor = conn.execute("UPDATE asset_cash SET description = ?, amount = ?, updated_at = ? WHERE id = ? AND user_id = ?", (description, amount, now, record_id, user["id"]))
                    if cursor.rowcount == 0:
                        self._send_json(404, {"error": "Cash entry not found."})
                        return
            self._send_json(200, {"success": True})
            return

        if parsed.path == "/api/liabilities/mortgages":
            user = self._require_auth()
            if not user:
                return
            try:
                data = self._read_json()
                record_id_raw = data.get("id")
                record_id = None if record_id_raw in (None, "") else int(record_id_raw)
                description = str(data.get("description", "")).strip()
                real_estate_id_raw = data.get("realEstateId")
                real_estate_id = None if real_estate_id_raw in (None, "") else int(real_estate_id_raw)
                interest_rate = float(data.get("interestRate", 0))
                monthly_payment = float(data.get("monthlyPayment", 0))
                start_date = str(data.get("startDate", "")).strip() or None
                initial_amount = float(data.get("initialAmount", 0))
                current_balance = float(data.get("currentBalance", 0))
                end_date = str(data.get("endDate", "")).strip() or None
                interest_change_date = str(data.get("interestChangeDate", "")).strip() or None
                account_number = normalize_account_number(data.get("accountNumber"))
                account_number_stored = encrypt_field_value(account_number)
                if not description or interest_rate < 0 or monthly_payment < 0 or initial_amount < 0 or current_balance < 0:
                    raise ValueError
            except (ValueError, TypeError, json.JSONDecodeError):
                self._send_json(400, {"error": "Invalid mortgage data."})
                return
            now = utc_now_iso()
            with sqlite3.connect(DB_PATH) as conn:
                if record_id is None:
                    conn.execute("INSERT INTO liability_mortgages (user_id, description, real_estate_id, interest_rate, monthly_payment, start_date, initial_amount, current_balance, end_date, interest_change_date, account_number, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", (user["id"], description, real_estate_id, interest_rate, monthly_payment, start_date, initial_amount, current_balance, end_date, interest_change_date, account_number_stored, now, now))
                else:
                    cursor = conn.execute("UPDATE liability_mortgages SET description = ?, real_estate_id = ?, interest_rate = ?, monthly_payment = ?, start_date = ?, initial_amount = ?, current_balance = ?, end_date = ?, interest_change_date = ?, account_number = ?, updated_at = ? WHERE id = ? AND user_id = ?", (description, real_estate_id, interest_rate, monthly_payment, start_date, initial_amount, current_balance, end_date, interest_change_date, account_number_stored, now, record_id, user["id"]))
                    if cursor.rowcount == 0:
                        self._send_json(404, {"error": "Mortgage not found."})
                        return
            self._send_json(200, {"success": True})
            return

        if parsed.path == "/api/liabilities/credit-cards":
            user = self._require_auth()
            if not user:
                return
            try:
                data = self._read_json()
                record_id_raw = data.get("id")
                record_id = None if record_id_raw in (None, "") else int(record_id_raw)
                description = str(data.get("description", "")).strip()
                interest_rate = float(data.get("interestRate", 0))
                special_interest_rate_raw = data.get("specialInterestRate")
                special_interest_rate = None if special_interest_rate_raw in (None, "") else float(special_interest_rate_raw)
                special_rate_end_date = str(data.get("specialRateEndDate", "")).strip() or None
                monthly_payment = float(data.get("monthlyPayment", 0))
                start_date = str(data.get("startDate", "")).strip() or None
                initial_amount = float(data.get("initialAmount", 0))
                current_balance = float(data.get("currentBalance", 0))
                end_date = str(data.get("endDate", "")).strip() or None
                credit_limit = float(data.get("creditLimit", 0))
                account_number_last4 = normalize_credit_card_last4(data.get("accountNumberLast4"))
                account_number_last4_stored = encrypt_field_value(account_number_last4)
                if not description or interest_rate < 0 or monthly_payment < 0 or initial_amount < 0 or current_balance < 0 or credit_limit < 0:
                    raise ValueError
            except (ValueError, TypeError, json.JSONDecodeError):
                self._send_json(400, {"error": "Invalid credit card data."})
                return
            now = utc_now_iso()
            with sqlite3.connect(DB_PATH) as conn:
                if record_id is None:
                    conn.execute("INSERT INTO liability_credit_cards (user_id, description, interest_rate, special_interest_rate, special_rate_end_date, monthly_payment, start_date, initial_amount, current_balance, end_date, credit_limit, account_number_last4, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", (user["id"], description, interest_rate, special_interest_rate, special_rate_end_date, monthly_payment, start_date, initial_amount, current_balance, end_date, credit_limit, account_number_last4_stored, now, now))
                else:
                    cursor = conn.execute("UPDATE liability_credit_cards SET description = ?, interest_rate = ?, special_interest_rate = ?, special_rate_end_date = ?, monthly_payment = ?, start_date = ?, initial_amount = ?, current_balance = ?, end_date = ?, credit_limit = ?, account_number_last4 = ?, updated_at = ? WHERE id = ? AND user_id = ?", (description, interest_rate, special_interest_rate, special_rate_end_date, monthly_payment, start_date, initial_amount, current_balance, end_date, credit_limit, account_number_last4_stored, now, record_id, user["id"]))
                    if cursor.rowcount == 0:
                        self._send_json(404, {"error": "Credit card not found."})
                        return
            self._send_json(200, {"success": True})
            return

        if parsed.path == "/api/liabilities/loans":
            user = self._require_auth()
            if not user:
                return
            try:
                data = self._read_json()
                record_id_raw = data.get("id")
                record_id = None if record_id_raw in (None, "") else int(record_id_raw)
                description = str(data.get("description", "")).strip()
                loan_type = str(data.get("loanType", "")).strip()
                is_private_raw = str(data.get("isPrivate", "no")).strip().lower()
                is_private = 1 if is_private_raw in ("1", "true", "yes") else 0
                vehicle_id_raw = data.get("vehicleId")
                vehicle_id = None if vehicle_id_raw in (None, "") else int(vehicle_id_raw)
                interest_rate = float(data.get("interestRate", 0))
                payment_amount = float(data.get("paymentAmount", data.get("monthlyPayment", 0)))
                start_date = str(data.get("startDate", "")).strip() or None
                initial_amount = float(data.get("initialAmount", 0))
                current_balance = float(data.get("currentBalance", 0))
                end_date = str(data.get("endDate", "")).strip() or None
                is_secured_raw = str(data.get("isSecured", "no")).strip().lower()
                is_secured = 1 if is_secured_raw in ("1", "true", "yes") else 0
                interest_only_raw = str(data.get("interestOnly", "no")).strip().lower()
                interest_only = 1 if interest_only_raw in ("1", "true", "yes") else 0
                payment_frequency = str(data.get("paymentFrequency", "monthly")).strip().lower()
                account_number = normalize_account_number(data.get("accountNumber"))
                account_number_stored = encrypt_field_value(account_number)
                if payment_frequency not in ("monthly", "quarterly", "annual"):
                    raise ValueError
                if not description or not loan_type or interest_rate < 0 or payment_amount < 0 or initial_amount < 0 or current_balance < 0:
                    raise ValueError
            except (ValueError, TypeError, json.JSONDecodeError):
                self._send_json(400, {"error": "Invalid loan data."})
                return
            now = utc_now_iso()
            with sqlite3.connect(DB_PATH) as conn:
                if record_id is None:
                    conn.execute("INSERT INTO liability_loans (user_id, description, loan_type, is_private, is_secured, interest_only, vehicle_id, interest_rate, monthly_payment, payment_amount, payment_frequency, start_date, initial_amount, current_balance, end_date, account_number, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", (user["id"], description, loan_type, is_private, is_secured, interest_only, vehicle_id, interest_rate, payment_amount, payment_amount, payment_frequency, start_date, initial_amount, current_balance, end_date, account_number_stored, now, now))
                else:
                    cursor = conn.execute("UPDATE liability_loans SET description = ?, loan_type = ?, is_private = ?, is_secured = ?, interest_only = ?, vehicle_id = ?, interest_rate = ?, monthly_payment = ?, payment_amount = ?, payment_frequency = ?, start_date = ?, initial_amount = ?, current_balance = ?, end_date = ?, account_number = ?, updated_at = ? WHERE id = ? AND user_id = ?", (description, loan_type, is_private, is_secured, interest_only, vehicle_id, interest_rate, payment_amount, payment_amount, payment_frequency, start_date, initial_amount, current_balance, end_date, account_number_stored, now, record_id, user["id"]))
                    if cursor.rowcount == 0:
                        self._send_json(404, {"error": "Loan not found."})
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

        if parsed.path == "/api/admin/backup-settings":
            admin = self._require_admin()
            if not admin:
                return
            try:
                data = self._read_json()
                enabled = bool(data.get("enabled", False))
                interval_hours = int(data.get("intervalHours", 24))
                keep_count = int(data.get("keepCount", 10))
                if interval_hours < 1 or keep_count < 1:
                    raise ValueError("Interval and keep count must be greater than 0.")
            except (ValueError, TypeError, json.JSONDecodeError) as error:
                self._send_json(400, {"error": str(error)})
                return

            with sqlite3.connect(DB_PATH) as conn:
                set_setting(conn, "backup_schedule_enabled", "1" if enabled else "0")
                set_setting(conn, "backup_schedule_interval_hours", str(interval_hours))
                set_setting(conn, "backup_keep_count", str(keep_count))
                if enabled:
                    set_setting(conn, "backup_next_run_at", compute_next_backup_run(utc_now(), interval_hours))
                else:
                    set_setting(conn, "backup_next_run_at", "")
            self._send_json(200, {"success": True})
            return

        if parsed.path == "/api/admin/notifications-broadcasts":
            admin = self._require_admin()
            if not admin:
                return
            try:
                data = self._read_json()
                title = str(data.get("title", "")).strip()
                message = str(data.get("message", "")).strip()
                if not title or not message:
                    raise ValueError("Title and message are required.")
            except (ValueError, TypeError, json.JSONDecodeError) as error:
                self._send_json(400, {"error": str(error)})
                return
            ts = utc_now_iso()
            with sqlite3.connect(DB_PATH) as conn:
                conn.row_factory = sqlite3.Row
                conn.execute("INSERT INTO notification_broadcasts (sender_user_id, title, message, created_at) VALUES (?, ?, ?, ?)", (admin["id"], title, message, ts))
                users = conn.execute("SELECT id FROM users").fetchall()
                for row in users:
                    conn.execute("INSERT INTO notifications (user_id, type, title, message, status, dedupe_key, created_at, updated_at) VALUES (?, 'system', ?, ?, 'unread', NULL, ?, ?)", (row["id"], title, message, ts, ts))
            self._send_json(200, {"success": True})
            return

        if parsed.path == "/api/admin/backups/run":
            admin = self._require_admin()
            if not admin:
                return
            with sqlite3.connect(DB_PATH) as conn:
                keep_count = safe_int(get_setting(conn, "backup_keep_count", "10"), 10)
                backup_file = create_backup_snapshot()
                enforce_backup_retention(keep_count)
            self._send_json(200, {"success": True, "name": backup_file.name})
            return

        self._send_json(404, {"error": "Not found"})

    def do_DELETE(self):
        parsed = urlparse(self.path)

        if parsed.path.startswith("/api/admin/backups/"):
            admin = self._require_admin()
            if not admin:
                return
            file_name = parsed.path.rsplit("/", 1)[-1]
            if not re.fullmatch(r"finance-backup-\d{8}T\d{6}Z\.sqlite3", file_name):
                self._send_json(400, {"error": "Invalid backup file name."})
                return
            backup_file = BACKUP_DIR / file_name
            if not backup_file.exists() or not backup_file.is_file():
                self._send_json(404, {"error": "Backup not found."})
                return
            backup_file.unlink(missing_ok=True)
            self._send_json(200, {"success": True})
            return

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

        if parsed.path.startswith("/api/notifications/"):
            user = self._require_auth()
            if not user:
                return
            try:
                notif_id = int(parsed.path.rsplit("/", 1)[-1])
            except ValueError:
                self._send_json(400, {"error": "Invalid notification id."})
                return
            with sqlite3.connect(DB_PATH) as conn:
                conn.execute("DELETE FROM notifications WHERE id = ? AND user_id = ?", (notif_id, user["id"]))
            self._send_json(200, {"success": True})
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

        if parsed.path.startswith("/api/retirement-accounts/"):
            try:
                item_id = int(parsed.path.rsplit("/", 1)[-1])
            except ValueError:
                self._send_json(400, {"error": "Invalid retirement account id."})
                return
            with sqlite3.connect(DB_PATH) as conn:
                conn.execute("DELETE FROM retirement_accounts WHERE id = ? AND user_id = ?", (item_id, user["id"]))
            self._send_json(200, {"success": True})
            return

        if parsed.path.startswith("/api/assets/vehicles/"):
            try:
                item_id = int(parsed.path.rsplit("/", 1)[-1])
            except ValueError:
                self._send_json(400, {"error": "Invalid vehicle id."})
                return
            with sqlite3.connect(DB_PATH) as conn:
                conn.execute("DELETE FROM asset_vehicles WHERE id = ? AND user_id = ?", (item_id, user["id"]))
            self._send_json(200, {"success": True})
            return

        if parsed.path.startswith("/api/assets/guns/"):
            try:
                item_id = int(parsed.path.rsplit("/", 1)[-1])
            except ValueError:
                self._send_json(400, {"error": "Invalid gun id."})
                return
            with sqlite3.connect(DB_PATH) as conn:
                conn.execute("DELETE FROM asset_guns WHERE id = ? AND user_id = ?", (item_id, user["id"]))
            self._send_json(200, {"success": True})
            return

        if parsed.path.startswith("/api/assets/bank-accounts/"):
            try:
                item_id = int(parsed.path.rsplit("/", 1)[-1])
            except ValueError:
                self._send_json(400, {"error": "Invalid bank account id."})
                return
            with sqlite3.connect(DB_PATH) as conn:
                conn.execute("DELETE FROM asset_bank_accounts WHERE id = ? AND user_id = ?", (item_id, user["id"]))
            self._send_json(200, {"success": True})
            return

        if parsed.path.startswith("/api/assets/cash/"):
            try:
                item_id = int(parsed.path.rsplit("/", 1)[-1])
            except ValueError:
                self._send_json(400, {"error": "Invalid cash id."})
                return
            with sqlite3.connect(DB_PATH) as conn:
                conn.execute("DELETE FROM asset_cash WHERE id = ? AND user_id = ?", (item_id, user["id"]))
            self._send_json(200, {"success": True})
            return

        if parsed.path.startswith("/api/liabilities/mortgages/"):
            try:
                item_id = int(parsed.path.rsplit("/", 1)[-1])
            except ValueError:
                self._send_json(400, {"error": "Invalid mortgage id."})
                return
            with sqlite3.connect(DB_PATH) as conn:
                conn.execute("DELETE FROM liability_mortgages WHERE id = ? AND user_id = ?", (item_id, user["id"]))
            self._send_json(200, {"success": True})
            return

        if parsed.path.startswith("/api/liabilities/credit-cards/"):
            try:
                item_id = int(parsed.path.rsplit("/", 1)[-1])
            except ValueError:
                self._send_json(400, {"error": "Invalid credit card id."})
                return
            with sqlite3.connect(DB_PATH) as conn:
                conn.execute("DELETE FROM liability_credit_cards WHERE id = ? AND user_id = ?", (item_id, user["id"]))
            self._send_json(200, {"success": True})
            return

        if parsed.path.startswith("/api/liabilities/loans/"):
            try:
                item_id = int(parsed.path.rsplit("/", 1)[-1])
            except ValueError:
                self._send_json(400, {"error": "Invalid loan id."})
                return
            with sqlite3.connect(DB_PATH) as conn:
                conn.execute("DELETE FROM liability_loans WHERE id = ? AND user_id = ?", (item_id, user["id"]))
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
