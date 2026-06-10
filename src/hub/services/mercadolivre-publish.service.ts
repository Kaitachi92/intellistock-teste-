import { MercadoLivreAdapter } from '../adapters/mercado-livre-adapter';
import { generateMercadoLivreContent } from './mercadolivre-ai.service';
import { refreshAccessTokenIfNeeded } from './mercadolivre-token.service';
import { saveProdutoIntegrado } from './mercadolivre-config.service';
import {
  MySqlLojasIntegradasRepository,
  MySqlProdutoLocalRepository,
  MySqlVinculoAnuncioRepository
} from '../infra/mysql-hub.repository';

interface PublishParams {
  clienteId: number;
  produtoLocalId: string;
  lojaIntegradaId: string;
  imagemUrl: string;
}

function normalizeCategory(category: string): string {
  const raw = String(category || '').trim();
  const categoryKey = raw.toLowerCase();

  if (/MLB\d+/i.test(raw)) {
    return raw.match(/MLB\d+/i)![0].toUpperCase();
  }

  const map: Record<string, string> = {
    'celulares e telefones': 'MLB1052',
    'celulares': 'MLB1052',
    'smartphones': 'MLB1052',
    'informática': 'MLB1648',
    'eletrodomésticos': 'MLB1574',
    'roupas': 'MLB1430',
    'calçados': 'MLB1431',
    'belezas e cuidados pessoais': 'MLB5726',
    'brinquedos': 'MLB1132',
    'casa e jardim': 'MLB2730',
    'ferramentas': 'MLB3675'
  };

  return map[categoryKey] || 'MLB1051';
}

export async function publishProductOnMercadoLivre(params: PublishParams): Promise<any> {
  const lojasRepo = new MySqlLojasIntegradasRepository();
  const produtoRepo = new MySqlProdutoLocalRepository();
  const vinculoRepo = new MySqlVinculoAnuncioRepository();

  const store = await lojasRepo.findById(params.lojaIntegradaId);
  if (!store) {
    throw new Error('Loja integrada Mercado Livre não encontrada.');
  }

  if (store.marketplace !== 'mercado_livre') {
    throw new Error('Loja integrada não é do Mercado Livre.');
  }

  if (!params.imagemUrl) {
    throw new Error('Informe a URL da imagem para publicação.');
  }

  const product = await produtoRepo.findById(params.produtoLocalId);
  if (!product) {
    throw new Error('Produto local não encontrado.');
  }

  const aiData = await generateMercadoLivreContent(String(product.titulo), Number(product.preco));
  const accessToken = await refreshAccessTokenIfNeeded(params.clienteId);

  const adapter = new MercadoLivreAdapter({
    accessToken,
    sellerId: store.seller_id || undefined
  });

  const universalProduct = {
    id_interno: String(product.id),
    sku: String(product.sku),
    titulo: String(product.titulo),
    descricao: String(product.descricao || ''),
    preco: Number(product.preco),
    estoque: Number(product.quantidade),
    imagens: [params.imagemUrl],
    variacoes: [],
    categorias: [{ marketplace: 'mercado_livre', categoria_id: normalizeCategory(aiData.categoria_sugerida) }],
    atributos: {
      BRAND: aiData.marca_sugerida,
      MODEL: aiData.modelo_sugerido
    }
  };

  const createdItem = await adapter.createProduct(universalProduct as any);
  const itemId = String(createdItem.id || createdItem.result?.id || createdItem.item_id || '');

  if (!itemId) {
    throw new Error('Resposta inválida da API Mercado Livre ao criar anúncio.');
  }

  await adapter.addDescription(itemId, aiData.descricao_completa);

  await saveProdutoIntegrado({
    produto_local_id: params.produtoLocalId,
    loja_integrada_id: params.lojaIntegradaId,
    sku: String(product.sku),
    item_id: itemId,
    preco: Number(product.preco),
    quantidade: Number(product.quantidade),
    url_imagem: params.imagemUrl
  });

  await vinculoRepo.create({
    produto_local_id: params.produtoLocalId,
    loja_integrada_id: params.lojaIntegradaId,
    marketplace_produto_id: itemId,
    sku_marketplace: String(product.sku),
    url_anuncio: `https://www.mercadolivre.com.br/p/${itemId}`
  });

  return {
    item_id: itemId,
    url: `https://www.mercadolivre.com.br/p/${itemId}`,
    categoria_sugerida: aiData.categoria_sugerida,
    marca_sugerida: aiData.marca_sugerida,
    modelo_sugerido: aiData.modelo_sugerido
  };
}
