require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const mysql = require('mysql2/promise');

const app = express();
const PORT = process.env.PORT || 3001;

// ==================== MIDDLEWARES ====================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  credentials: true
}));

// Evita cache de páginas protegidas e respostas de API para não reabrir sessão via botão voltar.
app.use((req, res, next) => {
  const noStorePaths = new Set([
    '/dashboard.html',
    '/insumos.html',
    '/fornecedores.html',
    '/relatorios.html',
    '/assinatura.html',
    '/historico.html',
    '/produtos.html',
    '/checkout.html'
  ]);

  const isApi = req.path.startsWith('/api/');
  if (isApi || noStorePaths.has(req.path)) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
  }

  next();
});

// Servir arquivos estáticos (HTML, CSS, JS)
app.use(express.static(path.join(__dirname, 'public')));

// ==================== CONFIGURAÇÃO DO BANCO DE DADOS ====================
let pool = null;
let dbConnected = false;

function toBool(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  return String(value).trim().toLowerCase() === 'true';
}

function buildSslConfig() {
  const host = String(process.env.DB_HOST || 'localhost').trim().toLowerCase();
  const isLocalHost = host === 'localhost' || host === '127.0.0.1';

  // Em localhost, SSL deve ficar desligado por padrao.
  // Em banco remoto (ex: TiDB Cloud), SSL fica ligado por padrao.
  const useSsl = toBool(process.env.DB_SSL, !isLocalHost);
  if (!useSsl) return undefined;

  return {
    minVersion: process.env.DB_SSL_MIN_VERSION || 'TLSv1.2',
    rejectUnauthorized: toBool(process.env.DB_SSL_REJECT_UNAUTHORIZED, false)
  };
}

function isLocalDatabaseConfig() {
  const host = String(process.env.DB_HOST || 'localhost').trim().toLowerCase();
  const user = String(process.env.DB_USER || 'root').trim().toLowerCase();
  const port = String(process.env.DB_PORT || '3306').trim();

  return (host === 'localhost' || host === '127.0.0.1') && user === 'root' && port === '3306';
}

