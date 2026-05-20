  // Função global para atualizar UI de assinatura (usada em todas as páginas)
  function setSubscriptionUi(payload) {
    const usuario = getCurrentUser();
    const cliente = payload?.cliente || {};
    const assinatura = payload?.assinatura || null;

    // Nome completo
    const nome = cliente.nome || usuario?.nome || '-';
    const cpf = cliente.cpf_mask || (cliente.cpf_cnpj ? formatCpf(cliente.cpf_cnpj) : '-');
    if (document.getElementById('subscriptionFullName'))
      document.getElementById('subscriptionFullName').textContent = nome;
    if (document.getElementById('subscriptionCpf'))
      document.getElementById('subscriptionCpf').textContent = cpf;

    // Plano, status, cartão, dias
    if (!assinatura) {
      if (document.getElementById('subscriptionPlan'))
        document.getElementById('subscriptionPlan').textContent = 'Sem assinatura ativa';
      if (document.getElementById('subscriptionStatus')) {
        document.getElementById('subscriptionStatus').textContent = 'Sem assinatura';
        document.getElementById('subscriptionStatus').classList.remove('is-active');
      }
      if (document.getElementById('subscriptionCardMask'))
        document.getElementById('subscriptionCardMask').textContent = 'Será informado no checkout';
      if (document.getElementById('subscriptionDays'))
        document.getElementById('subscriptionDays').textContent = '0 dias';
      return;
    }

    const planoLabel = assinatura.plano ? `Plano ${assinatura.plano}` : 'Plano não definido';
    const statusLabel = {
      ativa: 'Ativa', expirada: 'Expirada', cancelada: 'Cancelada', pendente: 'Pendente', suspensa: 'Suspensa'
    }[assinatura.status] || 'Sem assinatura';
    const dias = Number(assinatura.dias_restantes || 0);
    const mascaraCartao = assinatura.cartao?.mascarado || 'Será informado no checkout';
    const bandeira = assinatura.cartao?.bandeira ? `${assinatura.cartao.bandeira.toUpperCase()} ` : '';

    if (document.getElementById('subscriptionPlan'))
      document.getElementById('subscriptionPlan').textContent = planoLabel;
    if (document.getElementById('subscriptionStatus')) {
      document.getElementById('subscriptionStatus').textContent = statusLabel;
      document.getElementById('subscriptionStatus').classList.toggle('is-active', assinatura.status === 'ativa');
    }
    if (document.getElementById('subscriptionCardMask'))
      document.getElementById('subscriptionCardMask').textContent = `${bandeira}${mascaraCartao}`.trim();
    if (document.getElementById('subscriptionDays'))
      document.getElementById('subscriptionDays').textContent = `${dias} dia${dias === 1 ? '' : 's'}`;

    if (assinatura.plano && document.getElementById('renewPlan')) {
      const selectPlan = document.getElementById('renewPlan');
      const available = Array.from(selectPlan.options).map((opt) => opt.value);
      if (available.includes(assinatura.plano)) {
        selectPlan.value = assinatura.plano;
      }
    }
  }

  // Função auxiliar para formatar CPF/CNPJ
  function formatCpf(value) {
    const digits = String(value || '').replace(/\D/g, '');
    if (digits.length === 11) {
      return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    }
    if (digits.length === 14) {
      return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
    }
    return value || '-';
  }
