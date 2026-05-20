'use strict';

const bcrypt = require('bcryptjs');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');

// ==================== PLANOS ====================
const PLANOS = {
  semanal: { nome: 'Assinatura Semanal IntelliStock', preco: 59.00,   dias: 7   },
  mensal:  { nome: 'Assinatura Mensal IntelliStock',  preco: 179.00,  dias: 30  },
  anual:   { nome: 'Assinatura Anual IntelliStock',   preco: 1690.00, dias: 365 }
};

function maskCpfCnpj(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}.***.***-${digits.slice(-2)}`;
  }
  if (digits.length === 14) {
    return `${digits.slice(0, 2)}.***.***/****-${digits.slice(-2)}`;
  }
  return null;
}

function calcularDiasRestantes(dataExpiracao, status) {
  if (!dataExpiracao || status !== 'ativa') return 0;
  const diffMs = new Date(dataExpiracao).getTime() - Date.now();
  if (diffMs <= 0) return 0;
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

function getMpClient() {
  return new MercadoPagoConfig({
    accessToken: process.env.MP_ACCESS_TOKEN || '',
    options: { timeout: 15000 }
  });
}

function getAppUrl() {
  return (process.env.APP_URL || `http://localhost:${process.env.PORT || 3001}`).replace(/\/$/, '');
}

function isPublicHttpUrl(url) {
  if (!/^https?:\/\//i.test(url || '')) return false;
  return !/localhost|127\.0\.0\.1/i.test(url);
}

function emailValido(email) {
  return /\S+@\S+\.\S+/.test(String(email || '').trim());
}

function getPaymentIdFromPayload(payload = {}) {
  const candidates = [
    payload.payment_id,
    payload.collection_id,
    payload.id,
    payload.data?.id
  ];

  const paymentId = candidates.find((value) => value !== undefined && value !== null && value !== '');
  if (!paymentId) return null;

  return String(paymentId).trim();
}

async function reconciliarUsuarioPorPagamento(db, usuarioId) {
  if (!db || !usuarioId) {
    return {
      success: false,
      approved: false,
      status: 'invalid_input',
      message: 'Parâmetros inválidos para reconciliação.'
    };
  }

  const [rows] = await db.query(
    `SELECT mp_payment_id
     FROM assinaturas
     WHERE usuario_id = ?
       AND mp_payment_id IS NOT NULL
     ORDER BY updated_at DESC
     LIMIT 1`,
    [usuarioId]
  );

  if (rows.length) {
    const paymentId = String(rows[0].mp_payment_id || '').trim();
    if (!/^\d+$/.test(paymentId)) {
      return {
        success: false,
        approved: false,
        status: 'invalid_payment_id',
        message: 'payment_id inválido para reconciliação.'
      };
    }

    return ativarAssinaturaPorPagamento(db, paymentId);
  }

  // Fallback importante para PIX/checkout interrompido: localiza pagamento pelo external_reference.
  const client = getMpClient();
  const paymentClient = new Payment(client);
  const searchResponse = await paymentClient.search({
    options: {
      external_reference: String(usuarioId),
      sort: 'date_created',
      criteria: 'desc',
      limit: 10
    }
  });

  const results =
    searchResponse?.results ||
    searchResponse?.body?.results ||
    [];

  if (!Array.isArray(results) || !results.length) {
    return {
      success: false,
      approved: false,
      status: 'not_found',
      message: 'Nenhum pagamento associado ao usuário para reconciliação.'
    };
  }

  const pagamentoAprovado = results.find((item) => String(item?.status || '').toLowerCase() === 'approved');
  if (pagamentoAprovado?.id) {
    return ativarAssinaturaPorPagamento(db, String(pagamentoAprovado.id));
  }

  const ultimoPagamento = results[0] || {};
  return {
    success: true,
    approved: false,
    status: String(ultimoPagamento.status || 'pending'),
    message: 'Pagamento encontrado, mas ainda não aprovado.'
  };
}

async function ativarAssinaturaPorPagamento(db, paymentId) {
  if (!paymentId || !/^\d+$/.test(String(paymentId))) {
    return { success: false, status: 'invalid_payment_id', message: 'Pagamento inválido.' };
  }

  const client = getMpClient();
  const paymentClient = new Payment(client);
  const payment = await paymentClient.get({ id: String(paymentId) });

  if (!payment) {
    return { success: false, status: 'not_found', message: 'Pagamento não encontrado.' };
  }

  const usuarioId = parseInt(payment.external_reference, 10);
  if (!usuarioId || Number.isNaN(usuarioId)) {
    return { success: false, status: 'invalid_reference', message: 'Pagamento sem referência de usuário válida.' };
  }

  const planoId = payment.metadata?.plano || 'mensal';
  const plano = PLANOS[planoId] || PLANOS.mensal;
  const cpfCnpj = String(payment.payer?.identification?.number || '').replace(/\D/g, '');
  const cardBrand = String(payment.payment_method_id || '').trim() || null;
  const cardLast4 = String(payment.card?.last_four_digits || '').replace(/\D/g, '').slice(-4) || null;

  if (payment.status !== 'approved') {
    return {
      success: true,
      status: String(payment.status || 'pending'),
      approved: false,
      usuarioId,
      planoId,
      paymentId: String(payment.id || paymentId)
    };
  }

  const dataInicio = new Date();
  const dataExpiracao = new Date(dataInicio);
  dataExpiracao.setDate(dataExpiracao.getDate() + plano.dias);

  await db.query('UPDATE usuarios SET ativo = 1 WHERE id = ?', [usuarioId]);

  await db.query(
    `INSERT INTO assinaturas
       (usuario_id, plano, status, mp_payment_id, valor_pago, data_inicio, data_expiracao, cpf_cnpj, card_brand, card_last4)
     VALUES (?, ?, 'ativa', ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       plano             = VALUES(plano),
       status            = 'ativa',
       mp_payment_id     = VALUES(mp_payment_id),
       valor_pago        = VALUES(valor_pago),
       data_inicio       = VALUES(data_inicio),
       data_expiracao    = VALUES(data_expiracao),
       cpf_cnpj          = COALESCE(VALUES(cpf_cnpj), cpf_cnpj),
       card_brand        = COALESCE(VALUES(card_brand), card_brand),
       card_last4        = COALESCE(VALUES(card_last4), card_last4),
       data_cancelamento = NULL,
       updated_at        = NOW()`,
    [usuarioId, planoId, String(payment.id), plano.preco, dataInicio, dataExpiracao, cpfCnpj || null, cardBrand, cardLast4]
  );

  return {
    success: true,
    status: 'approved',
    approved: true,
    usuarioId,
    planoId,
    paymentId: String(payment.id),
    dataExpiracao
  };
}

async function criarPreferenciaMp(usuarioId, email, nome, cpfCnpj, planoId) {
  const plano = PLANOS[planoId];
  if (!plano) throw new Error('Plano inválido: ' + planoId);

  const appUrl = getAppUrl();
  const client = getMpClient();
  const prefClient = new Preference(client);

  const body = {
    items: [{
      id: planoId,
      title: plano.nome,
      description: 'Acesso ao IntelliStock - Sistema de Gerenciamento de Estoque',
      quantity: 1,
      unit_price: plano.preco,
      currency_id: 'BRL'
    }],
    payer: {
      name: nome,
      email,
      identification: {
        type: cpfCnpj.length <= 11 ? 'CPF' : 'CNPJ',
        number: cpfCnpj
      }
    },
    external_reference: String(usuarioId),
    metadata: {
      usuario_id: usuarioId,
      plano: planoId
    },
    statement_descriptor: 'INTELLISTOCK'
  };

  // Sempre define retorno para o checkout após pagamento.
  body.back_urls = {
    success: `${appUrl}/checkout.html?status=success`,
    failure: `${appUrl}/checkout.html?status=failure`,
    pending: `${appUrl}/checkout.html?status=pending`
  };
  body.auto_return = 'approved';

  // Webhook exige URL pública acessível pelo Mercado Pago.
  if (isPublicHttpUrl(appUrl)) {
    body.notification_url = `${appUrl}/api/assinaturas/webhook`;
  }

  return prefClient.create({ body });
}

class AssinaturasController {
  // ─────────────────────────────────────────────────────────────────────
  // POST /api/assinaturas/iniciar-checkout  (público)
  // Cria/atualiza usuário → cria preferência MP → devolve init_point
  // ─────────────────────────────────────────────────────────────────────
  static async iniciarCheckout(req, res) {
    const db = global.db;
    if (!db) {
      return res.status(503).json({ success: false, message: 'Banco de dados não disponível.' });
    }
    if (!process.env.MP_ACCESS_TOKEN) {
      return res.status(503).json({
        success: false,
        message: 'Gateway de pagamento não configurado. Contate o suporte.'
      });
    }

    const nome    = String(req.body.nome     || '').trim();
    const email   = String(req.body.email    || '').trim().toLowerCase();
    const senha   = String(req.body.senha    || '');
    const cpfCnpj = String(req.body.cpf_cnpj || '').replace(/\D/g, '');
    const planoId = String(req.body.plano    || 'mensal');

    if (!PLANOS[planoId])    return res.status(400).json({ success: false, message: 'Plano inválido.' });
    if (nome.length < 3)     return res.status(400).json({ success: false, message: 'Nome precisa ter ao menos 3 caracteres.' });
    if (nome.length > 50)    return res.status(400).json({ success: false, message: 'Nome precisa ter no máximo 50 caracteres.' });
    if (!emailValido(email)) return res.status(400).json({ success: false, message: 'E-mail inválido.' });
    if (cpfCnpj.length < 11) return res.status(400).json({ success: false, message: 'CPF (11 dígitos) ou CNPJ (14 dígitos) inválido.' });

    try {
      // Verifica se já há sessão ativa (usuário logado quer renovar)
      const authHeader  = req.headers['authorization'] || '';
      const sessionToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
      let usuarioId = null;

      if (sessionToken) {
        const [sessRows] = await db.query(
          `SELECT s.usuario_id
           FROM sessoes_ativas s
           JOIN usuarios u ON u.id = s.usuario_id
           WHERE s.token = ? AND s.expira_em > NOW() AND u.ativo = 1`,
          [sessionToken]
        );
        if (sessRows.length > 0) usuarioId = sessRows[0].usuario_id;
      }

      if (!usuarioId) {
        // Novo fluxo: usuário ainda não existe ou está pendente de pagamento
        if (senha.length < 6) {
          return res.status(400).json({ success: false, message: 'Senha precisa ter ao menos 6 caracteres.' });
        }

        const [existRows] = await db.query(
          'SELECT id, ativo FROM usuarios WHERE email = ? LIMIT 1',
          [email]
        );

        if (existRows.length > 0 && existRows[0].ativo === 1) {
          return res.status(409).json({
            success: false,
            message: 'Este e-mail já possui uma conta ativa. Faça login para renovar sua assinatura.',
            redirect: '/login.html'
          });
        }

        if (existRows.length > 0) {
          // Usuário pendente (pagamento anterior não concluído) — atualiza dados
          const hash = await bcrypt.hash(senha, 10);
          await db.query(
            'UPDATE usuarios SET nome = ?, senha_hash = ? WHERE id = ?',
            [nome, hash, existRows[0].id]
          );
          usuarioId = existRows[0].id;
        } else {
          // Cria usuário inativo — será ativado pelo webhook após pagamento
          const hash = await bcrypt.hash(senha, 10);
          const [ins] = await db.query(
            'INSERT INTO usuarios (nome, email, senha_hash, ativo) VALUES (?, ?, ?, 0)',
            [nome, email, hash]
          );
          usuarioId = ins.insertId;
        }
      }

      const pref = await criarPreferenciaMp(usuarioId, email, nome, cpfCnpj, planoId);

      await db.query(
        `INSERT INTO assinaturas (usuario_id, plano, status, cpf_cnpj)
         VALUES (?, ?, 'pendente', ?)
         ON DUPLICATE KEY UPDATE
           plano = VALUES(plano),
           cpf_cnpj = VALUES(cpf_cnpj),
           status = IF(status = 'ativa' AND data_expiracao > NOW(), status, 'pendente'),
           updated_at = NOW()`,
        [usuarioId, planoId, cpfCnpj]
      );

      return res.json({
        success: true,
        init_point: pref.init_point,
        sandbox_init_point: pref.sandbox_init_point,
        preference_id: pref.id
      });

    } catch (err) {
      console.error('Erro ao iniciar checkout:', err);
      return res.status(500).json({
        success: false,
        message: 'Erro ao processar checkout. Tente novamente.'
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // POST /api/assinaturas/renovar  (requer auth)
  // Usuário já logado com assinatura vencida quer renovar/trocar plano
  // ─────────────────────────────────────────────────────────────────────
  static async renovar(req, res) {
    const db = global.db;
    if (!db) return res.status(503).json({ success: false, message: 'Banco de dados não disponível.' });
    if (!process.env.MP_ACCESS_TOKEN) {
      return res.status(503).json({ success: false, message: 'Gateway de pagamento não configurado.' });
    }

    const planoId = String(req.body.plano    || 'mensal');
    const cpfCnpj = String(req.body.cpf_cnpj || '').replace(/\D/g, '');

    if (!PLANOS[planoId])    return res.status(400).json({ success: false, message: 'Plano inválido.' });
    if (cpfCnpj.length < 11) return res.status(400).json({ success: false, message: 'CPF ou CNPJ obrigatório para renovação.' });

    try {
      const [userRows] = await db.query(
        'SELECT nome, email FROM usuarios WHERE id = ? LIMIT 1',
        [req.usuario_id]
      );
      if (userRows.length === 0) {
        return res.status(404).json({ success: false, message: 'Usuário não encontrado.' });
      }

      const { nome, email } = userRows[0];
      const pref = await criarPreferenciaMp(req.usuario_id, email, nome, cpfCnpj, planoId);

      await db.query(
        `INSERT INTO assinaturas (usuario_id, plano, status, cpf_cnpj)
         VALUES (?, ?, 'pendente', ?)
         ON DUPLICATE KEY UPDATE
           plano = VALUES(plano),
           cpf_cnpj = VALUES(cpf_cnpj),
           status = IF(status = 'ativa' AND data_expiracao > NOW(), status, 'pendente'),
           updated_at = NOW()`,
        [req.usuario_id, planoId, cpfCnpj]
      );

      return res.json({
        success: true,
        init_point: pref.init_point,
        sandbox_init_point: pref.sandbox_init_point,
        preference_id: pref.id
      });

    } catch (err) {
      console.error('Erro ao renovar assinatura:', err);
      return res.status(500).json({ success: false, message: 'Erro ao iniciar renovação. Tente novamente.' });
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // POST /api/assinaturas/webhook  (público — chamado pelo Mercado Pago)
  // ─────────────────────────────────────────────────────────────────────
  static async webhook(req, res) {
    // Responder 200 imediatamente para evitar reenvio do MP
    res.status(200).end();

    const db = global.db;
    if (!db || !process.env.MP_ACCESS_TOKEN) return;

    const { type, data } = req.body || {};
    const paymentId = getPaymentIdFromPayload({ ...req.query, data });

    // Só processa notificações de pagamento com ID numérico
    if (!paymentId || !/^\d+$/.test(String(paymentId))) return;
    if (type && type !== 'payment') return;

    try {
      const resultado = await ativarAssinaturaPorPagamento(db, paymentId);
      if (!resultado.success) {
        console.warn('[MP Webhook] Falha ao processar pagamento:', resultado.message);
        return;
      }

      if (resultado.approved) {
        console.log(
          `✓ [MP Webhook] Assinatura ativada: usuário ${resultado.usuarioId}, plano ${resultado.planoId}, expira ${resultado.dataExpiracao.toISOString()}`
        );
      } else {
        console.log(`ℹ [MP Webhook] Pagamento status "${resultado.status}": usuário ${resultado.usuarioId}`);
      }

    } catch (err) {
      console.error('[MP Webhook] Erro ao processar notificação:', err.message);
    }
  }

  static async confirmarRetorno(req, res) {
    const db = global.db;
    if (!db) {
      return res.status(503).json({ success: false, message: 'Banco de dados não disponível.' });
    }

    if (!process.env.MP_ACCESS_TOKEN) {
      return res.status(503).json({ success: false, message: 'Gateway de pagamento não configurado.' });
    }

    const paymentId = getPaymentIdFromPayload(req.body || {});
    if (!paymentId) {
      return res.status(400).json({ success: false, message: 'payment_id é obrigatório.' });
    }

    try {
      const resultado = await ativarAssinaturaPorPagamento(db, paymentId);

      if (!resultado.success) {
        const statusCode = resultado.status === 'not_found' ? 404 : 400;
        return res.status(statusCode).json({ success: false, message: resultado.message });
      }

      if (!resultado.approved) {
        return res.json({
          success: true,
          approved: false,
          payment_status: resultado.status,
          message: 'Pagamento ainda não aprovado. Aguarde a confirmação do Mercado Pago.'
        });
      }

      return res.json({
        success: true,
        approved: true,
        payment_status: resultado.status,
        usuario_id: resultado.usuarioId,
        plano: resultado.planoId,
        expira_em: resultado.dataExpiracao,
        message: 'Pagamento confirmado e conta ativada com sucesso.'
      });
    } catch (err) {
      console.error('Erro ao confirmar retorno do pagamento:', err);
      return res.status(500).json({ success: false, message: 'Erro ao confirmar pagamento.' });
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // GET /api/assinaturas/status  (requer auth)
  // ─────────────────────────────────────────────────────────────────────
  static async status(req, res) {
    const db = global.db;
    if (!db) return res.status(503).json({ success: false, message: 'Banco de dados não disponível.' });

    try {
      const [rows] = await db.query(
        `SELECT u.nome, u.email,
                a.plano, a.status, a.mp_payment_id, a.valor_pago,
                a.cpf_cnpj, a.card_brand, a.card_last4,
                data_inicio, data_expiracao, data_cancelamento,
                renovacao_automatica, a.created_at, a.updated_at
         FROM usuarios u
         LEFT JOIN assinaturas a ON a.usuario_id = u.id
         WHERE u.id = ? LIMIT 1`,
        [req.usuario_id]
      );

      if (rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Usuário não encontrado.' });
      }

      const a = rows[0];

      if (!a.plano) {
        return res.json({
          success: true,
          assinatura: null,
          cliente: {
            nome: a.nome,
            email: a.email,
            cpf_cnpj: null,
            cpf_mask: null
          }
        });
      }

      // Auto-expirar se passou da data de expiração
      if (a.status === 'ativa' && a.data_expiracao && new Date(a.data_expiracao) < new Date()) {
        await db.query(
          'UPDATE assinaturas SET status = ? WHERE usuario_id = ?',
          ['expirada', req.usuario_id]
        );
        a.status = 'expirada';
      }

      const diasRestantes = calcularDiasRestantes(a.data_expiracao, a.status);

      return res.json({
        success: true,
        assinatura: {
          plano: a.plano,
          status: a.status,
          mp_payment_id: a.mp_payment_id,
          valor_pago: a.valor_pago,
          data_inicio: a.data_inicio,
          data_expiracao: a.data_expiracao,
          data_cancelamento: a.data_cancelamento,
          renovacao_automatica: a.renovacao_automatica,
          created_at: a.created_at,
          updated_at: a.updated_at,
          dias_restantes: diasRestantes,
          cartao: {
            bandeira: a.card_brand || null,
            final: a.card_last4 || null,
            mascarado: a.card_last4 ? `**** **** **** ${a.card_last4}` : null
          }
        },
        cliente: {
          nome: a.nome,
          email: a.email,
          cpf_cnpj: a.cpf_cnpj || null,
          cpf_mask: maskCpfCnpj(a.cpf_cnpj)
        }
      });

    } catch (err) {
      console.error('Erro ao buscar status de assinatura:', err);
      return res.status(500).json({ success: false, message: 'Erro ao buscar assinatura.' });
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // POST /api/assinaturas/cancelar  (requer auth)
  // ─────────────────────────────────────────────────────────────────────
  static async cancelar(req, res) {
    const db = global.db;
    if (!db) return res.status(503).json({ success: false, message: 'Banco de dados não disponível.' });

    try {
      const [rows] = await db.query(
        `SELECT id FROM assinaturas WHERE usuario_id = ? AND status = 'ativa' LIMIT 1`,
        [req.usuario_id]
      );

      if (rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Nenhuma assinatura ativa encontrada.' });
      }

      await db.query(
        `UPDATE assinaturas SET status = 'cancelada', data_cancelamento = NOW() WHERE usuario_id = ?`,
        [req.usuario_id]
      );

      return res.json({ success: true, message: 'Assinatura cancelada. Você terá acesso até a data de expiração.' });

    } catch (err) {
      console.error('Erro ao cancelar assinatura:', err);
      return res.status(500).json({ success: false, message: 'Erro ao cancelar assinatura.' });
    }
  }
}

module.exports = AssinaturasController;
module.exports.reconciliarUsuarioPorPagamento = reconciliarUsuarioPorPagamento;
