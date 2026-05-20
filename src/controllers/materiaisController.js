// src/controllers/materiaisController.js
// Controller para gerenciar operacoes com materiais

const Material = require('../models/Material');
const { enviarAlertaEstoqueBaixo } = require('../services/emailService');
const LIMITE_NOME_MATERIAL = 150;

function calcularPrecoVenda(precoCusto, margemLucro) {
  const custo = Number(precoCusto) || 0;
  const margem = Number(margemLucro) || 0;
  return Number((custo * (1 + margem / 100)).toFixed(2));
}

function usuarioDaRequisicao(req) {
  return String(req.body?.usuario_nome || req.headers['x-usuario-nome'] || 'Sistema').slice(0, 100);
}

function toNumber(value, defaultValue = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : defaultValue;
}

function normalizarUnidade(unidade) {
  const value = String(unidade || '').trim().toLowerCase();
  if (value === 'kg' || value === 'm' || value === 'un') return value;
  return 'un';
}

function calcularDeficit(material) {
  const atual = toNumber(material?.quantidade_atual, 0);
  const minimo = toNumber(material?.quantidade_minima, 0);
  return Math.max(0, minimo - atual);
}

function precisaNotificarBaixoEstoque(materialAntes, materialDepois) {
  // Só notifica se ANTES não era crítico e AGORA é crítico
  const antesCritico = isCriticalStock(materialAntes?.quantidade_atual, materialAntes?.quantidade_minima);
  const depoisCritico = isCriticalStock(materialDepois?.quantidade_atual, materialDepois?.quantidade_minima);
  return !antesCritico && depoisCritico;
}

function isCriticalStock(atual, minimo) {
  return toNumber(atual, 0) <= 0 || (toNumber(minimo, 0) > 0 && toNumber(atual, 0) <= toNumber(minimo, 0));
}

async function listarEmailsClientesAtivos(usuarioId) {
  if (!global.db) return [];
  const id = Number(usuarioId);
  if (!Number.isInteger(id) || id <= 0) return [];

  const connection = await global.db.getConnection();
  try {
    const [rows] = await connection.query('SELECT email FROM usuarios WHERE ativo = 1 AND id = ?', [id]);
    const emails = (rows || []).map((row) => String(row.email || '').trim()).filter(Boolean);
    return [...new Set(emails)];
  } finally {
    connection.release();
  }
}

function listarEmailsAlertaGlobais() {
  const bruto = String(
    process.env.ALERT_EMAILS ||
    process.env.ALERT_EMAIL ||
    process.env.MAIL_ALERT_EMAILS ||
    ''
  );

  if (!bruto.trim()) return [];

  return [...new Set(
    bruto
      .split(/[;,\s]+/)
      .map((item) => String(item || '').trim())
      .filter((item) => /[^\s@]+@[^\s@]+\.[^\s@]+/.test(item))
  )];
}

