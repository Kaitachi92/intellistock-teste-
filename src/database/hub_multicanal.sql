BEGIN;

CREATE TABLE IF NOT EXISTS lojas_integradas (
  id BIGSERIAL PRIMARY KEY,
  cliente_id BIGINT NOT NULL,
  marketplace VARCHAR(50) NOT NULL,
  nome_loja VARCHAR(150),
  token_acesso TEXT NOT NULL,
  token_atualizacao TEXT,
  expira_em TIMESTAMPTZ,
  status VARCHAR(30) NOT NULL DEFAULT 'ativa',
  credenciais_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_lojas_integradas_status CHECK (status IN ('ativa', 'expirada', 'revogada', 'pendente', 'erro_autenticacao')),
  CONSTRAINT uq_loja_cliente_marketplace UNIQUE (cliente_id, marketplace, nome_loja)
);

CREATE INDEX IF NOT EXISTS idx_lojas_integradas_cliente_marketplace
  ON lojas_integradas (cliente_id, marketplace);

CREATE INDEX IF NOT EXISTS idx_lojas_integradas_status
  ON lojas_integradas (status);

CREATE TABLE IF NOT EXISTS produtos_locais (
  id BIGSERIAL PRIMARY KEY,
  sku VARCHAR(100) NOT NULL,
  titulo VARCHAR(255) NOT NULL,
  preco NUMERIC(14, 2) NOT NULL,
  quantidade INTEGER NOT NULL DEFAULT 0,
  descricao TEXT,
  atributos_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_produtos_locais_sku UNIQUE (sku),
  CONSTRAINT chk_produtos_locais_quantidade CHECK (quantidade >= 0)
);

CREATE INDEX IF NOT EXISTS idx_produtos_locais_sku
  ON produtos_locais (sku);

CREATE INDEX IF NOT EXISTS idx_produtos_locais_titulo
  ON produtos_locais (titulo);

CREATE TABLE IF NOT EXISTS vinculo_anuncios (
  id BIGSERIAL PRIMARY KEY,
  produto_local_id BIGINT NOT NULL,
  loja_integrada_id BIGINT NOT NULL,
  marketplace_produto_id VARCHAR(120) NOT NULL,
  sku_marketplace VARCHAR(100),
  url_anuncio TEXT,
  status_sincronizacao VARCHAR(30) NOT NULL DEFAULT 'sincronizado',
  ultima_sincronizacao_em TIMESTAMPTZ,
  hash_payload_ultimo_envio VARCHAR(128),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_vinculo_anuncios_produto_local
    FOREIGN KEY (produto_local_id) REFERENCES produtos_locais (id) ON DELETE CASCADE,
  CONSTRAINT fk_vinculo_anuncios_loja_integrada
    FOREIGN KEY (loja_integrada_id) REFERENCES lojas_integradas (id) ON DELETE CASCADE,
  CONSTRAINT chk_vinculo_anuncios_status CHECK (status_sincronizacao IN ('sincronizado', 'pendente', 'erro', 'despublicado', 'pausado')),
  CONSTRAINT uq_vinculo_loja_anuncio UNIQUE (loja_integrada_id, marketplace_produto_id),
  CONSTRAINT uq_vinculo_produto_loja UNIQUE (produto_local_id, loja_integrada_id)
);

CREATE INDEX IF NOT EXISTS idx_vinculo_anuncios_produto_local
  ON vinculo_anuncios (produto_local_id);

CREATE INDEX IF NOT EXISTS idx_vinculo_anuncios_marketplace_produto_id
  ON vinculo_anuncios (marketplace_produto_id);

CREATE INDEX IF NOT EXISTS idx_vinculo_anuncios_loja_status
  ON vinculo_anuncios (loja_integrada_id, status_sincronizacao);

CREATE TABLE IF NOT EXISTS mapeamento_categorias (
  id BIGSERIAL PRIMARY KEY,
  marketplace_origem VARCHAR(50) NOT NULL,
  categoria_origem_id VARCHAR(120) NOT NULL,
  marketplace_destino VARCHAR(50) NOT NULL,
  categoria_destino_id VARCHAR(120) NOT NULL,
  categoria_origem_nome VARCHAR(255),
  categoria_destino_nome VARCHAR(255),
  confianca SMALLINT NOT NULL DEFAULT 100,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_mapeamento_categorias_confianca CHECK (confianca BETWEEN 0 AND 100),
  CONSTRAINT uq_mapeamento_categorias UNIQUE (
    marketplace_origem,
    categoria_origem_id,
    marketplace_destino,
    categoria_destino_id
  )
);

CREATE INDEX IF NOT EXISTS idx_mapeamento_categorias_origem
  ON mapeamento_categorias (marketplace_origem, categoria_origem_id);

CREATE INDEX IF NOT EXISTS idx_mapeamento_categorias_destino
  ON mapeamento_categorias (marketplace_destino, categoria_destino_id);

COMMIT;