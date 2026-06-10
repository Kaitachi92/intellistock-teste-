import axios, { AxiosInstance } from 'axios';
import { MarketplaceAdapter } from './marketplace-adapter';
import { ProdutoUniversal } from '../domain/produto-universal';

export interface MercadoLivreAdapterOptions {
  accessToken: string;
  sellerId?: string;
  baseUrl?: string;
}

interface MercadoLivreApiItem {
  id: string;
  title: string;
  price: number;
  available_quantity: number;
  seller_custom_field?: string;
  category_id?: string;
  pictures?: Array<{ url: string }>;
  attributes?: Array<{ id: string; value_name?: string }>;
  condition?: string;
}

export class MercadoLivreAdapter implements MarketplaceAdapter {
  public readonly marketplace = 'mercado_livre';

  private readonly httpClient: AxiosInstance;
  private readonly sellerId?: string;

  constructor(options: MercadoLivreAdapterOptions) {
    this.sellerId = options.sellerId;
    this.httpClient = axios.create({
      baseURL: options.baseUrl || 'https://api.mercadolibre.com',
      timeout: 15000,
      headers: {
        Authorization: `Bearer ${options.accessToken}`,
        'Content-Type': 'application/json'
      }
    });
  }

  toUniversalFormat(data: MercadoLivreApiItem): ProdutoUniversal {
    return {
      id_interno: `mercado_livre:${data.id}`,
      sku: String(data.seller_custom_field || data.id),
      titulo: data.title,
      descricao: '',
      preco: Number(data.price || 0),
      estoque: Number(data.available_quantity || 0),
      imagens: (data.pictures || []).map((picture) => picture.url).filter(Boolean),
      variacoes: [],
      categorias: data.category_id ? [{ marketplace: this.marketplace, categoria_id: data.category_id }] : [],
      atributos: (data.attributes || []).reduce<Record<string, string>>((acc, attribute) => {
        if (attribute.id && attribute.value_name) {
          acc[attribute.id] = attribute.value_name;
        }
        return acc;
      }, {}),
      metadata: {
        origem: this.marketplace,
        item_id: data.id,
        condition: data.condition || 'new'
      }
    };
  }

  toMarketplaceFormat(product: ProdutoUniversal): MercadoLivreApiItem {
    return {
      id: product.id_interno,
      title: product.titulo.substring(0, 60),
      price: Number(product.preco || 0),
      available_quantity: Number(product.estoque || 0),
      seller_custom_field: product.sku,
      category_id: product.categorias[0]?.categoria_id,
      condition: 'new',
      pictures: product.imagens.map((url) => ({ url })),
      attributes: Object.entries(product.atributos || {}).map(([id, value]) => ({
        id,
        value_name: String(value)
      }))
    };
  }

  async getProducts(): Promise<ProdutoUniversal[]> {
    if (!this.sellerId) {
      throw new Error('sellerId é obrigatório para listar produtos no Mercado Livre.');
    }

    const searchResponse = await this.httpClient.get<{ results: string[] }>(`/users/${this.sellerId}/items/search`);
    const itemIds = searchResponse.data?.results || [];
    if (!itemIds.length) {
      return [];
    }

    const itemsResponse = await this.httpClient.get<Array<{ body: MercadoLivreApiItem }>>('/items', {
      params: {
        ids: itemIds.join(',')
      }
    });

    return (itemsResponse.data || []).map((item) => this.toUniversalFormat(item.body));
  }

  async createProduct(product: ProdutoUniversal): Promise<any> {
    const payload = {
      title: product.titulo.substring(0, 60),
      price: Number(product.preco || 0),
      available_quantity: Number(product.estoque || 0),
      category_id: product.categorias[0]?.categoria_id,
      seller_custom_field: product.sku,
      condition: 'new',
      buying_mode: 'buy_it_now',
      listing_type_id: 'gold_special',
      pictures: product.imagens.map((url) => ({ source: url })),
      attributes: Object.entries(product.atributos || {}).map(([id, value]) => ({
        id,
        value_name: String(value)
      }))
    };

    const response = await this.httpClient.post('/items', payload);
    return response.data;
  }

  async addDescription(itemId: string, plainText: string): Promise<any> {
    const response = await this.httpClient.post(
      `/items/${encodeURIComponent(itemId)}/description`,
      { plain_text: plainText }
    );

    return response.data;
  }

  async updateStock(marketplaceProductId: string, quantity: number): Promise<void> {
    await this.httpClient.put(`/items/${marketplaceProductId}`, {
      available_quantity: Number(quantity || 0)
    });
  }
}