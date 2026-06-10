import express, { Request, Response, NextFunction } from 'express';
import { getHubService } from '../services/hub-service';

const authMiddleware = require('../../middleware/authMiddleware');

type AuthenticatedRequest = Request & {
  usuario_id?: number;
};

function asyncHandler(handler: (req: Request, res: Response, next: NextFunction) => Promise<any>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void handler(req, res, next).catch(next);
  };
}

export function createHubRouter() {
  const router = express.Router();
  const service = getHubService();

  router.get('/health', authMiddleware, asyncHandler(async (_req, res) => {
    const health = await service.getHealth();
    res.json({ success: true, data: health });
  }));

  router.get('/stores', authMiddleware, asyncHandler(async (req, res) => {
    const authReq = req as AuthenticatedRequest;
    const stores = await service.listStores(Number(authReq.usuario_id));
    res.json({ success: true, data: stores });
  }));

  router.get('/products', authMiddleware, asyncHandler(async (req, res) => {
    const authReq = req as AuthenticatedRequest;
    const products = await service.listLocalProducts(Number(authReq.usuario_id));
    res.json({ success: true, data: products });
  }));

  router.get('/links', authMiddleware, asyncHandler(async (req, res) => {
    const authReq = req as AuthenticatedRequest;
    const links = await service.listLinks(Number(authReq.usuario_id));
    res.json({ success: true, data: links });
  }));

  router.post('/stores', authMiddleware, asyncHandler(async (req, res) => {
    const authReq = req as AuthenticatedRequest;
    const id = await service.createStore({
      cliente_id: Number(authReq.usuario_id),
      marketplace: String(req.body.marketplace || '').trim(),
      nome_loja: req.body.nome_loja ? String(req.body.nome_loja).trim() : undefined,
      token_acesso: String(req.body.token_acesso || '').trim(),
      token_atualizacao: req.body.token_atualizacao ? String(req.body.token_atualizacao).trim() : undefined,
      expira_em: req.body.expira_em || null,
      status: req.body.status ? String(req.body.status).trim() : 'ativa',
      seller_id: req.body.seller_id ? String(req.body.seller_id).trim() : undefined,
      metadata_json: typeof req.body.metadata_json === 'object' && req.body.metadata_json !== null ? req.body.metadata_json : {}
    });

    res.status(201).json({ success: true, id });
  }));

  router.post('/products', authMiddleware, asyncHandler(async (req, res) => {
    const authReq = req as AuthenticatedRequest;
    const id = await service.createLocalProduct({
      cliente_id: Number(authReq.usuario_id),
      sku: String(req.body.sku || '').trim(),
      titulo: String(req.body.titulo || '').trim(),
      preco: Number(req.body.preco || 0),
      quantidade: Number(req.body.quantidade || 0),
      descricao: req.body.descricao ? String(req.body.descricao) : undefined
    });

    res.status(201).json({ success: true, id });
  }));

  router.post('/links', authMiddleware, asyncHandler(async (req, res) => {
    const id = await service.createLink({
      produto_local_id: String(req.body.produto_local_id || '').trim(),
      loja_integrada_id: String(req.body.loja_integrada_id || '').trim(),
      marketplace_produto_id: String(req.body.marketplace_produto_id || '').trim(),
      sku_marketplace: req.body.sku_marketplace ? String(req.body.sku_marketplace).trim() : undefined,
      url_anuncio: req.body.url_anuncio ? String(req.body.url_anuncio).trim() : undefined,
      status_sincronizacao: req.body.status_sincronizacao ? String(req.body.status_sincronizacao).trim() : 'sincronizado'
    });

    res.status(201).json({ success: true, id });
  }));

  router.post('/import/url', authMiddleware, asyncHandler(async (req, res) => {
    const url = String(req.body.url || '').trim();
    if (!url) {
      res.status(400).json({ success: false, message: 'Informe a URL do anúncio.' });
      return;
    }

    const product = await service.importFromUrl(url);
    res.json({ success: true, data: product });
  }));

  router.get('/mercadolivre/auth/redirect', authMiddleware, asyncHandler(async (req, res) => {
    const authReq = req as AuthenticatedRequest;
    const url = await service.createMercadoLivreAuthorizationUrl(Number(authReq.usuario_id));
    res.redirect(url);
  }));

  router.get('/mercadolivre/auth/callback', asyncHandler(async (req, res) => {
    const code = String(req.query.code || '').trim();
    const state = String(req.query.state || '').trim();

    if (!code || !state) {
      return res.status(400).json({ success: false, message: 'Parâmetros code e state são obrigatórios.' });
    }

    const data = await service.handleMercadoLivreAuthCallback(code, state);
    res.json({ success: true, message: 'Conta Mercado Livre conectada com sucesso.', data });
  }));

  router.post('/mercadolivre/webhook', asyncHandler(async (req, res) => {
    const webhookSecret = process.env.ML_WEBHOOK_SECRET;
    const receivedSignature = String(req.headers['x-mercadolivre-signature'] || req.headers['x-hub-signature'] || '');

    if (webhookSecret && receivedSignature !== webhookSecret) {
      return res.status(401).json({ success: false, message: 'Assinatura de webhook inválida.' });
    }

    await service.handleMercadoLivreWebhook(req.body || {});
    res.status(200).json({ success: true, message: 'Webhook Mercado Livre processado.' });
  }));

  router.post('/publish', authMiddleware, asyncHandler(async (req, res) => {
    const response = await service.publishToMarketplace({
      produtoLocalId: String(req.body.produto_local_id || '').trim(),
      lojaIntegradaId: String(req.body.loja_integrada_id || '').trim(),
      imagemUrl: String(req.body.imagem_url || '').trim()
    });

    res.json({ success: true, data: response });
  }));

  router.post('/webhooks/shopee', asyncHandler(async (req, res) => {
    await service.handleShopeeWebhook(req.body || {});
    res.status(202).json({ success: true, message: 'Webhook processado e sincronização enfileirada.' });
  }));

  return router;
}