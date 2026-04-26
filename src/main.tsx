import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { BrowserRouter } from "react-router-dom";
import {
  Bell,
  ChevronRight,
  CircleDollarSign,
  FileText,
  Home,
  Landmark,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Pencil,
  Printer,
  Settings,
  Shield,
  Sun,
  Trash2,
  WalletCards,
  X,
} from "lucide-react";
import clsx from "clsx";
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
} from "chart.js";
import { Bar, Doughnut, Line } from "react-chartjs-2";
import "./styles.css";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Filler, Tooltip, Legend);

type AnyRow = Record<string, any>;
type User = {
  id: number;
  fullName: string;
  username: string;
  email?: string;
  phone?: string;
  streetAddress?: string;
  city?: string;
  state?: string;
  zip?: string;
  role: "user" | "admin";
  unreadNotifications?: number;
  givingGoalPercent?: number;
  darkMode?: boolean;
  themePreference?: "system" | "light" | "dark";
  notificationSettings?: {
    creditCardPromo?: boolean;
    vehicleInspection?: boolean;
    system?: boolean;
  };
};

const DEFAULT_GOAL_PERCENT = 10;

const money = (value: any) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(Number(value || 0));
const wholeMoney = (value: any) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(value || 0));
const compactMoney = (value: any) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(Number(value || 0));
const pct = (value: any) => `${Number(value || 0).toFixed(2)}%`;
const asArray = <T,>(value: unknown): T[] => Array.isArray(value) ? value : [];
type StatementItem = { description: string; value: number | null };
type StatementCategory = { title: string; items: StatementItem[] };
const statementTotal = (items: StatementItem[]) =>
  items.reduce((sum, item) => sum + (item.value == null || Number.isNaN(item.value) ? 0 : item.value), 0);
const summaryToChartRows = (summary: AnyRow) => [
  { label: "Stocks", total: Number(summary?.stocks || 0) },
  { label: "Precious metals", total: Number(summary?.preciousMetals || 0) },
  { label: "Real estate", total: Number(summary?.realEstateMyValue || 0) },
  { label: "Business", total: Number(summary?.businessVenturesMyValue || 0) },
  { label: "Retirement", total: Number(summary?.retirementAccounts || 0) },
].filter((row) => row.total > 0);
const todayMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

async function api<T = any>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: options.body ? { "Content-Type": "application/json", ...(options.headers || {}) } : options.headers,
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(payload.error || "Request failed.");
  return payload;
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Unable to read file."));
    reader.readAsDataURL(file);
  });
}

async function fileToBase64(file: File): Promise<string> {
  const dataUrl = await fileToDataUrl(file);
  return dataUrl.split(",")[1] || "";
}

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  refreshUser: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("AuthContext missing");
  return value;
}

function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    const payload = await api<{ authenticated: boolean; user?: User }>("/api/me");
    setUser(payload.authenticated ? payload.user || null : null);
    setLoading(false);
  }, []);

  useEffect(() => {
    refreshUser().catch(() => setLoading(false));
  }, [refreshUser]);

  useEffect(() => {
    const theme = user?.themePreference || (user?.darkMode ? "dark" : "system");
    const resolved = theme === "system" ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : theme;
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.resolvedTheme = resolved;
  }, [user]);

  const login = async (username: string, password: string) => {
    const payload = await api<{ user: User }>("/api/login", { method: "POST", body: JSON.stringify({ username, password }) });
    setUser(payload.user);
  };

  const logout = async () => {
    await api("/api/logout", { method: "POST", body: JSON.stringify({}) });
    setUser(null);
  };

  return <AuthContext.Provider value={{ user, loading, refreshUser, login, logout }}>{children}</AuthContext.Provider>;
}

type NavItem = {
  path: string;
  label: string;
  icon?: React.ComponentType<{ size?: number }>;
  adminOnly?: boolean;
  children?: NavItem[];
};

