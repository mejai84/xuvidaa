(function () {
  'use strict';

  var gate = document.getElementById('access-gate');
  var form = document.getElementById('access-form');
  var input = document.getElementById('access-password');
  var button = document.getElementById('access-submit');
  var message = document.getElementById('access-message');
  var app = document.getElementById('app');
  var started = false;

  function setMessage(value) {
    message.textContent = value || '';
  }

  function loadScript(path) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = path;
      script.onload = resolve;
      script.onerror = function () { reject(new Error('No se pudo cargar la aplicación.')); };
      document.head.appendChild(script);
    });
  }

  function enter() {
    if (started) return;
    started = true;
    gate.hidden = true;
    app.hidden = false;
    loadScript('/config/api.js')
      .then(function () { return loadScript('/js/app.js'); })
      .catch(function () {
        started = false;
        app.hidden = true;
        gate.hidden = false;
        setMessage('No se pudo iniciar la aplicación. Recarga la página e inténtalo de nuevo.');
      });
  }

  function checkSession() {
    fetch('/api/session', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (response) {
        if (!response.ok) throw new Error('session');
        return response.json();
      })
      .then(function (data) {
        if (data && data.authenticated) enter();
        else input.focus();
      })
      .catch(function () {
        setMessage('No se pudo conectar con el servidor. Inténtalo de nuevo.');
      });
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (button.disabled) return;
    button.disabled = true;
    setMessage('Verificando…');
    fetch('/api/login', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: input.value })
    })
      .then(function (response) {
        if (!response.ok) throw new Error(response.status === 401 ? 'Clave incorrecta.' : 'No se pudo iniciar sesión.');
        return response.json();
      })
      .then(function (data) {
        if (!data || !data.authenticated) throw new Error('No se pudo iniciar sesión.');
        input.value = '';
        enter();
      })
      .catch(function (error) {
        setMessage(error.message || 'No se pudo iniciar sesión.');
      })
      .then(function () { button.disabled = false; });
  });

  checkSession();
})();
