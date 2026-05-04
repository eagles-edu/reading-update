(function () {
  "use strict";

  const storageKey = "theme";
  const cookieMaxAgeSeconds = 60 * 60 * 24 * 365 * 2;
  const root = document.documentElement;
  const themeToggles = [];

  const isTheme = (value) => value === "light" || value === "dark";

  const getCookieValue = (name) => {
    const prefix = `${name}=`;
    const entry = document.cookie
      .split("; ")
      .find((part) => part.startsWith(prefix));
    return entry ? decodeURIComponent(entry.slice(prefix.length)) : "";
  };

  const setCookieValue = (name, value, maxAgeSeconds) => {
    document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax`;
  };

  const clearCookieValue = (name) => {
    document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
  };

  const readStorageTheme = () => {
    const cookieTheme = getCookieValue(storageKey);
    if (isTheme(cookieTheme)) {
      return cookieTheme;
    }

    try {
      const savedTheme = localStorage.getItem(storageKey);
      if (isTheme(savedTheme)) {
        return savedTheme;
      }
    } catch {
      // Ignore storage failures.
    }

    return "";
  };

  const syncThemeToggles = (theme) => {
    const darkMode = theme === "dark";
    for (const toggle of themeToggles) {
      if (!toggle) continue;
      toggle.setAttribute("aria-pressed", String(darkMode));
      toggle.setAttribute(
        "aria-label",
        darkMode ? "Switch to light theme" : "Switch to dark theme",
      );

      const icon = toggle.querySelector("[data-theme-toggle-icon]");
      if (icon) {
        icon.setAttribute("data-theme-icon", darkMode ? "sun" : "moon");
      }
    }
  };

  const applyTheme = (theme, persist = true) => {
    const nextTheme = theme === "dark" ? "dark" : "light";

    root.dataset.theme = nextTheme;
    root.style.colorScheme = nextTheme;
    syncThemeToggles(nextTheme);

    if (!persist) {
      return nextTheme;
    }

    try {
      localStorage.setItem(storageKey, nextTheme);
    } catch {
      // Ignore storage failures.
    }

    setCookieValue(storageKey, nextTheme, cookieMaxAgeSeconds);
    return nextTheme;
  };

  const resolveTheme = () => {
    const storedTheme = readStorageTheme();
    if (storedTheme) {
      return storedTheme;
    }

    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    return prefersDark ? "dark" : "light";
  };

  const bindToggle = (toggle) => {
    if (!toggle || toggle.__themeToggleBound) {
      return;
    }

    toggle.__themeToggleBound = true;
    themeToggles.push(toggle);
    syncThemeToggles(root.dataset.theme === "dark" ? "dark" : "light");
  };

  const bindToggles = () => {
    const toggles = document.querySelectorAll("[data-theme-toggle]");
    for (const toggle of toggles) {
      bindToggle(toggle);
    }
    syncThemeToggles(root.dataset.theme === "dark" ? "dark" : "light");
  };

  const bridgeThemeStorage = () => {
    try {
      const storage = window.localStorage;
      if (!storage || storage.__themeBridgePatched) {
        return;
      }

      const originalSetItem = storage.setItem.bind(storage);
      const originalRemoveItem = storage.removeItem.bind(storage);
      const originalClear = storage.clear.bind(storage);

      storage.setItem = function (key, value) {
        const result = originalSetItem(key, value);
        if (key === storageKey && isTheme(String(value))) {
          setCookieValue(storageKey, String(value), cookieMaxAgeSeconds);
          applyTheme(String(value), false);
        }
        return result;
      };

      storage.removeItem = function (key) {
        const result = originalRemoveItem(key);
        if (key === storageKey) {
          clearCookieValue(storageKey);
        }
        return result;
      };

      storage.clear = function () {
        const result = originalClear();
        clearCookieValue(storageKey);
        return result;
      };

      storage.__themeBridgePatched = true;
    } catch {
      // Best effort only.
    }
  };

  const init = () => {
    const theme = resolveTheme();
    applyTheme(theme, true);
    bridgeThemeStorage();
    bindToggles();
  };

  try {
    init();
  } catch {
    root.dataset.theme = "light";
    root.style.colorScheme = "light";
  }

  window.addEventListener("storage", (event) => {
    if (event.storageArea !== window.localStorage || event.key !== storageKey) {
      return;
    }

    if (isTheme(event.newValue)) {
      applyTheme(event.newValue, false);
      return;
    }

    applyTheme(resolveTheme(), false);
  });

  window.ThemeSelector = {
    applyTheme,
    bindToggles,
    getTheme() {
      return root.dataset.theme === "dark" ? "dark" : "light";
    },
    setTheme(theme) {
      return applyTheme(theme, true);
    },
  };
})();
