(function () {
  var MODAL_ID = 'navAlertModal';
  var PANEL_ID = 'navAlertPanel';
  var BUTTON_ID = 'navAlertBtn';
  var COUNT_ID = 'navAlertCount';
  var LIST_ID = 'navAlertList';
  var SEEN_KEY_PREFIX = 'intellistock_seen_alerts_v1_';
  var REFRESH_MS = 15000;
  var iconBell = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>';
  var refreshTimer = null;
  var refreshDebounceTimer = null;
  var currentFingerprint = '';

  function getUserRef() {
    try {
      var user = window.AuthService && window.AuthService.getCurrentUser ? window.AuthService.getCurrentUser() : null;
      return String(user && (user.id || user.email || user.nome) || 'anon').toLowerCase();
    } catch (_) {
      return 'anon';
    }
  }

  function getSeenFingerprint() {
    try {
      return localStorage.getItem(SEEN_KEY_PREFIX + getUserRef()) || '';
    } catch (_) {
      return '';
    }
  }

  function saveSeenFingerprint(fingerprint) {
    try {
      localStorage.setItem(SEEN_KEY_PREFIX + getUserRef(), fingerprint || '');
    } catch (_) {
      // noop
    }
  }

  function getAuthHeadersSafe() {
    try {
      return window.AuthService && window.AuthService.getAuthHeaders ? window.AuthService.getAuthHeaders() : {};
    } catch (_) {
      return {};
    }
  }

  function getModeSafe() {
    try {
      return window.AuthService && window.AuthService.getMode ? window.AuthService.getMode() : 'api';
    } catch (_) {
      return 'api';
    }
  }

  function esc(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function limitText(text, maxLen) {
    var raw = String(text || '').trim();
    if (!maxLen || raw.length <= maxLen) return raw;
    return raw.slice(0, Math.max(0, maxLen - 3)).trimEnd() + '...';
  }

  function toNumber(value) {
    var num = Number(value || 0);
    return Number.isFinite(num) ? num : 0;
  }

  function isCriticalStock(atual, minimo) {
    return atual <= 0 || (minimo > 0 && atual <= minimo);
  }

  function hasSalesVelocity(item) {
    return toNumber(item && item.consumoMedio7Dias, 0) > 0 ||
      toNumber(item && item.consumoMedio30Dias, 0) > 0 ||
      toNumber(item && item.consumoMedioDiario, 0) > 0;
  }

  function isSellOutPriority(item) {
    return isCriticalStock(item.quantidadeAtual, item.quantidadeMinima) && hasSalesVelocity(item);
  }

  function mapAlertItem(item) {
    var atual = toNumber(item && (item.quantidade_atual != null ? item.quantidade_atual : item.qtd_atual));
    var minimo = toNumber(item && (item.quantidade_minima != null ? item.quantidade_minima : item.ponto_pedido));
    var deficit = Math.max(0, minimo - atual);
    var semEstoque = atual <= 0;
    var rec = (item && item.recomendacao_compra) || {};
    var consumoMedioDiario = toNumber(rec.consumoMedioDiario, 0);
    var consumoMedio7Dias = toNumber(rec.consumoMedio7Dias, 0);
    var consumoMedio30Dias = toNumber(rec.consumoMedio30Dias, 0);
    var quando = rec.quandoComprar || (semEstoque ? 'Comprar imediatamente' : 'Comprar em ate 48h');
    var texto = rec.resumoRecomendacao || (semEstoque
      ? 'Item sem estoque. Reposicao urgente para evitar perda de venda.'
      : 'Item abaixo do minimo. Programe reposicao para evitar ruptura.');
    var nivel = semEstoque ? 'crit' : 'warn';
    var status = semEstoque ? 'Sem estoque' : 'Abaixo do minimo';

    return {
      id: String((item && item.id) || (item && item.nome) || Math.random()),
      nome: String((item && item.nome) || 'Item sem nome'),
      deficit: deficit,
      quantidadeAtual: atual,
      quantidadeMinima: minimo,
      consumoMedioDiario: consumoMedioDiario,
      consumoMedio7Dias: consumoMedio7Dias,
      consumoMedio30Dias: consumoMedio30Dias,
      quandoComprar: String(quando),
      resumo: String(texto),
      status: status,
      nivel: nivel
    };
  }

  function uniqById(items) {
    var map = new Map();
    (items || []).forEach(function (item) {
      map.set(String(item.id), item);
    });
    return Array.from(map.values());
  }

  async function loadFromApi() {
    var headers = getAuthHeadersSafe();
    var lowRes = await fetch('/api/materiais/estoque/baixo', { headers: headers });
    if (!lowRes.ok) throw new Error('http_low_' + lowRes.status);

    var lowPayload = await lowRes.json();
    if (!lowPayload || lowPayload.success === false) throw new Error('api_low_error');

    var lowList = Array.isArray(lowPayload.data) ? lowPayload.data : [];

    return uniqById(lowList)
      .map(mapAlertItem)
      .filter(function (item) { return isCriticalStock(item.quantidadeAtual, item.quantidadeMinima); });
  }

  function loadFromMockStorage() {
    var raw = null;
    try {
      raw = JSON.parse(localStorage.getItem('intellistock_mock_materiais_v1') || '[]');
    } catch (_) {
      raw = [];
    }

    if (!Array.isArray(raw)) return [];
    return raw
      .map(mapAlertItem)
      .filter(function (item) { return isCriticalStock(item.quantidadeAtual, item.quantidadeMinima); });
  }

  async function loadAlerts() {
    var mode = getModeSafe();
    if (mode !== 'api') return loadFromMockStorage();

    return loadFromApi();
  }

  function buildFingerprint(items) {
    return items
      .map(function (item) {
        return [item.id, item.nome, item.deficit, item.quandoComprar].join(':');
        
      })
      .join('|');
  }

  function updateBadge(unreadCount) {
    var badge = document.getElementById(COUNT_ID);
    if (!badge) return;

    if (unreadCount > 0) {
      badge.classList.remove('is-hidden');
      badge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
    } else {
      badge.classList.add('is-hidden');
      badge.textContent = '0';
    }
  }

  function scheduleRefresh(delayMs) {
    var delay = Number(delayMs || 0);
    if (refreshDebounceTimer) {
      clearTimeout(refreshDebounceTimer);
    }
    refreshDebounceTimer = setTimeout(function () {
      refreshNotifications();
    }, Math.max(0, delay));
  }

  function renderList(items) {
    var list = document.getElementById(LIST_ID);
    if (!list) return;

    if (!items.length) {
      list.innerHTML = '<div class="nav-alert-empty">Nenhum item com giro de venda está sem estoque ou abaixo do mínimo.</div>';
      return;
    }

    list.innerHTML = items.map(function (item) {
      var klass = item.nivel === 'crit' ? '' : (item.nivel === 'warn' ? ' is-warn' : ' is-info');
      var nomeCurto = limitText(item.nome, 70);
      var sugestaoCurta = limitText(item.quandoComprar, 42);
      var resumoCurto = limitText(item.resumo, 180);
      return '' +
        '<article class="nav-alert-item' + klass + '">' +
          '<div class="nav-alert-item-title" title="' + esc(item.nome) + '">' + esc(nomeCurto) + '</div>' +
          '<div class="nav-alert-item-meta">Status: ' + esc(item.status) + ' | Atual: ' + esc(item.quantidadeAtual) + ' | Minimo: ' + esc(item.quantidadeMinima) + ' | Sugestao: ' + esc(sugestaoCurta) + '</div>' +
          '<div class="nav-alert-item-text" title="' + esc(item.resumo) + '">' + esc(resumoCurto) + '</div>' +
        '</article>';
    }).join('');
  }

  async function refreshNotifications() {
    try {
      var items = await loadAlerts();
      var prioritized = items.filter(isSellOutPriority);
      var listToRender = prioritized.length ? prioritized : items;

      listToRender.sort(function (a, b) {
        var scoreA = (a.quantidadeAtual <= 0 ? 100000 : 0) + (toNumber(a.deficit, 0) * 100) + (toNumber(a.consumoMedio7Dias, 0) * 10);
        var scoreB = (b.quantidadeAtual <= 0 ? 100000 : 0) + (toNumber(b.deficit, 0) * 100) + (toNumber(b.consumoMedio7Dias, 0) * 10);
        return scoreB - scoreA;
      });

      currentFingerprint = buildFingerprint(listToRender);
      renderList(listToRender);

      var seen = getSeenFingerprint();
      var unread = currentFingerprint && currentFingerprint !== seen ? listToRender.length : 0;
      updateBadge(unread);
    } catch (error) {
      var list = document.getElementById(LIST_ID);
      if (list) {
        list.innerHTML = '<div class="nav-alert-empty">Não foi possível carregar os avisos agora. Clique em Atualizar.</div>';
      }
      updateBadge(0);
      console.warn('Falha ao carregar avisos do sininho:', error && error.message ? error.message : error);
    }
  }

  function closePanel() {
    var modal = document.getElementById(MODAL_ID);
    var btn = document.getElementById(BUTTON_ID);
    if (!modal || !btn) return;
    modal.classList.add('is-hidden');
    btn.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('nav-alert-open');
  }

  function openPanel() {
    var modal = document.getElementById(MODAL_ID);
    var btn = document.getElementById(BUTTON_ID);
    if (!modal || !btn) return;

    modal.classList.remove('is-hidden');
    btn.setAttribute('aria-expanded', 'true');
    document.body.classList.add('nav-alert-open');
    saveSeenFingerprint(currentFingerprint);
    updateBadge(0);
  }

  function positionBellByViewport() {
    var btn = document.getElementById(BUTTON_ID);
    if (!btn) return;

    var wrap = btn.closest('.nav-alert-wrap');
    if (!wrap) return;

    var header = document.querySelector('header');
    if (!header) return;

    var nav = header.querySelector('nav');
    var fornecedoresLink = nav ? nav.querySelector('a[href="/fornecedores.html"]') : null;
    var userArea = header.querySelector('.user-area');
    var logoutBtn = userArea ? userArea.querySelector('#btnLogout') : null;
    var isMobile = window.matchMedia('(max-width: 768px)').matches;

    if (isMobile && userArea && logoutBtn) {
      if (wrap.parentElement !== userArea || wrap.nextElementSibling !== logoutBtn) {
        userArea.insertBefore(wrap, logoutBtn);
      }
      return;
    }

    if (!isMobile && fornecedoresLink && nav) {
      if (wrap.parentElement !== nav || wrap.previousElementSibling !== fornecedoresLink) {
        fornecedoresLink.insertAdjacentElement('afterend', wrap);
      }
    }
  }

  function mountBell() {
    var nav = document.querySelector('header nav');
    if (!nav) return false;

    var fornecedoresLink = nav.querySelector('a[href="/fornecedores.html"]');
    if (!fornecedoresLink) return false;
    if (document.getElementById(BUTTON_ID)) return true;

    var wrap = document.createElement('div');
    wrap.className = 'nav-alert-wrap';

    var button = document.createElement('button');
    button.type = 'button';
    button.id = BUTTON_ID;
    button.className = 'nav-alert-btn';
    button.setAttribute('aria-label', 'Abrir avisos de estoque');
    button.setAttribute('aria-expanded', 'false');
    button.innerHTML = iconBell + '<span class="nav-alert-label">Avisos</span><span id="' + COUNT_ID + '" class="nav-alert-count is-hidden">0</span>';

    wrap.appendChild(button);
    fornecedoresLink.insertAdjacentElement('afterend', wrap);

    positionBellByViewport();

    var modal = document.getElementById(MODAL_ID);
    if (!modal) {
      modal = document.createElement('div');
      modal.id = MODAL_ID;
      modal.className = 'nav-alert-modal-overlay is-hidden';
      modal.innerHTML = '' +
        '<div class="nav-alert-panel" role="dialog" aria-modal="true" aria-labelledby="navAlertTitle">' +
          '<div class="nav-alert-head">' +
            '<div><strong id="navAlertTitle">Avisos de estoque</strong><div class="nav-alert-sub">Itens que vendem e estão sem estoque ou abaixo do mínimo</div></div>' +
            '<div class="nav-alert-head-actions">' +
              '<button type="button" class="nav-alert-refresh" id="navAlertRefreshBtn">Atualizar</button>' +
              '<button type="button" class="nav-alert-close" id="navAlertCloseBtn" aria-label="Fechar avisos">✕</button>' +
            '</div>' +
          '</div>' +
          '<div id="' + LIST_ID + '" class="nav-alert-list"><div class="nav-alert-empty">Carregando...</div></div>' +
        '</div>';
      document.body.appendChild(modal);
    }

    button.addEventListener('click', function (event) {
      event.stopPropagation();
      if (modal.classList.contains('is-hidden')) openPanel();
      else closePanel();
    });

    modal.addEventListener('click', function (event) {
      if (event.target === modal) closePanel();
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closePanel();
    });

    var refreshBtn = document.getElementById('navAlertRefreshBtn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', function () {
        refreshNotifications();
      });
    }

    var closeBtn = document.getElementById('navAlertCloseBtn');
    if (closeBtn) {
      closeBtn.addEventListener('click', closePanel);
    }

    return true;
  }

  function installAutoSyncHooks() {
    if (window.__intellistockBellAutoSyncInstalled) return;
    window.__intellistockBellAutoSyncInstalled = true;

    var originalFetch = window.fetch && window.fetch.bind(window);
    if (typeof originalFetch === 'function') {
      window.fetch = function (input, init) {
        var url = '';
        try {
          url = typeof input === 'string' ? input : String((input && input.url) || '');
        } catch (_) {
          url = '';
        }

        var method = String((init && init.method) || 'GET').toUpperCase();
        var isMateriaisEndpoint = /\/api\/materiais(\/|$)/.test(url);
        var isMutation = isMateriaisEndpoint && method !== 'GET';

        return originalFetch(input, init).then(function (response) {
          if (response && response.ok && isMutation) {
            // Atualiza pouco depois da mutação para refletir mudança no estoque quase em tempo real.
            scheduleRefresh(400);
          }
          return response;
        });
      };
    }

    window.addEventListener('focus', function () {
      scheduleRefresh(150);
    });

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') {
        scheduleRefresh(150);
      }
    });

    window.addEventListener('pageshow', function () {
      scheduleRefresh(150);
    });
  }

  function init() {
    if (!mountBell()) return;

    installAutoSyncHooks();
    positionBellByViewport();

    window.addEventListener('resize', function () {
      positionBellByViewport();
    });

    refreshNotifications();

    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(refreshNotifications, REFRESH_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
