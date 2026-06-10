import axios from 'axios';
import crypto from 'crypto';
import { saveMercadoLivreConfig } from './mercadolivre-config.service';

const CLIENT_ID = process.env.ML_CLIENT_ID;
const CLIENT_SECRET = process.env.ML_CLIENT_SECRET;
const REDIRECT_URI = process.env.ML_REDIRECT_URI;
const STATE_SECRET = process.env.ML_STATE_SECRET || 'ml_state_secret_default';

if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
  console.warn('Variáveis ML_CLIENT_ID, ML_CLIENT_SECRET ou ML_REDIRECT_URI não configuradas.');
}

function encodeState(payload: string): string {
  const signature = crypto
    .createHmac('sha256', STATE_SECRET)
    .update(payload)
    .digest('base64url');

  return `${Buffer.from(payload, 'utf8').toString('base64url')}.${signature}`;
}

function decodeState(state: string): { cliente_id: number; exp: number } {
  const [encoded, signature] = String(state).split('.');
  if (!encoded || !signature) {
    throw new Error('State inválido.');
  }

  const expectedSignature = crypto
    .createHmac('sha256', STATE_SECRET)
    .update(encoded)
    .digest('base64url');

  const safeEqual = crypto.timingSafeEqual(
    Buffer.from(signature, 'utf8'),
    Buffer.from(expectedSignature, 'utf8')
  );

  if (!safeEqual) {
    throw new Error('State inválido ou adulterado.');
  }

  const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  if (!payload.cliente_id || !payload.exp) {
    throw new Error('State inválido.');
  }

  return payload;
}

export function buildMercadoLivreAuthorizationUrl(clienteId: number): string {
  if (!CLIENT_ID || !REDIRECT_URI) {
    throw new Error('Configuração Mercado Livre incompleta. Defina ML_CLIENT_ID e ML_REDIRECT_URI.');
  }

  const payload = JSON.stringify({ cliente_id: clienteId, exp: Date.now() + 10 * 60 * 1000 });
  const state = encodeState(payload);

  const query = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    state,
    scope: 'read write' // scope genérico, Mercado Livre decide o mais apropriado
  });

  return `https://auth.mercadolivre.com.br/authorization?${query.toString()}`;
}

export async function handleMercadoLivreAuthCallback(code: string, state: string): Promise<{ cliente_id: number; user_id: string }> {
  if (!code) {
    throw new Error('Parâmetro code ausente.');
  }

  const payload = decodeState(String(state));
  if (payload.exp < Date.now()) {
    throw new Error('State expirado. Solicite a conexão novamente.');
  }

  if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
    throw new Error('Configuração Mercado Livre incompleta.');
  }

  const tokenResponse = await axios.post(
    'https://api.mercadolibre.com/oauth/token',
    new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      redirect_uri: REDIRECT_URI
    }).toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  const data = tokenResponse.data;
  const expiresAt = new Date(Date.now() + Number(data.expires_in || 21600) * 1000);

  await saveMercadoLivreConfig({
    cliente_id: payload.cliente_id,
    access_token: String(data.access_token),
    refresh_token: String(data.refresh_token),
    expires_at: expiresAt,
    user_id: String(data.user_id),
    seller_id: data.seller_id ? String(data.seller_id) : null,
    metadata_json: {
      scope: data.scope,
      token_type: data.token_type
    }
  });

  return {
    cliente_id: payload.cliente_id,
    user_id: String(data.user_id)
  };
}