// Função para inicializar conexão com banco (pode ser chamada depois)
const initializeDatabase = async () => {
  try {
    const sslConfig = buildSslConfig();

    pool = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'estoque_db',
      port: process.env.DB_PORT || 3306,
      ...(sslConfig ? { ssl: sslConfig } : {}),
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    });

    const connection = await pool.getConnection();
    console.log('✓ Conexão com banco de dados estabelecida com sucesso');
    connection.release();
    
    dbConnected = true;
    global.db = pool;
    await seedAdmin(pool);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tokens_reset_senha (
        id INT AUTO_INCREMENT PRIMARY KEY,
        usuario_id INT NOT NULL,
        token VARCHAR(64) NOT NULL UNIQUE,
        expira_em TIMESTAMP NOT NULL,
        usado TINYINT(1) NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
        INDEX idx_token_reset (token)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sessoes_ativas (
        id INT AUTO_INCREMENT PRIMARY KEY,
        usuario_id INT NOT NULL,
        token VARCHAR(64) NOT NULL UNIQUE,
        expira_em TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
        INDEX idx_sessoes_token (token),
        INDEX idx_sessoes_usuario (usuario_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await pool.query(`
      ALTER TABLE materiais
        MODIFY COLUMN codigo_barras VARCHAR(50) NOT NULL
    `).catch(() => {});
    await pool.query(`
      ALTER TABLE materiais ADD COLUMN IF NOT EXISTS usuario_id INT NULL AFTER id
    `).catch(() => {});
    await pool.query(`
      ALTER TABLE movimentacoes_estoque ADD COLUMN IF NOT EXISTS usuario_id INT NULL AFTER id
    `).catch(() => {});
    await pool.query(`
      ALTER TABLE insumos ADD COLUMN IF NOT EXISTS usuario_id INT NULL AFTER id
    `).catch(() => {});

    await pool.query(`
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
        CONSTRAINT fk_materiais_receitas_material
          FOREIGN KEY (material_id) REFERENCES materiais(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `).catch(() => {});

    // Migração: adicionar is_admin em usuarios (bancos existentes)
    await pool.query(`
      ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS is_admin TINYINT(1) NOT NULL DEFAULT 0
    `).catch(() => {});

    // Tabela de assinaturas
    await pool.query(`
      CREATE TABLE IF NOT EXISTS assinaturas (
        id                   INT AUTO_INCREMENT PRIMARY KEY,
        usuario_id           INT NOT NULL,
        plano                ENUM('teste','semanal','mensal','anual') NOT NULL,
        status               ENUM('pendente','ativa','cancelada','suspensa','expirada') NOT NULL DEFAULT 'pendente',
        mp_payment_id        VARCHAR(100) NULL,
        cpf_cnpj             VARCHAR(14) NULL,
        card_brand           VARCHAR(40) NULL,
        card_last4           VARCHAR(4) NULL,
        valor_pago           DECIMAL(10,2) NULL,
        data_inicio          TIMESTAMP NULL,
        data_expiracao       TIMESTAMP NULL,
        data_cancelamento    TIMESTAMP NULL,
        renovacao_automatica TINYINT(1) NOT NULL DEFAULT 1,
        created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_assinatura_usuario (usuario_id),
        INDEX idx_assinaturas_status    (status),
        INDEX idx_assinaturas_expiracao (data_expiracao),
        INDEX idx_mp_payment            (mp_payment_id),
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await pool.query(`
      ALTER TABLE assinaturas ADD COLUMN IF NOT EXISTS cpf_cnpj VARCHAR(14) NULL AFTER mp_payment_id
    `).catch(() => {});
    await pool.query(`
      ALTER TABLE assinaturas ADD COLUMN IF NOT EXISTS card_brand VARCHAR(40) NULL AFTER cpf_cnpj
    `).catch(() => {});
    await pool.query(`
      ALTER TABLE assinaturas ADD COLUMN IF NOT EXISTS card_last4 VARCHAR(4) NULL AFTER card_brand
    `).catch(() => {});
    await pool.query(`
      ALTER TABLE assinaturas
        MODIFY COLUMN plano ENUM('teste','semanal','mensal','anual') NOT NULL
    `).catch(() => {});

    // Garante que o admin fixo seja sempre is_admin = 1
    await pool.query(
      `UPDATE usuarios SET is_admin = 1 WHERE email = 'admin@intellistock.com'`
    ).catch(() => {});

    // Migrações: tabela fornecedores
    await pool.query(`
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
        INDEX idx_fornecedores_nome (nome),
        INDEX idx_fornecedores_usuario (usuario_id),
        INDEX idx_fornecedores_ativo (ativo)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await pool.query(`ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS usuario_id INT NULL AFTER id`).catch(() => {});
    await pool.query(`ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS email VARCHAR(150) AFTER nome`).catch(() => {});
    await pool.query(`ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS telefone VARCHAR(20) AFTER email`).catch(() => {});
    await pool.query(`ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS endereco TEXT AFTER telefone`).catch(() => {});
    await pool.query(`ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS cidade VARCHAR(100) AFTER endereco`).catch(() => {});
    await pool.query(`ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS estado VARCHAR(2) AFTER cidade`).catch(() => {});
    await pool.query(`ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS cep VARCHAR(9) AFTER estado`).catch(() => {});
    await pool.query(`ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS observacoes TEXT AFTER contato`).catch(() => {});
    await pool.query(`ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS data_atualizacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`).catch(() => {});

    return true;
  } catch (error) {
    console.warn('⚠️ Banco de dados não conectado. Execute: npm run setup:db');
    console.warn('Erro:', error.message);
    if (isLocalDatabaseConfig()) {
      console.warn('Dica: o .env está apontando para MySQL local. Se seu banco é na nuvem, ajuste DB_HOST, DB_USER e DB_PORT com os dados do provedor.');
    }
    dbConnected = false;
    return false;
  }
};

// Tentar conectar ao banco na inicialização (não obrigatório)
initializeDatabase();

// ==================== ROTAS ====================
// Importar rotas
const materiaisRoutes   = require('./src/routes/materiais.routes');
const insumosRoutes     = require('./src/routes/insumos.routes');
const authRoutes        = require('./src/routes/auth.routes');
const assinaturasRoutes = require('./src/routes/assinaturas.routes');
const fornecedoresRoutes = require('./src/routes/fornecedores.routes');
const seedAdmin         = require('./src/utils/seedAdmin');

app.use('/api/materiais',   materiaisRoutes);
app.use('/api/insumos',     insumosRoutes);
app.use('/api/auth',        authRoutes);
app.use('/api/assinaturas', assinaturasRoutes);
app.use('/api/fornecedores', fornecedoresRoutes);

// Rota padrão para teste
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Servidor rodando corretamente' });
});

// Rota para servir o index.html na raiz
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== TRATAMENTO DE ERROS ====================
app.use((err, req, res, next) => {
  console.error('Erro:', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Erro interno do servidor'
  });
});

// ==================== MIDDLEWARE DE VERIFICAÇÃO DE BD ====================
app.use((req, res, next) => {
  // Se for requisição à API e BD não está conectado, avisar
  if (req.path.startsWith('/api') && !dbConnected && req.path !== '/api/health') {
    console.warn(`⚠️ Requisição a ${req.path} sem banco de dados conectado`);
  }
  next();
});

// ==================== INICIALIZAR SERVIDOR ====================
app.listen(PORT, () => {
  console.log(`\n🚀 Servidor rodando em http://localhost:${PORT}`);
  console.log(`📦 Ambiente: ${process.env.NODE_ENV || 'development'}\n`);
});

module.exports = app;
