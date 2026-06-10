CREATE DATABASE IF NOT EXISTS estoque_db;
USE estoque_db;

CREATE TABLE IF NOT EXISTS usuarios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(100) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  senha_hash VARCHAR(255) NOT NULL,
  ativo TINYINT(1) NOT NULL DEFAULT 1,
  is_admin TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS materiais (
  id INT AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT NULL,
  codigo_barras VARCHAR(50) NOT NULL,
  nome VARCHAR(150) NOT NULL,
  fornecedor VARCHAR(150) NOT NULL DEFAULT 'Nao informado',
  unidade ENUM('un', 'kg', 'm') NOT NULL DEFAULT 'un',
  quantidade_atual DECIMAL(12, 3) NOT NULL DEFAULT 0,
  quantidade_minima DECIMAL(12, 3) NOT NULL DEFAULT 10,
  preco_custo DECIMAL(10, 2) NOT NULL DEFAULT 0,
  margem_lucro DECIMAL(5, 2) NOT NULL DEFAULT 0,
  preco_manual DECIMAL(10, 2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_usuario_codigo (usuario_id, codigo_barras),
  INDEX idx_usuario_id (usuario_id),
  INDEX idx_quantidade (quantidade_atual),
  INDEX idx_fornecedor (fornecedor),
  CONSTRAINT fk_materiais_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS alertas_estoque (
  id INT AUTO_INCREMENT PRIMARY KEY,
  material_id INT NOT NULL,
  tipo_alerta VARCHAR(50) NOT NULL,
  mensagem VARCHAR(255) NOT NULL,
  data_alerta TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_material_id (material_id),
  CONSTRAINT fk_alertas_material FOREIGN KEY (material_id) REFERENCES materiais(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS materiais_receitas (
  material_id INT NOT NULL,
  usuario_id INT NOT NULL,
  base_quantidade DECIMAL(12, 3) NOT NULL,
  receita_json LONGTEXT NOT NULL,
  custos_extras_json LONGTEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (material_id),
  INDEX idx_materiais_receitas_usuario (usuario_id),
  CONSTRAINT fk_materiais_receitas_material FOREIGN KEY (material_id) REFERENCES materiais(id) ON DELETE CASCADE,
  CONSTRAINT fk_materiais_receitas_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS movimentacoes_estoque (
  id INT AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT NULL,
  material_id INT NULL,
  material_nome_snapshot VARCHAR(150) NOT NULL,
  tipo_movimento ENUM('CADASTRO', 'AJUSTE', 'EDICAO', 'REMOCAO') NOT NULL,
  quantidade_delta DECIMAL(12, 3) NOT NULL DEFAULT 0,
  quantidade_anterior DECIMAL(12, 3) NOT NULL DEFAULT 0,
  quantidade_atual DECIMAL(12, 3) NOT NULL DEFAULT 0,
  usuario_nome VARCHAR(100) NOT NULL DEFAULT 'Sistema',
  observacao VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_mov_usuario (usuario_id),
  INDEX idx_mov_material (material_id),
  INDEX idx_mov_data (created_at),
  INDEX idx_mov_tipo (tipo_movimento),
  CONSTRAINT fk_movimentacoes_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL,
  CONSTRAINT fk_movimentacoes_material FOREIGN KEY (material_id) REFERENCES materiais(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS codigos_verificacao (
  id INT AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT NOT NULL,
  token_temp VARCHAR(64) NOT NULL UNIQUE,
  codigo VARCHAR(6) NOT NULL,
  expira_em TIMESTAMP NOT NULL,
  usado TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_token_temp (token_temp),
  CONSTRAINT fk_codigos_verificacao_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tokens_reset_senha (
  id INT AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT NOT NULL,
  token VARCHAR(64) NOT NULL UNIQUE,
  expira_em TIMESTAMP NOT NULL,
  usado TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_token_reset (token),
  CONSTRAINT fk_tokens_reset_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessoes_ativas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT NOT NULL,
  token VARCHAR(64) NOT NULL UNIQUE,
  expira_em TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_sessoes_token (token),
  INDEX idx_sessoes_usuario (usuario_id),
  CONSTRAINT fk_sessoes_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS assinaturas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT NOT NULL,
  plano ENUM('teste','semanal','mensal','anual') NOT NULL,
  status ENUM('pendente','ativa','cancelada','suspensa','expirada') NOT NULL DEFAULT 'pendente',
  mp_payment_id VARCHAR(100) NULL,
  cpf_cnpj VARCHAR(14) NULL,
  card_brand VARCHAR(40) NULL,
  card_last4 VARCHAR(4) NULL,
  valor_pago DECIMAL(10,2) NULL,
  data_inicio TIMESTAMP NULL,
  data_expiracao TIMESTAMP NULL,
  data_cancelamento TIMESTAMP NULL,
  renovacao_automatica TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_assinatura_usuario (usuario_id),
  INDEX idx_assinaturas_status (status),
  INDEX idx_assinaturas_expiracao (data_expiracao),
  INDEX idx_mp_payment (mp_payment_id),
  CONSTRAINT fk_assinaturas_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fornecedores (
  id INT AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT NULL,
  nome VARCHAR(150) NOT NULL,
  email VARCHAR(150),
  telefone VARCHAR(20),
  endereco TEXT,
  cidade VARCHAR(100),
  estado VARCHAR(2),
  cep VARCHAR(9),
  tempo_espera_dias INT NOT NULL DEFAULT 7,
  contato VARCHAR(255),
  observacoes TEXT,
  ativo TINYINT(1) NOT NULL DEFAULT 1,
  data_cadastro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  data_atualizacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_usuario_fornecedor (usuario_id, nome),
  INDEX idx_fornecedores_nome (nome),
  INDEX idx_fornecedores_usuario (usuario_id),
  INDEX idx_fornecedores_ativo (ativo),
  CONSTRAINT fk_fornecedores_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS insumos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT NULL,
  nome VARCHAR(200) NOT NULL,
  preco_custo_un DECIMAL(10, 4) NOT NULL,
  qtd_atual DECIMAL(12, 4) NOT NULL DEFAULT 0,
  unidade ENUM('kg', 'un', 'ml', 'l', 'g') NOT NULL DEFAULT 'un',
  id_fornecedor_pref INT NOT NULL,
  descricao TEXT,
  ativo TINYINT(1) NOT NULL DEFAULT 1,
  data_cadastro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  data_atualizacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_usuario_insumo_nome (usuario_id, nome),
  INDEX idx_insumos_nome (nome),
  INDEX idx_insumos_ativo (ativo),
  INDEX idx_insumos_usuario (usuario_id),
  INDEX idx_insumos_fornecedor (id_fornecedor_pref),
  CONSTRAINT fk_insumos_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  CONSTRAINT fk_insumos_fornecedor FOREIGN KEY (id_fornecedor_pref) REFERENCES fornecedores(id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS estoque_seguranca (
  id INT AUTO_INCREMENT PRIMARY KEY,
  id_insumo INT NOT NULL UNIQUE,
  consumo_medio_diario DECIMAL(10, 4) NOT NULL DEFAULT 0,
  qtd_seguranca_minima DECIMAL(10, 4) NOT NULL DEFAULT 0,
  ponto_pedido DECIMAL(10, 4) NOT NULL DEFAULT 0,
  data_ultima_atualizacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_estoque_seguranca_insumo (id_insumo),
  CONSTRAINT fk_estoque_seguranca_insumo FOREIGN KEY (id_insumo) REFERENCES insumos(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;