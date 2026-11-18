(function () {
  'use strict';
  var app = document.getElementById('shell');
  document.addEventListener('keydown', function (event) {
    if (app && !app.hidden &&
        ((event.keyCode || event.which) === 405 || (event.altKey && event.keyCode === 80))) {
      event.preventDefault();
      event.stopImmediatePropagation();
      window.location.assign('/xuper/');
    }
  }, true);
})();
