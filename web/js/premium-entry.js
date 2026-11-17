(function () {
  'use strict';
  var app = document.getElementById('shell');
  var observer;
  function resumePremium() {
    var next = /(?:^|[?&])next=([^&]*)/.exec(window.location.search);
    if (next && (next[1] === '/xuper/' || next[1] === '%2Fxuper%2F') && app && !app.hidden) {
      if (observer) observer.disconnect();
      window.location.replace('/xuper/');
    }
  }
  if (app && window.MutationObserver) {
    observer = new MutationObserver(resumePremium);
    observer.observe(app, { attributes: true, attributeFilter: ['hidden'] });
  }
  resumePremium();
  document.addEventListener('keydown', function (event) {
    if (app && !app.hidden &&
        ((event.keyCode || event.which) === 405 || (event.altKey && event.keyCode === 80))) {
      event.preventDefault();
      event.stopImmediatePropagation();
      window.location.assign('/xuper/');
    }
  }, true);
})();