(function () {
  const MODE_KEY = 'auth_mode';
  const DEFAULT_MODE = 'api';
  const MOCK_USERS_KEY = 'mock_auth_users_v1';
  const USER_KEY = 'is_usuario';
  const TOKEN_KEY = 'is_session_token';
  const TWO_FA_KEY = 'is_2fa_session';
  const REMEMBER_KEY = 'is_remember_me';

  const defaultMockUsers = [
    {
      id: 1,
      nome: 'Usuário Demo',
      email: 'demo@intellistock.com',
      senha: '123456'
    }
  ];

  function safeParse(raw) {
    try {
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  function isRememberEnabled() {
    return localStorage.getItem(REMEMBER_KEY) === '1';
  }

  function setRememberEnabled(enabled) {
    localStorage.setItem(REMEMBER_KEY, enabled ? '1' : '0');
  }

  function getCurrentUser() {
    const sessionUser = safeParse(sessionStorage.getItem(USER_KEY) || 'null');
    if (sessionUser) return sessionUser;
    return safeParse(localStorage.getItem(USER_KEY) || 'null');
  }

  function getSessionToken() {
    const sessionToken = sessionStorage.getItem(TOKEN_KEY);
    if (sessionToken) return sessionToken;
    return localStorage.getItem(TOKEN_KEY);
  }

  function get2FASession() {
    const session2fa = safeParse(sessionStorage.getItem(TWO_FA_KEY) || 'null');
    if (session2fa) return session2fa;
    return safeParse(localStorage.getItem(TWO_FA_KEY) || 'null');
  }

  function hydrateAuthState() {
    if (!isRememberEnabled()) return;

    const persistedUser = localStorage.getItem(USER_KEY);
    const persistedToken = localStorage.getItem(TOKEN_KEY);
    const persisted2fa = localStorage.getItem(TWO_FA_KEY);

    if (!sessionStorage.getItem(USER_KEY) && persistedUser) {
      sessionStorage.setItem(USER_KEY, persistedUser);
    }

    if (!sessionStorage.getItem(TOKEN_KEY) && persistedToken) {
      sessionStorage.setItem(TOKEN_KEY, persistedToken);
    }

    if (!sessionStorage.getItem(TWO_FA_KEY) && persisted2fa) {
      sessionStorage.setItem(TWO_FA_KEY, persisted2fa);
    }
  }

  function clear2FASession() {
    sessionStorage.removeItem(TWO_FA_KEY);
    localStorage.removeItem(TWO_FA_KEY);
  }

  function save2FASession(sessionData, remember) {
    const safeSession = {
      ...sessionData,
      remember: remember === true
    };

    sessionStorage.setItem(TWO_FA_KEY, JSON.stringify(safeSession));
    setRememberEnabled(remember === true);

    if (remember === true) {
      localStorage.setItem(TWO_FA_KEY, JSON.stringify(safeSession));
    } else {
      localStorage.removeItem(TWO_FA_KEY);
    }
  }

  function saveAuthSession(usuario, sessionToken, remember) {
    sessionStorage.setItem(USER_KEY, JSON.stringify(usuario));
    if (sessionToken) {
      sessionStorage.setItem(TOKEN_KEY, sessionToken);
    } else {
      sessionStorage.removeItem(TOKEN_KEY);
    }

    setRememberEnabled(remember === true);

    if (remember === true) {
      localStorage.setItem(USER_KEY, JSON.stringify(usuario));
      if (sessionToken) {
        localStorage.setItem(TOKEN_KEY, sessionToken);
      } else {
        localStorage.removeItem(TOKEN_KEY);
      }
    } else {
      localStorage.removeItem(USER_KEY);
      localStorage.removeItem(TOKEN_KEY);
    }

    clear2FASession();
  }

  function updateStoredUserName(nome) {
    const currentUser = getCurrentUser();
    if (!currentUser) return null;

    const updatedUser = { ...currentUser, nome };
    sessionStorage.setItem(USER_KEY, JSON.stringify(updatedUser));
    if (localStorage.getItem(USER_KEY)) {
      localStorage.setItem(USER_KEY, JSON.stringify(updatedUser));
    }

    return updatedUser;
  }

  function clearAuthState() {
    sessionStorage.removeItem(USER_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TWO_FA_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TWO_FA_KEY);
    localStorage.removeItem(REMEMBER_KEY);
  }

  function hasActiveSession() {
    const currentUser = getCurrentUser();
    if (!currentUser) return false;

    // Em modo API exigimos token ativo; em mock basta o usuário.
    if (getMode() === 'api') {
      return Boolean(getSessionToken());
    }

    return true;
  }

  function redirectToLogin(loginPath = '/login.html') {
    try {
      window.location.replace(loginPath);
    } catch (_) {
      window.location.href = loginPath;
    }
  }

  function enforceProtectedPage(loginPath = '/login.html') {
    const validateSession = () => {
      hydrateAuthState();
      if (!hasActiveSession()) {
        redirectToLogin(loginPath);
      }
    };

    validateSession();

    // bfcache/back-forward: ao voltar para a aba, valida novamente a sessão.
    window.addEventListener('pageshow', () => {
      validateSession();
    });

    // Troca de aba/janela também revalida quando voltar ao foco.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        validateSession();
      }
    });
  }

  async function logoutAndRedirect(loginPath = '/login.html') {
    const token = getSessionToken();
    if (token && getMode() === 'api') {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` }
        });
      } catch (_) {
        // Mesmo com falha de rede, limpar sessão local para impedir retorno.
      }
    }

    clearAuthState();
    redirectToLogin(loginPath);
  }

  function getMode() {
    const saved = localStorage.getItem(MODE_KEY);
    if (saved === 'mock') {
      return 'mock';
    }

    if (saved === 'api') {
      // Recuperacao automatica para ambiente local:
      // se o modo estiver salvo como API, mas nao houver token ativo e houver usuario local,
      // troca para mock para evitar loop de redirecionamento para o login.
      const hasUser = Boolean(getCurrentUser());
      const hasToken = Boolean(getSessionToken());
      if (hasUser && !hasToken) {
        localStorage.setItem(MODE_KEY, 'mock');
        return 'mock';
      }
      return 'api';
    }

    // Compatibilidade: sessões antigas/locales podem ter usuário salvo sem token.
    // Nesse caso, assume mock para não forçar redirecionamento indevido ao login.
    const hasUser = Boolean(getCurrentUser());
    const hasToken = Boolean(getSessionToken());

    if (hasUser && !hasToken) {
      return 'mock';
    }

    if (hasToken) {
      return 'api';
    }

    return DEFAULT_MODE;
  }

  function setMode(mode) {
    const safeMode = mode === 'api' ? 'api' : 'mock';
    localStorage.setItem(MODE_KEY, safeMode);
  }

  function makeToken() {
    return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
  }

  function makeCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
  }

  async function apiLogin(payload) {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    return data;
  }

  async function apiVerify(payload) {
    const response = await fetch('/api/auth/verificar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    return data;
  }

  async function apiReenviarCodigo(payload) {
    const response = await fetch('/api/auth/reenviar-codigo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    return data;
  }

  async function apiRegister(payload) {
    const response = await fetch('/api/auth/cadastro', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    return data;
  }

  async function apiSolicitarReset(payload) {
    const response = await fetch('/api/auth/solicitar-reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return response.json();
  }

  async function apiRedefinirSenha(payload) {
    const response = await fetch('/api/auth/redefinir-senha', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return response.json();
  }

  function readMockUsers() {
    try {
      const saved = JSON.parse(localStorage.getItem(MOCK_USERS_KEY) || 'null');
      if (Array.isArray(saved) && saved.length) {
        return saved;
      }
    } catch (_) {}

    return defaultMockUsers.map((user) => ({ ...user }));
  }

  function writeMockUsers(users) {
    localStorage.setItem(MOCK_USERS_KEY, JSON.stringify(users));
  }

  function nextMockUserId(users) {
    return users.reduce((maxId, user) => Math.max(maxId, Number(user.id) || 0), 0) + 1;
  }

  function createMockChallenge(usuario) {
    const tokenTemp = makeToken();
    const codigo = makeCode();
    const expiraEm = Date.now() + 10 * 60 * 1000;

    sessionStorage.setItem('mock_2fa_pending', JSON.stringify({
      token_temp: tokenTemp,
      codigo,
      expiraEm,
      usuario: {
        id: usuario.id,
        nome: usuario.nome,
        email: usuario.email
      }
    }));

    return {
      success: true,
      token_temp: tokenTemp,
      nome: usuario.nome,
      email_enviado: false,
      codigo_demo: codigo
    };
  }

  async function mockLogin(payload) {
    const email = String(payload.email || '').trim().toLowerCase();
    const senha = String(payload.senha || '');

    if (!email || !senha) {
      return { success: false, message: 'E-mail e senha são obrigatórios.' };
    }

    const users = readMockUsers();
    const usuario = users.find((user) => user.email === email);

    if (!usuario || usuario.senha !== senha) {
      return { success: false, message: 'Credenciais inválidas (mock).' };
    }

    return createMockChallenge(usuario);
  }

  async function mockRegister(payload) {
    const nome = String(payload.nome || '').trim();
    const email = String(payload.email || '').trim().toLowerCase();
    const senha = String(payload.senha || '');

    if (nome.length < 3) {
      return { success: false, message: 'Informe um nome com pelo menos 3 caracteres.' };
    }

    if (!/\S+@\S+\.\S+/.test(email)) {
      return { success: false, message: 'Informe um e-mail válido.' };
    }

    if (senha.length < 6) {
      return { success: false, message: 'A senha precisa ter pelo menos 6 caracteres.' };
    }

    const users = readMockUsers();
    if (users.some((user) => user.email === email)) {
      return { success: false, message: 'Já existe uma conta cadastrada com este e-mail.' };
    }

    const usuario = {
      id: nextMockUserId(users),
      nome,
      email,
      senha
    };

    users.push(usuario);
    writeMockUsers(users);

    return {
      success: true,
      message: 'Cadastro realizado com sucesso. Faça login com seu e-mail e senha.'
    };
  }

  async function mockVerify(payload) {
    const tokenTemp = String(payload.token_temp || '');
    const codigo = String(payload.codigo || '').trim();

    const pendingRaw = sessionStorage.getItem('mock_2fa_pending');
    if (!pendingRaw) {
      return { success: false, message: 'Sessão inválida. Faça login novamente.' };
    }

    const pending = JSON.parse(pendingRaw);

    if (pending.token_temp !== tokenTemp) {
      return { success: false, message: 'Token inválido. Faça login novamente.' };
    }

    if (Date.now() > pending.expiraEm) {
      return { success: false, message: 'Código expirado. Faça login novamente.' };
    }

    if (pending.codigo !== codigo) {
      return { success: false, message: 'Código incorreto.' };
    }

    sessionStorage.removeItem('mock_2fa_pending');
    return { success: true, usuario: pending.usuario };
  }

  async function mockReenviarCodigo(payload) {
    const tokenTemp = String(payload?.token_temp || '').trim();
    const pendingRaw = sessionStorage.getItem('mock_2fa_pending');

    if (!pendingRaw) {
      return { success: false, message: 'Sessão inválida. Faça login novamente.' };
    }

    const pending = JSON.parse(pendingRaw);
    if (!tokenTemp || pending.token_temp !== tokenTemp) {
      return { success: false, message: 'Sessão inválida. Faça login novamente.' };
    }

    const novoToken = makeToken();
    const novoCodigo = makeCode();
    const novoExpiraEm = Date.now() + 10 * 60 * 1000;

    const nextPending = {
      ...pending,
      token_temp: novoToken,
      codigo: novoCodigo,
      expiraEm: novoExpiraEm
    };

    sessionStorage.setItem('mock_2fa_pending', JSON.stringify(nextPending));

    return {
      success: true,
      token_temp: novoToken,
      nome: nextPending.usuario?.nome || pending.usuario?.nome,
      email_enviado: false,
      codigo_demo: novoCodigo
    };
  }

  async function mockSolicitarReset(payload) {
    const email = String(payload.email || '').trim().toLowerCase();
    if (!/\S+@\S+\.\S+/.test(email)) {
      return { success: false, message: 'Informe um e-mail válido.' };
    }
    const token = makeToken();
    sessionStorage.setItem('mock_reset_token', token);
    
    // Simulate email send
    console.log(`[MOCK EMAIL] Acesse para resetar a senha: http://localhost:3001/redefinir-senha.html?token=${token}`);
    
    return { success: true, message: 'Se este e-mail for válido, você receberá as instruções. (MOCK: Veja o console)' };
  }

  async function mockRedefinirSenha(payload) {
    const token = String(payload.token || '').trim();
    const senha = String(payload.senha || '');

    if (!token) return { success: false, message: 'Token inválido.' };
    if (senha.length < 6) return { success: false, message: 'A nova senha precisa ter pelo menos 6 caracteres.' };

    const expectedToken = sessionStorage.getItem('mock_reset_token');
    if (!expectedToken || token !== expectedToken) {
      return { success: false, message: 'Link inválido ou já utilizado.' };
    }

    sessionStorage.removeItem('mock_reset_token');
    return { success: true, message: 'Senha redefinida com sucesso. Faça login com sua nova senha. (Modo MOCK não salva permanentemente, mas simula sucesso)' };
  }

  async function login(payload) {
    return getMode() === 'api' ? apiLogin(payload) : mockLogin(payload);
  }

  async function register(payload) {
    return getMode() === 'api' ? apiRegister(payload) : mockRegister(payload);
  }

  async function verify(payload) {
    return getMode() === 'api' ? apiVerify(payload) : mockVerify(payload);
  }

  async function reenviarCodigo(payload) {
    return getMode() === 'api' ? apiReenviarCodigo(payload) : mockReenviarCodigo(payload);
  }

  async function solicitarReset(payload) {
    return getMode() === 'api' ? apiSolicitarReset(payload) : mockSolicitarReset(payload);
  }

  async function redefinirSenha(payload) {
    return getMode() === 'api' ? apiRedefinirSenha(payload) : mockRedefinirSenha(payload);
  }

  async function updateCurrentUserName(nome) {
    const nomeNormalizado = String(nome || '').trim().replace(/\s+/g, ' ');
    if (nomeNormalizado.length < 2) {
      throw new Error('Informe um nome válido.');
    }
    if (nomeNormalizado.length > 120) {
      throw new Error('O nome deve ter no máximo 120 caracteres.');
    }

    if (getMode() !== 'api') {
      updateStoredUserName(nomeNormalizado);
      return { success: true, usuario: getCurrentUser() };
    }

    const token = getSessionToken();
    if (!token) {
      throw new Error('Sessão expirada. Faça login novamente.');
    }

    const response = await fetch('/api/auth/perfil', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ nome: nomeNormalizado })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) {
      throw new Error(data.message || 'Não foi possível atualizar o nome.');
    }

    updateStoredUserName(data.usuario?.nome || nomeNormalizado);
    return data;
  }

  function setupEditNameButton() {
    function openEditNameModal() {
      const currentUser = getCurrentUser();
      const nomeAtual = currentUser?.nome || '';
      const modal = document.getElementById('editNameModal');
      const input = document.getElementById('editNameInput');

      if (!modal || !input) return;

      input.value = nomeAtual;
      modal.classList.remove('is-hidden');
      input.focus();
    }

    function closeEditNameModal() {
      const modal = document.getElementById('editNameModal');
      if (modal) {
        modal.classList.add('is-hidden');
      }
    }

    async function saveEditName() {
      const input = document.getElementById('editNameInput');
      const btn = document.getElementById('btnSaveEditName');

      if (!input || !btn) return;

      const novoNome = String(input.value || '').trim();
      if (!novoNome) {
        window.alert('Informe um nome válido.');
        return;
      }

      const previousText = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Salvando...';

      try {
        await updateCurrentUserName(novoNome);
        closeEditNameModal();
        // Atualiza o nome do usuário no topo, se existir
        const userNameEl = document.getElementById('userName');
        if (userNameEl) {
          userNameEl.textContent = novoNome;
        }
        // Atualiza o avatar, se existir
        const avatarEl = document.getElementById('avatarInitial');
        if (avatarEl) {
          const ini = novoNome.split(' ').map(w => w[0]).slice(0,2).join('').toUpperCase();
          avatarEl.textContent = ini;
        }
        // Atualiza objeto _usuario em memória, se existir
        if (typeof _usuario !== 'undefined' && _usuario) {
          _usuario.nome = novoNome;
        }
        // Atualiza o card de assinatura se função global existir
        if (typeof window.setSubscriptionUi === 'function') {
          window.setSubscriptionUi({ cliente: { nome: novoNome }, assinatura: null });
        } else {
          // fallback: atualiza diretamente o campo
          const fullNameEl = document.getElementById('subscriptionFullName');
          if (fullNameEl) {
            fullNameEl.textContent = novoNome;
          }
        }
        // Não faz reload!
      } catch (error) {
        window.alert(error.message || 'Não foi possível atualizar o nome.');
      } finally {
        btn.disabled = false;
        btn.textContent = previousText;
      }
    }

    // Abrir modal ao clicar na caneta
    const editButtons = document.querySelectorAll('#btnEditDisplayName');
    editButtons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openEditNameModal();
      });
    });

    // Fechar modal ao clicar no botão fechar
    const closeButton = document.querySelector('#editNameModal .modal-close');
    if (closeButton) {
      closeButton.addEventListener('click', () => {
        closeEditNameModal();
      });
    }

    // Fechar modal ao clicar no botão cancelar
    const cancelButton = document.getElementById('btnCancelEditName');
    if (cancelButton) {
      cancelButton.addEventListener('click', () => {
        closeEditNameModal();
      });
    }

    // Salvar ao clicar no botão salvar
    const saveButton = document.getElementById('btnSaveEditName');
    if (saveButton) {
      saveButton.addEventListener('click', saveEditName);
    }

    // Fechar modal ao clicar fora dele
    const modal = document.getElementById('editNameModal');
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          closeEditNameModal();
        }
      });
    }

    // Salvar ao pressionar Enter
    const input = document.getElementById('editNameInput');
    if (input) {
      input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          saveEditName();
        }
      });
    }
  }

  function initAuthService() {
    hydrateAuthState();
    setupEditNameButton();

    const protectedPaths = new Set([
      '/dashboard.html',
      '/insumos.html',
      '/fornecedores.html',
      '/relatorios.html',
      '/historico.html'
    ]);

    if (protectedPaths.has(window.location.pathname)) {
      enforceProtectedPage('/login.html');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAuthService);
  } else {
    initAuthService();
  }

  hydrateAuthState();

  function getAuthHeaders() {
    const token = getSessionToken();
    if (getMode() === 'api' && token) {
      return { Authorization: `Bearer ${token}` };
    }
    return {};
  }

  window.setSubscriptionUi = setSubscriptionUi;
  window.AuthService = {
    getMode,
    setMode,
    login,
    register,
    verify,
    reenviarCodigo,
    solicitarReset,
    redefinirSenha,
    updateCurrentUserName,
    isRememberEnabled,
    getCurrentUser,
    getSessionToken,
    get2FASession,
    save2FASession,
    clear2FASession,
    saveAuthSession,
    clearAuthState,
    hasActiveSession,
    enforceProtectedPage,
    logoutAndRedirect,
    hydrateAuthState,
    setupEditNameButton,
    getAuthHeaders
  };
})();
