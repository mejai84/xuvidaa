(function () {
  'use strict';

  var gate = document.getElementById('access-gate');
  var form = document.getElementById('access-form');
  var input = document.getElementById('access-password');
  var button = document.getElementById('access-submit');
  var message = document.getElementById('access-message');
  var app = document.getElementById('app');
  var started = false;

  function say(text) { message.textContent = text || ''; }

  function loadScript(src, integrity) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = src;
      if (integrity) {
        script.integrity = integrity;
        script.crossOrigin = 'anonymous';
      }
      script.onload = resolve;
      script.onerror = function () { reject(new Error('No se pudo cargar un recurso de la aplicación.')); };
      document.head.appendChild(script);
    });
  }

  function startApp() {
    if (started) return;
    started = true;
    gate.hidden = true;
    app.hidden = false;
    loadScript('/config/api.js')
      .then(function () {
        return loadScript('https://cdn.jsdelivr.net/npm/hls.js@1.6.13/dist/hls.min.js',
          'sha384-z+tuLqMWl1/cPv7O+39RO0EURSNvorimpcCaMgeNwU+qFBx+AlUIl7jaAwg0cYil')
          .catch(function () { return null; });
      })
      .then(function () { return loadScript('/js/app.js'); })
      .catch(function () {
        started = false;
        app.hidden = true;
        gate.hidden = false;
        say('No se pudo iniciar la aplicación. Recarga la página e inténtalo de nuevo.');
      });
  }

  fetch('/api/session', { credentials: 'same-origin', cache: 'no-store' })
    .then(function (response) {
      if (!response.ok) throw new Error('session');
      return response.json();
    })
    .then(function (result) {
      if (result && result.authenticated) startApp();
      else input.focus();
    })
    .catch(function () { say('No se pudo conectar con el servidor. Inténtalo de nuevo.'); });

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (button.disabled) return;
    button.disabled = true;
    say('Verificando…');
    fetch('/api/login', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: input.value })
    })
      .then(function (response) {
        if (!response.ok) throw new Error(response.status === 401 ? 'La clave no es correcta.' :
          (response.status === 429 ? 'Demasiados intentos. Espera unos minutos.' : 'No se pudo iniciar sesión.'));
        return response.json();
      })
      .then(function (result) {
        if (!result || !result.authenticated) throw new Error('No se pudo iniciar sesión.');
        input.value = '';
        startApp();
      })
      .catch(function (error) { say(error.message || 'No se pudo iniciar sesión.'); })
      .then(function () { button.disabled = false; });
  });
})();
