// src/config/database.js
// Configuração centralizada de conexão com banco de dados

const mysql = require('mysql2/promise');

function toBool(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  return String(value).trim().toLowerCase() === 'true';
}

function buildSslConfig() {
  const host = String(process.env.DB_HOST || 'localhost').trim().toLowerCase();
  const isLocalHost = host === 'localhost' || host === '127.0.0.1';
  const useSsl = toBool(process.env.DB_SSL, !isLocalHost);

  if (!useSsl) return undefined;

  return {
    minVersion: process.env.DB_SSL_MIN_VERSION || 'TLSv1.2',
    rejectUnauthorized: toBool(process.env.DB_SSL_REJECT_UNAUTHORIZED, false)
  };
}

const sslConfig = buildSslConfig();

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'estoque_db',
  port: process.env.DB_PORT || 3306,
  ...(sslConfig ? { ssl: sslConfig } : {}),
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

let pool = null;
let isConnected = false;

/**
 * Inicializar pool de conexões
 * @returns {Promise<boolean>}
 */
const connect = async () => {
  try {
    pool = mysql.createPool(dbConfig);
    
    // Testar conexão
    const connection = await pool.getConnection();
    console.log('✓ Conexão com banco de dados estabelecida');
    connection.release();
    
    isConnected = true;
    global.db = pool;
    return true;
  } catch (error) {
    console.error('✗ Erro ao conectar ao banco de dados:', error.message);
    isConnected = false;
    return false;
  }
};

/**
 * Obter pool de conexões
 * @returns {mysql.Pool}
 */
const getPool = () => {
  return pool;
};

/**
 * Verificar se está conectado
 * @returns {boolean}
 */
const isConnected_check = () => {
  return isConnected;
};

/**
 * Fechar todas as conexões
 */
const disconnect = async () => {
  if (pool) {
    await pool.end();
    isConnected = false;
    console.log('✓ Conexões do banco de dados fechadas');
  }
};

module.exports = {
  connect,
  getPool,
  isConnected: isConnected_check,
  dbConfig
};
