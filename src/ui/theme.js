// Appearance: a light or dark page, and how large the text is.
//
// Both are preferences (`prefs.theme`, `prefs.textSize`) and both are set as
// attributes on <html>, which styles.css keys its light tokens and root font
// size on. The first paint cannot wait for a module, so index.html carries a
// copy of `applyAppearance` as an inline script that runs before the page
// draws; without it a light-theme player would see the dark page flash first.
// tests/theme.test.js runs that copy against this one for every setting.

export const THEMES = ['system', 'dark', 'light'];
export const THEME_LABELS = { system: 'System', dark: 'Dark', light: 'Light' };
export const TEXT_SIZES = ['m', 'l', 'xl'];
export const TEXT_LABELS = { m: 'Default', l: 'Large', xl: 'Larger' };
// The browser's bar and the phone's status bar, matched to each page's --bg.
// A meta tag cannot read a CSS variable, so the test holds these to styles.css.
export const BAR_COLOURS = { dark: '#0f1a12', light: '#f1f4f1' };

const LIGHT_QUERY = '(prefers-color-scheme: light)';

/** The theme a page should wear: the player's choice, or the system's when left to it. */
export function resolveTheme(pref, systemLight) {
  if (pref === 'light' || pref === 'dark') return pref;
  return systemLight ? 'light' : 'dark';
}

function systemLight(win) {
  return !!(win && typeof win.matchMedia === 'function' && win.matchMedia(LIGHT_QUERY).matches);
}

/** Put the preferences on the page. Returns the theme it chose. */
export function applyAppearance(prefs = {}, doc = document, win = typeof window !== 'undefined' ? window : null) {
  const theme = resolveTheme(prefs.theme, systemLight(win));
  const root = doc.documentElement;
  root.setAttribute('data-theme', theme);
  if (prefs.textSize === 'l' || prefs.textSize === 'xl') root.setAttribute('data-text', prefs.textSize);
  else root.removeAttribute('data-text');
  const bar = doc.querySelector('meta[name="theme-color"]');
  if (bar) bar.setAttribute('content', BAR_COLOURS[theme]);
  return theme;
}

/**
 * A page left to the system turns when the system does: a phone set to switch
 * at sunset switches the game with it, without a reload.
 */
export function followSystem(getPrefs, win = typeof window !== 'undefined' ? window : null) {
  if (!win || typeof win.matchMedia !== 'function') return;
  const query = win.matchMedia(LIGHT_QUERY);
  const again = () => applyAppearance(getPrefs() || {}, win.document, win);
  if (typeof query.addEventListener === 'function') query.addEventListener('change', again);
  else if (typeof query.addListener === 'function') query.addListener(again);
}
