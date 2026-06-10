CREATE DATABASE IF NOT EXISTS estoque_db;
USE estoque_db;

CREATE TABLE IF NOT EXISTS lojas_integradas (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  cliente_id BIGINT NOT NULL,
  marketplace VARCHAR(50) NOT NULL,
  nome_loja VARCHAR(150) NULL,
  token_acesso TEXT NOT NULL,
  token_atualizacao TEXT NULL,
  expira_em TIMESTAMP NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'ativa',
  credenciais_json LONGTEXT NOT NULL,
  criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_loja_cliente_marketplace (cliente_id, marketplace, nome_loja),
  INDEX idx_lojas_integradas_cliente_marketplace (cliente_id, marketplace),
  INDEX idx_lojas_integradas_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS produtos_locais (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  sku VARCHAR(100) NOT NULL,
  titulo VARCHAR(255) NOT NULL,
  preco DECIMAL(14, 2) NOT NULL,
  quantidade INT NOT NULL DEFAULT 0,
  descricao TEXT NULL,
  atributos_json LONGTEXT NOT NULL,
  criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_produtos_locais_sku (sku),
  INDEX idx_produtos_locais_sku (sku),
  INDEX idx_produtos_locais_titulo (titulo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS vinculo_anuncios (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  produto_local_id BIGINT NOT NULL,
  loja_integrada_id BIGINT NOT NULL,
  marketplace_produto_id VARCHAR(120) NOT NULL,
  sku_marketplace VARCHAR(100) NULL,
  url_anuncio TEXT NULL,
  status_sincronizacao VARCHAR(30) NOT NULL DEFAULT 'sincronizado',
  ultima_sincronizacao_em TIMESTAMP NULL,
  hash_payload_ultimo_envio VARCHAR(128) NULL,
  criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_vinculo_loja_anuncio (loja_integrada_id, marketplace_produto_id),
  UNIQUE KEY uq_vinculo_produto_loja (produto_local_id, loja_integrada_id),
  INDEX idx_vinculo_anuncios_produto_local (produto_local_id),
  INDEX idx_vinculo_anuncios_marketplace_produto_id (marketplace_produto_id),
  INDEX idx_vinculo_anuncios_loja_status (loja_integrada_id, status_sincronizacao),
  CONSTRAINT fk_vinculo_anuncios_produto_local FOREIGN KEY (produto_local_id) REFERENCES produtos_locais(id) ON DELETE CASCADE,
  CONSTRAINT fk_vinculo_anuncios_loja_integrada FOREIGN KEY (loja_integrada_id) REFERENCES lojas_integradas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mapeamento_categorias (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  marketplace_origem VARCHAR(50) NOT NULL,
  categoria_origem_id VARCHAR(120) NOT NULL,
  marketplace_destino VARCHAR(50) NOT NULL,
  categoria_destino_id VARCHAR(120) NOT NULL,
  categoria_origem_nome VARCHAR(255) NULL,
  categoria_destino_nome VARCHAR(255) NULL,
  confianca SMALLINT NOT NULL DEFAULT 100,
  metadata_json LONGTEXT NOT NULL,
  criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_mapeamento_categorias (marketplace_origem, categoria_origem_id, marketplace_destino, categoria_destino_id),
  INDEX idx_mapeamento_categorias_origem (marketplace_origem, categoria_origem_id),
  INDEX idx_mapeamento_categorias_destino (marketplace_destino, categoria_destino_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;