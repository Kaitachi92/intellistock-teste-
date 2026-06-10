import { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import {
  ProdutoLocalRecord,
  ProdutoLocalRepository,
  SyncFailureRepository,
  SyncJob,
  VinculoAnuncioRecord,
  VinculoAnuncioRepository
} from '../sync/stock-sync-engine';

export interface LojaIntegradaRecord {
  id: string;
  cliente_id: number;
  marketplace: string;
  nome_loja: string | null;
  token_acesso: string;
  token_atualizacao: string | null;
  expira_em: Date | null;
  status: string;
  seller_id: string | null;
  metadata_json: string | null;
}

export interface CreateLojaIntegradaInput {
  cliente_id: number;
  marketplace: string;
  nome_loja?: string;
  token_acesso: string;
  token_atualizacao?: string;
  expira_em?: string | null;
  status?: string;
  seller_id?: string;
  metadata_json?: Record<string, unknown>;
}

export interface CreateProdutoLocalInput {
  cliente_id: number;
  sku: string;
  titulo: string;
  preco: number;
  quantidade: number;
  descricao?: string;
}

export interface CreateVinculoInput {
  produto_local_id: string;
  loja_integrada_id: string;
  marketplace_produto_id: string;
  sku_marketplace?: string;
  url_anuncio?: string;
  status_sincronizacao?: string;
}

function getDbPool(): Pool {
  const db = (global as typeof globalThis & { db?: Pool }).db;
  if (!db) {
    throw new Error('Banco de dados não disponível para o Hub Multi-canal.');
  }

  return db;
}

export class MySqlHubSchema {
  private initialized = false;

  async ensureSchema(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const db = getDbPool();

    await db.query(`
      CREATE TABLE IF NOT EXISTS lojas_integradas (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        cliente_id INT NOT NULL,
        marketplace VARCHAR(50) NOT NULL,
        nome_loja VARCHAR(150) NULL,
        token_acesso TEXT NOT NULL,
        token_atualizacao TEXT NULL,
        expira_em TIMESTAMP NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'ativa',
        seller_id VARCHAR(80) NULL,
        metadata_json LONGTEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_lojas_integradas_cliente_marketplace_nome (cliente_id, marketplace, nome_loja(100)),
        INDEX idx_lojas_integradas_cliente_marketplace (cliente_id, marketplace),
        INDEX idx_lojas_integradas_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS produtos_locais (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        cliente_id INT NOT NULL,
        sku VARCHAR(100) NOT NULL,
        titulo VARCHAR(255) NOT NULL,
        preco DECIMAL(14, 2) NOT NULL,
        quantidade INT NOT NULL DEFAULT 0,
        descricao TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_produtos_locais_cliente_sku (cliente_id, sku),
        INDEX idx_produtos_locais_sku (sku),
        INDEX idx_produtos_locais_cliente_id (cliente_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS vinculo_anuncios (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        produto_local_id BIGINT NOT NULL,
        loja_integrada_id BIGINT NOT NULL,
        marketplace_produto_id VARCHAR(120) NOT NULL,
        sku_marketplace VARCHAR(100) NULL,
        url_anuncio TEXT NULL,
        status_sincronizacao VARCHAR(30) NOT NULL DEFAULT 'sincronizado',
        ultima_sincronizacao_em TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_vinculo_anuncios_produto_local FOREIGN KEY (produto_local_id) REFERENCES produtos_locais(id) ON DELETE CASCADE,
        CONSTRAINT fk_vinculo_anuncios_loja_integrada FOREIGN KEY (loja_integrada_id) REFERENCES lojas_integradas(id) ON DELETE CASCADE,
        UNIQUE KEY uq_vinculo_loja_anuncio (loja_integrada_id, marketplace_produto_id),
        UNIQUE KEY uq_vinculo_produto_loja (produto_local_id, loja_integrada_id),
        INDEX idx_vinculo_anuncios_produto_local (produto_local_id),
        INDEX idx_vinculo_anuncios_marketplace_produto_id (marketplace_produto_id),
        INDEX idx_vinculo_anuncios_status (status_sincronizacao)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS mercadolivre_config (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        cliente_id INT NOT NULL,
        access_token TEXT NOT NULL,
        refresh_token TEXT NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        user_id VARCHAR(100) NOT NULL,
        seller_id VARCHAR(100) NULL,
        marketplace VARCHAR(50) NOT NULL DEFAULT 'mercado_livre',
        status VARCHAR(30) NOT NULL DEFAULT 'ativa',
        metadata_json LONGTEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_mercadolivre_config_cliente_user (cliente_id, user_id),
        INDEX idx_mercadolivre_config_cliente (cliente_id),
        INDEX idx_mercadolivre_config_expires_at (expires_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS produtos_integrados (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        produto_local_id BIGINT NOT NULL,
        loja_integrada_id BIGINT NULL,
        marketplace VARCHAR(50) NOT NULL DEFAULT 'mercado_livre',
        sku VARCHAR(100) NOT NULL,
        item_id VARCHAR(120) NOT NULL,
        preco DECIMAL(14,2) NOT NULL,
        quantidade INT NOT NULL DEFAULT 0,
        url_imagem TEXT NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'publicado',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_produtos_integrados_produto_local FOREIGN KEY (produto_local_id) REFERENCES produtos_locais(id) ON DELETE CASCADE,
        CONSTRAINT fk_produtos_integrados_loja_integrada FOREIGN KEY (loja_integrada_id) REFERENCES lojas_integradas(id) ON DELETE SET NULL,
        UNIQUE KEY uq_produtos_integrados_item (marketplace, item_id),
        UNIQUE KEY uq_produtos_integrados_produto_loja (produto_local_id, loja_integrada_id),
        INDEX idx_produtos_integrados_sku (sku),
        INDEX idx_produtos_integrados_produto_local (produto_local_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS hub_sync_failures (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        loja_integrada_id BIGINT NULL,
        marketplace VARCHAR(50) NOT NULL,
        marketplace_produto_id VARCHAR(120) NOT NULL,
        sku VARCHAR(100) NOT NULL,
        quantity INT NOT NULL,
        attempts INT NOT NULL DEFAULT 0,
        error_message TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_hub_sync_failures_marketplace_produto (marketplace, marketplace_produto_id),
        INDEX idx_hub_sync_failures_sku (sku)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await db.query(`
      ALTER TABLE lojas_integradas
        ADD COLUMN IF NOT EXISTS seller_id VARCHAR(80) NULL AFTER status
    `).catch(() => {});
    await db.query(`
      ALTER TABLE lojas_integradas
        ADD COLUMN IF NOT EXISTS metadata_json LONGTEXT NULL AFTER seller_id
    `).catch(() => {});
    await db.query(`
      ALTER TABLE lojas_integradas
        ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    `).catch(() => {});
    await db.query(`
      ALTER TABLE lojas_integradas
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    `).catch(() => {});
    await db.query(`
      UPDATE lojas_integradas
         SET metadata_json = CAST(credenciais_json AS CHAR)
       WHERE metadata_json IS NULL AND credenciais_json IS NOT NULL
    `).catch(() => {});

    await db.query(`
      ALTER TABLE produtos_locais
        ADD COLUMN IF NOT EXISTS cliente_id INT NULL AFTER id
    `).catch(() => {});
    await db.query(`
      ALTER TABLE produtos_locais
        ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    `).catch(() => {});
    await db.query(`
      ALTER TABLE produtos_locais
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    `).catch(() => {});

    await db.query(`
      ALTER TABLE vinculo_anuncios
        ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    `).catch(() => {});
    await db.query(`
      ALTER TABLE vinculo_anuncios
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    `).catch(() => {});

    this.initialized = true;
  }
}

export class MySqlProdutoLocalRepository implements ProdutoLocalRepository {
  async findBySku(sku: string): Promise<ProdutoLocalRecord | null> {
    const db = getDbPool();
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT id, sku, quantidade FROM produtos_locais WHERE sku = ? LIMIT 1`,
      [sku]
    );

    if (!rows.length) {
      return null;
    }

    return {
      id: String(rows[0].id),
      sku: String(rows[0].sku),
      quantidade: Number(rows[0].quantidade || 0)
    };
  }

  async decrementStock(productId: string, quantity: number): Promise<ProdutoLocalRecord> {
    const db = getDbPool();
    await db.query(
      `UPDATE produtos_locais
       SET quantidade = GREATEST(quantidade - ?, 0)
       WHERE id = ?`,
      [quantity, productId]
    );

    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT id, sku, quantidade FROM produtos_locais WHERE id = ? LIMIT 1`,
      [productId]
    );

    if (!rows.length) {
      throw new Error(`Produto local não encontrado: ${productId}`);
    }

    return {
      id: String(rows[0].id),
      sku: String(rows[0].sku),
      quantidade: Number(rows[0].quantidade || 0)
    };
  }

  async create(input: CreateProdutoLocalInput): Promise<string> {
    const db = getDbPool();
    const [result] = await db.query<ResultSetHeader>(
      `INSERT INTO produtos_locais (cliente_id, sku, titulo, preco, quantidade, descricao)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         titulo = VALUES(titulo),
         preco = VALUES(preco),
         quantidade = VALUES(quantidade),
         descricao = VALUES(descricao),
         updated_at = CURRENT_TIMESTAMP`,
      [input.cliente_id, input.sku, input.titulo, input.preco, input.quantidade, input.descricao || null]
    );

    if (result.insertId) {
      return String(result.insertId);
    }

    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT id FROM produtos_locais WHERE cliente_id = ? AND sku = ? LIMIT 1`,
      [input.cliente_id, input.sku]
    );
    return String(rows[0].id);
  }

  async findById(id: string): Promise<RowDataPacket | null> {
    const db = getDbPool();
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT * FROM produtos_locais WHERE id = ? LIMIT 1`,
      [id]
    );
    return rows[0] || null;
  }

  async listByCliente(clienteId: number): Promise<RowDataPacket[]> {
    const db = getDbPool();
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT * FROM produtos_locais WHERE cliente_id = ? ORDER BY id DESC`,
      [clienteId]
    );

    return rows;
  }
}

