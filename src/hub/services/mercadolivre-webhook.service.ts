import { findProdutoIntegradoByItemId, updateProdutoIntegradoQuantity } from './mercadolivre-config.service';
import { MySqlProdutoLocalRepository } from '../infra/mysql-hub.repository';

function getPayloadItemId(payload: any): string | null {
  if (!payload) {
    return null;
  }

  return (
    payload.item_id ||
    payload.resource?.id ||
    payload.resource?.data?.id ||
    payload.data?.item_id ||
    payload.data?.id ||
    payload.topic ||
    null
  );
}

function getPayloadQuantity(payload: any): number {
  const candidate =
    payload.quantity ||
    payload.sold_quantity ||
    payload.resource?.quantity ||
    payload.resource?.data?.quantity ||
    payload.data?.quantity ||
    1;

  const qty = Number(candidate);
  return Number.isNaN(qty) || qty < 1 ? 1 : qty;
}

export async function handleMercadoLivreWebhook(payload: any): Promise<void> {
  const itemId = getPayloadItemId(payload);
  if (!itemId) {
    throw new Error('item_id não encontrado no payload do webhook Mercado Livre.');
  }

  const quantity = getPayloadQuantity(payload);
  const mapping = await findProdutoIntegradoByItemId(String(itemId));
  if (!mapping) {
    throw new Error(`Nenhum produto integrado encontrado para item_id ${itemId}.`);
  }

  const produtoRepo = new MySqlProdutoLocalRepository();
  await produtoRepo.decrementStock(mapping.produto_local_id, quantity);
  await updateProdutoIntegradoQuantity(mapping.produto_local_id, quantity);
}
