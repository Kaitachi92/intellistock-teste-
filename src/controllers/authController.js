// src/controllers/authController.js
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { enviarCodigoVerificacao, enviarLinkResetSenha } = require('../services/emailService');
const { reconciliarUsuarioPorPagamento } = require('./assinaturasController');

async function criarDesafioVerificacao(db, usuario) {
  const codigo = String(Math.floor(100000 + Math.random() * 900000));
  const tokenTemp = crypto.randomBytes(32).toString('hex');
  const expiraEm = new Date(Date.now() + 10 * 60 * 1000);
  const mailRequired = String(process.env.MAIL_ENABLED || '').trim().toLowerCase() === 'true';

  await db.query('DELETE FROM codigos_verificacao WHERE usuario_id = ?', [usuario.id]);
  await db.query(
    'INSERT INTO codigos_verificacao (usuario_id, token_temp, codigo, expira_em) VALUES (?, ?, ?, ?)',
    [usuario.id, tokenTemp, codigo, expiraEm]
  );

  const envioEmail = await enviarCodigoVerificacao({
    para: usuario.email,
    nome: usuario.nome,
    codigo
  });

  const resposta = {
    success: true,
    token_temp: tokenTemp,
    nome: usuario.nome,
    email_enviado: envioEmail.sent
  };

  if (mailRequired && !envioEmail.sent) {
    return {
      success: false,
      message: 'Não foi possível enviar o código de verificação por e-mail. Tente novamente em instantes.'
    };
  }

  if (!envioEmail.sent && process.env.NODE_ENV !== 'production') {
    resposta.codigo_demo = codigo;
  }

  return resposta;
}

function emailValido(email) {
  return /\S+@\S+\.\S+/.test(String(email || '').trim());
}

function listarEmailsBypass() {
  const bruto = String(
    process.env.DEV_ACCESS_EMAILS ||
    process.env.FREE_ACCESS_EMAILS ||
    ''
  );

  if (!bruto.trim()) return [];

  return [...new Set(
    bruto
      .split(/[;,\s]+/)
      .map((item) => String(item || '').trim().toLowerCase())
      .filter((item) => /\S+@\S+\.\S+/.test(item))
  )];
}

function emailTemBypass(email) {
  const normalizado = String(email || '').trim().toLowerCase();
  if (!normalizado) return false;
  return listarEmailsBypass().includes(normalizado);
}

async function obterStatusAcessoUsuario(db, usuarioId) {
  const [rows] = await db.query(
    `SELECT
       u.id,
       u.email,
       u.ativo,
       u.is_admin,
       (SELECT COUNT(*)
        FROM assinaturas a
        WHERE a.usuario_id = u.id
          AND a.status = 'ativa'
          AND a.data_expiracao > NOW()) AS assinatura_ativa
     FROM usuarios u
     WHERE u.id = ?
     LIMIT 1`,
    [usuarioId]
  );

  return rows[0] || null;
}

function isPublicHttpUrl(url) {
  return /^https?:\/\//i.test(String(url || '')) && !/localhost|127\.0\.0\.1/i.test(String(url || ''));
}

function normalizePublicOrigin(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || '').trim());
    const protocol = parsed.protocol.toLowerCase();
    const hostname = parsed.hostname.toLowerCase();

    if (!['http:', 'https:'].includes(protocol)) return '';
    if (hostname === 'localhost' || hostname === '127.0.0.1') return '';

    return `${protocol}//${parsed.host}`;
  } catch (_) {
    return '';
  }
}

function getAppBaseUrl(req) {
  const appUrl = String(process.env.APP_URL || '').trim().replace(/\/$/, '');
  if (isPublicHttpUrl(appUrl)) {
    return appUrl;
  }

  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const host = forwardedHost || String(req.get('host') || '').trim();
  const protocol = forwardedProto || req.protocol || 'http';
  const requestUrl = host ? `${protocol}://${host}`.replace(/\/$/, '') : '';

  // Alguns proxies não repassam host/proto corretamente; usa Origin/Referer como fallback.
  const originHeader = normalizePublicOrigin(req.headers.origin);
  const refererHeader = normalizePublicOrigin(req.headers.referer);

  if (isPublicHttpUrl(requestUrl)) {
    return requestUrl;
  }

  if (originHeader) {
    return originHeader;
  }

  if (refererHeader) {
    return refererHeader;
  }

  return `http://localhost:${process.env.PORT || 3001}`;
}

