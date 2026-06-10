import { ProdutoUniversal } from '../domain/produto-universal';

export interface MarketplaceAdapter {
  readonly marketplace: string;
  toUniversalFormat(data: any): ProdutoUniversal;
  toMarketplaceFormat(product: ProdutoUniversal): any;
  getProducts(): Promise<ProdutoUniversal[]>;
  createProduct(product: ProdutoUniversal): Promise<any>;
  updateStock?(marketplaceProductId: string, quantity: number): Promise<void>;
}