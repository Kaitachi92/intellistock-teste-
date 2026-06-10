import axios from 'axios';

export interface MercadoLivreAIResult {
  categoria_sugerida: string;
  marca_sugerida: string;
  modelo_sugerido: string;
  descricao_completa: string;
}

export async function generateMercadoLivreContent(titulo: string, preco: number): Promise<MercadoLivreAIResult> {
  const apiUrl = process.env.OPENAI_API_URL || 'https://api.openai.com/v1/chat/completions';
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY não configurada.');
  }

  const prompt = `Você é um especialista em e-commerce para Mercado Livre. Receba título e preço e responda apenas em JSON válido com as chaves:\n- categoria_sugerida\n- marca_sugerida\n- modelo_sugerido\n- descricao_completa\n\nA descricao_completa deve conter em texto puro:\n1. Apresentação\n2. Benefícios\n3. Características\n4. Conteúdo da Embalagem\n5. Garantia\n\nTítulo: ${titulo}\nPreço: R$ ${preco.toFixed(2)}\n`;

  const response = await axios.post(
    apiUrl,
    {
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 450
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    }
  );

  const content = response.data?.choices?.[0]?.message?.content || response.data?.choices?.[0]?.text;
  if (!content || typeof content !== 'string') {
    throw new Error('Resposta da IA inválida.');
  }

  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    const rawJson = content.match(/\{[\s\S]*\}/);
    if (!rawJson) {
      throw new Error('Não foi possível parsear JSON da IA.');
    }
    parsed = JSON.parse(rawJson[0]);
  }

  if (!parsed.categoria_sugerida || !parsed.descricao_completa) {
    throw new Error('IA retornou JSON incompleto.');
  }

  return {
    categoria_sugerida: String(parsed.categoria_sugerida),
    marca_sugerida: String(parsed.marca_sugerida || 'Marca Genérica'),
    modelo_sugerido: String(parsed.modelo_sugerido || 'Modelo Único'),
    descricao_completa: String(parsed.descricao_completa)
  };
}
