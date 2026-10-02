// Applies the theme before the app renders: the user's saved choice
// (localStorage "theme", set from the user menu), else the system setting.
(function () {
  var theme;
  try {
    theme = localStorage.getItem('theme');
  } catch (e) {}
  if (theme !== 'light' && theme !== 'dark') {
    theme =
      window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
  }
  // The payment portal pages are always light.
  if (window.location.pathname.indexOf('/payment') === 0) theme = 'light';
  var dark = theme === 'dark';
  document.documentElement.classList.toggle('bp4-dark', dark);
  document.body.classList.toggle('bp4-dark', dark);
})();