const navGroups: { label: string; items: NavItem[] }[] = [
  {
    label: "Core",
    items: [
      { path: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { path: "/records", label: "Records", icon: FileText },
      { path: "/goals", label: "Goals", icon: CircleDollarSign },
      { path: "/taxes", label: "Taxes", icon: FileText },
    ],
  },
  {
    label: "Portfolio",
    items: [
      {
        path: "/portfolio/investments",
        label: "Investments",
        icon: Landmark,
        children: [
          { path: "/portfolio/investments", label: "Stocks" },
          { path: "/portfolio/precious-metals", label: "Precious Metals" },
          { path: "/portfolio/real-estate", label: "Real Estate" },
          { path: "/portfolio/business-ventures", label: "Business Ventures" },
          { path: "/portfolio/retirement-accounts", label: "Retirement Accounts" },
        ],
      },
      {
        path: "/assets/bank-accounts",
        label: "Assets",
        icon: WalletCards,
        children: [
          { path: "/assets/bank-accounts", label: "Bank Accounts" },
          { path: "/assets/cash", label: "Cash" },
          { path: "/assets/vehicles", label: "Vehicles" },
          { path: "/assets/guns", label: "Guns" },
          { path: "/assets/equipment", label: "Equipment" },
        ],
      },
      {
        path: "/liabilities/mortgages",
        label: "Liabilities",
        icon: CircleDollarSign,
        children: [
          { path: "/liabilities/mortgages", label: "Mortgages" },
          { path: "/liabilities/credit-cards", label: "Credit Cards" },
          { path: "/liabilities/loans", label: "Loans" },
          { path: "/liabilities/recurring-expenses", label: "Recurring Expenses" },
        ],
      },
    ],
  },
  {
    label: "Reports",
    items: [
      {
        path: "/reports/net-worth",
        label: "Reports",
        icon: FileText,
        children: [
          { path: "/reports/net-worth", label: "Net Worth" },
          { path: "/reports/monthly-payments", label: "Monthly Payments" },
          { path: "/reports/liquid-cash", label: "Liquid Cash" },
          { path: "/reports/investment-calculator", label: "Investment Projection" },
          { path: "/reports/loan-amortization", label: "Loan Amortization" },
        ],
      },
      { path: "/notifications", label: "Notifications", icon: Bell },
    ],
  },
  {
    label: "Projects",
    items: [
      {
        path: "/sandy/goals",
        label: "Sandy Lake",
        icon: Home,
        children: [
          { path: "/sandy/goals", label: "Goals" },
          { path: "/sandy/deer-harvest", label: "Deer Harvest" },
          { path: "/sandy/food-plots", label: "Food Plots" },
          { path: "/sandy/expenses", label: "Expenses" },
        ],
      },
      { path: "/solar-electric", label: "Solar Electric", icon: Sun },
    ],
  },
  {
    label: "System",
    items: [
      { path: "/profile", label: "Profile", icon: Settings },
      {
        path: "/admin/users",
        label: "Admin",
        icon: Shield,
        adminOnly: true,
        children: [
          { path: "/admin/users", label: "Users" },
          { path: "/admin/email", label: "Email" },
          { path: "/admin/backups", label: "Backups" },
          { path: "/admin/updates", label: "Updates" },
          { path: "/admin/notifications", label: "Broadcasts" },
        ],
      },
    ],
  },
];

const meta: Record<string, { title: string; eyebrow: string; description: string }> = {
  "/dashboard": { title: "Command Center", eyebrow: "Overview", description: "Annual performance, balance-sheet mix, giving, and portfolio signals." },
  "/records": { title: "Annual Records", eyebrow: "History", description: "Review and edit yearly income, giving, and net worth." },
  "/portfolio/investments": { title: "Stocks", eyebrow: "Portfolio", description: "Manage equity positions, current quotes, and performance." },
  "/portfolio/precious-metals": { title: "Precious Metals", eyebrow: "Portfolio", description: "Track holdings, purchase basis, and current values." },
  "/portfolio/real-estate": { title: "Real Estate", eyebrow: "Portfolio", description: "Maintain properties, ownership share, and market values." },
  "/portfolio/business-ventures": { title: "Business Ventures", eyebrow: "Portfolio", description: "Track business interests and ownership-adjusted value." },
  "/portfolio/retirement-accounts": { title: "Retirement Accounts", eyebrow: "Portfolio", description: "Keep long-term balances current." },
  "/assets/bank-accounts": { title: "Bank Accounts", eyebrow: "Assets", description: "Liquid balances by institution and account type." },
  "/assets/cash": { title: "Cash", eyebrow: "Assets", description: "Cash positions and totals." },
  "/assets/vehicles": { title: "Vehicles", eyebrow: "Assets", description: "Vehicle value, dates, and inspection reminders." },
  "/assets/guns": { title: "Guns", eyebrow: "Assets", description: "Collection details and values." },
  "/assets/equipment": { title: "Equipment", eyebrow: "Assets", description: "Equipment records and replacement value." },
  "/liabilities/mortgages": { title: "Mortgages", eyebrow: "Liabilities", description: "Property-linked debt and payment details." },
  "/liabilities/credit-cards": { title: "Credit Cards", eyebrow: "Liabilities", description: "Balances, rates, limits, and promo windows." },
  "/liabilities/loans": { title: "Loans", eyebrow: "Liabilities", description: "Loan balances, payment structure, and linked collateral." },
  "/liabilities/recurring-expenses": { title: "Recurring Expenses", eyebrow: "Liabilities", description: "Repeating obligations by category and frequency." },
  "/goals": { title: "Goals", eyebrow: "Planning", description: "Savings and pay-down goals with live progress." },
  "/taxes": { title: "Taxes", eyebrow: "Planning", description: "Tax-year totals and document storage." },
  "/reports/net-worth": { title: "Net Worth Statement", eyebrow: "Reports", description: "Assets, investments, liabilities, and signature-ready totals." },
  "/reports/monthly-payments": { title: "Monthly Payments", eyebrow: "Reports", description: "Monthly and periodic obligations for a selected month." },
  "/reports/liquid-cash": { title: "Liquid Cash", eyebrow: "Reports", description: "Immediately available cash positions." },
  "/reports/investment-calculator": { title: "Investment Projection", eyebrow: "Reports", description: "Model future growth using current holdings." },
  "/reports/loan-amortization": { title: "Loan Amortization", eyebrow: "Reports", description: "Generate payment schedules." },
  "/profile": { title: "Profile & Preferences", eyebrow: "Account", description: "Identity, theme, giving goal, and notification settings." },
  "/notifications": { title: "Notifications", eyebrow: "Inbox", description: "Operational reminders and system notices." },
  "/admin/users": { title: "User Administration", eyebrow: "Admin", description: "Accounts, roles, verification, and storage use." },
  "/admin/email": { title: "Email Settings", eyebrow: "Admin", description: "SMTP delivery and verification settings." },
  "/admin/backups": { title: "Backups", eyebrow: "Admin", description: "Backup settings, snapshots, and downloads." },
  "/admin/updates": { title: "Updates", eyebrow: "Admin", description: "Release channel, update checks, and service restart." },
  "/admin/notifications": { title: "Broadcast Notifications", eyebrow: "Admin", description: "Send system-wide notices." },
  "/sandy/goals": { title: "Sandy Lake Goals", eyebrow: "Sandy Lake", description: "Retreat goals, progress, and target years." },
  "/sandy/deer-harvest": { title: "Deer Harvest", eyebrow: "Sandy Lake", description: "Harvest records, photos, and hunter totals." },
  "/sandy/food-plots": { title: "Food Plot History", eyebrow: "Sandy Lake", description: "Plot activity, notes, and images." },
  "/sandy/expenses": { title: "Sandy Lake Expenses", eyebrow: "Sandy Lake", description: "Retreat spending by year." },
  "/solar-electric": { title: "Solar Electric Usage", eyebrow: "Projects", description: "Production, usage, net kWh, and cost." },
};

function flattenNav(items = navGroups.flatMap((group) => group.items)): NavItem[] {
  return items.flatMap((item) => [item, ...(item.children || [])]);
}

function pageMeta(pathname: string) {
  return meta[pathname] || { title: "NetWorth OS", eyebrow: "Workspace", description: "Manage the household finance operating system." };
}

function isNavActive(item: NavItem, pathname: string) {
  return pathname === item.path || Boolean(item.children?.some((child) => pathname === child.path));
}

function AuthScreen({ reset = false }: { reset?: boolean }) {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "signup" | "verify" | "forgot" | "reset">(reset ? "reset" : "login");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<AnyRow>({});

  const set = (key: string, value: any) => setForm((current) => ({ ...current, [key]: value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      if (mode === "login") {
        await login(String(form.username || ""), String(form.password || ""));
        navigate("/dashboard", { replace: true });
      } else if (mode === "signup") {
        await api("/api/signup", {
          method: "POST",
          body: JSON.stringify({ fullName: form.fullName, email: form.email, username: form.username, password: form.password }),
        });
        setMessage("Account created. Check your email for the verification code.");
        setMode("verify");
      } else if (mode === "verify") {
        await api("/api/verify-account", { method: "POST", body: JSON.stringify({ username: form.username, code: form.code }) });
        setMessage("Account verified. You can now log in.");
        setMode("login");
      } else if (mode === "forgot") {
        const payload = await api<{ message: string }>("/api/forgot-password", { method: "POST", body: JSON.stringify({ identifier: form.identifier }) });
        setMessage(payload.message || "If an account exists, reset email sent.");
      } else {
        const token = new URLSearchParams(window.location.search).get("token") || "";
        await api("/api/reset-password", { method: "POST", body: JSON.stringify({ token, password: form.password }) });
        setMessage("Password updated. Sign in with your new password.");
        setMode("login");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-brand">
        <div className="brand-mark">NW</div>
        <p className="eyebrow">Private finance workspace</p>
        <h1>NetWorth OS</h1>
        <p>Annual records, portfolio workspaces, lender-ready reports, and project ledgers in one fast command center.</p>
      </section>
      <section className="auth-panel">
        <p className="eyebrow">{mode === "reset" ? "Reset access" : "Secure access"}</p>
        <h2>{mode === "login" ? "Welcome back" : mode === "signup" ? "Create account" : mode === "verify" ? "Verify account" : mode === "forgot" ? "Reset link" : "Choose a new password"}</h2>
        <form onSubmit={submit} className="stack">
          {mode === "signup" && <Field label="Full name" value={form.fullName || ""} onChange={(v) => set("fullName", v)} required />}
          {(mode === "signup" || mode === "forgot") && <Field label={mode === "forgot" ? "Email or username" : "Email"} type={mode === "signup" ? "email" : "text"} value={mode === "forgot" ? form.identifier || "" : form.email || ""} onChange={(v) => set(mode === "forgot" ? "identifier" : "email", v)} required />}
          {(mode === "login" || mode === "signup" || mode === "verify") && <Field label="Username" value={form.username || ""} onChange={(v) => set("username", v)} required />}
          {mode === "verify" && <Field label="Verification code" value={form.code || ""} onChange={(v) => set("code", v)} required />}
          {(mode === "login" || mode === "signup" || mode === "reset") && <Field label={mode === "reset" ? "New password" : "Password"} type="password" value={form.password || ""} onChange={(v) => set("password", v)} required />}
          <button className="primary-btn" disabled={busy}>{busy ? "Working..." : mode === "login" ? "Log in" : mode === "signup" ? "Create account" : mode === "verify" ? "Verify account" : mode === "forgot" ? "Send reset link" : "Update password"}</button>
        </form>
        <div className="auth-links">
          <button type="button" onClick={() => setMode("signup")}>Create account</button>
          <button type="button" onClick={() => setMode("verify")}>Verify</button>
          <button type="button" onClick={() => setMode("forgot")}>Forgot password</button>
          <button type="button" onClick={() => setMode("login")}>Back to login</button>
        </div>
        {message && <p className="form-message">{message}</p>}
      </section>
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  required,
  options,
  min,
  max,
  step,
}: {
  label: string;
  value: any;
  onChange: (value: any) => void;
  type?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
  min?: number | string;
  max?: number | string;
  step?: number | string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {options ? (
        <select value={value ?? ""} onChange={(event) => onChange(event.target.value)} required={required}>
          {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      ) : type === "textarea" ? (
        <textarea value={value ?? ""} onChange={(event) => onChange(event.target.value)} required={required} />
      ) : type === "file" ? (
        <input type="file" onChange={(event) => onChange(event.target.files?.[0] || null)} required={required} />
      ) : type === "checkbox" ? (
        <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} required={required} />
      ) : (
        <input type={type} min={min} max={max} step={step} value={value ?? ""} onChange={(event) => onChange(type === "checkbox" ? event.target.checked : event.target.value)} required={required} />
      )}
    </label>
  );
}

function RequireAuth({ children, admin = false }: { children: React.ReactNode; admin?: boolean }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="loading-screen">Loading NetWorth OS...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (admin && user.role !== "admin") return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function AppShell() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const current = pageMeta(location.pathname);
  const childNav = useMemo(() => flattenNav().find((item) => isNavActive(item, location.pathname) && item.children)?.children || [], [location.pathname]);

  useEffect(() => setOpen(false), [location.pathname]);

  return (
    <div className="app-shell">
      <aside className={clsx("sidebar", open && "open")}>
        <div className="sidebar-brand">
          <div className="brand-mark">NW</div>
          <div>
            <strong>NetWorth OS</strong>
            <span>Finance command center</span>
          </div>
        </div>
        <nav className="nav-groups">
          {navGroups.map((group) => (
            <section key={group.label}>
              <p>{group.label}</p>
              {group.items.filter((item) => !item.adminOnly || user?.role === "admin").map((item) => {
                const Icon = item.icon || ChevronRight;
                return (
                  <NavLink key={item.path} to={item.path} className={() => clsx("nav-link", isNavActive(item, location.pathname) && "active")}>
                    <Icon size={17} />
                    <span>{item.label}</span>
                  </NavLink>
                );
              })}
            </section>
          ))}
        </nav>
      </aside>
      <button className={clsx("nav-backdrop", open && "show")} type="button" aria-label="Close navigation" onClick={() => setOpen(false)} />
      <div className="main-shell">
        <header className="topbar">
          <button className="icon-btn menu-btn" type="button" onClick={() => setOpen(true)}><Menu size={20} /></button>
          <div className="topbar-title">
            <span>{current.eyebrow}</span>
            <strong>{current.title}</strong>
          </div>
          <button className="icon-btn" title="Notifications" type="button" onClick={() => navigate("/notifications")}>
            <Bell size={18} />
            {Number(user?.unreadNotifications || 0) > 0 && <span className="badge">{user?.unreadNotifications}</span>}
          </button>
          <button className="session-pill" type="button" onClick={() => navigate("/profile")}>{user?.fullName || user?.username}</button>
          <button className="icon-btn" type="button" title="Logout" onClick={logout}><LogOut size={18} /></button>
        </header>
        {childNav.length > 0 && (
          <nav className="context-nav">
            {childNav.map((item) => <NavLink key={item.path} to={item.path}>{item.label}</NavLink>)}
          </nav>
        )}
        <main className="page">
          <section className="page-heading">
            <div>
              <p className="eyebrow">{current.eyebrow}</p>
              <h1>{current.title}</h1>
              <p>{current.description}</p>
            </div>
          </section>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/records" element={<RecordsPage />} />
            <Route path="/portfolio/investments" element={<InvestmentsPage />} />
            <Route path="/portfolio/precious-metals" element={<CrudPage config={crudConfigs.preciousMetals} />} />
            <Route path="/portfolio/real-estate" element={<CrudPage config={crudConfigs.realEstate} />} />
            <Route path="/portfolio/business-ventures" element={<CrudPage config={crudConfigs.businessVentures} />} />
            <Route path="/portfolio/retirement-accounts" element={<CrudPage config={crudConfigs.retirementAccounts} />} />
            <Route path="/assets/bank-accounts" element={<CrudPage config={crudConfigs.bankAccounts} />} />
            <Route path="/assets/cash" element={<CrudPage config={crudConfigs.cash} />} />
            <Route path="/assets/vehicles" element={<CrudPage config={crudConfigs.vehicles} />} />
            <Route path="/assets/guns" element={<CrudPage config={crudConfigs.guns} />} />
            <Route path="/assets/equipment" element={<CrudPage config={crudConfigs.equipment} />} />
            <Route path="/liabilities/mortgages" element={<CrudPage config={crudConfigs.mortgages} />} />
            <Route path="/liabilities/credit-cards" element={<CrudPage config={crudConfigs.creditCards} />} />
            <Route path="/liabilities/loans" element={<CrudPage config={crudConfigs.loans} />} />
            <Route path="/liabilities/recurring-expenses" element={<RecurringExpensesPage />} />
            <Route path="/goals" element={<GoalsPage />} />
            <Route path="/taxes" element={<TaxesPage />} />
            <Route path="/reports/net-worth" element={<NetWorthReport />} />
            <Route path="/reports/monthly-payments" element={<MonthlyPaymentsReport />} />
            <Route path="/reports/liquid-cash" element={<LiquidCashReport />} />
            <Route path="/reports/investment-calculator" element={<InvestmentCalculator />} />
            <Route path="/reports/loan-amortization" element={<LoanAmortization />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/admin/users" element={<RequireAuth admin><AdminUsers /></RequireAuth>} />
            <Route path="/admin/email" element={<RequireAuth admin><AdminSettings kind="email" /></RequireAuth>} />
            <Route path="/admin/backups" element={<RequireAuth admin><AdminBackups /></RequireAuth>} />
            <Route path="/admin/updates" element={<RequireAuth admin><AdminUpdates /></RequireAuth>} />
            <Route path="/admin/notifications" element={<RequireAuth admin><AdminBroadcasts /></RequireAuth>} />
            <Route path="/sandy/goals" element={<CrudPage config={crudConfigs.sandyGoals} />} />
            <Route path="/sandy/deer-harvest" element={<SandyDeerHarvest />} />
            <Route path="/sandy/food-plots" element={<SandyFoodPlots />} />
            <Route path="/sandy/expenses" element={<SandyExpenses />} />
            <Route path="/solar-electric" element={<CrudPage config={crudConfigs.solar} />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

function EmptyState({ text = "No records yet." }: { text?: string }) {
  return <div className="empty-state">{text}</div>;
}

function Actions({ onEdit, onDelete }: { onEdit?: () => void; onDelete?: () => void }) {
  return (
    <div className="row-actions">
      {onEdit && <button className="icon-action" type="button" aria-label="Edit" onClick={onEdit}><Pencil size={15} /></button>}
      {onDelete && <button className="icon-action danger" type="button" aria-label="Delete" onClick={onDelete}><Trash2 size={15} /></button>}
    </div>
  );
}

function DataTable({ rows, columns, actions, empty }: { rows: AnyRow[]; columns: { key: string; label: string; render?: (row: AnyRow) => React.ReactNode }[]; actions?: (row: AnyRow) => React.ReactNode; empty?: string }) {
  if (!rows.length) return <EmptyState text={empty} />;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr>{columns.map((col) => <th key={col.key}>{col.label}</th>)}{actions && <th>Actions</th>}</tr></thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.id ?? index}>
              {columns.map((col) => <td key={col.key} data-label={col.label}>{col.render ? col.render(row) : String(row[col.key] ?? "—")}</td>)}
              {actions && <td data-label="Actions">{actions(row)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type FieldConfig = {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
  min?: number | string;
  max?: number | string;
  step?: number | string;
  from?: string;
  to?: string;
  defaultValue?: any;
};

type CrudConfig = {
  title: string;
  endpoint: string;
  fields: FieldConfig[];
  columns: { key: string; label: string; render?: (row: AnyRow) => React.ReactNode }[];
  empty?: string;
  saveText?: string;
  total?: { label: string; value: (row: AnyRow) => number };
  beforeLoad?: () => Promise<Record<string, { value: string; label: string }[]>>;
  transformPayload?: (form: AnyRow, id: number | null) => AnyRow | Promise<AnyRow>;
};

function initialForm(fields: FieldConfig[]) {
  return fields.reduce((acc, field) => ({ ...acc, [field.name]: field.defaultValue ?? (field.options?.[0]?.value ?? "") }), {});
}

function CrudPage({ config }: { config: CrudConfig }) {
  const [rows, setRows] = useState<AnyRow[]>([]);
  const [form, setForm] = useState<AnyRow>(() => initialForm(config.fields));
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [dynamicOptions, setDynamicOptions] = useState<Record<string, { value: string; label: string }[]>>({});

  const load = useCallback(async () => {
    if (config.beforeLoad) setDynamicOptions(await config.beforeLoad());
    setRows(await api(config.endpoint));
  }, [config]);

  useEffect(() => { load().catch((error) => setMessage(error.message)); }, [load]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const payload = config.transformPayload
        ? await config.transformPayload(form, editingId)
        : { id: editingId, ...Object.fromEntries(config.fields.map((field) => [field.to || field.name, castValue(form[field.name], field.type)])) };
      await api(config.endpoint, { method: "POST", body: JSON.stringify(payload) });
      setForm(initialForm(config.fields));
      setEditingId(null);
      setShowForm(false);
      await load();
      setMessage(config.saveText || "Saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: AnyRow) {
    if (!window.confirm(`Delete ${config.title.toLowerCase()} record?`)) return;
    await api(`${config.endpoint}/${row.id}`, { method: "DELETE" });
    await load();
  }

  function edit(row: AnyRow) {
    setEditingId(Number(row.id));
    setForm(Object.fromEntries(config.fields.map((field) => [field.name, row[field.from || field.name] ?? field.defaultValue ?? ""])));
    setShowForm(true);
  }

  const total = config.total ? rows.reduce((sum, row) => sum + config.total!.value(row), 0) : null;

  return (
    <div className={clsx("workspace-grid", !showForm && "form-collapsed")}>
      {showForm && <section className="panel form-panel reveal-panel">
        <div className="panel-heading">
          <h2>{editingId ? `Update ${config.title}` : `Add ${config.title}`}</h2>
          <button className="ghost-btn" type="button" onClick={() => { setEditingId(null); setForm(initialForm(config.fields)); setShowForm(false); }}>Close</button>
        </div>
        <form className="form-grid" onSubmit={save}>
          {config.fields.map((field) => (
            <Field
              key={field.name}
              label={field.label}
              type={field.type || "text"}
              required={field.required}
              min={field.min}
              max={field.max}
              step={field.step}
              options={field.options || dynamicOptions[field.name]}
              value={form[field.name] ?? ""}
              onChange={(value) => setForm((current) => ({ ...current, [field.name]: value }))}
            />
          ))}
          <button className="primary-btn" disabled={busy}>{busy ? "Saving..." : editingId ? "Update" : "Save"}</button>
        </form>
        {message && <p className="form-message">{message}</p>}
      </section>}
      <section className="panel table-panel">
        <div className="panel-heading">
          <h2>{config.title}</h2>
          <div className="panel-actions">
            {config.total && <span className="total-pill">{config.total.label}: {money(total)}</span>}
            <button className="primary-btn compact" type="button" onClick={() => { setEditingId(null); setForm(initialForm(config.fields)); setShowForm((value) => !value); }}>
              {showForm ? "Hide form" : `Add ${config.title}`}
            </button>
          </div>
        </div>
        <DataTable rows={rows} columns={config.columns} empty={config.empty} actions={(row) => <Actions onEdit={() => edit(row)} onDelete={() => remove(row)} />} />
      </section>
    </div>
  );
}

function castValue(value: any, type?: string) {
  if (type === "number") return Number(value || 0);
  if (type === "checkbox") return Boolean(value);
  return value ?? "";
}

const yesNo = [{ value: "no", label: "No" }, { value: "yes", label: "Yes" }];
const freqOptions = ["monthly", "quarterly", "semiannual", "annual"].map((x) => ({ value: x, label: x[0].toUpperCase() + x.slice(1) }));

const crudConfigs: Record<string, CrudConfig> = {
  preciousMetals: {
    title: "Precious Metal",
    endpoint: "/api/precious-metals",
    fields: [
      { name: "type", from: "metal_type", label: "Metal type", required: true },
      { name: "description", label: "Description", required: true },
      { name: "quantity", label: "Quantity", type: "number", step: "0.01", required: true },
      { name: "weight", label: "Weight", type: "number", step: "0.01", required: true },
      { name: "datePurchased", from: "purchase_date", label: "Purchase date", type: "date", required: true },
      { name: "wherePurchased", from: "where_purchased", label: "Where purchased", required: true },
      { name: "purchasePrice", from: "purchase_price", label: "Purchase price", type: "number", step: "0.01", required: true },
      { name: "currentValue", from: "current_value", label: "Current value", type: "number", step: "0.01", required: true },
    ],
    columns: [
      { key: "metal_type", label: "Type" },
      { key: "description", label: "Description" },
      { key: "quantity", label: "Qty" },
      { key: "weight", label: "Weight" },
      { key: "purchase_price", label: "Basis", render: (r) => money(r.purchase_price) },
      { key: "current_value", label: "Value", render: (r) => money(r.current_value) },
    ],
    total: { label: "Current value", value: (r) => Number(r.current_value || 0) },
  },
  realEstate: {
    title: "Real Estate",
    endpoint: "/api/real-estate",
    fields: [
      { name: "description", label: "Description" },
      { name: "address", label: "Address", required: true },
      { name: "percentageOwned", from: "percentage_owned", label: "Owned %", type: "number", step: "0.01", required: true },
      { name: "purchasePrice", from: "purchase_price", label: "Purchase price", type: "number", step: "0.01", required: true },
      { name: "currentValue", from: "current_value", label: "Current value", type: "number", step: "0.01", required: true },
    ],
    columns: [
      { key: "description", label: "Description" },
      { key: "address", label: "Address" },
      { key: "percentage_owned", label: "Owned", render: (r) => `${r.percentage_owned}%` },
      { key: "current_value", label: "Current value", render: (r) => money(r.current_value) },
      { key: "my_value", label: "My value", render: (r) => money(Number(r.current_value || 0) * Number(r.percentage_owned || 0) / 100) },
    ],
    total: { label: "Owned value", value: (r) => Number(r.current_value || 0) * Number(r.percentage_owned || 0) / 100 },
  },
  businessVentures: {
    title: "Business Venture",
    endpoint: "/api/business-ventures",
    fields: [
      { name: "businessName", from: "business_name", label: "Business name", required: true },
      { name: "percentageOwned", from: "percentage_owned", label: "Owned %", type: "number", step: "0.01", required: true },
      { name: "businessValue", from: "business_value", label: "Business value", type: "number", step: "0.01", required: true },
    ],
    columns: [
      { key: "business_name", label: "Business" },
      { key: "percentage_owned", label: "Owned", render: (r) => `${r.percentage_owned}%` },
      { key: "business_value", label: "Value", render: (r) => money(r.business_value) },
      { key: "my_value", label: "My value", render: (r) => money(Number(r.business_value || 0) * Number(r.percentage_owned || 0) / 100) },
    ],
    total: { label: "Owned value", value: (r) => Number(r.business_value || 0) * Number(r.percentage_owned || 0) / 100 },
  },
  retirementAccounts: {
    title: "Retirement Account",
    endpoint: "/api/retirement-accounts",
    fields: [
      { name: "description", label: "Description", required: true },
      { name: "type", from: "account_type", label: "Account type", required: true },
      { name: "broker", label: "Broker", required: true },
      { name: "taxable", label: "Taxable", options: yesNo, defaultValue: "no" },
      { name: "value", label: "Value", type: "number", step: "0.01", required: true },
    ],
    columns: [
      { key: "description", label: "Description" },
      { key: "account_type", label: "Type" },
      { key: "broker", label: "Broker" },
      { key: "taxable", label: "Taxable", render: (r) => Number(r.taxable) === 1 ? "Yes" : "No" },
      { key: "value", label: "Value", render: (r) => money(r.value) },
    ],
    total: { label: "Value", value: (r) => Number(r.value || 0) },
  },
  bankAccounts: {
    title: "Bank Account",
    endpoint: "/api/assets/bank-accounts",
    fields: [
      { name: "description", label: "Description", required: true },
      { name: "institution", label: "Institution", required: true },
      { name: "type", from: "account_type", label: "Type", options: ["Checking", "Savings", "Money Market Account"].map((x) => ({ value: x, label: x })), required: true },
      { name: "balance", label: "Balance", type: "number", step: "0.01", required: true },
    ],
    columns: [
      { key: "description", label: "Description" },
      { key: "institution", label: "Institution" },
      { key: "account_type", label: "Type" },
      { key: "balance", label: "Balance", render: (r) => money(r.balance) },
    ],
    total: { label: "Balance", value: (r) => Number(r.balance || 0) },
  },
  cash: {
    title: "Cash Entry",
    endpoint: "/api/assets/cash",
    fields: [
      { name: "description", label: "Description", required: true },
      { name: "amount", label: "Amount", type: "number", step: "0.01", required: true },
    ],
    columns: [{ key: "description", label: "Description" }, { key: "amount", label: "Amount", render: (r) => money(r.amount) }],
    total: { label: "Cash", value: (r) => Number(r.amount || 0) },
  },
  vehicles: {
    title: "Vehicle",
    endpoint: "/api/assets/vehicles",
    fields: [
      { name: "description", label: "Description", required: true },
      { name: "year", from: "model_year", label: "Model year", type: "number" },
      { name: "make", label: "Make", required: true },
      { name: "model", label: "Model", required: true },
      { name: "vin", label: "VIN number" },
      { name: "datePurchased", from: "date_purchased", label: "Date purchased", type: "date" },
      { name: "inspectionExpiresOn", from: "inspection_expires_on", label: "Inspection expires", type: "date" },
      { name: "value", label: "Value", type: "number", step: "0.01", required: true },
    ],
    columns: [
      { key: "description", label: "Description" },
      { key: "model_year", label: "Year" },
      { key: "make", label: "Make" },
      { key: "model", label: "Model" },
      { key: "vin", label: "VIN" },
      { key: "inspection_expires_on", label: "Inspection" },
      { key: "value", label: "Value", render: (r) => money(r.value) },
    ],
    total: { label: "Value", value: (r) => Number(r.value || 0) },
  },
  equipment: {
    title: "Equipment",
    endpoint: "/api/assets/equipment",
    fields: [
      { name: "description", label: "Description", required: true },
      { name: "year", from: "model_year", label: "Model year", type: "number" },
      { name: "type", from: "equipment_type", label: "Type", required: true },
      { name: "make", label: "Make", required: true },
      { name: "model", label: "Model", required: true },
      { name: "yearPurchased", from: "year_purchased", label: "Year purchased", type: "number" },
      { name: "value", label: "Value", type: "number", step: "0.01", required: true },
    ],
    columns: [
      { key: "description", label: "Description" },
      { key: "equipment_type", label: "Type" },
      { key: "make", label: "Make" },
      { key: "model", label: "Model" },
      { key: "value", label: "Value", render: (r) => money(r.value) },
    ],
    total: { label: "Value", value: (r) => Number(r.value || 0) },
  },
  guns: {
    title: "Gun",
    endpoint: "/api/assets/guns",
    fields: [
      { name: "description", label: "Description", required: true },
      { name: "type", from: "gun_type", label: "Type", required: true },
      { name: "manufacturer", label: "Manufacturer" },
      { name: "model", label: "Model" },
      { name: "yearAcquired", from: "year_acquired", label: "Year acquired", type: "number" },
      { name: "notes", label: "Notes", type: "textarea" },
      { name: "value", label: "Value", type: "number", step: "0.01", required: true },
    ],
    columns: [
      { key: "description", label: "Description" },
      { key: "gun_type", label: "Type" },
      { key: "manufacturer", label: "Manufacturer" },
      { key: "model", label: "Model" },
      { key: "value", label: "Value", render: (r) => money(r.value) },
    ],
    total: { label: "Value", value: (r) => Number(r.value || 0) },
  },
  mortgages: {
    title: "Mortgage",
    endpoint: "/api/liabilities/mortgages",
    beforeLoad: async () => ({ realEstateId: (await api<any[]>("/api/real-estate")).map((r) => ({ value: String(r.id), label: `${r.description || r.address}` })) }),
    fields: [
      { name: "description", label: "Description", required: true },
      { name: "realEstateId", from: "real_estate_id", label: "Property" },
      { name: "accountNumber", from: "account_number", label: "Account number" },
      { name: "interestRate", from: "interest_rate", label: "Interest rate %", type: "number", step: "0.01", required: true },
      { name: "monthlyPayment", from: "monthly_payment", label: "Monthly payment", type: "number", step: "0.01" },
      { name: "startDate", from: "start_date", label: "Start date", type: "date" },
      { name: "initialAmount", from: "initial_amount", label: "Initial amount", type: "number", step: "0.01", required: true },
      { name: "currentBalance", from: "current_balance", label: "Current balance", type: "number", step: "0.01", required: true },
      { name: "interestChangeDate", from: "interest_change_date", label: "Interest change", type: "date" },
      { name: "endDate", from: "end_date", label: "End date", type: "date" },
    ],
    columns: [
      { key: "description", label: "Description" },
      { key: "real_estate_address", label: "Property" },
      { key: "interest_rate", label: "Rate", render: (r) => pct(r.interest_rate) },
      { key: "monthly_payment", label: "Payment", render: (r) => money(r.monthly_payment) },
      { key: "current_balance", label: "Balance", render: (r) => money(r.current_balance) },
    ],
    total: { label: "Balance", value: (r) => Number(r.current_balance || 0) },
  },
  creditCards: {
    title: "Credit Card",
    endpoint: "/api/liabilities/credit-cards",
    fields: [
      { name: "description", label: "Description", required: true },
      { name: "accountNumberLast4", from: "account_number_last4", label: "Last 4", required: true },
      { name: "interestRate", from: "interest_rate", label: "Interest rate %", type: "number", step: "0.01", required: true },
      { name: "specialInterestRate", from: "special_interest_rate", label: "Special rate %", type: "number", step: "0.01" },
      { name: "specialRateEndDate", from: "special_rate_end_date", label: "Special end", type: "date" },
      { name: "monthlyPayment", from: "monthly_payment", label: "Monthly payment", type: "number", step: "0.01" },
      { name: "startDate", from: "start_date", label: "Start date", type: "date" },
      { name: "initialAmount", from: "initial_amount", label: "Initial amount", type: "number", step: "0.01", required: true },
      { name: "currentBalance", from: "current_balance", label: "Current balance", type: "number", step: "0.01", required: true },
      { name: "creditLimit", from: "credit_limit", label: "Credit limit", type: "number", step: "0.01", required: true },
      { name: "endDate", from: "end_date", label: "End date", type: "date" },
    ],
    columns: [
      { key: "description", label: "Description" },
      { key: "account_number_last4", label: "Card", render: (r) => r.account_number_last4 ? `.... ${r.account_number_last4}` : "—" },
      { key: "interest_rate", label: "Rate", render: (r) => pct(r.interest_rate) },
      { key: "monthly_payment", label: "Payment", render: (r) => money(r.monthly_payment) },
      { key: "current_balance", label: "Balance", render: (r) => money(r.current_balance) },
      { key: "credit_limit", label: "Limit", render: (r) => money(r.credit_limit) },
    ],
    total: { label: "Balance", value: (r) => Number(r.current_balance || 0) },
  },
  loans: {
    title: "Loan",
    endpoint: "/api/liabilities/loans",
    beforeLoad: async () => {
      const [vehicles, equipment] = await Promise.all([api<any[]>("/api/assets/vehicles"), api<any[]>("/api/assets/equipment")]);
      return { linkedAsset: [{ value: "", label: "(optional)" }, ...vehicles.map((r) => ({ value: `v:${r.id}`, label: `Vehicle - ${r.description}` })), ...equipment.map((r) => ({ value: `e:${r.id}`, label: `Equipment - ${r.description}` }))] };
    },
    fields: [
      { name: "description", label: "Description", required: true },
      { name: "loanType", from: "loan_type", label: "Loan type", required: true },
      { name: "accountNumber", from: "account_number", label: "Account number" },
      { name: "isPrivate", from: "is_private", label: "Private", options: yesNo, defaultValue: "no" },
      { name: "isSecured", from: "is_secured", label: "Secured", options: yesNo, defaultValue: "no" },
      { name: "interestOnly", from: "interest_only", label: "Interest only", options: yesNo, defaultValue: "no" },
      { name: "linkedAsset", from: "linked_asset_ref", label: "Linked asset" },
      { name: "interestRate", from: "interest_rate", label: "Interest rate %", type: "number", step: "0.01", required: true },
      { name: "paymentAmount", from: "payment_amount", label: "Payment amount", type: "number", step: "0.01" },
      { name: "paymentFrequency", from: "payment_frequency", label: "Frequency", options: freqOptions, defaultValue: "monthly" },
      { name: "startDate", from: "start_date", label: "Start date", type: "date" },
      { name: "initialAmount", from: "initial_amount", label: "Initial amount", type: "number", step: "0.01", required: true },
      { name: "currentBalance", from: "current_balance", label: "Current balance", type: "number", step: "0.01", required: true },
      { name: "endDate", from: "end_date", label: "End date", type: "date" },
    ],
    columns: [
      { key: "description", label: "Description" },
      { key: "loan_type", label: "Type" },
      { key: "linked_asset_label", label: "Asset" },
      { key: "interest_rate", label: "Rate", render: (r) => pct(r.interest_rate) },
      { key: "payment_amount", label: "Payment", render: (r) => money(r.payment_amount) },
      { key: "current_balance", label: "Balance", render: (r) => money(r.current_balance) },
    ],
    total: { label: "Balance", value: (r) => Number(r.current_balance || 0) },
  },
  sandyGoals: {
    title: "Sandy Goal",
    endpoint: "/api/sandy/goals",
    fields: [
      { name: "title", from: "goal_title", label: "Goal", required: true },
      { name: "details", from: "goal_details", label: "Details", type: "textarea" },
      { name: "year", from: "goal_year", label: "Target year", type: "number", required: true },
      { name: "percentComplete", from: "percent_complete", label: "% complete", type: "number", min: 0, max: 100, defaultValue: 0 },
    ],
    columns: [
      { key: "goal_title", label: "Goal" },
      { key: "goal_year", label: "Year" },
      { key: "percent_complete", label: "Progress", render: (r) => <Progress value={Number(r.percent_complete || 0)} /> },
      { key: "updated_at", label: "Updated", render: (r) => r.updated_at ? new Date(r.updated_at).toLocaleDateString() : "—" },
    ],
  },
  solar: {
    title: "Solar Usage",
    endpoint: "/api/solar-electric-usage",
    fields: [
      { name: "month", from: "usage_month", label: "Month", type: "month", required: true },
      { name: "solarKwh", from: "solar_kwh", label: "Solar generated kWh", type: "number", step: "0.01", required: true },
      { name: "meter1Kwh", from: "meter1_kwh", label: "Meter 1 kWh", type: "number", step: "0.01", required: true },
      { name: "meter2Kwh", from: "meter2_kwh", label: "Meter 2 kWh", type: "number", step: "0.01", required: true },
      { name: "amountPaid", from: "amount_paid", label: "Amount paid", type: "number", step: "0.01", required: true },
    ],
    columns: [
      { key: "usage_month", label: "Month" },
      { key: "solar_kwh", label: "Solar", render: (r) => Number(r.solar_kwh || 0).toFixed(2) },
      { key: "total_usage", label: "Usage", render: (r) => (Number(r.meter1_kwh || 0) + Number(r.meter2_kwh || 0)).toFixed(2) },
      { key: "net_usage", label: "Net", render: (r) => (Number(r.meter1_kwh || 0) + Number(r.meter2_kwh || 0) - Number(r.solar_kwh || 0)).toFixed(2) },
      { key: "amount_paid", label: "Paid", render: (r) => money(r.amount_paid) },
    ],
    total: { label: "Paid", value: (r) => Number(r.amount_paid || 0) },
  },
};

function Progress({ value }: { value: number }) {
  return <div className="progress-line"><progress max="100" value={value} /><span>{value.toFixed(0)}%</span></div>;
}

function Dashboard() {
  const { user } = useAuth();
  const [records, setRecords] = useState<AnyRow[]>([]);
  const [investments, setInvestments] = useState<AnyRow[]>([]);
  const [assets, setAssets] = useState(0);
  const [liabilities, setLiabilities] = useState(0);

  const load = useCallback(async () => {
    const [recordsPayload, investmentsSummary, assetsPayload, liabilitiesPayload] = await Promise.all([
      api<any[]>("/api/records"),
      api<AnyRow>("/api/investments/summary").catch((): AnyRow => ({})),
      Promise.all(["vehicles", "equipment", "guns", "bank-accounts", "cash"].map((x) => api<any[]>(`/api/assets/${x}`).catch(() => []))),
      api<AnyRow>("/api/liabilities/summary").catch((): AnyRow => ({})),
    ]);
    setRecords(asArray<AnyRow>(recordsPayload));
    setInvestments(summaryToChartRows(investmentsSummary));
    const directAssetTotal = (assetsPayload as any[][]).flat().reduce((sum, row) => sum + Number(row.value ?? row.balance ?? row.amount ?? 0), 0);
    const investmentTotal = Number(investmentsSummary?.combinedTotal || 0);
    setAssets(directAssetTotal + investmentTotal);
    setLiabilities(Number(liabilitiesPayload?.combinedTotal || 0));
  }, []);

  useEffect(() => { load().catch(() => undefined); }, [load]);
  const sorted = [...records].sort((a, b) => Number(a.year) - Number(b.year));
  const latest = sorted[sorted.length - 1];
  const totalIncome = records.reduce((sum, row) => sum + Number(row.income || 0), 0);
  const totalGiving = records.reduce((sum, row) => sum + Number(row.donation || 0), 0);
  const givingRate = totalIncome > 0 ? (totalGiving / totalIncome) * 100 : 0;

  return (
    <div className="dashboard-grid">
      <section className="kpi-strip">
        <Kpi label="Latest income" value={wholeMoney(latest?.income || 0)} note={latest ? `Tax year ${latest.year}` : "No records yet"} />
        <Kpi label="Latest net worth" value={wholeMoney(latest?.netWorth || latest?.net_worth || 0)} note="Most recent annual record" />
        <Kpi label="Giving rate" value={`${givingRate.toFixed(1)}%`} note={`Goal ${Number(user?.givingGoalPercent || DEFAULT_GOAL_PERCENT)}%`} />
        <Kpi label="Tracked balance sheet" value={wholeMoney(assets - liabilities)} note="Investments + assets minus liabilities" />
      </section>
      <section className="panel chart-panel">
        <h2>Income & Giving</h2>
        <Bar data={{ labels: sorted.map((r) => r.year), datasets: [{ label: "Income", data: sorted.map((r) => r.income), backgroundColor: "#2563eb" }, { label: "Giving", data: sorted.map((r) => r.donation), backgroundColor: "#16a34a" }] }} options={{ responsive: true, maintainAspectRatio: false }} />
      </section>
      <section className="panel chart-panel">
        <h2>Net Worth</h2>
        <Line data={{ labels: sorted.map((r) => r.year), datasets: [{ label: "Net worth", data: sorted.map((r) => Number(r.netWorth ?? r.net_worth ?? 0)), borderColor: "#2563eb", backgroundColor: "rgba(37,99,235,.14)", fill: true, tension: 0.25 }] }} options={{ responsive: true, maintainAspectRatio: false }} />
      </section>
      <section className="panel chart-panel">
        <h2>Investment Mix</h2>
        {(() => {
          const mixColors = ["#2563eb", "#16a34a", "#f59e0b", "#dc2626", "#7c3aed"];
          return (
            <>
              <div className="giving-chart-wrap">
                <Doughnut
                  data={{ labels: investments.map((x) => x.label || x.category), datasets: [{ data: investments.map((x) => Number(x.total || x.value || 0)), backgroundColor: mixColors, borderWidth: 0, hoverOffset: 4 }] }}
                  options={{ responsive: true, maintainAspectRatio: false, cutout: "72%", plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => ` ${wholeMoney(ctx.parsed)}` } } } }}
                />
              </div>
              <div className="giving-chart-legend mix-legend">
                {investments.map((x, i) => (
                  <div key={x.label} className="giving-legend-item">
                    <span className="giving-legend-dot" style={{ background: mixColors[i] }} />
                    <span>{x.label}</span>
                    <strong>{wholeMoney(x.total)}</strong>
                  </div>
                ))}
              </div>
            </>
          );
        })()}
      </section>
      <section className="panel chart-panel">
        <h2>Lifetime Giving</h2>
        <div className="giving-chart-wrap">
          <Doughnut
            data={{ labels: ["Giving", "Remaining income"], datasets: [{ data: [totalGiving, Math.max(0, totalIncome - totalGiving)], backgroundColor: ["#16a34a", "#2563eb"], borderWidth: 0, hoverOffset: 4 }] }}
            options={{ responsive: true, maintainAspectRatio: false, cutout: "72%", plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => ` ${wholeMoney(ctx.parsed)}` } } } }}
          />
          <div className="giving-chart-center">
            <span>{givingRate.toFixed(1)}%</span>
            <small>given</small>
          </div>
        </div>
        <div className="giving-chart-legend">
          <div className="giving-legend-item">
            <span className="giving-legend-dot" style={{ background: "#16a34a" }} />
            <span>Total giving</span>
            <strong>{wholeMoney(totalGiving)}</strong>
          </div>
          <div className="giving-legend-item">
            <span className="giving-legend-dot" style={{ background: "#2563eb" }} />
            <span>Total income</span>
            <strong>{wholeMoney(totalIncome)}</strong>
          </div>
        </div>
      </section>
    </div>
  );
}

function Kpi({ label, value, note }: { label: string; value: string; note: string }) {
  return <article className="kpi"><span>{label}</span><strong>{value}</strong><small>{note}</small></article>;
}

function RecordsPage() {
  const [records, setRecords] = useState<AnyRow[]>([]);
  const [form, setForm] = useState<AnyRow>({ year: "", income: "", donation: "", netWorth: "" });
  const [editingYear, setEditingYear] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => setRecords((await api<any[]>("/api/records")).sort((a, b) => Number(b.year) - Number(a.year))), []);
  useEffect(() => { load().catch((e) => setMessage(e.message)); }, [load]);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    const year = Number(form.year);
    await api("/api/records", { method: "POST", body: JSON.stringify({ year, income: Number(form.income), donation: Number(form.donation), netWorth: form.netWorth === "" ? null : Number(form.netWorth) }) });
    if (editingYear !== null && editingYear !== year) await api(`/api/records/${editingYear}`, { method: "DELETE" });
    setEditingYear(null);
    setForm({ year: "", income: "", donation: "", netWorth: "" });
    setShowForm(false);
    await load();
    setMessage("Record saved.");
  }
  return (
    <div className={clsx("workspace-grid", !showForm && "form-collapsed")}>
      {showForm && <section className="panel form-panel reveal-panel">
        <div className="panel-heading">
          <h2>{editingYear ? "Update Annual Record" : "Add Annual Record"}</h2>
          <button className="ghost-btn" type="button" onClick={() => { setEditingYear(null); setForm({ year: "", income: "", donation: "", netWorth: "" }); setShowForm(false); }}>Close</button>
        </div>
        <form className="form-grid" onSubmit={save}>
          <Field label="Tax year" type="number" value={form.year} onChange={(v) => setForm((f) => ({ ...f, year: v }))} required />
          <Field label="Income" type="number" step="0.01" value={form.income} onChange={(v) => setForm((f) => ({ ...f, income: v }))} required />
          <Field label="Donations" type="number" step="0.01" value={form.donation} onChange={(v) => setForm((f) => ({ ...f, donation: v }))} required />
          <Field label="Net worth" type="number" step="0.01" value={form.netWorth} onChange={(v) => setForm((f) => ({ ...f, netWorth: v }))} />
          <button className="primary-btn">Save record</button>
        </form>
        {message && <p className="form-message">{message}</p>}
      </section>}
      <section className="panel table-panel">
        <div className="panel-heading">
          <h2>Annual Records</h2>
          <button className="primary-btn compact" type="button" onClick={() => { setEditingYear(null); setForm({ year: "", income: "", donation: "", netWorth: "" }); setShowForm((value) => !value); }}>{showForm ? "Hide form" : "Add record"}</button>
        </div>
        <DataTable rows={records} columns={[
          { key: "year", label: "Year" },
          { key: "income", label: "Income", render: (r) => money(r.income) },
          { key: "donation", label: "Donations", render: (r) => money(r.donation) },
          { key: "giving", label: "Giving Rate", render: (r) => `${(Number(r.income) ? Number(r.donation) / Number(r.income) * 100 : 0).toFixed(2)}%` },
          { key: "netWorth", label: "Net Worth", render: (r) => r.netWorth == null ? "—" : money(r.netWorth) },
        ]} actions={(row) => <Actions onEdit={() => { setEditingYear(Number(row.year)); setForm({ year: row.year, income: row.income, donation: row.donation, netWorth: row.netWorth ?? "" }); setShowForm(true); }} onDelete={async () => { await api(`/api/records/${row.year}`, { method: "DELETE" }); await load(); }} />} />
      </section>
    </div>
  );
}

function InvestmentsPage() {
  const [rows, setRows] = useState<AnyRow[]>([]);
  const [form, setForm] = useState<AnyRow>({ ticker: "", broker: "", companyName: "", currentPrice: "", manualQuote: false, shares: "", purchasePrice: "", purchaseDate: "" });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => setRows(await api("/api/investments")), []);
  useEffect(() => { load().catch((e) => setMessage(e.message)); }, [load]);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setMessage("");
    try {
      await api("/api/investments", { method: "POST", body: JSON.stringify({ id: editingId, ...form, ticker: String(form.ticker).toUpperCase(), shares: Number(form.shares), purchasePrice: Number(form.purchasePrice), currentPrice: form.currentPrice === "" ? "" : Number(form.currentPrice) }) });
      setForm({ ticker: "", broker: "", companyName: "", currentPrice: "", manualQuote: false, shares: "", purchasePrice: "", purchaseDate: "" });
      setEditingId(null);
      setShowForm(false);
      await load();
      setMessage("Stock saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save stock.");
    }
  }
  async function refresh() {
    const payload = await api<any>("/api/investments/refresh", { method: "POST", body: JSON.stringify({}) });
    await load();
    setMessage(`Prices refreshed (${payload.updated || 0} updated${payload.failed ? `, ${payload.failed} failed` : ""}).`);
  }
  return (
    <div className={clsx("workspace-grid", !showForm && "form-collapsed")}>
      {showForm && <section className="panel form-panel reveal-panel">
        <div className="panel-heading">
          <h2>{editingId ? "Update Stock" : "Add Stock"}</h2>
          <button className="ghost-btn" type="button" onClick={() => { setEditingId(null); setForm({ ticker: "", broker: "", companyName: "", currentPrice: "", manualQuote: false, shares: "", purchasePrice: "", purchaseDate: "" }); setShowForm(false); }}>Close</button>
        </div>
        <form className="form-grid" onSubmit={save}>
          <Field label="Ticker" value={form.ticker} onChange={(v) => setForm((f) => ({ ...f, ticker: v }))} required />
          <Field label="Broker" value={form.broker} onChange={(v) => setForm((f) => ({ ...f, broker: v }))} />
          <Field label="Company name" value={form.companyName} onChange={(v) => setForm((f) => ({ ...f, companyName: v }))} />
          <Field label="Current price" type="number" step="0.01" value={form.currentPrice} onChange={(v) => setForm((f) => ({ ...f, currentPrice: v }))} />
          <Field label="Shares" type="number" step="0.0001" value={form.shares} onChange={(v) => setForm((f) => ({ ...f, shares: v }))} required />
          <Field label="Purchase price" type="number" step="0.01" value={form.purchasePrice} onChange={(v) => setForm((f) => ({ ...f, purchasePrice: v }))} required />
          <Field label="Purchase date" type="date" value={form.purchaseDate} onChange={(v) => setForm((f) => ({ ...f, purchaseDate: v }))} required />
          <button className="primary-btn">Save stock</button>
        </form>
        {message && <p className="form-message">{message}</p>}
      </section>}
      <section className="panel table-panel">
        <div className="panel-heading">
          <h2>Stocks</h2>
          <div className="panel-actions">
            <button className="ghost-btn compact" type="button" onClick={refresh}>Refresh prices</button>
            <button className="primary-btn compact" type="button" onClick={() => { setEditingId(null); setForm({ ticker: "", broker: "", companyName: "", currentPrice: "", manualQuote: false, shares: "", purchasePrice: "", purchaseDate: "" }); setShowForm((value) => !value); }}>{showForm ? "Hide form" : "Add stock"}</button>
          </div>
        </div>
        <DataTable rows={rows} columns={[
          { key: "ticker", label: "Ticker" },
          { key: "broker", label: "Broker" },
          { key: "company_name", label: "Company" },
          { key: "shares", label: "Shares" },
          { key: "purchase_price", label: "Basis", render: (r) => money(r.purchase_price) },
          { key: "current_price", label: "Price", render: (r) => r.current_price == null ? "N/A" : money(r.current_price) },
          { key: "gain", label: "Gain/Loss", render: (r) => {
            const basis = Number(r.shares) * Number(r.purchase_price);
            const value = Number(r.shares) * Number(r.current_price || 0);
            return r.current_price == null ? "—" : <span className={value - basis >= 0 ? "gain" : "loss"}>{money(value - basis)}</span>;
          } },
        ]} actions={(row) => <Actions onEdit={() => { setEditingId(row.id); setForm({ ticker: row.ticker, broker: row.broker || "", companyName: row.company_name || "", currentPrice: row.current_price ?? "", manualQuote: Boolean(row.manual_quote), shares: row.shares, purchasePrice: row.purchase_price, purchaseDate: row.purchase_date }); setShowForm(true); }} onDelete={async () => { await api(`/api/investments/${row.id}`, { method: "DELETE" }); await load(); }} />} />
      </section>
    </div>
  );
}

function RecurringExpensesPage() {
  const [categories, setCategories] = useState<string[]>([]);
  const config: CrudConfig = useMemo(() => ({
    title: "Recurring Expense",
    endpoint: "/api/liabilities/recurring-expenses",
    beforeLoad: async () => {
      const cats = await api<string[]>("/api/liabilities/recurring-expense-categories");
      setCategories(cats);
      return { category: cats.map((x) => ({ value: x, label: x })) };
    },
    fields: [
      { name: "description", label: "Description", required: true },
      { name: "category", label: "Category", required: true },
      { name: "amount", label: "Amount", type: "number", step: "0.01", required: true },
      { name: "frequency", label: "Frequency", options: freqOptions, defaultValue: "monthly" },
      { name: "startDate", from: "start_date", label: "Start date", type: "date" },
      { name: "endDate", from: "end_date", label: "End date", type: "date" },
    ],
    columns: [
      { key: "description", label: "Description" },
      { key: "category", label: "Category" },
      { key: "amount", label: "Amount", render: (r) => money(r.amount) },
      { key: "frequency", label: "Frequency" },
      { key: "start_date", label: "Start" },
      { key: "end_date", label: "End" },
    ],
    total: { label: "Monthly equivalent", value: (r) => Number(r.amount || 0) },
  }), []);
  return (
    <>
      <CategoryManager categories={categories} onAdded={(name) => setCategories((current) => [...new Set([...current, name])])} />
      <CrudPage config={config} />
    </>
  );
}

function CategoryManager({ categories, onAdded }: { categories: string[]; onAdded: (name: string) => void }) {
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  async function add() {
    if (!name.trim()) return;
    await api("/api/liabilities/recurring-expense-categories", { method: "POST", body: JSON.stringify({ name: name.trim() }) });
    onAdded(name.trim());
    setName("");
    setMessage("Category added.");
  }
  return (
    <section className="panel slim-panel">
      <h2>Categories</h2>
      <div className="inline-form"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="New category" /><button className="ghost-btn" type="button" onClick={add}>Add</button></div>
      <p className="muted">{categories.length ? categories.join(" · ") : "No categories yet."}</p>
      {message && <p className="form-message">{message}</p>}
    </section>
  );
}

function GoalsPage() {
  const subtypeOptions: Record<string, { value: string; label: string }[]> = {
    asset: ["bank-accounts", "cash", "vehicles", "equipment", "guns"].map((x) => ({ value: x, label: x.replace(/-/g, " ") })),
    investment: ["stocks", "precious-metals", "real-estate", "business-ventures", "retirement-accounts"].map((x) => ({ value: x, label: x.replace(/-/g, " ") })),
    liability: ["mortgages", "credit-cards", "loans", "recurring-expenses"].map((x) => ({ value: x, label: x.replace(/-/g, " ") })),
  };
  const [rows, setRows] = useState<AnyRow[]>([]);
  const [form, setForm] = useState<AnyRow>({ name: "", goalType: "save-up", targetAmount: "", targetCategory: "investment", targetSubtype: "stocks", goalDate: "" });
  const [showForm, setShowForm] = useState(false);
  const load = useCallback(async () => setRows(await api("/api/goals")), []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const first = subtypeOptions[form.targetCategory]?.[0]?.value || "";
    if (!subtypeOptions[form.targetCategory]?.some((x) => x.value === form.targetSubtype)) setForm((f) => ({ ...f, targetSubtype: first }));
  }, [form.targetCategory]);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    await api("/api/goals", { method: "POST", body: JSON.stringify({ ...form, targetAmount: Number(form.targetAmount) }) });
    setForm({ name: "", goalType: "save-up", targetAmount: "", targetCategory: "investment", targetSubtype: "stocks", goalDate: "" });
    setShowForm(false);
    await load();
  }
  return (
    <div className={clsx("workspace-grid", !showForm && "form-collapsed")}>
      {showForm && <section className="panel form-panel reveal-panel">
        <div className="panel-heading"><h2>Add Goal</h2><button className="ghost-btn" type="button" onClick={() => setShowForm(false)}>Close</button></div>
        <form className="form-grid" onSubmit={save}>
          <Field label="Goal name" value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} required />
          <Field label="Goal type" value={form.goalType} onChange={(v) => setForm((f) => ({ ...f, goalType: v }))} options={[{ value: "save-up", label: "Save up" }, { value: "pay-down", label: "Pay down" }]} />
          <Field label="Target amount" type="number" step="0.01" value={form.targetAmount} onChange={(v) => setForm((f) => ({ ...f, targetAmount: v }))} required />
          <Field label="Category" value={form.targetCategory} onChange={(v) => setForm((f) => ({ ...f, targetCategory: v }))} options={[{ value: "investment", label: "Investment" }, { value: "asset", label: "Asset" }, { value: "liability", label: "Liability" }]} />
          <Field label="Track subcategory" value={form.targetSubtype} onChange={(v) => setForm((f) => ({ ...f, targetSubtype: v }))} options={subtypeOptions[form.targetCategory]} />
          <Field label="Goal date" type="date" value={form.goalDate} onChange={(v) => setForm((f) => ({ ...f, goalDate: v }))} />
          <button className="primary-btn">Save goal</button>
        </form>
      </section>}
      <section className="panel table-panel">
        <div className="panel-heading"><h2>Goals</h2><button className="primary-btn compact" type="button" onClick={() => setShowForm((value) => !value)}>{showForm ? "Hide form" : "Add goal"}</button></div>
        <DataTable rows={rows} columns={[
          { key: "name", label: "Name" },
          { key: "goal_type", label: "Type" },
          { key: "target_amount", label: "Target", render: (r) => money(r.target_amount) },
          { key: "progress_amount", label: "Progress", render: (r) => <Progress value={Number(r.target_amount) ? Math.min(100, Number(r.progress_amount || 0) / Number(r.target_amount) * 100) : 0} /> },
          { key: "goal_date", label: "Goal date" },
        ]} actions={(row) => <Actions onDelete={async () => { await api(`/api/goals/${row.id}`, { method: "DELETE" }); await load(); }} />} />
      </section>
    </div>
  );
}

