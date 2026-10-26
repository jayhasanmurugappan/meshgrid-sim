// Entry gate: Cloudflare Turnstile + access code. The simulator (app.js) is only
// requested after the gate opens. This is a deterrent, not real security: real
// scraping protection comes from the Cloudflare proxy, WAF and bot rules (see CLOUDFLARE.md).
(function () {
  'use strict';
  if (window.top !== window.self) { try { window.top.location = window.self.location; } catch (e) { document.documentElement.remove(); } return; }

  var CFG = window.MESHGRID_CONFIG;
  var $ = function (id) { return document.getElementById(id); };
  var cfOK = false, cfState = 'loading';

  function setStatus(txt, cls) { var s = $('cf-status'); s.textContent = txt; s.className = 'status ' + (cls || ''); }

  function sha256(text) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    });
  }

  function openApp() {
    try { sessionStorage.setItem('mg_ok', '1'); } catch (e) {}
    $('gate').hidden = true; $('app').hidden = false;
    var s = document.createElement('script'); s.src = 'app.js'; document.body.appendChild(s);
  }

  function loadTurnstile() {
    var timer = setTimeout(function () {
      if (cfState === 'loading') {
        cfState = 'offline';
        setStatus(CFG.ALLOW_OFFLINE_CODE ? 'Cloudflare check unavailable (offline). Access code only.' : 'Cloudflare check could not load. Try again online.', 'warn');
      }
    }, 5000);
    window.__mgTurnstileReady = function () {
      clearTimeout(timer);
      try {
        window.turnstile.render('#cf-widget', {
          sitekey: CFG.TURNSTILE_SITEKEY,
          callback: function () { cfOK = true; cfState = 'ok'; setStatus('Cloudflare check: passed.', 'ok'); },
          'error-callback': function () { cfOK = false; cfState = 'error'; setStatus('Cloudflare check failed. Reload and try again.', 'err'); },
          'expired-callback': function () { cfOK = false; setStatus('Check expired. Please repeat.', 'warn'); }
        });
        setStatus('Cloudflare check: please confirm above.', '');
      } catch (e) { cfState = 'error'; setStatus('Cloudflare check error.', 'err'); }
    };
    var s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__mgTurnstileReady';
    s.async = true; s.onerror = function () { clearTimeout(timer); cfState = 'offline'; setStatus(CFG.ALLOW_OFFLINE_CODE ? 'Cloudflare check unavailable (offline). Access code only.' : 'Cloudflare check could not load.', 'warn'); };
    document.head.appendChild(s);
  }

  $('gate-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var msg = $('gate-msg'); msg.hidden = true;
    var needCF = !(cfState === 'offline' && CFG.ALLOW_OFFLINE_CODE);
    if (needCF && !cfOK) { msg.textContent = 'Please complete the Cloudflare check first.'; msg.hidden = false; return; }
    if (!window.crypto || !crypto.subtle) { msg.textContent = 'This browser cannot verify the code. Use Chrome or Edge over https.'; msg.hidden = false; return; }
    sha256('i4o-alliance|' + $('code').value.trim().toUpperCase()).then(function (h) {
      if (h === CFG.ACCESS_HASH) openApp();
      else { msg.textContent = 'That access code is not valid.'; msg.hidden = false; $('code').value = ''; }
    });
  });

  var kept = false; try { kept = sessionStorage.getItem('mg_ok') === '1'; } catch (e) {}
  if (kept) openApp(); else loadTurnstile();
})();
