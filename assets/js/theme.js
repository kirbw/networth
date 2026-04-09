const STORAGE_KEY = "networth.theme";
const VALID_THEMES = new Set(["system", "light", "dark"]);

function normalizeThemePreference(value, fallback = "system") {
  const candidate = String(value || "").trim().toLowerCase();
  return VALID_THEMES.has(candidate) ? candidate : fallback;
}

function getSystemTheme() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function resolveThemePreference(user) {
  const explicit = normalizeThemePreference(user?.themePreference, "");
  if (explicit) return explicit;
  if (typeof user?.darkMode === "boolean") return user.darkMode ? "dark" : "light";
  return normalizeThemePreference(localStorage.getItem(STORAGE_KEY), "system");
}

export function applyThemePreference(themePreference) {
  const preference = normalizeThemePreference(themePreference, "system");
  const resolved = preference === "system" ? getSystemTheme() : preference;
  document.documentElement.dataset.theme = preference;
  document.documentElement.dataset.resolvedTheme = resolved;
  document.documentElement.style.colorScheme = resolved;
  if (document.body) {
    document.body.classList.toggle("dark-mode", resolved === "dark");
    document.body.dataset.themePreference = preference;
    document.body.dataset.resolvedTheme = resolved;
  }
  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // Ignore storage failures in restricted contexts.
  }
  window.dispatchEvent(new CustomEvent("networth:themechange", {
    detail: { preference, resolved },
  }));
  return { preference, resolved };
}

export function syncThemePreference(user) {
  return applyThemePreference(resolveThemePreference(user));
}

const media = window.matchMedia("(prefers-color-scheme: dark)");
media.addEventListener("change", () => {
  const current = normalizeThemePreference(document.documentElement.dataset.theme, "system");
  if (current === "system") applyThemePreference("system");
});

try {
  applyThemePreference(normalizeThemePreference(localStorage.getItem(STORAGE_KEY), "system"));
} catch {
  applyThemePreference("system");
}