function TaxesPage() {
  const [rows, setRows] = useState<AnyRow[]>([]);
  const [form, setForm] = useState<AnyRow>({ taxYear: "", federalTax: "", stateTax: "", localTax: "", notes: "", file: null });
  const [showForm, setShowForm] = useState(false);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => setRows(await api("/api/taxes")), []);
  useEffect(() => { load(); }, [load]);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    const file = form.file as File | null;
    await api("/api/taxes", {
      method: "POST",
      body: JSON.stringify({
        taxYear: Number(form.taxYear),
        federalTax: Number(form.federalTax || 0),
        stateTax: Number(form.stateTax || 0),
        localTax: Number(form.localTax || 0),
        notes: form.notes || "",
        fileName: file?.name || "",
        contentType: file?.type || "application/pdf",
        fileBase64: file ? await fileToBase64(file) : "",
      }),
    });
    setForm({ taxYear: "", federalTax: "", stateTax: "", localTax: "", notes: "", file: null });
    setShowForm(false);
    await load();
    setMessage("Tax year saved.");
  }
  return (
    <div className={clsx("workspace-grid", !showForm && "form-collapsed")}>
      {showForm && <section className="panel form-panel reveal-panel">
        <div className="panel-heading"><h2>Add Tax Year</h2><button className="ghost-btn" type="button" onClick={() => setShowForm(false)}>Close</button></div>
        <form className="form-grid" onSubmit={save}>
          <Field label="Tax year" type="number" value={form.taxYear} onChange={(v) => setForm((f) => ({ ...f, taxYear: v }))} required />
          <Field label="Federal tax" type="number" step="0.01" value={form.federalTax} onChange={(v) => setForm((f) => ({ ...f, federalTax: v }))} />
          <Field label="State tax" type="number" step="0.01" value={form.stateTax} onChange={(v) => setForm((f) => ({ ...f, stateTax: v }))} />
          <Field label="Local tax" type="number" step="0.01" value={form.localTax} onChange={(v) => setForm((f) => ({ ...f, localTax: v }))} />
          <label className="field"><span>Document</span><input type="file" onChange={(e) => setForm((f) => ({ ...f, file: e.target.files?.[0] || null }))} /></label>
          <Field label="Notes" type="textarea" value={form.notes} onChange={(v) => setForm((f) => ({ ...f, notes: v }))} />
          <button className="primary-btn">Save tax year</button>
        </form>
        {message && <p className="form-message">{message}</p>}
      </section>}
      <section className="panel table-panel">
        <div className="panel-heading"><h2>Taxes</h2><button className="primary-btn compact" type="button" onClick={() => setShowForm((value) => !value)}>{showForm ? "Hide form" : "Add tax year"}</button></div>
        <DataTable rows={rows} columns={[
          { key: "tax_year", label: "Year" },
          { key: "federal_tax", label: "Federal", render: (r) => money(r.federal_tax) },
          { key: "state_tax", label: "State", render: (r) => money(r.state_tax) },
          { key: "local_tax", label: "Local", render: (r) => money(r.local_tax) },
          { key: "document", label: "Document", render: (r) => r.document_id ? <a href={`/api/taxes/documents/${r.document_id}/download`}>{r.file_name || "Download"}</a> : "—" },
        ]} actions={(row) => <Actions onDelete={async () => { await api(`/api/taxes/${row.id}`, { method: "DELETE" }); await load(); }} />} />
      </section>
    </div>
  );
}

