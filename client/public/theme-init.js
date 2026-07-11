// Runs before React mounts so there's no flash of the wrong theme. Kept as an
// external file (not an inline <script>) so it isn't blocked by the app's CSP
// (script-src 'self', no 'unsafe-inline' — see server/index.js).
(function () {
  try {
    var t = localStorage.getItem('havoro-theme') || 'system';
    var isDark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', isDark);
  } catch (e) {}
})();
