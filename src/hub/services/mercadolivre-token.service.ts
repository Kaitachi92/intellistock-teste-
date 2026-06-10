import axios from 'axios';
import { getMercadoLivreConfigByClienteId, updateMercadoLivreConfigTokens } from './mercadolivre-config.service';

const CLIENT_ID = process.env.ML_CLIENT_ID;
const CLIENT_SECRET = process.env.ML_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.warn('Variáveis ML_CLIENT_ID ou ML_CLIENT_SECRET não configuradas.');
}

export async function refreshAccessTokenIfNeeded(clienteId: number): Promise<string> {
  const config = await getMercadoLivreConfigByClienteId(clienteId);
  if (!config) {
    throw new Error('Configuração Mercado Livre não encontrada para o cliente.');
  }

  const now = new Date();
  const expiresSoon = config.expires_at.getTime() - now.getTime() < 5 * 60 * 1000;

  if (!expiresSoon) {
    return config.access_token;
  }

  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error('Configuração Mercado Livre incompleta para refresh token.');
  }

  const response = await axios.post(
    'https://api.mercadolibre.com/oauth/token',
    new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: config.refresh_token
    }).toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  const data = response.data;
  const expiresAt = new Date(Date.now() + Number(data.expires_in || 21600) * 1000);

  await updateMercadoLivreConfigTokens(config.cliente_id, {
    access_token: String(data.access_token),
    refresh_token: String(data.refresh_token),
    expires_at: expiresAt
  });

  return String(data.access_token);
}
