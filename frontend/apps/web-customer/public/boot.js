// Runs before the app boots (classic, render-blocking script in <head>, like the inline script it replaces).
// For a ticket URL /{22-char token}: preloads the ticket data in parallel with the JS chunk (TR-FE-10) and adds the
// per-ticket manifest link. An external same-origin file because the production CSP is script-src 'self' (L-20);
// never relax that with 'unsafe-inline'.
(function () {
  var m = location.pathname.match(/^\/([0-9A-Za-z]{22})$/);
  if (!m) return;
  var l = document.createElement('link');
  l.rel = 'preload'; l.as = 'fetch'; l.crossOrigin = 'use-credentials';
  l.href = '/api/public/v1/tickets/' + m[1];
  document.head.appendChild(l);
  var man = document.createElement('link');
  man.rel = 'manifest'; man.href = '/m/' + m[1] + '.webmanifest';
  document.head.appendChild(man);
})();