class AuthController {
  static async login(req, res) {
    const db = global.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        message: 'Estamos tendo problemas técnicos. Contate o suporte.'
      });
    }

    const { email, senha } = req.body;
    if (!email || !senha) {
      return res.status(400).json({ success: false, message: 'E-mail e senha são obrigatórios.' });
    }

    try {
      const [rows] = await db.query(
        'SELECT id, nome, email, senha_hash, ativo FROM usuarios WHERE email = ? LIMIT 1',
        [email.trim().toLowerCase()]
      );

      if (rows.length === 0) {
        return res.status(401).json({ success: false, message: 'E-mail ou senha incorretos.' });
      }

      const usuario = rows[0];
      const senhaValida = await bcrypt.compare(senha, usuario.senha_hash);
      if (!senhaValida) {
        return res.status(401).json({ success: false, message: 'E-mail ou senha incorretos.' });
      }

      let statusAcesso = await obterStatusAcessoUsuario(db, usuario.id);
      if (!statusAcesso) {
        return res.status(401).json({ success: false, message: 'Usuário não encontrado.' });
      }

      if (!Number(statusAcesso.ativo)) {
        try {
          const reconciliacao = await reconciliarUsuarioPorPagamento(db, usuario.id);
          if (reconciliacao.success && reconciliacao.approved) {
            statusAcesso = await obterStatusAcessoUsuario(db, usuario.id);
          }
        } catch (reconciliacaoError) {
          console.error('Erro ao reconciliar pagamento no login:', reconciliacaoError.message);
        }
      }

      if (!Number(statusAcesso?.ativo)) {
        return res.status(403).json({
          success: false,
          message: 'Sua conta ainda está aguardando confirmação do pagamento. Se você já pagou, tente entrar novamente em alguns instantes.'
        });
      }

      const bypassAtivo = emailTemBypass(statusAcesso.email);
      const exigeAssinatura = !Number(statusAcesso.is_admin) && !bypassAtivo;

      if (exigeAssinatura && Number(statusAcesso.assinatura_ativa) <= 0) {
        try {
          await reconciliarUsuarioPorPagamento(db, usuario.id);
          statusAcesso = await obterStatusAcessoUsuario(db, usuario.id);
        } catch (reconciliacaoError) {
          console.error('Erro ao reconciliar assinatura no login:', reconciliacaoError.message);
        }
      }

      const possuiAssinaturaAtiva = Number(statusAcesso?.assinatura_ativa) > 0;
      const acessoCompleto = !exigeAssinatura || possuiAssinaturaAtiva;

      const desafio = await criarDesafioVerificacao(db, usuario);
      if (!desafio.success) {
        return res.status(502).json(desafio);
      }

      desafio.subscription_required = !acessoCompleto;
      desafio.redirect_after_login = acessoCompleto ? '/dashboard.html' : '/assinatura.html';

      return res.json(desafio);

    } catch (err) {
      console.error('Erro no login:', err);
      return res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
    }
  }

  static async cadastrar(req, res) {
    return res.status(403).json({
      success: false,
      message: 'Para criar uma conta, escolha primeiro um plano de assinatura.',
      redirect: '/produtos.html'
    });
  }

  static async verificar(req, res) {
    const db = global.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        message: 'Banco de dados não configurado.'
      });
    }

    const { token_temp, codigo } = req.body;
    if (!token_temp || !codigo) {
      return res.status(400).json({ success: false, message: 'Token e código são obrigatórios.' });
    }

    try {
      const [rows] = await db.query(
        `SELECT cv.id, cv.codigo, cv.expira_em, cv.usado,
                u.id AS usuario_id, u.nome, u.email
         FROM codigos_verificacao cv
         JOIN usuarios u ON cv.usuario_id = u.id
         WHERE cv.token_temp = ?`,
        [token_temp]
      );

      if (rows.length === 0) {
        return res.status(401).json({ success: false, message: 'Sessão inválida. Faça o login novamente.' });
      }

      const reg = rows[0];

      if (reg.usado) {
        return res.status(401).json({ success: false, message: 'Código já utilizado.' });
      }

      if (new Date() > new Date(reg.expira_em)) {
        return res.status(401).json({ success: false, message: 'Código expirado. Faça o login novamente.' });
      }

      if (reg.codigo !== String(codigo).trim()) {
        return res.status(401).json({ success: false, message: 'Código incorreto.' });
      }

      // Marcar código como usado (uso único)
      await db.query('UPDATE codigos_verificacao SET usado = 1 WHERE id = ?', [reg.id]);

      // Criar token de sessao duradouro (8 horas)
      const sessionToken = crypto.randomBytes(32).toString('hex');
      const sessionExpira = new Date(Date.now() + 8 * 60 * 60 * 1000);
      await db.query(
        'INSERT INTO sessoes_ativas (usuario_id, token, expira_em) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE token = VALUES(token), expira_em = VALUES(expira_em)',
        [reg.usuario_id, sessionToken, sessionExpira]
      );

      return res.json({
        success: true,
        session_token: sessionToken,
        usuario: { id: reg.usuario_id, nome: reg.nome, email: reg.email }
      });

    } catch (err) {
      console.error('Erro na verificação 2FA:', err);
      return res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
    }
  }

  static async reenviarCodigo(req, res) {
    const db = global.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        message: 'Banco de dados não configurado.'
      });
    }

    const { token_temp } = req.body || {};
    if (!token_temp) {
      return res.status(400).json({ success: false, message: 'Sessão inválida. Faça login novamente.' });
    }

    try {
      const [rows] = await db.query(
        `SELECT cv.usado, u.id, u.nome, u.email, u.ativo
         FROM codigos_verificacao cv
         JOIN usuarios u ON cv.usuario_id = u.id
         WHERE cv.token_temp = ?
         LIMIT 1`,
        [token_temp]
      );

      if (!rows.length) {
        return res.status(401).json({ success: false, message: 'Sessão inválida. Faça login novamente.' });
      }

      const usuario = rows[0];
      if (Number(usuario.usado) === 1) {
        return res.status(401).json({ success: false, message: 'Esta sessão já foi utilizada. Faça login novamente.' });
      }

      if (!Number(usuario.ativo)) {
        return res.status(403).json({ success: false, message: 'Sua conta está inativa no momento.' });
      }

      const desafio = await criarDesafioVerificacao(db, usuario);
      if (!desafio.success) {
        return res.status(502).json(desafio);
      }

      return res.json(desafio);
    } catch (err) {
      console.error('Erro ao reenviar código 2FA:', err);
      return res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
    }
  }

  static async atualizarPerfil(req, res) {
    const db = global.db;
    if (!db) {
      return res.status(503).json({ success: false, message: 'Banco de dados não configurado.' });
    }

    const nome = String(req.body?.nome || '').trim().replace(/\s+/g, ' ');
    if (nome.length < 2) {
      return res.status(400).json({ success: false, message: 'Informe um nome válido.' });
    }
    if (nome.length > 120) {
      return res.status(400).json({ success: false, message: 'O nome deve ter no máximo 120 caracteres.' });
    }

    try {
      await db.query('UPDATE usuarios SET nome = ? WHERE id = ?', [nome, req.usuario_id]);
      const [rows] = await db.query(
        'SELECT id, nome, email FROM usuarios WHERE id = ? LIMIT 1',
        [req.usuario_id]
      );

      return res.json({
        success: true,
        usuario: rows[0] || { id: req.usuario_id, nome }
      });
    } catch (err) {
      console.error('Erro ao atualizar nome do usuário:', err);
      return res.status(500).json({ success: false, message: 'Não foi possível atualizar o nome.' });
    }
  }

  static async logout(req, res) {
    const db = global.db;
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (token && db) {
      try {
        await db.query('DELETE FROM sessoes_ativas WHERE token = ?', [token]);
      } catch (_) {}
    }

    return res.json({ success: true });
  }

  static async solicitarReset(req, res) {
    const db = global.db;
    if (!db) return res.status(503).json({ success: false, message: 'Banco de dados não configurado.' });

    const email = String(req.body.email || '').trim().toLowerCase();
    if (!emailValido(email)) {
      return res.status(400).json({ success: false, message: 'Informe um e-mail válido.' });
    }

    try {
      const [rows] = await db.query(
        `SELECT
           u.id,
           u.nome,
           u.email,
           u.ativo,
           u.is_admin,
           (SELECT COUNT(*)
            FROM assinaturas a
            WHERE a.usuario_id = u.id
              AND a.status = 'ativa'
              AND a.data_expiracao > NOW()) AS assinatura_ativa
         FROM usuarios u
         WHERE u.email = ?
         LIMIT 1`,
        [email]
      );

      // Resposta generica por seguranca (nao revela se o e-mail existe)
      if (rows.length === 0) {
        return res.json({ success: true, message: 'Se este e-mail estiver cadastrado, você receberá as instruções em instantes.' });
      }

      const usuario = rows[0];
      const acessoPermitido = Number(usuario.ativo) === 1 && (
        Number(usuario.is_admin) === 1 ||
        emailTemBypass(usuario.email) ||
        Number(usuario.assinatura_ativa) > 0
      );

      if (!acessoPermitido) {
        return res.json({ success: true, message: 'Se este e-mail estiver cadastrado, você receberá as instruções em instantes.' });
      }

      const token = crypto.randomBytes(32).toString('hex');
      const expiraEm = new Date(Date.now() + 30 * 60 * 1000);

      await db.query('DELETE FROM tokens_reset_senha WHERE usuario_id = ?', [usuario.id]);
      await db.query(
        'INSERT INTO tokens_reset_senha (usuario_id, token, expira_em) VALUES (?, ?, ?)',
        [usuario.id, token, expiraEm]
      );

      const baseUrl = getAppBaseUrl(req);
      const link = `${baseUrl}/redefinir-senha.html?token=${token}`;

      const envio = await enviarLinkResetSenha({ para: usuario.email, nome: usuario.nome, link });

      if (!envio.sent) {
        console.error('Falha ao enviar e-mail de reset para', usuario.email, '-', envio.reason);
        return res.status(502).json({ success: false, message: 'Não foi possível enviar o e-mail. Tente novamente.' });
      }

      return res.json({ success: true, message: 'Se este e-mail estiver cadastrado, você receberá as instruções em instantes.' });
    } catch (err) {
      console.error('Erro ao solicitar reset:', err);
      return res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
    }
  }

  static async redefinirSenha(req, res) {
    const db = global.db;
    if (!db) return res.status(503).json({ success: false, message: 'Banco de dados não configurado.' });

    const token = String(req.body.token || '').trim();
    const novaSenha = String(req.body.senha || '');

    if (!token) return res.status(400).json({ success: false, message: 'Token inválido.' });
    if (novaSenha.length < 6) return res.status(400).json({ success: false, message: 'A nova senha precisa ter pelo menos 6 caracteres.' });

    try {
      const [rows] = await db.query(
        `SELECT
           tr.id,
           tr.usuario_id,
           tr.expira_em,
           tr.usado,
           u.email,
           u.ativo,
           u.is_admin,
           (SELECT COUNT(*)
            FROM assinaturas a
            WHERE a.usuario_id = u.id
              AND a.status = 'ativa'
              AND a.data_expiracao > NOW()) AS assinatura_ativa
         FROM tokens_reset_senha tr
         JOIN usuarios u ON u.id = tr.usuario_id
         WHERE tr.token = ?`,
        [token]
      );

      if (rows.length === 0) return res.status(401).json({ success: false, message: 'Link inválido ou já utilizado.' });

      const reg = rows[0];
      if (reg.usado) return res.status(401).json({ success: false, message: 'Este link já foi utilizado.' });
      if (new Date() > new Date(reg.expira_em)) return res.status(401).json({ success: false, message: 'Link expirado. Solicite um novo.' });

      const acessoPermitido = Number(reg.ativo) === 1 && (
        Number(reg.is_admin) === 1 ||
        emailTemBypass(reg.email) ||
        Number(reg.assinatura_ativa) > 0
      );

      if (!acessoPermitido) {
        return res.status(403).json({
          success: false,
          code: 'SUBSCRIPTION_REQUIRED',
          message: 'Assinatura ativa necessária para redefinir senha.',
          redirect: '/produtos.html'
        });
      }

      const senhaHash = await bcrypt.hash(novaSenha, 10);
      await db.query('UPDATE usuarios SET senha_hash = ? WHERE id = ?', [senhaHash, reg.usuario_id]);
      await db.query('UPDATE tokens_reset_senha SET usado = 1 WHERE id = ?', [reg.id]);

      return res.json({ success: true, message: 'Senha redefinida com sucesso. Faça login com sua nova senha.' });
    } catch (err) {
      console.error('Erro ao redefinir senha:', err);
      return res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
    }
  }
}

module.exports = AuthController;
