import { MercadoLivreAdapter } from '../adapters/mercado-livre-adapter';
import { MarketplaceAdapterResolver, ShopeeWebhookPayload, StockSyncEngine, StockSyncWorker } from '../sync/stock-sync-engine';
import { GenericMarketplaceParser } from '../importers/marketplace-product-parser';
import {
  CreateLojaIntegradaInput,
  CreateProdutoLocalInput,
  CreateVinculoInput,
  LojaIntegradaRecord,
  MySqlHubSchema,
  MySqlLojasIntegradasRepository,
  MySqlProdutoLocalRepository,
  MySqlSyncFailureRepository,
  MySqlVinculoAnuncioRepository
} from '../infra/mysql-hub.repository';
import { HybridSyncQueue } from '../infra/hybrid-sync-queue';
import { ProdutoUniversal } from '../domain/produto-universal';
import { buildMercadoLivreAuthorizationUrl, handleMercadoLivreAuthCallback } from './mercadolivre-auth.service';
import { publishProductOnMercadoLivre } from './mercadolivre-publish.service';
import { handleMercadoLivreWebhook } from './mercadolivre-webhook.service';

class HubAdapterResolver implements MarketplaceAdapterResolver {
  constructor(private readonly lojasRepository: MySqlLojasIntegradasRepository) {}

  async resolve(marketplace: string, lojaIntegradaId: string) {
    const store = await this.lojasRepository.findById(lojaIntegradaId);
    if (!store || store.status !== 'ativa') {
      return null;
    }

    return createAdapterForStore(store);
  }
}

function createAdapterForStore(store: LojaIntegradaRecord) {
  if (store.marketplace === 'mercado_livre') {
    return new MercadoLivreAdapter({
      accessToken: store.token_acesso,
      sellerId: store.seller_id || undefined
    });
  }

  return null;
}

export class HubService {
  private readonly schema = new MySqlHubSchema();
  private readonly lojasRepository = new MySqlLojasIntegradasRepository();
  private readonly produtoRepository = new MySqlProdutoLocalRepository();
  private readonly vinculoRepository = new MySqlVinculoAnuncioRepository();
  private readonly failureRepository = new MySqlSyncFailureRepository();
  private readonly parser = new GenericMarketplaceParser();
  private readonly queue = new HybridSyncQueue();
  private readonly syncEngine = new StockSyncEngine(this.produtoRepository, this.vinculoRepository, this.queue);
  private readonly worker = new StockSyncWorker(new HubAdapterResolver(this.lojasRepository), this.failureRepository, this.queue);
  private workerStarted = false;

  async initialize(): Promise<void> {
    await this.schema.ensureSchema();

    if (!this.workerStarted) {
      await this.queue.start((job) => this.worker.process(job));
      this.workerStarted = true;
    }
  }

  async getHealth(): Promise<{ ok: boolean; queue: string; }> {
    await this.initialize();
    return {
      ok: true,
      queue: this.queue.isBullMqEnabled() ? 'bullmq' : 'in-memory'
    };
  }

  async importFromUrl(url: string): Promise<ProdutoUniversal> {
    await this.initialize();
    const result = await this.parser.parse(url);
    return result.product;
  }

  async createStore(input: CreateLojaIntegradaInput): Promise<string> {
    await this.initialize();
    return this.lojasRepository.create(input);
  }

  async listStores(clienteId: number): Promise<LojaIntegradaRecord[]> {
    await this.initialize();
    return this.lojasRepository.listByCliente(clienteId);
  }

  async listLocalProducts(clienteId: number): Promise<any[]> {
    await this.initialize();
    return this.produtoRepository.listByCliente(clienteId);
  }

  async listLinks(clienteId: number): Promise<any[]> {
    await this.initialize();
    return this.vinculoRepository.listByCliente(clienteId);
  }

  async createLocalProduct(input: CreateProdutoLocalInput): Promise<string> {
    await this.initialize();
    return this.produtoRepository.create(input);
  }

  async createLink(input: CreateVinculoInput): Promise<string> {
    await this.initialize();
    return this.vinculoRepository.create(input);
  }

  async createMercadoLivreAuthorizationUrl(clienteId: number): Promise<string> {
    await this.initialize();
    return buildMercadoLivreAuthorizationUrl(clienteId);
  }

  async handleMercadoLivreAuthCallback(code: string, state: string): Promise<{ cliente_id: number; user_id: string }> {
    await this.initialize();
    return handleMercadoLivreAuthCallback(code, state);
  }

  async publishToMarketplace(params: {
    produtoLocalId: string;
    lojaIntegradaId: string;
    imagemUrl?: string;
  }): Promise<any> {
    await this.initialize();

    const product = await this.produtoRepository.findById(params.produtoLocalId);
    if (!product) {
      throw new Error('Produto local não encontrado.');
    }

    const store = await this.lojasRepository.findById(params.lojaIntegradaId);
    if (!store) {
      throw new Error('Loja integrada não encontrada.');
    }

    if (store.marketplace === 'mercado_livre') {
      return publishProductOnMercadoLivre({
        clienteId: store.cliente_id,
        produtoLocalId: params.produtoLocalId,
        lojaIntegradaId: params.lojaIntegradaId,
        imagemUrl: String(params.imagemUrl || '')
      });
    }

    const adapter = createAdapterForStore(store);
    if (!adapter) {
      throw new Error(`Marketplace ${store.marketplace} ainda não possui adapter operacional.`);
    }

    const universalProduct: ProdutoUniversal = {
      id_interno: String(product.id),
      sku: String(product.sku),
      titulo: String(product.titulo),
      descricao: String(product.descricao || ''),
      preco: Number(product.preco || 0),
      estoque: Number(product.quantidade || 0),
      imagens: [],
      variacoes: [],
      categorias: []
    };

    const response = await adapter.createProduct(universalProduct);
    return response;
  }

  async handleMercadoLivreWebhook(payload: any): Promise<void> {
    await this.initialize();
    return handleMercadoLivreWebhook(payload);
  }

  async handleShopeeWebhook(payload: Partial<ShopeeWebhookPayload> & Record<string, any>): Promise<void> {
    await this.initialize();
    const normalizedPayload = this.normalizeShopeeWebhook(payload);
    await this.syncEngine.handleShopeeWebhook(normalizedPayload);
  }

  private normalizeShopeeWebhook(payload: Partial<ShopeeWebhookPayload> & Record<string, any>): ShopeeWebhookPayload {
    const itemsSource = Array.isArray(payload.items)
      ? payload.items
      : Array.isArray(payload.order_items)
        ? payload.order_items
        : [];

    const items = itemsSource.map((item: Record<string, any>) => ({
      sku: String(item.sku || item.model_sku || item.item_sku || ''),
      quantidade: Number(item.quantidade || item.quantity || item.model_quantity_purchased || 0)
    })).filter((item) => item.sku && item.quantidade > 0);

    if (!items.length) {
      throw new Error('Webhook Shopee sem SKU/quantidade utilizáveis.');
    }

    return {
      order_sn: String(payload.order_sn || payload.ordersn || payload.order_id || `shopee-${Date.now()}`),
      marketplace: 'shopee',
      items
    };
  }
}

let hubServiceSingleton: HubService | null = null;

export function getHubService(): HubService {
  if (!hubServiceSingleton) {
    hubServiceSingleton = new HubService();
  }

  return hubServiceSingleton;
}