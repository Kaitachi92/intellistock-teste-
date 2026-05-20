// Função original restaurada para relatorios.html
function setSubscriptionUi(payload) {
  const cliente = payload?.cliente || {};
  const assinatura = payload?.assinatura || null;

  document.getElementById('subscriptionFullName').textContent = cliente.nome || (_usuario?.nome || '-');
  document.getElementById('subscriptionCpf').textContent = cliente.cpf_mask || formatCpf(cliente.cpf_cnpj || '');

  if (!assinatura) {
    document.getElementById('subscriptionPlan').textContent = 'Sem assinatura ativa';
    document.getElementById('subscriptionStatus').textContent = 'Sem assinatura';
    document.getElementById('subscriptionStatus').classList.remove('is-active');
    document.getElementById('subscriptionCardMask').textContent = 'Será informado no checkout';
    document.getElementById('subscriptionDays').textContent = '0 dias';
    return;
  }

  const planoLabel = assinatura.plano ? `Plano ${assinatura.plano}` : 'Plano não definido';
  const statusLabel = {
    ativa: 'Ativa', expirada: 'Expirada', cancelada: 'Cancelada', pendente: 'Pendente', suspensa: 'Suspensa'
  }[assinatura.status] || 'Sem assinatura';
  const dias = Number(assinatura.dias_restantes || 0);
  const mascaraCartao = assinatura.cartao?.mascarado || 'Será informado no checkout';
  const bandeira = assinatura.cartao?.bandeira ? `${assinatura.cartao.bandeira.toUpperCase()} ` : '';

  document.getElementById('subscriptionPlan').textContent = planoLabel;
  document.getElementById('subscriptionStatus').textContent = statusLabel;
  document.getElementById('subscriptionStatus').classList.toggle('is-active', assinatura.status === 'ativa');
  document.getElementById('subscriptionCardMask').textContent = `${bandeira}${mascaraCartao}`.trim();
  document.getElementById('subscriptionDays').textContent = `${dias} dia${dias === 1 ? '' : 's'}`;

  if (assinatura.plano) {
    const selectPlan = document.getElementById('renewPlan');
    const available = Array.from(selectPlan.options).map((opt) => opt.value);
    if (available.includes(assinatura.plano)) {
      selectPlan.value = assinatura.plano;
    }
  }
}
