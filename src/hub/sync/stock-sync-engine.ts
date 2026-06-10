import { MarketplaceAdapter } from '../adapters/marketplace-adapter';

export interface EstoqueWebhookItem {
  sku: string;
  quantidade: number;
}

export interface ShopeeWebhookPayload {
  order_sn: string;
  marketplace: 'shopee';
  items: EstoqueWebhookItem[];
}

export interface ProdutoLocalRecord {
  id: string;
  sku: string;
  quantidade: number;
}

export interface VinculoAnuncioRecord {
  id: string;
  produto_local_id: string;
  marketplace: string;
  loja_integrada_id: string;
  marketplace_produto_id: string;
}

export interface ProdutoLocalRepository {
  findBySku(sku: string): Promise<ProdutoLocalRecord | null>;
  decrementStock(productId: string, quantity: number): Promise<ProdutoLocalRecord>;
}

export interface VinculoAnuncioRepository {
  findOtherChannelsByProductId(productId: string, sourceMarketplace: string): Promise<VinculoAnuncioRecord[]>;
}

export interface SyncJob {
  sku: string;
  quantity: number;
  marketplace: string;
  marketplaceProductId: string;
  lojaIntegradaId: string;
  attempts: number;
}

export interface SyncQueue {
  publish(job: SyncJob): Promise<void>;
}

export interface SyncFailureRepository {
  register(job: SyncJob, error: Error): Promise<void>;
}

export interface MarketplaceAdapterResolver {
  resolve(marketplace: string, lojaIntegradaId: string): Promise<MarketplaceAdapter | null>;
}

export class InMemorySyncQueue implements SyncQueue {
  private readonly subscribers: Array<(job: SyncJob) => Promise<void>> = [];

  subscribe(handler: (job: SyncJob) => Promise<void>): void {
    this.subscribers.push(handler);
  }

  async publish(job: SyncJob): Promise<void> {
    for (const subscriber of this.subscribers) {
      await subscriber(job);
    }
  }
}

export class StockSyncEngine {
  constructor(
    private readonly productRepository: ProdutoLocalRepository,
    private readonly vinculoRepository: VinculoAnuncioRepository,
    private readonly queue: SyncQueue
  ) {}

  async handleShopeeWebhook(payload: ShopeeWebhookPayload): Promise<void> {
    for (const item of payload.items) {
      const localProduct = await this.productRepository.findBySku(item.sku);
      if (!localProduct) {
        throw new Error(`SKU não encontrado no estoque central: ${item.sku}`);
      }

      const updatedProduct = await this.productRepository.decrementStock(localProduct.id, item.quantidade);
      const linkedChannels = await this.vinculoRepository.findOtherChannelsByProductId(updatedProduct.id, payload.marketplace);

      for (const channel of linkedChannels) {
        await this.queue.publish({
          sku: updatedProduct.sku,
          quantity: updatedProduct.quantidade,
          marketplace: channel.marketplace,
          marketplaceProductId: channel.marketplace_produto_id,
          lojaIntegradaId: channel.loja_integrada_id,
          attempts: 0
        });
      }
    }
  }
}

export class StockSyncWorker {
  constructor(
    private readonly adapterResolver: MarketplaceAdapterResolver,
    private readonly failureRepository: SyncFailureRepository,
    private readonly queue?: SyncQueue
  ) {}

  async process(job: SyncJob): Promise<void> {
    const adapter = await this.adapterResolver.resolve(job.marketplace, job.lojaIntegradaId);
    if (!adapter || !adapter.updateStock) {
      await this.failureRepository.register(job, new Error(`Adapter sem suporte de estoque para ${job.marketplace}`));
      return;
    }

    try {
      await adapter.updateStock(job.marketplaceProductId, job.quantity);
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error('Falha desconhecida ao sincronizar estoque');
      await this.failureRepository.register(job, normalizedError);

      if (job.attempts >= 2 || !this.queue) {
        return;
      }

      await this.queue.publish({
        ...job,
        attempts: job.attempts + 1
      });
    }
  }
}

export class MercadoLivreStockAdapterMock implements MarketplaceAdapter {
  public readonly marketplace = 'mercado_livre';

  private unavailable = false;

  constructor(options?: { unavailable?: boolean }) {
    this.unavailable = options?.unavailable === true;
  }

  toUniversalFormat(data: any) {
    return data;
  }

  toMarketplaceFormat(product: any) {
    return product;
  }

  async getProducts(): Promise<any[]> {
    return [];
  }

  async createProduct(product: any): Promise<any> {
    return product;
  }

  async updateStock(marketplaceProductId: string, quantity: number): Promise<void> {
    if (this.unavailable) {
      throw new Error(`Mercado Livre indisponível ao atualizar anúncio ${marketplaceProductId}`);
    }

    console.log(`[sync] Mercado Livre atualizado`, { marketplaceProductId, quantity });
  }
}

export class BullMqBridgeExample {
  async example(job: SyncJob): Promise<void> {
    void job;
    // Exemplo conceitual:
    // await bullQueue.add('stock-sync', job, {
    //   attempts: 5,
    //   backoff: { type: 'exponential', delay: 3000 },
    //   removeOnComplete: 1000,
    //   removeOnFail: 5000
    // });
  }
}