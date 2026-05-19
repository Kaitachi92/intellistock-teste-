(function () {
  'use strict';

  var ALLOWED_TYPES = ['success', 'error', 'warning', 'info'];

  function ensureToastWrap() {
    var wrap = document.getElementById('toastWrap');
    if (wrap) return wrap;

    wrap = document.createElement('div');
    wrap.id = 'toastWrap';
    wrap.className = 'toast-wrap';
    document.body.appendChild(wrap);
    return wrap;
  }

  function showToast(msg, type) {
    var safeType = ALLOWED_TYPES.includes(type) ? type : 'success';
    var el = document.createElement('div');
    el.className = 'toast ' + safeType;
    el.textContent = String(msg || '');
    ensureToastWrap().appendChild(el);
    setTimeout(function () {
      el.remove();
    }, 5000);
  }

  window.showToast = showToast;
})();
