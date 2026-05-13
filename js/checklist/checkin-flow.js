/**
 * Confirmação pós-envio de check-in (Calandra / Impressão / Amostras) + marcação no painel + demo Matriz.
 */

export const NT_CHECKLIST_DONE_STORAGE_KEY = 'nt_checklist_done_by_day';
export const NT_MATRIZ_DEMO_CHECKINS_KEY = 'nt_matriz_demo_checkins';

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function markChecklistDoneForToday(sectorKey) {
  const day = new Date().toISOString().slice(0, 10);
  try {
    const map = JSON.parse(sessionStorage.getItem(NT_CHECKLIST_DONE_STORAGE_KEY) || '{}');
    if (!map[day]) map[day] = {};
    map[day][sectorKey] = true;
    sessionStorage.setItem(NT_CHECKLIST_DONE_STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

/** Linha no formato consumido por matriz-dados.html (renderTable). */
export function matrizRowFromCalandraOrImpressao(setorNome, base, recordedAt, simulated) {
  const dataHora = recordedAt.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
  const temPedido = base.temPedido === 'Sim' ? 'Sim' : 'Não';
  const obsParts = [];
  if (base.relatorio) obsParts.push(base.relatorio);
  if (base.checklistObservacoes) obsParts.push(base.checklistObservacoes);
  if (simulated) obsParts.push('[Sem gravação na nuvem — modo demonstração / Auth]');
  return {
    id: `chk-${setorNome}-${Date.now()}`,
    setor: setorNome,
    dataHora,
    equipe: base.equipe || '—',
    responsavel: simulated ? 'Firebase indisponível (UI)' : 'Check-in supervisor',
    tipoMaterial: '',
    qtdAmostra: Number.isFinite(base.producaoQtd) ? base.producaoQtd : '—',
    tipoTecido: '',
    motivoPapel: '',
    motivoTecido: '',
    equipePerda: '',
    temPedido,
    pedidoQtd: base.pedidoQtd != null && base.pedidoQtd !== '' ? String(base.pedidoQtd) : '',
    obs: obsParts.length ? obsParts.join(' · ') : '—'
  };
}

/** Amostras — linha compatível com a matriz (campos de papel/tecido). */
export function matrizRowFromAmostrasForm(form, recordedAt, simulated) {
  const flux = form.querySelector('input[name="material_fluxo"]:checked')?.value === 'tecido' ? 'Tecido' : 'Papel';
  const eq = form.querySelector('input[name="equipe"]:checked')?.value || '—';
  const dataHora = recordedAt.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
  let qtdAmostra = '—';
  let tipoTecido = '';
  let motivoPapel = '';
  let motivoTecido = '';
  let equipePerda = '';
  if (flux === 'Papel') {
    const q = form.querySelector('#qtd_papel')?.value?.trim();
    qtdAmostra = q || '—';
    const mp = form.querySelector('input[name="motivo_perda_papel"]:checked');
    motivoPapel =
      mp?.closest('label')?.querySelector('span')?.textContent?.trim() || mp?.value || '';
    equipePerda = form.querySelector('input[name="equipe_perda"]:checked')?.value || '';
  } else {
    const qa = form.querySelector('#qtd_metros_amostra')?.value?.trim().replace(',', '.');
    const qp = form.querySelector('#qtd_metros_perda')?.value?.trim().replace(',', '.');
    qtdAmostra = qp ? `${qa || '0'} / ${qp} m` : qa || '—';
    const ta = form.querySelector('input[name="tipo_tecido_amostra"]:checked');
    const tp = form.querySelector('input[name="tipo_tecido_perda"]:checked');
    tipoTecido = [ta?.value, tp?.value].filter(Boolean).join(' → ') || '—';
    const mt = form.querySelector('input[name="motivo_perda_tecido"]:checked');
    motivoTecido = mt?.closest('label')?.querySelector('span')?.textContent?.trim() || mt?.value || '';
  }
  const obsParts = [];
  if (simulated) obsParts.push('[Demonstração — sem servidor]');
  return {
    id: `chk-amostras-${Date.now()}`,
    setor: 'Amostras e Perdas',
    dataHora,
    equipe: eq,
    responsavel: simulated ? 'Demonstração UI' : 'Check-in Amostras',
    tipoMaterial: flux,
    qtdAmostra,
    tipoTecido,
    motivoPapel,
    motivoTecido,
    equipePerda,
    temPedido: 'Não',
    pedidoQtd: '',
    obs: obsParts.join(' ') || '—'
  };
}

export function appendCheckinToMatrizDemoRows(row) {
  try {
    const prev = JSON.parse(localStorage.getItem(NT_MATRIZ_DEMO_CHECKINS_KEY) || '[]');
    const next = [row, ...prev].slice(0, 80);
    localStorage.setItem(NT_MATRIZ_DEMO_CHECKINS_KEY, JSON.stringify(next));
  } catch (e) {
    console.warn('[checkin-flow] matriz demo:', e);
  }
}

/**
 * @param {HTMLElement} successPanel
 * @param {object} opts
 * @param {string} opts.sectorLabel
 * @param {string} opts.sectorKey
 * @param {string} opts.equipeLabel
 * @param {string} opts.accentClass
 * @param {string} opts.panelHomeHref
 * @param {Date} [opts.recordedAt]
 * @param {string} opts.idleClassName
 * @param {string} opts.idleInnerHTML
 * @param {() => void} opts.onAnother
 * @param {boolean} [opts.simulated] — true quando o envio ao Firestore falhou e a UI segue em modo demo
 */
export function mountCheckinSuccessUI({
  successPanel,
  sectorLabel,
  sectorKey,
  equipeLabel,
  accentClass,
  panelHomeHref,
  recordedAt,
  idleClassName,
  idleInnerHTML,
  onAnother,
  simulated = false
}) {
  if (!successPanel) return;

  markChecklistDoneForToday(sectorKey);

  const d = recordedAt instanceof Date ? recordedAt : new Date(recordedAt || Date.now());
  const dateStr = d.toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  });
  const timeStr = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const metaLine = `${dateStr} · ${timeStr} · Equipe: ${equipeLabel}`;

  let metaBlock =
    '<p class="nt-checkin-success-meta">' +
    escHtml(metaLine) +
    '</p>';
  if (simulated) {
    metaBlock +=
      '<p class="nt-checkin-success-hint">' +
      escHtml('Atenção: os dados não foram gravados na nuvem neste envio (Firebase/Auth). Use para testar a interface.') +
      '</p>';
  }

  successPanel.innerHTML =
    '<div class="nt-checkin-success-card" role="dialog" aria-modal="true" aria-labelledby="nt-checkin-success-title">' +
    '<div class="nt-checkin-success-check" aria-hidden="true">✓</div>' +
    '<h3 id="nt-checkin-success-title" class="nt-checkin-success-heading">' +
    escHtml(`Check-in de ${sectorLabel} enviado com sucesso!`) +
    '</h3>' +
    metaBlock +
    '<div class="nt-checkin-success-btns">' +
    '<button type="button" class="nt-checkin-success-primary" id="nt-checkin-success-another">Novo Check-in</button>' +
    '<button type="button" class="nt-checkin-success-secondary" id="nt-checkin-success-home">Ir para o Início</button>' +
    '</div>' +
    '</div>';

  successPanel.classList.add('nt-checkin-success-overlay', accentClass);
  requestAnimationFrame(() => {
    successPanel.classList.add('is-visible');
    const card = successPanel.querySelector('.nt-checkin-success-card');
    if (card) {
      requestAnimationFrame(() => card.classList.add('nt-checkin-success-card--visible'));
    }
  });

  function restoreIdle() {
    const card = successPanel.querySelector('.nt-checkin-success-card');
    if (card) card.classList.remove('nt-checkin-success-card--visible');
    successPanel.classList.remove('is-visible', 'nt-checkin-success-overlay', accentClass);
    successPanel.className = idleClassName;
    successPanel.innerHTML = idleInnerHTML;
  }

  const btnAnother = successPanel.querySelector('#nt-checkin-success-another');
  const btnHome = successPanel.querySelector('#nt-checkin-success-home');
  if (btnAnother) {
    btnAnother.addEventListener('click', () => {
      restoreIdle();
      onAnother();
    });
  }
  if (btnHome) {
    btnHome.addEventListener('click', () => {
      window.location.href = panelHomeHref;
    });
  }
}
