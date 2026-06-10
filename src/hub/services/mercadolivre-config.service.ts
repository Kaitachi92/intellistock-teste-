import { Pool } from 'mysql2/promise';
const { getPool } = require('../../config/database');

export interface MercadoLivreConfigRecord {
  id: string;
  cliente_id: number;
  access_token: string;
  refresh_token: string;
  expires_at: Date;
  user_id: string;
  seller_id: string | null;
  marketplace: string;
  status: string;
  metadata_json: Record<string, unknown> | null;
}

export interface ProdutoIntegradoRecord {
  id: string;
  produto_local_id: string;
  loja_integrada_id: string | null;
  marketplace: string;
  sku: string;
  item_id: string;
  preco: number;
  quantidade: number;
  url_imagem: string | null;
  status: string;
}

function getDb(): Pool {
  const pool = getPool();
  if (!pool) {
    throw new Error('Banco de dados não disponível.');
  }
  return pool;
}

export async function saveMercadoLivreConfig(data: {
  cliente_id: number;
  access_token: string;
  refresh_token: string;
  expires_at: Date;
  user_id: string;
  seller_id?: string | null;
  metadata_json?: Record<string, unknown>;
}): Promise<void> {
  const db = getDb();
  await db.query(
    `INSERT INTO mercadolivre_config
      (cliente_id, access_token, refresh_token, expires_at, user_id, seller_id, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       access_token = VALUES(access_token),
       refresh_token = VALUES(refresh_token),
       expires_at = VALUES(expires_at),
       seller_id = VALUES(seller_id),
       metadata_json = VALUES(metadata_json),
       updated_at = CURRENT_TIMESTAMP`,
    [
      data.cliente_id,
      data.access_token,
      data.refresh_token,
      data.expires_at,
      data.user_id,
      data.seller_id || null,
      JSON.stringify(data.metadata_json || {})
    ]
  );
}

export async function getMercadoLivreConfigByClienteId(clienteId: number): Promise<MercadoLivreConfigRecord | null> {
  const db = getDb();
  const [rows] = await db.query<any[]>(
    `SELECT * FROM mercadolivre_config WHERE cliente_id = ? ORDER BY id DESC LIMIT 1`,
    [clienteId]
  );

  if (!rows.length) {
    return null;
  }

  const row = rows[0];
  return {
    id: String(row.id),
    cliente_id: Number(row.cliente_id),
    access_token: String(row.access_token),
    refresh_token: String(row.refresh_token),
    expires_at: new Date(row.expires_at),
    user_id: String(row.user_id),
    seller_id: row.seller_id ? String(row.seller_id) : null,
    marketplace: String(row.marketplace),
    status: String(row.status),
    metadata_json: row.metadata_json ? JSON.parse(String(row.metadata_json)) : null
  };
}

export async function updateMercadoLivreConfigTokens(clienteId: number, data: {
  access_token: string;
  refresh_token: string;
  expires_at: Date;
}): Promise<void> {
  const db = getDb();
  await db.query(
    `UPDATE mercadolivre_config
       SET access_token = ?,
           refresh_token = ?,
           expires_at = ?,
           updated_at = CURRENT_TIMESTAMP
     WHERE cliente_id = ?`,
    [data.access_token, data.refresh_token, data.expires_at, clienteId]
  );
}

export async function saveProdutoIntegrado(record: {
  produto_local_id: string;
  loja_integrada_id?: string | null;
  marketplace?: string;
  sku: string;
  item_id: string;
  preco: number;
  quantidade: number;
  url_imagem?: string | null;
}): Promise<void> {
  const db = getDb();
  await db.query(
    `INSERT INTO produtos_integrados
      (produto_local_id, loja_integrada_id, marketplace, sku, item_id, preco, quantidade, url_imagem)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       sku = VALUES(sku),
       preco = VALUES(preco),
       quantidade = VALUES(quantidade),
       url_imagem = VALUES(url_imagem),
       updated_at = CURRENT_TIMESTAMP`,
    [
      record.produto_local_id,
      record.loja_integrada_id || null,
      record.marketplace || 'mercado_livre',
      record.sku,
      record.item_id,
      record.preco,
      record.quantidade,
      record.url_imagem || null
    ]
  );
}

export async function findProdutoIntegradoByItemId(itemId: string): Promise<{ produto_local_id: string; item_id: string } | null> {
  const db = getDb();
  const [rows] = await db.query<any[]>(
    `SELECT produto_local_id, item_id
     FROM produtos_integrados
     WHERE item_id = ? AND marketplace = 'mercado_livre'
     LIMIT 1`,
    [itemId]
  );

  if (!rows.length) {
    return null;
  }

  return {
    produto_local_id: String(rows[0].produto_local_id),
    item_id: String(rows[0].item_id)
  };
}

export async function updateProdutoIntegradoQuantity(produtoLocalId: string, quantity: number): Promise<void> {
  const db = getDb();
  await db.query(
    `UPDATE produtos_integrados
       SET quantidade = GREATEST(?, 0),
           updated_at = CURRENT_TIMESTAMP
     WHERE produto_local_id = ? AND marketplace = 'mercado_livre'`,
    [quantity, produtoLocalId]
  );
}