function NetWorthReport() {
  const { user } = useAuth();
  const [data, setData] = useState<Record<string, AnyRow[]>>({});
  const [condensed, setCondensed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const reportDate = useMemo(() => new Date(), []);

  useEffect(() => {
    Promise.all([
      api<any[]>("/api/investments"), api<any[]>("/api/precious-metals"), api<any[]>("/api/real-estate"), api<any[]>("/api/business-ventures"), api<any[]>("/api/retirement-accounts"),
      api<any[]>("/api/assets/vehicles"), api<any[]>("/api/assets/equipment"), api<any[]>("/api/assets/guns"), api<any[]>("/api/assets/bank-accounts"), api<any[]>("/api/assets/cash"),
      api<any[]>("/api/liabilities/mortgages"), api<any[]>("/api/liabilities/credit-cards"), api<any[]>("/api/liabilities/loans"),
    ]).then(([stocks, metals, realEstate, business, retirement, vehicles, equipment, guns, bank, cash, mortgages, creditCards, loans]) =>
      setData({ stocks, metals, realEstate, business, retirement, vehicles, equipment, guns, bank, cash, mortgages, creditCards, loans }))
      .catch((error) => setMessage(error instanceof Error ? error.message : "Unable to load net worth statement."))
      .finally(() => setLoading(false));
  }, []);

  const assetCategories = useMemo<StatementCategory[]>(() => [
    {
      title: "Stocks",
      items: (data.stocks || []).map((x) => ({
        description: [x.ticker, x.company_name].filter(Boolean).join(" - "),
        value: x.current_price == null ? null : Number(x.shares || 0) * Number(x.current_price || 0),
      })),
    },
    { title: "Precious Metals", items: (data.metals || []).map((x) => ({ description: [x.metal_type, x.description].filter(Boolean).join(" - "), value: Number(x.current_value || 0) })) },
    {
      title: "Real Estate",
      items: (data.realEstate || []).map((x) => ({
        description: `${x.description || x.address}${x.address && x.description ? ` (${x.address})` : ""}${Number(x.percentage_owned) < 100 ? ` (${Number(x.percentage_owned).toFixed(0)}% owned)` : ""}`,
        value: Number(x.current_value || 0) * (Number(x.percentage_owned || 0) / 100),
      })),
    },
    { title: "Business Ventures", items: (data.business || []).map((x) => ({ description: String(x.business_name || "Business venture"), value: Number(x.business_value || 0) * (Number(x.percentage_owned || 0) / 100) })) },
    { title: "Retirement Accounts", items: (data.retirement || []).map((x) => ({ description: [x.description, x.account_type, x.broker].filter(Boolean).join(" - "), value: Number(x.value || 0) })) },
    { title: "Vehicles", items: (data.vehicles || []).map((x) => ({ description: [`${x.description || "Vehicle"}${x.model_year ? ` (${x.model_year})` : ""}`, [x.make, x.model].filter(Boolean).join(" "), x.vin ? `VIN: ${x.vin}` : ""].filter(Boolean).join(" - "), value: Number(x.value || 0) })) },
    { title: "Equipment", items: (data.equipment || []).map((x) => ({ description: [`${x.description || "Equipment"}${x.model_year ? ` (${x.model_year})` : ""}`, x.equipment_type, [x.make, x.model].filter(Boolean).join(" ")].filter(Boolean).join(" - "), value: Number(x.value || 0) })) },
    { title: "Firearms", items: (data.guns || []).map((x) => ({ description: [x.description, x.gun_type, x.manufacturer, x.model].filter(Boolean).join(" - "), value: Number(x.value || 0) })) },
    { title: "Bank Accounts", items: (data.bank || []).map((x) => ({ description: [x.description, x.institution, x.account_type].filter(Boolean).join(" - "), value: Number(x.balance || 0) })) },
    { title: "Cash", items: (data.cash || []).map((x) => ({ description: String(x.description || "Cash"), value: Number(x.amount || 0) })) },
  ], [data]);

  const liabilityCategories = useMemo<StatementCategory[]>(() => [
    {
      title: "Mortgages",
      items: (data.mortgages || []).map((x) => {
        const ownedPct = x.real_estate_percentage_owned == null ? 100 : Number(x.real_estate_percentage_owned);
        const effectivePct = Number.isNaN(ownedPct) ? 100 : ownedPct;
        const ownershipNote = x.real_estate_percentage_owned == null ? "" : ` (${effectivePct.toFixed(0)}% owned)`;
        return {
          description: `${x.description || "Mortgage"}${x.real_estate_address ? ` (${x.real_estate_address})` : ""}${ownershipNote}`,
          value: Number(x.current_balance || 0) * (effectivePct / 100),
        };
      }),
    },
    { title: "Credit Cards", items: (data.creditCards || []).map((x) => ({ description: String(x.description || "Credit card"), value: Number(x.current_balance || 0) })) },
    { title: "Loans", items: (data.loans || []).map((x) => ({ description: [x.description, x.loan_type].filter(Boolean).join(" - "), value: Number(x.current_balance || 0) })) },
  ], [data]);

  const visibleAssetCategories = assetCategories.filter((category) => category.items.length || statementTotal(category.items) !== 0);
  const visibleLiabilityCategories = liabilityCategories.filter((category) => category.items.length || statementTotal(category.items) !== 0);
  const assetTotal = visibleAssetCategories.reduce((sum, category) => sum + statementTotal(category.items), 0);
  const liabilityTotal = visibleLiabilityCategories.reduce((sum, category) => sum + statementTotal(category.items), 0);
  const netWorth = assetTotal - liabilityTotal;
  const ownerName = user?.fullName || user?.username || "Account holder";
  const generatedLabel = reportDate.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

  return (
    <div className="net-worth-statement">
      <section className="panel statement-toolbar">
        <div>
          <h2>Net Worth Statement</h2>
          <p className="muted">Print a detailed statement or a condensed totals-only version for lender review.</p>
        </div>
        <div className="statement-actions">
          <label className="toggle-row statement-toggle"><input type="checkbox" checked={condensed} onChange={(event) => setCondensed(event.target.checked)} /> Condensed report</label>
          <button className="primary-btn compact icon-text-btn" type="button" onClick={() => window.print()}><Printer size={16} /> Print / Save PDF</button>
        </div>
      </section>

      <section className={clsx("statement-paper", condensed && "is-condensed")}>
        <header className="statement-header">
          <div>
            <p className="statement-eyebrow">Personal Financial Statement</p>
            <h2>Net Worth Statement</h2>
            <p>Prepared for {ownerName}</p>
          </div>
          <dl className="statement-meta">
            <div><dt>As Of</dt><dd>{generatedLabel}</dd></div>
            <div><dt>Report Type</dt><dd>{condensed ? "Condensed" : "Detailed"}</dd></div>
          </dl>
        </header>

        {message && <p className="form-message">{message}</p>}
        {loading ? <EmptyState text="Loading statement..." /> : (
          <>
            <section className="statement-summary">
              <div><span>Assets and Investments</span><strong>{money(assetTotal)}</strong></div>
              <div><span>Liabilities</span><strong>{money(liabilityTotal)}</strong></div>
              <div className="statement-net"><span>Total Net Worth</span><strong>{money(netWorth)}</strong></div>
            </section>

            <StatementGroup title="Assets and Investments" categories={visibleAssetCategories} condensed={condensed} empty="No assets or investments are currently tracked." />
            <StatementSubtotal label="Assets and Investments Subtotal" value={assetTotal} />
            <StatementGroup title="Liabilities" categories={visibleLiabilityCategories} condensed={condensed} empty="No liabilities are currently tracked." />
            <StatementSubtotal label="Liabilities Subtotal" value={liabilityTotal} />

            <section className="statement-grand-total">
              <span>Total Net Worth</span>
              <strong>{money(netWorth)}</strong>
            </section>

            <section className="statement-certification">
              <p>The information in this financial statement is accurate and complete to the best of my knowledge.</p>
              <div className="signature-row">
                <div className="signature-field"><span className="signature-line" /><span className="signature-label">Signature</span></div>
                <div className="signature-field signature-date"><span className="signature-line" /><span className="signature-label">Date</span></div>
              </div>
            </section>
          </>
        )}
      </section>
    </div>
  );
}

function StatementGroup({ title, categories, condensed, empty }: { title: string; categories: StatementCategory[]; condensed: boolean; empty: string }) {
  return (
    <section className="statement-section">
      <h3>{title}</h3>
      {categories.length === 0 ? <p className="statement-empty">{empty}</p> : categories.map((category) => (
        <StatementCategoryTable key={category.title} category={category} condensed={condensed} />
      ))}
    </section>
  );
}

function StatementCategoryTable({ category, condensed }: { category: StatementCategory; condensed: boolean }) {
  const total = statementTotal(category.items);
  return (
    <section className={clsx("statement-category", condensed && "is-condensed")}>
      {!condensed && <h4>{category.title}</h4>}
      <table className="statement-table">
        <tbody>
          {!condensed && category.items.map((item, index) => (
            <tr key={`${item.description}-${index}`}>
              <td>{item.description || "Unlabeled item"}</td>
              <td>{item.value == null ? "N/A" : money(item.value)}</td>
            </tr>
          ))}
          <tr className="statement-total-row">
            <td>{condensed ? category.title : `${category.title} Total`}</td>
            <td>{money(total)}</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

function StatementSubtotal({ label, value }: { label: string; value: number }) {
  return <section className="statement-subtotal"><span>{label}</span><strong>{money(value)}</strong></section>;
}

function ReportTable({ title, rows }: { title: string; rows: AnyRow[] }) {
  if (!rows?.length) return null;
  const keys = Object.keys(rows[0]).filter((key) => !["id", "user_id", "photo_data"].includes(key)).slice(0, 5);
  return <section className="panel report-section"><h2>{title}</h2><DataTable rows={rows} columns={keys.map((key) => ({ key, label: key.replace(/_/g, " ") }))} /></section>;
}

function ReportSurface({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="report-surface"><div className="report-toolbar"><h2>{title}</h2><button className="primary-btn" type="button" onClick={() => window.print()}>Print / Save PDF</button></div>{children}</div>;
}

function MonthlyPaymentsReport() {
  const [month, setMonth] = useState(todayMonth());
  const [data, setData] = useState<AnyRow>({ monthlyPayments: [], periodicPayments: [] });
  const load = useCallback(async () => setData(await api(`/api/reports/monthly-payments?month=${encodeURIComponent(month)}`)), [month]);
  useEffect(() => { load(); }, [load]);
  return <ReportSurface title="Monthly Payments"><section className="panel slim-panel"><Field label="Month" type="month" value={month} onChange={setMonth} /></section><ReportTable title="Monthly payments" rows={data.monthlyPayments || []} /><ReportTable title="Periodic payments" rows={data.periodicPayments || []} /></ReportSurface>;
}

function LiquidCashReport() {
  const [data, setData] = useState<AnyRow>({ bankAccounts: [], cashAccounts: [] });
  useEffect(() => { api("/api/reports/liquid-cash").then(setData); }, []);
  return <ReportSurface title="Liquid Cash"><ReportTable title="Bank accounts" rows={data.bankAccounts || []} /><ReportTable title="Cash accounts" rows={data.cashAccounts || []} /></ReportSurface>;
}

function InvestmentCalculator() {
  const categories = [
    { key: "stocks", label: "Stocks", endpoint: "/api/investments", total: (items: AnyRow[]) => items.reduce((sum, item) => sum + Number(item.shares || 0) * Number(item.current_price || 0), 0) },
    { key: "preciousMetals", label: "Precious Metals", endpoint: "/api/precious-metals", total: (items: AnyRow[]) => items.reduce((sum, item) => sum + Number(item.current_value || 0), 0) },
    { key: "realEstate", label: "Real Estate", endpoint: "/api/real-estate", total: (items: AnyRow[]) => items.reduce((sum, item) => sum + Number(item.current_value || 0) * Number(item.percentage_owned || 0) / 100, 0) },
    { key: "businessVentures", label: "Business Ventures", endpoint: "/api/business-ventures", total: (items: AnyRow[]) => items.reduce((sum, item) => sum + Number(item.business_value || 0) * Number(item.percentage_owned || 0) / 100, 0) },
    { key: "retirementAccounts", label: "Retirement Accounts", endpoint: "/api/retirement-accounts", total: (items: AnyRow[]) => items.reduce((sum, item) => sum + Number(item.value || 0), 0) },
  ];
  const [form, setForm] = useState<AnyRow>({ annualReturn: 7, monthlyContribution: 0, years: 20, selected: Object.fromEntries(categories.map((c) => [c.key, true])) });
  const [points, setPoints] = useState<AnyRow[]>([]);
  async function run(event: React.FormEvent) {
    event.preventDefault();
    const payloads = await Promise.all(categories.map((cat) => api<any[]>(cat.endpoint)));
    const principal = categories.reduce((sum, cat, index) => form.selected[cat.key] ? sum + cat.total(payloads[index]) : sum, 0);
    const monthlyRate = Number(form.annualReturn || 0) / 100 / 12;
    let balance = principal;
    const next = [{ year: 0, value: principal }];
    for (let month = 1; month <= Number(form.years) * 12; month += 1) {
      balance = (balance + Number(form.monthlyContribution || 0)) * (1 + monthlyRate);
      if (month % 12 === 0) next.push({ year: month / 12, value: balance });
    }
    setPoints(next);
  }
  return (
    <div className="workspace-grid">
      <section className="panel form-panel">
        <h2>Projection Inputs</h2>
        <form className="form-grid" onSubmit={run}>
          <Field label="Annual return %" type="number" step="0.01" value={form.annualReturn} onChange={(v) => setForm((f) => ({ ...f, annualReturn: v }))} />
          <Field label="Monthly contribution" type="number" step="0.01" value={form.monthlyContribution} onChange={(v) => setForm((f) => ({ ...f, monthlyContribution: v }))} />
          <Field label="Years" type="number" value={form.years} onChange={(v) => setForm((f) => ({ ...f, years: v }))} />
          <button className="primary-btn">Run projection</button>
        </form>
      </section>
      <section className="panel chart-panel wide">
        <h2>Projected Value</h2>
        {points.length ? <Line data={{ labels: points.map((p) => `Year ${p.year}`), datasets: [{ label: "Value", data: points.map((p) => p.value), borderColor: "#2563eb", backgroundColor: "rgba(37,99,235,.14)", fill: true }] }} options={{ responsive: true, maintainAspectRatio: false }} /> : <EmptyState text="Run a projection to view the chart." />}
      </section>
    </div>
  );
}

function LoanAmortization() {
  const [form, setForm] = useState<AnyRow>({ startDate: "", principal: "", annualRate: "", months: "" });
  const [rows, setRows] = useState<AnyRow[]>([]);
  function run(event: React.FormEvent) {
    event.preventDefault();
    const monthlyRate = Number(form.annualRate || 0) / 100 / 12;
    const months = Number(form.months || 0);
    const principal = Number(form.principal || 0);
    const payment = monthlyRate === 0 ? principal / months : principal * (monthlyRate / (1 - ((1 + monthlyRate) ** -months)));
    let balance = principal;
    const next = [];
    for (let month = 1; month <= months; month += 1) {
      const interest = balance * monthlyRate;
      const principalPaid = Math.min(balance, payment - interest);
      balance = Math.max(0, balance - principalPaid);
      next.push({ month, interest, principal: principalPaid, payment: principalPaid + interest, remaining: balance });
    }
    setRows(next);
  }
  return (
    <div className="workspace-grid">
      <section className="panel form-panel"><h2>Loan Details</h2><form className="form-grid" onSubmit={run}>
        <Field label="Start date" type="date" value={form.startDate} onChange={(v) => setForm((f) => ({ ...f, startDate: v }))} required />
        <Field label="Starting balance" type="number" step="0.01" value={form.principal} onChange={(v) => setForm((f) => ({ ...f, principal: v }))} required />
        <Field label="Interest rate %" type="number" step="0.001" value={form.annualRate} onChange={(v) => setForm((f) => ({ ...f, annualRate: v }))} required />
        <Field label="Term months" type="number" value={form.months} onChange={(v) => setForm((f) => ({ ...f, months: v }))} required />
        <button className="primary-btn">Calculate</button>
      </form></section>
      <section className="panel table-panel"><h2>Schedule</h2><DataTable rows={rows} empty="Run a calculation to view the schedule." columns={[
        { key: "month", label: "Month" },
        { key: "interest", label: "Interest", render: (r) => money(r.interest) },
        { key: "principal", label: "Principal", render: (r) => money(r.principal) },
        { key: "payment", label: "Payment", render: (r) => money(r.payment) },
        { key: "remaining", label: "Remaining", render: (r) => money(r.remaining) },
      ]} /></section>
    </div>
  );
}

function ProfilePage() {
  const { user, refreshUser } = useAuth();
  const [profile, setProfile] = useState<AnyRow>({});
  const [settings, setSettings] = useState<AnyRow>({});
  const [message, setMessage] = useState("");
  useEffect(() => {
    setProfile({
      fullName: user?.fullName || "", email: user?.email || "", phone: user?.phone || "", streetAddress: user?.streetAddress || "", city: user?.city || "", state: user?.state || "", zip: user?.zip || "", currentPassword: "", newPassword: "",
    });
    setSettings({
      givingGoalPercent: user?.givingGoalPercent || DEFAULT_GOAL_PERCENT,
      themePreference: user?.themePreference || "system",
      creditCardPromo: user?.notificationSettings?.creditCardPromo ?? true,
      vehicleInspection: user?.notificationSettings?.vehicleInspection ?? true,
      system: user?.notificationSettings?.system ?? true,
    });
  }, [user]);
  async function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    await api("/api/profile", { method: "POST", body: JSON.stringify(profile) });
    await refreshUser();
    setMessage("Profile updated.");
  }
  async function saveSettings(event: React.FormEvent) {
    event.preventDefault();
    await api("/api/user-settings", { method: "POST", body: JSON.stringify({ givingGoalPercent: Number(settings.givingGoalPercent), themePreference: settings.themePreference, notifications: { creditCardPromo: settings.creditCardPromo, vehicleInspection: settings.vehicleInspection, system: settings.system } }) });
    await refreshUser();
    setMessage("Settings updated.");
  }
  return (
    <div className="settings-grid-page">
      <section className="panel form-panel"><h2>Profile</h2><form className="form-grid" onSubmit={saveProfile}>
        {["fullName", "email", "phone", "streetAddress", "city", "state", "zip"].map((key) => <Field key={key} label={key.replace(/([A-Z])/g, " $1")} value={profile[key] || ""} onChange={(v) => setProfile((f) => ({ ...f, [key]: v }))} />)}
        <Field label="Current password" type="password" value={profile.currentPassword || ""} onChange={(v) => setProfile((f) => ({ ...f, currentPassword: v }))} />
        <Field label="New password" type="password" value={profile.newPassword || ""} onChange={(v) => setProfile((f) => ({ ...f, newPassword: v }))} />
        <button className="primary-btn">Save profile</button>
      </form></section>
      <section className="panel form-panel"><h2>Preferences</h2><form className="form-grid" onSubmit={saveSettings}>
        <Field label="Giving goal %" type="number" step="0.1" value={settings.givingGoalPercent || ""} onChange={(v) => setSettings((f) => ({ ...f, givingGoalPercent: v }))} />
        <Field label="Theme" value={settings.themePreference || "system"} onChange={(v) => setSettings((f) => ({ ...f, themePreference: v }))} options={[{ value: "system", label: "System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} />
        <Check label="Credit card promo alerts" checked={settings.creditCardPromo} onChange={(v) => setSettings((f) => ({ ...f, creditCardPromo: v }))} />
        <Check label="Vehicle inspection alerts" checked={settings.vehicleInspection} onChange={(v) => setSettings((f) => ({ ...f, vehicleInspection: v }))} />
        <Check label="System notifications" checked={settings.system} onChange={(v) => setSettings((f) => ({ ...f, system: v }))} />
        <button className="primary-btn">Save settings</button>
      </form></section>
      {message && <p className="form-message">{message}</p>}
    </div>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="check-row"><input type="checkbox" checked={Boolean(checked)} onChange={(e) => onChange(e.target.checked)} /><span>{label}</span></label>;
}

function NotificationsPage() {
  const { refreshUser } = useAuth();
  const [rows, setRows] = useState<AnyRow[]>([]);
  const load = useCallback(async () => setRows(await api("/api/notifications")), []);
  useEffect(() => { load(); }, [load]);
  async function mark(id: number, status: string) {
    await api("/api/notifications/mark", { method: "POST", body: JSON.stringify({ id, status }) });
    await refreshUser();
    await load();
  }
  return <section className="panel table-panel"><h2>Notifications</h2><DataTable rows={rows} columns={[
    { key: "created_at", label: "Created", render: (r) => new Date(r.created_at).toLocaleString() },
    { key: "title", label: "Title" },
    { key: "message", label: "Message" },
    { key: "status", label: "Status" },
  ]} actions={(row) => <div className="row-actions"><button className="ghost-btn" onClick={() => mark(row.id, "read")}>Read</button><button className="ghost-btn" onClick={() => mark(row.id, "unread")}>Unread</button><Actions onDelete={async () => { await api(`/api/notifications/${row.id}`, { method: "DELETE" }); await refreshUser(); await load(); }} /></div>} /></section>;
}

function AdminUsers() {
  const [rows, setRows] = useState<AnyRow[]>([]);
  const [form, setForm] = useState<AnyRow>({ fullName: "", username: "", email: "", password: "", role: "user" });
  const load = useCallback(async () => setRows(await api("/api/admin/users")), []);
  useEffect(() => { load(); }, [load]);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    await api("/api/admin/users", { method: "POST", body: JSON.stringify(form) });
    setForm({ fullName: "", username: "", email: "", password: "", role: "user" });
    await load();
  }
  return <div className="workspace-grid"><section className="panel form-panel"><h2>Create User</h2><form className="form-grid" onSubmit={save}>
    <Field label="Full name" value={form.fullName} onChange={(v) => setForm((f) => ({ ...f, fullName: v }))} required />
    <Field label="Username" value={form.username} onChange={(v) => setForm((f) => ({ ...f, username: v }))} required />
    <Field label="Email" type="email" value={form.email} onChange={(v) => setForm((f) => ({ ...f, email: v }))} />
    <Field label="Password" type="password" value={form.password} onChange={(v) => setForm((f) => ({ ...f, password: v }))} required />
    <Field label="Role" value={form.role} onChange={(v) => setForm((f) => ({ ...f, role: v }))} options={[{ value: "user", label: "User" }, { value: "admin", label: "Admin" }]} />
    <button className="primary-btn">Create user</button>
  </form></section><section className="panel table-panel"><h2>Users</h2><DataTable rows={rows} columns={[
    { key: "fullName", label: "Name" }, { key: "username", label: "Username" }, { key: "email", label: "Email" }, { key: "role", label: "Role" }, { key: "isVerified", label: "Verified", render: (r) => r.isVerified ? "Yes" : "No" }, { key: "dbUsageHuman", label: "Storage" },
  ]} actions={(row) => <Actions onDelete={async () => { await api(`/api/admin/users/${row.id}`, { method: "DELETE" }); await load(); }} />} /></section></div>;
}

function AdminSettings({ kind }: { kind: "email" }) {
  const [form, setForm] = useState<AnyRow>({});
  const endpoint = kind === "email" ? "/api/admin/smtp-settings" : "";
  useEffect(() => { api(endpoint).then(setForm).catch(() => undefined); }, [endpoint]);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    await api(endpoint, { method: "POST", body: JSON.stringify(form) });
  }
  return <section className="panel form-panel"><h2>SMTP Settings</h2><form className="form-grid" onSubmit={save}>{["host", "port", "username", "password", "fromEmail", "fromName"].map((key) => <Field key={key} label={key} value={form[key] || ""} onChange={(v) => setForm((f) => ({ ...f, [key]: v }))} />)}<button className="primary-btn">Save settings</button></form></section>;
}

function AdminBackups() {
  const [rows, setRows] = useState<AnyRow[]>([]);
  const load = useCallback(async () => setRows(await api("/api/admin/backups")), []);
  useEffect(() => { load(); }, [load]);
  return <section className="panel table-panel"><div className="panel-heading"><h2>Backups</h2><button className="primary-btn" onClick={async () => { await api("/api/admin/backups/run", { method: "POST", body: JSON.stringify({}) }); await load(); }}>Run backup</button></div><DataTable rows={rows} columns={[{ key: "name", label: "Name" }, { key: "sizeHuman", label: "Size" }, { key: "createdAt", label: "Created", render: (r) => new Date(r.createdAt).toLocaleString() }, { key: "download", label: "Download", render: (r) => <a href={`/api/admin/backups/download?name=${encodeURIComponent(r.name)}`}>Download</a> }]} actions={(row) => <Actions onDelete={async () => { await api(`/api/admin/backups/${encodeURIComponent(row.name)}`, { method: "DELETE" }); await load(); }} />} /></section>;
}

function AdminUpdates() {
  const [message, setMessage] = useState("");
  return <section className="panel slim-panel"><h2>Updates</h2><div className="button-row"><button className="primary-btn" onClick={async () => setMessage(JSON.stringify(await api("/api/admin/updates/check"), null, 2))}>Check updates</button><button className="ghost-btn" onClick={async () => setMessage(JSON.stringify(await api("/api/admin/updates/apply", { method: "POST", body: JSON.stringify({ confirm: true }) }), null, 2))}>Apply update</button><button className="ghost-btn" onClick={async () => setMessage(JSON.stringify(await api("/api/admin/restart-service", { method: "POST", body: JSON.stringify({}) }), null, 2))}>Restart service</button></div>{message && <pre className="code-output">{message}</pre>}</section>;
}

function AdminBroadcasts() {
  const [rows, setRows] = useState<AnyRow[]>([]);
  const [form, setForm] = useState<AnyRow>({ title: "", message: "" });
  const load = useCallback(async () => setRows(await api("/api/admin/notifications-broadcasts")), []);
  useEffect(() => { load(); }, [load]);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    await api("/api/admin/notifications-broadcasts", { method: "POST", body: JSON.stringify(form) });
    setForm({ title: "", message: "" });
    await load();
  }
  return <div className="workspace-grid"><section className="panel form-panel"><h2>Send Broadcast</h2><form className="form-grid" onSubmit={save}><Field label="Title" value={form.title} onChange={(v) => setForm((f) => ({ ...f, title: v }))} required /><Field label="Message" type="textarea" value={form.message} onChange={(v) => setForm((f) => ({ ...f, message: v }))} required /><button className="primary-btn">Send</button></form></section><section className="panel table-panel"><h2>History</h2><DataTable rows={rows} columns={[{ key: "created_at", label: "Created", render: (r) => new Date(r.created_at).toLocaleString() }, { key: "title", label: "Title" }, { key: "message", label: "Message" }, { key: "sender_username", label: "Sender" }]} /></section></div>;
}

function SandyDeerHarvest() {
  return <PhotoCrud endpoint="/api/sandy/deer-harvest" title="Harvest Entry" fields={[{ name: "year", from: "harvest_year", label: "Year", type: "number", required: true }, { name: "hunter", from: "hunter_name", label: "Hunter", required: true }, { name: "deerType", from: "deer_type", label: "Buck or Doe", options: [{ value: "Buck", label: "Buck" }, { value: "Doe", label: "Doe" }] }, { name: "notes", label: "Notes", type: "textarea" }]} columns={[{ key: "harvest_year", label: "Year" }, { key: "hunter_name", label: "Hunter" }, { key: "deer_type", label: "Type" }, { key: "notes", label: "Notes" }]} />;
}

function SandyFoodPlots() {
  return <PhotoCrud endpoint="/api/sandy/food-plots" title="Food Plot Entry" fields={[{ name: "date", from: "activity_date", label: "Date", type: "date", required: true }, { name: "plotName", from: "plot_name", label: "Food plot", required: true }, { name: "activity", from: "activity_details", label: "What we did", type: "textarea", required: true }]} columns={[{ key: "activity_date", label: "Date" }, { key: "plot_name", label: "Plot" }, { key: "activity_details", label: "Activity" }]} />;
}

function PhotoCrud({ endpoint, title, fields, columns }: { endpoint: string; title: string; fields: FieldConfig[]; columns: { key: string; label: string }[] }) {
  const config: CrudConfig = {
    title,
    endpoint,
    fields: [...fields, { name: "photo", label: "Photo", type: "file" }, { name: "clearPhoto", label: "Clear existing photo", type: "checkbox" }],
    columns: [...columns, { key: "photo_data", label: "Photo", render: (r) => r.photo_data ? <a href={r.photo_data} target="_blank" rel="noreferrer"><img className="thumb-image" src={r.photo_data} alt="" /></a> : "—" }],
    transformPayload: async (form, id) => {
      const file = form.photo instanceof File ? form.photo : null;
      return { id, ...Object.fromEntries(fields.map((field) => [field.name, castValue(form[field.name], field.type)])), photoData: file ? await fileToDataUrl(file) : null, clearPhoto: Boolean(form.clearPhoto) };
    },
  };
  return <CrudPage config={config} />;
}

function SandyExpenses() {
  return <CrudPage config={{
    title: "Sandy Expense",
    endpoint: "/api/sandy/expenses",
    fields: [{ name: "date", from: "expense_date", label: "Date", type: "date", required: true }, { name: "amount", label: "Amount", type: "number", step: "0.01", required: true }, { name: "description", label: "Description", required: true }],
    columns: [{ key: "expense_date", label: "Date" }, { key: "amount", label: "Amount", render: (r) => money(r.amount) }, { key: "description", label: "Description" }],
    total: { label: "Expenses", value: (r) => Number(r.amount || 0) },
  }} />;
}

function App() {
  const { user, loading } = useAuth();
  if (loading) return <div className="loading-screen">Loading NetWorth OS...</div>;
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/dashboard" replace /> : <AuthScreen />} />
      <Route path="/reset-password" element={<AuthScreen reset />} />
      <Route path="/*" element={<RequireAuth><AppShell /></RequireAuth>} />
    </Routes>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