export class MySqlVinculoAnuncioRepository implements VinculoAnuncioRepository {
  async findOtherChannelsByProductId(productId: string, sourceMarketplace: string): Promise<VinculoAnuncioRecord[]> {
    const db = getDbPool();
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT va.id, va.produto_local_id, li.marketplace, va.loja_integrada_id, va.marketplace_produto_id
       FROM vinculo_anuncios va
       JOIN lojas_integradas li ON li.id = va.loja_integrada_id
       WHERE va.produto_local_id = ?
         AND li.marketplace <> ?
         AND li.status = 'ativa'`,
      [productId, sourceMarketplace]
    );

    return rows.map((row) => ({
      id: String(row.id),
      produto_local_id: String(row.produto_local_id),
      marketplace: String(row.marketplace),
      loja_integrada_id: String(row.loja_integrada_id),
      marketplace_produto_id: String(row.marketplace_produto_id)
    }));
  }

  async create(input: CreateVinculoInput): Promise<string> {
    const db = getDbPool();
    const [result] = await db.query<ResultSetHeader>(
      `INSERT INTO vinculo_anuncios
        (produto_local_id, loja_integrada_id, marketplace_produto_id, sku_marketplace, url_anuncio, status_sincronizacao)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         sku_marketplace = VALUES(sku_marketplace),
         url_anuncio = VALUES(url_anuncio),
         status_sincronizacao = VALUES(status_sincronizacao),
         updated_at = CURRENT_TIMESTAMP`,
      [
        input.produto_local_id,
        input.loja_integrada_id,
        input.marketplace_produto_id,
        input.sku_marketplace || null,
        input.url_anuncio || null,
        input.status_sincronizacao || 'sincronizado'
      ]
    );

    if (result.insertId) {
      return String(result.insertId);
    }

    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT id FROM vinculo_anuncios WHERE loja_integrada_id = ? AND marketplace_produto_id = ? LIMIT 1`,
      [input.loja_integrada_id, input.marketplace_produto_id]
    );
    return String(rows[0].id);
  }

  async listByCliente(clienteId: number): Promise<RowDataPacket[]> {
    const db = getDbPool();
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT
         va.*,
         pl.titulo AS produto_titulo,
         pl.sku AS produto_sku,
         li.marketplace,
         li.nome_loja
       FROM vinculo_anuncios va
       JOIN produtos_locais pl ON pl.id = va.produto_local_id
       JOIN lojas_integradas li ON li.id = va.loja_integrada_id
       WHERE pl.cliente_id = ?
       ORDER BY va.id DESC`,
      [clienteId]
    );

    return rows;
  }
}

export class MySqlLojasIntegradasRepository {
  async create(input: CreateLojaIntegradaInput): Promise<string> {
    const db = getDbPool();
    const [result] = await db.query<ResultSetHeader>(
      `INSERT INTO lojas_integradas
        (cliente_id, marketplace, nome_loja, token_acesso, token_atualizacao, expira_em, status, seller_id, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         token_acesso = VALUES(token_acesso),
         token_atualizacao = VALUES(token_atualizacao),
         expira_em = VALUES(expira_em),
         status = VALUES(status),
         seller_id = VALUES(seller_id),
         metadata_json = VALUES(metadata_json),
         updated_at = CURRENT_TIMESTAMP`,
      [
        input.cliente_id,
        input.marketplace,
        input.nome_loja || null,
        input.token_acesso,
        input.token_atualizacao || null,
        input.expira_em || null,
        input.status || 'ativa',
        input.seller_id || null,
        JSON.stringify(input.metadata_json || {})
      ]
    );

    if (result.insertId) {
      return String(result.insertId);
    }

    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT id FROM lojas_integradas WHERE cliente_id = ? AND marketplace = ? AND COALESCE(nome_loja, '') = COALESCE(?, '') LIMIT 1`,
      [input.cliente_id, input.marketplace, input.nome_loja || null]
    );
    return String(rows[0].id);
  }

  async findById(id: string): Promise<LojaIntegradaRecord | null> {
    const db = getDbPool();
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT * FROM lojas_integradas WHERE id = ? LIMIT 1`,
      [id]
    );

    if (!rows.length) {
      return null;
    }

    const row = rows[0];
    return {
      id: String(row.id),
      cliente_id: Number(row.cliente_id),
      marketplace: String(row.marketplace),
      nome_loja: row.nome_loja ? String(row.nome_loja) : null,
      token_acesso: String(row.token_acesso),
      token_atualizacao: row.token_atualizacao ? String(row.token_atualizacao) : null,
      expira_em: row.expira_em ? new Date(row.expira_em) : null,
      status: String(row.status),
      seller_id: row.seller_id ? String(row.seller_id) : null,
      metadata_json: row.metadata_json ? String(row.metadata_json) : null
    };
  }

  async listByCliente(clienteId: number): Promise<LojaIntegradaRecord[]> {
    const db = getDbPool();
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT * FROM lojas_integradas WHERE cliente_id = ? ORDER BY id DESC`,
      [clienteId]
    );

    return rows.map((row) => ({
      id: String(row.id),
      cliente_id: Number(row.cliente_id),
      marketplace: String(row.marketplace),
      nome_loja: row.nome_loja ? String(row.nome_loja) : null,
      token_acesso: String(row.token_acesso),
      token_atualizacao: row.token_atualizacao ? String(row.token_atualizacao) : null,
      expira_em: row.expira_em ? new Date(row.expira_em) : null,
      status: String(row.status),
      seller_id: row.seller_id ? String(row.seller_id) : null,
      metadata_json: row.metadata_json ? String(row.metadata_json) : null
    }));
  }
}

export class MySqlSyncFailureRepository implements SyncFailureRepository {
  async register(job: SyncJob, error: Error): Promise<void> {
    const db = getDbPool();
    await db.query(
      `INSERT INTO hub_sync_failures
        (loja_integrada_id, marketplace, marketplace_produto_id, sku, quantity, attempts, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [job.lojaIntegradaId, job.marketplace, job.marketplaceProductId, job.sku, job.quantity, job.attempts, error.message]
    );
  }
}