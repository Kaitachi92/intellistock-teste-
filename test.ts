interface ProdutoUniversal {
  id_interno: string;
  sku: string;
  titulo: string;
  preco: number;
  quantidade: number;
  descricao: string;
  imagens: string[];
}

interface MarketplaceAdapter {
  toUniversalFormat(apiData: any): ProdutoUniversal;
  toMarketplaceFormat(universalData: ProdutoUniversal): any;
}

class ShopeeAdapter implements MarketplaceAdapter {
  toUniversalFormat(apiData: any): ProdutoUniversal {
    return {
      id_interno: String(apiData.item_id),
      sku: String(apiData.item_sku || apiData.model_sku || `SHP-${apiData.item_id}`),
      titulo: String(apiData.item_name || 'Sem título'),
      preco: Number(apiData.price || 0),
      quantidade: Number(apiData.stock_setting?.normal_stock ?? 0),
      descricao: String(apiData.description || ''),
      imagens: Array.isArray(apiData.images)
        ? apiData.images.map((image: string) => String(image))
        : []
    };
  }

  toMarketplaceFormat(universalData: ProdutoUniversal): any {
    return {
      item_id: universalData.id_interno,
      item_name: universalData.titulo,
      item_sku: universalData.sku,
      price: universalData.preco,
      stock_setting: {
        normal_stock: universalData.quantidade
      },
      description: universalData.descricao,
      images: universalData.imagens
    };
  }
}

class MercadoLivreAdapter implements MarketplaceAdapter {
  toUniversalFormat(apiData: any): ProdutoUniversal {
    return {
      id_interno: String(apiData.id || ''),
      sku: String(apiData.seller_custom_field || ''),
      titulo: String(apiData.title || ''),
      preco: Number(apiData.price || 0),
      quantidade: Number(apiData.available_quantity || 0),
      descricao: String(apiData.description || ''),
      imagens: Array.isArray(apiData.pictures)
        ? apiData.pictures.map((picture: { url: string }) => String(picture.url))
        : []
    };
  }

  toMarketplaceFormat(universalData: ProdutoUniversal): any {
    return {
      title: universalData.titulo.substring(0, 60),
      price: universalData.preco,
      available_quantity: universalData.quantidade,
      condition: 'new',
      seller_custom_field: universalData.sku,
      buying_mode: 'buy_it_now',
      listing_type_id: 'gold_special',
      pictures: universalData.imagens.map((url) => ({ url })),
      description: {
        plain_text: universalData.descricao
      }
    };
  }
}

class ProdutoRepositoryInMemory {
  private produtos: ProdutoUniversal[] = [];

  salvar(produto: ProdutoUniversal): void {
    const existingIndex = this.produtos.findIndex((item) => item.sku === produto.sku);

    if (existingIndex >= 0) {
      this.produtos[existingIndex] = produto;
      return;
    }

    this.produtos.push(produto);
  }

  buscarPorSku(sku: string): ProdutoUniversal | undefined {
    return this.produtos.find((produto) => produto.sku === sku);
  }

  listarTodos(): ProdutoUniversal[] {
    return [...this.produtos];
  }
}

async function main(): Promise<void> {
  const shopeeJson = {
    item_id: 102030,
    item_name: 'Teclado Mecânico RGB Gamer Switch Blue Hot Swap com Apoio de Pulso Premium',
    item_sku: 'TEC-RGB-001',
    price: 250.0,
    stock_setting: {
      normal_stock: 15
    },
    description: 'Teclado mecânico com iluminação RGB, estrutura reforçada e layout ABNT2.',
    images: [
      'https://cdn.exemplo.com/produtos/teclado-rgb-principal.jpg',
      'https://cdn.exemplo.com/produtos/teclado-rgb-lateral.jpg'
    ]
  };

  const shopeeAdapter = new ShopeeAdapter();
  const mercadoLivreAdapter = new MercadoLivreAdapter();
  const repository = new ProdutoRepositoryInMemory();

  const produtoUniversal = shopeeAdapter.toUniversalFormat(shopeeJson);
  repository.salvar(produtoUniversal);

  const produtoRecuperado = repository.buscarPorSku(produtoUniversal.sku);
  if (!produtoRecuperado) {
    throw new Error(`Produto com SKU ${produtoUniversal.sku} não foi encontrado no repositório.`);
  }

  const mercadoLivreJson = mercadoLivreAdapter.toMarketplaceFormat(produtoRecuperado);

  console.log('\n=== 1) JSON original da Shopee ===');
  console.log(JSON.stringify(shopeeJson, null, 2));

  console.log('\n=== 2) Formato universal salvo em memória ===');
  console.log(JSON.stringify(produtoRecuperado, null, 2));

  console.log('\n=== 3) Payload exportado para Mercado Livre ===');
  console.log(JSON.stringify(mercadoLivreJson, null, 2));

  console.log('\n=== Produtos persistidos no repositório em memória ===');
  console.log(JSON.stringify(repository.listarTodos(), null, 2));
}

main().catch((error) => {
  console.error('Falha na execução do teste do hub multi-canal:', error);
  process.exit(1);
});