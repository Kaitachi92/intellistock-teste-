import { MarketplaceAdapter } from './marketplace-adapter';
import { ProdutoUniversal, VariacaoUniversal } from '../domain/produto-universal';

interface ShopeeApiImage {
  image_url: string;
}

interface ShopeeApiVariation {
  model_id: number | string;
  model_sku?: string;
  model_name?: string;
  price?: number;
  stock_setting?: {
    normal_stock?: number;
  };
  tier_index?: number[];
}

interface ShopeeApiProduct {
  item_id: number | string;
  item_name: string;
  description?: string;
  item_sku?: string;
  price: number;
  stock_setting?: {
    normal_stock?: number;
  };
  image?: {
    image_url_list?: string[];
    images?: ShopeeApiImage[];
  };
  category_id?: number | string;
  category_name?: string;
  variations?: ShopeeApiVariation[];
}

export class ShopeeAdapter implements MarketplaceAdapter {
  public readonly marketplace = 'shopee';

  constructor(private readonly apiClient?: { listProducts(): Promise<ShopeeApiProduct[]>; createItem(payload: unknown): Promise<unknown>; }) {}

  toUniversalFormat(data: ShopeeApiProduct): ProdutoUniversal {
    const imagens = this.extractImages(data);
    const variacoes = (data.variations || []).map((variation): VariacaoUniversal => ({
      id: String(variation.model_id),
      sku: String(variation.model_sku || data.item_sku || `SHP-${data.item_id}`),
      titulo: variation.model_name,
      preco: Number(variation.price ?? data.price ?? 0),
      estoque: Number(variation.stock_setting?.normal_stock ?? 0),
      atributos: variation.tier_index ? { tier_index: variation.tier_index.join(',') } : undefined,
      imagens
    }));

    return {
      id_interno: `shopee:${String(data.item_id)}`,
      sku: String(data.item_sku || variacoes[0]?.sku || `SHP-${data.item_id}`),
      titulo: data.item_name,
      descricao: data.description || '',
      preco: Number(data.price || 0),
      estoque: Number(data.stock_setting?.normal_stock ?? variacoes.reduce((sum, item) => sum + Number(item.estoque || 0), 0)),
      imagens,
      variacoes,
      categorias: data.category_id
        ? [{ marketplace: this.marketplace, categoria_id: String(data.category_id), nome: data.category_name }]
        : [],
      metadata: {
        origem: this.marketplace,
        raw_item_id: String(data.item_id)
      }
    };
  }

  toMarketplaceFormat(product: ProdutoUniversal): ShopeeApiProduct {
    return {
      item_id: product.id_interno,
      item_name: product.titulo,
      description: product.descricao,
      item_sku: product.sku,
      price: product.preco,
      stock_setting: {
        normal_stock: product.estoque
      },
      image: {
        image_url_list: product.imagens
      },
      category_id: product.categorias[0]?.categoria_id,
      category_name: product.categorias[0]?.nome,
      variations: product.variacoes.map((variation) => ({
        model_id: variation.id || variation.sku,
        model_sku: variation.sku,
        model_name: variation.titulo,
        price: variation.preco,
        stock_setting: {
          normal_stock: variation.estoque
        }
      }))
    };
  }

  async getProducts(): Promise<ProdutoUniversal[]> {
    if (!this.apiClient) {
      return [this.toUniversalFormat(this.getMockShopeePayload())];
    }

    const products = await this.apiClient.listProducts();
    return products.map((product) => this.toUniversalFormat(product));
  }

  async createProduct(product: ProdutoUniversal): Promise<unknown> {
    const payload = this.toMarketplaceFormat(product);

    if (!this.apiClient) {
      return {
        success: true,
        marketplace: this.marketplace,
        payload
      };
    }

    return this.apiClient.createItem(payload);
  }

  private extractImages(data: ShopeeApiProduct): string[] {
    const imageList = data.image?.image_url_list || [];
    const nestedImages = (data.image?.images || []).map((image) => image.image_url);
    return [...new Set([...imageList, ...nestedImages].filter(Boolean))];
  }

  private getMockShopeePayload(): ShopeeApiProduct {
    return {
      item_id: 908172635,
      item_name: 'Camiseta Dry Fit Premium Preta',
      description: 'Camiseta esportiva com secagem rápida e modelagem regular.',
      item_sku: 'CAM-PRETA-G',
      price: 79.9,
      stock_setting: {
        normal_stock: 12
      },
      image: {
        image_url_list: [
          'https://cdn.exemplo.com/shopee/cam-preta-frente.jpg'
        ]
      },
      category_id: 456,
      category_name: 'Moda Masculina > Camisetas',
      variations: [
        {
          model_id: 1,
          model_sku: 'CAM-PRETA-P',
          model_name: 'Preta / P',
          price: 79.9,
          stock_setting: { normal_stock: 3 }
        },
        {
          model_id: 2,
          model_sku: 'CAM-PRETA-M',
          model_name: 'Preta / M',
          price: 79.9,
          stock_setting: { normal_stock: 4 }
        },
        {
          model_id: 3,
          model_sku: 'CAM-PRETA-G',
          model_name: 'Preta / G',
          price: 79.9,
          stock_setting: { normal_stock: 5 }
        }
      ]
    };
  }
}