async function calcularRecomendacaoCompraHistorica({ materialId, usuarioId, quantidadeAtual, quantidadeMinima, deficit }) {
  const atual = Math.max(0, toNumber(quantidadeAtual, 0));
  const minimo = Math.max(0, toNumber(quantidadeMinima, 0));
  const falta = Math.max(0, toNumber(deficit, Math.max(0, minimo - atual)));

  const diasHistorico = 30;
  const diasRecente = 7;
  const diasCoberturaAlvo = 7;
  let consumoTotalPeriodo = 0;
  let consumoTotalRecente = 0;

  if (global.db && Number.isInteger(Number(materialId)) && Number(materialId) > 0) {
    const connection = await global.db.getConnection();
    try {
      const [rows] = await connection.query(
        `SELECT
           COALESCE(SUM(ABS(quantidade_delta)), 0) AS total_saida_30d,
           COALESCE(SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL ? DAY) THEN ABS(quantidade_delta) ELSE 0 END), 0) AS total_saida_7d
         FROM movimentacoes_estoque
         WHERE usuario_id = ?
           AND material_id = ?
           AND quantidade_delta < 0
           AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
        [diasRecente, usuarioId, Number(materialId), diasHistorico]
      );
      consumoTotalPeriodo = toNumber(rows?.[0]?.total_saida_30d, 0);
      consumoTotalRecente = toNumber(rows?.[0]?.total_saida_7d, 0);
    } finally {
      connection.release();
    }
  }

  const consumoMedio30Dias = consumoTotalPeriodo > 0
    ? Number((consumoTotalPeriodo / diasHistorico).toFixed(3))
    : 0;
  const consumoMedio7Dias = consumoTotalRecente > 0
    ? Number((consumoTotalRecente / diasRecente).toFixed(3))
    : 0;

  // Da mais peso ao recente para reagir quando a saída acelerar.
  let consumoPrevistoDiario = 0;
  if (consumoMedio7Dias > 0 && consumoMedio30Dias > 0) {
    consumoPrevistoDiario = Number(((consumoMedio7Dias * 0.6) + (consumoMedio30Dias * 0.4)).toFixed(3));
  } else {
    consumoPrevistoDiario = Math.max(consumoMedio7Dias, consumoMedio30Dias, 0);
  }

  const aceleracaoAtiva = consumoMedio30Dias > 0 && consumoMedio7Dias >= (consumoMedio30Dias * 1.3);
  const fatorAceleracao = aceleracaoAtiva ? 1.25 : 1;

  const estoqueSeguranca = consumoPrevistoDiario > 0
    ? Math.ceil(consumoPrevistoDiario * 2)
    : 0;

  const estoqueObjetivo = Math.max(
    minimo,
    minimo + Math.ceil(consumoPrevistoDiario * diasCoberturaAlvo) + estoqueSeguranca
  );

  const sugestaoPorObjetivo = Math.max(0, Math.ceil(estoqueObjetivo - atual));
  let quantidadeSugerida = Math.max(1, falta, sugestaoPorObjetivo);

  if (falta > 0 && consumoPrevistoDiario > 0) {
    const loteMinimoDinamico = Math.ceil(consumoPrevistoDiario * 3);
    quantidadeSugerida = Math.max(quantidadeSugerida, loteMinimoDinamico);
  }

  if (aceleracaoAtiva) {
    quantidadeSugerida = Math.ceil(quantidadeSugerida * fatorAceleracao);
  }

  const coberturaDias = consumoPrevistoDiario > 0
    ? Number((atual / consumoPrevistoDiario).toFixed(1))
    : null;

  let quandoComprar = 'Monitorar diariamente';
  let resumoRecomendacao = 'Consumo recente estável; mantenha acompanhamento do saldo.';

  if (atual <= 0) {
    quandoComprar = 'Comprar imediatamente (hoje)';
    resumoRecomendacao = 'Estoque zerado: há risco imediato de ruptura.';
  } else if (consumoPrevistoDiario > 0 && coberturaDias !== null) {
    if (coberturaDias <= 3) {
      quandoComprar = 'Comprar hoje';
      resumoRecomendacao = 'Pelo consumo recente, o estoque cobre poucos dias.';
    } else if (coberturaDias <= 7) {
      quandoComprar = 'Comprar em até 48h';
      resumoRecomendacao = 'Reposição de curto prazo recomendada para evitar ruptura.';
    } else {
      quandoComprar = 'Comprar em até 7 dias';
      resumoRecomendacao = 'Há cobertura temporária, mas a compra deve ser programada.';
    }
  } else if (falta > 0) {
    quandoComprar = 'Comprar em até 48h';
    resumoRecomendacao = 'Sem histórico suficiente de consumo; baseando sugestão no déficit atual.';
  }

  if (aceleracaoAtiva) {
    resumoRecomendacao += ' Saída acelerada nos últimos 7 dias; sugestão reforçada automaticamente.';
  }

  return {
    quandoComprar,
    quantidadeSugerida,
    resumoRecomendacao,
    consumoMedioDiario: consumoPrevistoDiario,
    consumoMedio7Dias,
    consumoMedio30Dias,
    aceleracaoAtiva,
    fatorAceleracao,
    coberturaDias,
    diasHistorico,
    diasRecente,
    diasCoberturaAlvo,
    acaoPrincipal: 'comprar'
  };
}

async function enriquecerRecomendacaoItemFinal(snapshot, usuarioId, recomendacaoBase) {
  const base = {
    ...(recomendacaoBase || {}),
    acaoPrincipal: 'produzir'
  };

  const materialId = Number(snapshot?.id || 0);
  if (!Number.isInteger(materialId) || materialId <= 0) {
    return {
      ...base,
      resumoRecomendacao: 'Item final sem identificação válida para buscar receita de produção.'
    };
  }

  const receita = await Material.findReceita(materialId, usuarioId);
  if (!receita || !Array.isArray(receita.componentes) || !receita.componentes.length) {
    return {
      ...base,
      possuiReceita: false,
      resumoRecomendacao: 'Item final sem receita cadastrada. Defina a receita para calcular componentes e planejar produção.'
    };
  }

  const quantidadeProduzir = Math.max(1, Math.ceil(Number(base.quantidadeSugerida || 1)));
  const baseQuantidadeReceita = Number(receita.base_quantidade || 0);
  const componentesCriticos = [];

  for (const comp of receita.componentes) {
    const componenteId = Number(comp?.material_id || comp?.materialId || 0);
    if (!Number.isInteger(componenteId) || componenteId <= 0) continue;

    let consumoUnitario = Number(comp?.qty_unitaria || 0);
    if ((!Number.isFinite(consumoUnitario) || consumoUnitario <= 0) && baseQuantidadeReceita > 0) {
      const qtyTotal = Number(comp?.qty_total || 0);
      consumoUnitario = Number.isFinite(qtyTotal) && qtyTotal > 0 ? qtyTotal / baseQuantidadeReceita : 0;
    }
    if (!Number.isFinite(consumoUnitario) || consumoUnitario <= 0) continue;

    const materialComponente = await Material.findById(componenteId, usuarioId);
    if (!materialComponente) continue;

    const disponivel = toNumber(materialComponente.quantidade_atual, 0);
    const necessario = Number((consumoUnitario * quantidadeProduzir).toFixed(3));
    const falta = Math.max(0, Number((necessario - disponivel).toFixed(3)));

    if (falta > 0) {
      componentesCriticos.push({
        id: componenteId,
        nome: String(materialComponente.nome || `Componente ${componenteId}`),
        necessario,
        disponivel,
        falta
      });
    }
  }

  const componentesOrdenados = componentesCriticos.sort((a, b) => b.falta - a.falta);
  const resumoRecomendacao = componentesOrdenados.length
    ? `Produza ${quantidadeProduzir} unidade(s) e reponha os componentes em falta para liberar a produção.`
    : `Produza ${quantidadeProduzir} unidade(s). Componentes com estoque suficiente para esta sugestão.`;

  return {
    ...base,
    possuiReceita: true,
    acaoPrincipal: 'produzir',
    quantidadeSugerida: quantidadeProduzir,
    componentesCriticos: componentesOrdenados,
    resumoRecomendacao
  };
}

async function notificarBaixoEstoque(materialAntes, materialDepois, usuarioId) {
  if (!precisaNotificarBaixoEstoque(materialAntes, materialDepois)) return;

  const destinatariosCliente = await listarEmailsClientesAtivos(usuarioId);
  const destinatariosGlobais = listarEmailsAlertaGlobais();
  const destinatarios = [...new Set([...destinatariosCliente, ...destinatariosGlobais])];
  if (!destinatarios.length) {
    console.warn('Alerta de estoque baixo não enviado (usuário sem e-mail ativo para notificação)');
    return;
  }

  let snapshot = materialDepois;
  const materialId = Number(materialDepois?.id || 0);
  if (Number.isInteger(materialId) && materialId > 0) {
    try {
      const atualDoBanco = await Material.findById(materialId, usuarioId);
      if (atualDoBanco) snapshot = atualDoBanco;
    } catch (err) {
      console.warn(`Não foi possível atualizar snapshot do material para alerta (${err?.message || 'erro_desconhecido'})`);
    }
  }

  const quantidadeAtual = toNumber(snapshot?.quantidade_atual, 0);
  const quantidadeMinima = toNumber(snapshot?.quantidade_minima, 0);
  const deficit = Math.max(0, quantidadeMinima - quantidadeAtual);
  const fornecedor = String(snapshot?.fornecedor || materialDepois?.fornecedor || '').trim().toLowerCase();
  const tipoItem = fornecedor === 'produção interna' || fornecedor === 'producao interna'
    ? 'Item final de produção'
    : 'Material';

  let recomendacaoCompra = await calcularRecomendacaoCompraHistorica({
    materialId,
    usuarioId,
    quantidadeAtual,
    quantidadeMinima,
    deficit
  });

  if (tipoItem === 'Item final de produção') {
    recomendacaoCompra = await enriquecerRecomendacaoItemFinal(snapshot, usuarioId, recomendacaoCompra);
  }

  const resultado = await enviarAlertaEstoqueBaixo({
    destinatarios,
    materialNome: String(snapshot?.nome || materialDepois?.nome || 'Material'),
    quantidadeAtual,
    quantidadeMinima,
    deficit,
    tipoItem,
    recomendacaoCompra
  });

  if (!resultado?.sent) {
    console.warn(`Alerta de estoque baixo não enviado (${resultado?.reason || 'motivo_desconhecido'})`);
    return;
  }

  console.log(`Alerta de estoque baixo enviado para ${resultado.recipients?.length || 0} destinatário(s) - material: ${String(snapshot?.nome || materialDepois?.nome || 'Material')} - atual: ${quantidadeAtual} - mínimo: ${quantidadeMinima}`);
}

async function registrarMovimentacaoSegura(movimentacao) {
  try {
    await Material.registrarMovimentacao(movimentacao);
  } catch (error) {
    console.warn(`Falha ao registrar movimentação (${error?.message || 'erro_desconhecido'})`);
  }
}

async function notificarBaixoEstoqueSeguro(materialAntes, materialDepois, usuarioId) {
  try {
    await notificarBaixoEstoque(materialAntes, materialDepois, usuarioId);
  } catch (error) {
    console.warn(`Falha ao processar notificação de estoque baixo (${error?.message || 'erro_desconhecido'})`);
  }
}

async function enriquecerMateriaisComRecomendacao(materiais, usuarioId) {
  return Promise.all(
    (materiais || []).map(async (material) => {
      const quantidadeAtual = toNumber(material?.quantidade_atual, 0);
      const quantidadeMinima = toNumber(material?.quantidade_minima, 0);
      const deficit = Math.max(0, quantidadeMinima - quantidadeAtual);
      const fornecedor = String(material?.fornecedor || '').trim().toLowerCase();
      const tipoItem = fornecedor === 'produção interna' || fornecedor === 'producao interna'
        ? 'Item final de produção'
        : 'Material';

      let recomendacaoCompra = await calcularRecomendacaoCompraHistorica({
        materialId: material?.id,
        usuarioId,
        quantidadeAtual,
        quantidadeMinima,
        deficit
      });

      if (tipoItem === 'Item final de produção') {
        recomendacaoCompra = await enriquecerRecomendacaoItemFinal(material, usuarioId, recomendacaoCompra);
      }

      return {
        ...material,
        deficit,
        tipo_item: tipoItem,
        recomendacao_compra: recomendacaoCompra
      };
    })
  );
}
class MateriaisController {
  /**
   * GET /api/materiais/:id/receita
  * Buscar receita de produção do item final
   */
  static async obterReceita(req, res) {
    try {
      const { id } = req.params;
      const usuarioId = req.usuario_id;

      const material = await Material.findById(id, usuarioId);
      if (!material) {
        return res.status(404).json({
          success: false,
          message: 'Material não encontrado'
        });
      }

      const receita = await Material.findReceita(id, usuarioId);
      if (!receita) {
        return res.status(404).json({
          success: false,
          message: 'Receita de produção não cadastrada para este item final'
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Receita recuperada com sucesso',
        data: receita
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: 'Erro ao obter receita de produção',
        error: error.message
      });
    }
  }

  /**
   * PUT /api/materiais/:id/receita
  * Criar/atualizar receita de produção do item final
   */
  static async salvarReceita(req, res) {
    try {
      const { id } = req.params;
      const usuarioId = req.usuario_id;
      const { base_quantidade, componentes = [], custos_extras = [] } = req.body || {};

      const material = await Material.findById(id, usuarioId);
      if (!material) {
        return res.status(404).json({
          success: false,
          message: 'Material não encontrado'
        });
      }

      const baseQuantidadeNum = Number(base_quantidade || 0);
      if (!Number.isFinite(baseQuantidadeNum) || baseQuantidadeNum <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Base de quantidade da receita deve ser maior que zero'
        });
      }

      const componentesArray = Array.isArray(componentes) ? componentes : [];

      const componentesNormalizados = [];
      for (const comp of componentesArray) {
        const materialId = Number(comp?.material_id || comp?.materialId || 0);
        const qtdTotal = Number(comp?.qty_total || comp?.qtyTotal || 0);
        if (!Number.isInteger(materialId) || materialId <= 0 || !Number.isFinite(qtdTotal) || qtdTotal <= 0) {
          return res.status(400).json({
            success: false,
            message: 'Componentes da receita estão inválidos'
          });
        }

        const materialComponente = await Material.findById(materialId, usuarioId);
        if (!materialComponente) {
          return res.status(404).json({
            success: false,
            message: `Componente não encontrado: ${materialId}`
          });
        }

        if (Number(materialId) === Number(id)) {
          return res.status(400).json({
            success: false,
            message: 'O item final não pode ser componente da própria receita'
          });
        }

        const qtyUnit = Number((qtdTotal / baseQuantidadeNum).toFixed(6));
        componentesNormalizados.push({
          material_id: materialId,
          nome: String(materialComponente.nome || 'Material'),
          qty_total: Number(qtdTotal.toFixed(6)),
          qty_unitaria: qtyUnit
        });
      }

      const custosNormalizados = Array.isArray(custos_extras)
        ? custos_extras
            .map((item) => {
              const label = String(item?.label || '').trim();
              const valueTotal = Number(item?.value_total || item?.value || 0);
              if (!label || !Number.isFinite(valueTotal) || valueTotal <= 0) return null;
              return {
                label,
                value_total: Number(valueTotal.toFixed(2)),
                value_unitario: Number((valueTotal / baseQuantidadeNum).toFixed(6))
              };
            })
            .filter(Boolean)
        : [];

      const receita = await Material.saveReceita(id, usuarioId, {
        base_quantidade: baseQuantidadeNum,
        componentes: componentesNormalizados,
        custos_extras: custosNormalizados
      });

      return res.status(200).json({
        success: true,
        message: 'Receita salva com sucesso',
        data: receita
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: 'Erro ao salvar receita de produção',
        error: error.message
      });
    }
  }

  /**
   * GET /api/materiais
   * Listar todos os materiais ou buscar por termo
   */
  static async listar(req, res) {
    try {
      const { busca } = req.query;
      const usuarioId = req.usuario_id;
      const materiais = busca
        ? await Material.findByNome(busca, usuarioId)
        : await Material.findAll(usuarioId);

      res.status(200).json({
        success: true,
        message: 'Materiais recuperados com sucesso',
        data: materiais
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Erro ao listar materiais',
        error: error.message
      });
    }
  }

  /**
   * GET /api/materiais/historico
  * Listar movimentações de estoque do usuário
   */
  static async listarHistorico(req, res) {
    try {
      const movimentacoes = await Material.listarMovimentacoes(req.usuario_id);

      res.status(200).json({
        success: true,
        message: 'Histórico recuperado com sucesso',
        data: movimentacoes
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Erro ao listar histórico de estoque',
        error: error.message
      });
    }
  }

  /**
   * GET /api/materiais/:id
  * Buscar material específico por ID (do usuário)
   */
  static async obter(req, res) {
    try {
      const { id } = req.params;
      const material = await Material.findById(id, req.usuario_id);

      if (!material) {
        return res.status(404).json({
          success: false,
          message: 'Material não encontrado'
        });
      }

      res.status(200).json({
        success: true,
        message: 'Material recuperado com sucesso',
        data: material
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Erro ao obter material',
        error: error.message
      });
    }
  }

  /**
   * POST /api/materiais
   * Criar novo material
   */
  static async criar(req, res) {
    try {
      const { codigo_barras, nome, fornecedor, unidade, quantidade_atual, quantidade_minima, preco_custo, margem_lucro, preco_manual } = req.body;
      const usuarioId = req.usuario_id;
      const nomeNormalizado = String(nome || '').trim();
      const precoVenda = preco_manual !== undefined ? Number(preco_manual) : calcularPrecoVenda(preco_custo, margem_lucro);
      const unidadeNormalizada = normalizarUnidade(unidade);

      if (!codigo_barras || !nomeNormalizado || !fornecedor) {
        return res.status(400).json({
          success: false,
          message: 'Para cadastrar o item, informe código de barras, nome e fornecedor.'
        });
      }

      if (nomeNormalizado.length > LIMITE_NOME_MATERIAL) {
        return res.status(400).json({
          success: false,
          message: `O nome do item deve ter no máximo ${LIMITE_NOME_MATERIAL} caracteres.`
        });
      }

      const materialExistente = await Material.findByCodigoBarras(codigo_barras, usuarioId);
      if (materialExistente) {
        return res.status(409).json({
          success: false,
          message: 'Já existe um item com este código de barras. Use outro código ou edite o item existente.'
        });
      }

      const novoMaterialId = await Material.create({
        usuario_id: usuarioId,
        codigo_barras,
        nome: nomeNormalizado,
        fornecedor,
        unidade: unidadeNormalizada,
        quantidade_atual: quantidade_atual || 0,
        quantidade_minima: quantidade_minima || 10,
        preco_custo: preco_custo || 0,
        margem_lucro: margem_lucro || 0,
        preco_manual: precoVenda
      });

      const novoMaterial = await Material.findById(novoMaterialId, usuarioId);

      await registrarMovimentacaoSegura({
        usuario_id: usuarioId,
        material_id: novoMaterialId,
        material_nome_snapshot: String(novoMaterial?.nome || nomeNormalizado),
        tipo_movimento: 'CADASTRO',
        quantidade_delta: Number(quantidade_atual || 0),
        quantidade_anterior: 0,
        quantidade_atual: Number(quantidade_atual || 0),
        usuario_nome: req.usuario_nome || 'Sistema',
        observacao: 'Cadastro de novo material'
      });

      await notificarBaixoEstoqueSeguro(null, novoMaterial, usuarioId);

      res.status(201).json({
        success: true,
        message: 'Material criado com sucesso',
        data: novoMaterial
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Não foi possível cadastrar o item agora. Tente novamente em instantes.',
        error: error.message
      });
    }
  }

  /**
   * PUT /api/materiais/:id
  * Atualizar material completo (somente do usuário)
   */
  static async atualizar(req, res) {
    try {
      const { id } = req.params;
      const usuarioId = req.usuario_id;
      const { codigo_barras, nome, fornecedor, unidade, quantidade_atual, quantidade_minima, preco_custo, margem_lucro, preco_manual } = req.body;

      const material = await Material.findById(id, usuarioId);
      if (!material) {
        return res.status(404).json({
          success: false,
          message: 'Material não encontrado'
        });
      }

      if (codigo_barras && codigo_barras !== material.codigo_barras) {
        const materialComCodigo = await Material.findByCodigoBarras(codigo_barras, usuarioId);
        if (materialComCodigo) {
          return res.status(409).json({
            success: false,
            message: 'Já existe um material com este código de barras'
          });
        }
      }

      if (nome !== undefined) {
        const nomeNormalizado = String(nome || '').trim();
        if (!nomeNormalizado) {
          return res.status(400).json({
            success: false,
            message: 'Nome do item não pode ficar vazio.'
          });
        }

        if (nomeNormalizado.length > LIMITE_NOME_MATERIAL) {
          return res.status(400).json({
            success: false,
            message: `O nome do item deve ter no máximo ${LIMITE_NOME_MATERIAL} caracteres.`
          });
        }
      }

      const dadosAtualizacao = {};
      if (codigo_barras !== undefined) dadosAtualizacao.codigo_barras = codigo_barras;
      if (nome !== undefined) dadosAtualizacao.nome = String(nome).trim();
      if (fornecedor !== undefined) dadosAtualizacao.fornecedor = fornecedor;
      if (unidade !== undefined) dadosAtualizacao.unidade = normalizarUnidade(unidade);
      if (quantidade_atual !== undefined) dadosAtualizacao.quantidade_atual = quantidade_atual;
      if (quantidade_minima !== undefined) dadosAtualizacao.quantidade_minima = quantidade_minima;
      if (preco_custo !== undefined) dadosAtualizacao.preco_custo = preco_custo;
      if (margem_lucro !== undefined) dadosAtualizacao.margem_lucro = margem_lucro;
      if (preco_manual !== undefined) {
        dadosAtualizacao.preco_manual = preco_manual;
      } else if (preco_custo !== undefined || margem_lucro !== undefined) {
        dadosAtualizacao.preco_manual = calcularPrecoVenda(
          preco_custo !== undefined ? preco_custo : material.preco_custo,
          margem_lucro !== undefined ? margem_lucro : material.margem_lucro
        );
      }

      await Material.update(id, dadosAtualizacao, usuarioId);
      const materialAtualizado = await Material.findById(id, usuarioId);

      const qtdAnterior = Number(material.quantidade_atual || 0);
      const qtdAtual = Number(materialAtualizado.quantidade_atual || 0);
      await registrarMovimentacaoSegura({
        usuario_id: usuarioId,
        material_id: Number(id),
        material_nome_snapshot: String(materialAtualizado?.nome || material?.nome || 'Material'),
        tipo_movimento: 'EDICAO',
        quantidade_delta: qtdAtual - qtdAnterior,
        quantidade_anterior: qtdAnterior,
        quantidade_atual: qtdAtual,
        usuario_nome: req.usuario_nome || 'Sistema',
        observacao: 'Edição de dados do material'
      });

      await notificarBaixoEstoqueSeguro(material, materialAtualizado, usuarioId);

      res.status(200).json({
        success: true,
        message: 'Material atualizado com sucesso',
        data: materialAtualizado
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Erro ao atualizar material',
        error: error.message
      });
    }
  }

  /**
   * DELETE /api/materiais/:id
  * Deletar material (somente do usuário)
   */
  static async deletar(req, res) {
    try {
      const { id } = req.params;
      const usuarioId = req.usuario_id;
      const material = await Material.findById(id, usuarioId);
      if (!material) {
        return res.status(404).json({
          success: false,
          message: 'Material não encontrado'
        });
      }

      await registrarMovimentacaoSegura({
        usuario_id: usuarioId,
        material_id: Number(id),
        material_nome_snapshot: String(material?.nome || 'Material removido'),
        tipo_movimento: 'REMOCAO',
        quantidade_delta: -Number(material.quantidade_atual || 0),
        quantidade_anterior: Number(material.quantidade_atual || 0),
        quantidade_atual: 0,
        usuario_nome: req.usuario_nome || 'Sistema',
        observacao: 'Exclusão de material'
      });

      await Material.delete(id, usuarioId);

      res.status(200).json({
        success: true,
        message: 'Material deletado com sucesso',
        data: material
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Erro ao deletar material',
        error: error.message
      });
    }
  }

  /**
   * PUT /api/materiais/:id/quantidade
   * Atualizar quantidade (somar/subtrair)
   */
  static async atualizarQuantidade(req, res) {
    try {
      const { id } = req.params;
      const usuarioId = req.usuario_id;
      const { diferenca, observacao, motivo } = req.body;

      if (diferenca === undefined || typeof diferenca !== 'number') {
        return res.status(400).json({
          success: false,
          message: 'Diferença de quantidade é obrigatória e deve ser um número'
        });
      }

      const materialAntes = await Material.findById(id, usuarioId);
      if (!materialAntes) {
        return res.status(404).json({
          success: false,
          message: 'Material não encontrado'
        });
      }

      const isVenda = /venda/i.test(String(observacao || '')) || String(motivo || '').toUpperCase() === 'VENDA';
      if (isVenda && Number(diferenca) >= 0) {
        return res.status(400).json({
          success: false,
          message: 'Venda deve reduzir o estoque (diferença negativa)'
        });
      }

      const quantidadeAtualAntes = Number(materialAntes.quantidade_atual || 0);
      const tentativaNovaQuantidade = quantidadeAtualAntes + Number(diferenca || 0);
      if (tentativaNovaQuantidade < 0) {
        return res.status(400).json({
          success: false,
          message: 'Quantidade insuficiente em estoque para esta operação'
        });
      }

            const materialAtualizado = await Material.atualizarQuantidade(id, diferenca, usuarioId);

      await registrarMovimentacaoSegura({
        usuario_id: usuarioId,
        material_id: Number(id),
        material_nome_snapshot: String(materialAtualizado?.nome || materialAntes?.nome || 'Material'),
        tipo_movimento: 'AJUSTE',
        quantidade_delta: Number(diferenca),
        quantidade_anterior: Number(materialAntes.quantidade_atual || 0),
        quantidade_atual: Number(materialAtualizado.quantidade_atual || 0),
        usuario_nome: usuarioDaRequisicao(req),
        observacao: observacao || (isVenda ? 'Venda registrada' : 'Ajuste manual de quantidade')
      });

      await notificarBaixoEstoqueSeguro(materialAntes, materialAtualizado, usuarioId);

      res.status(200).json({
        success: true,
        message: 'Quantidade atualizada com sucesso',
        data: materialAtualizado
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Erro ao atualizar quantidade',
        error: error.message
      });
    }
  }

  /**
   * GET /api/materiais/estoque/baixo
  * Listar materiais com estoque baixo do usuário
   */
  static async listarBaixoEstoque(req, res) {
    try {
      const usuarioId = req.usuario_id;
      const materiais = await Material.findBaixoEstoque(usuarioId);
      const materiaisComRecomendacao = await enriquecerMateriaisComRecomendacao(materiais, usuarioId);

      res.status(200).json({
        success: true,
        message: 'Materiais com estoque baixo recuperados',
        data: materiaisComRecomendacao
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Erro ao listar materiais com estoque baixo',
        error: error.message
      });
    }
  }
}

module.exports = MateriaisController;
