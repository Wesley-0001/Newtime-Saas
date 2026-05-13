/**
 * Check List — Impressão
 * Navegação, validação, UI condicional e persistência Firestore.
 */
import { db, auth, Timestamp } from '../firebase-db.js';
import { collection, addDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { signInAnonymously } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { mountCheckinSuccessUI, appendCheckinToMatrizDemoRows, matrizRowFromCalandraOrImpressao } from './checkin-flow.js';

const TOTAL = 6;
const COLLECTION = 'checklist_impressao';

const SUCCESS_PANEL_IDLE_CLASS = 'impressao-card impressao-success';
const SUCCESS_PANEL_IDLE_HTML =
  '<div class="impressao-success-ico" aria-hidden="true">✅</div>' +
  '<h3>Check-in enviado com sucesso!</h3>' +
  '<p>Redirecionando para o painel...</p>';

const CHECKLIST_LABELS = [
  'PVs conferidas',
  'Setor organizado e limpo',
  'Produção parada',
  'Houve problema na Impressão?',
  'Houve problema no tecido ou largura?',
  'Houve problemas na Revisadeira?',
  'Os retalhos estão organizados?',
  'O papel queimado está armazenado no local correto?'
];

/** Chaves estáveis do objeto `checklist` no Firestore (8 itens). */
const CHECKLIST_KEYS = [
  'pvs_conferidas',
  'setor_organizado_limpo',
  'producao_parada',
  'problema_impressao',
  'problema_tecido_ou_largura',
  'problema_revisadeira',
  'retalhos_organizados',
  'papel_queimado_local_correto'
];

function simNaoFromRadio(value) {
  if (value === 'sim') return 'Sim';
  if (value === 'nao') return 'Não';
  return '';
}

function waitDbReady(timeoutMs = 60000) {
  if (typeof window !== 'undefined' && window._dbReady) return Promise.resolve();
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const t = setInterval(() => {
      if (typeof window !== 'undefined' && window._dbReady) {
        clearInterval(t);
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        clearInterval(t);
        reject(new Error('Firebase demorou para ficar pronto. Recarregue a página e tente de novo.'));
      }
    }, 80);
  });
}

async function resolveCriadoPorUid() {
  if (auth.currentUser && auth.currentUser.uid) return auth.currentUser.uid;
  try {
    const cred = await signInAnonymously(auth);
    return cred.user.uid;
  } catch (e) {
    const msg = e && (e.message || String(e));
    throw new Error(
      'Não foi possível obter o identificador do usuário (Firebase Auth). ' +
        'Ative o login anônimo no console ou autentique-se. Detalhe: ' + msg
    );
  }
}

function isoDateToBr(iso) {
  if (!iso || typeof iso !== 'string') return '';
  const p = iso.split('-');
  if (p.length !== 3) return iso;
  return `${p[2]}/${p[1]}/${p[0]}`;
}

function showAlert(el, msg) {
  el.textContent = msg;
  el.classList.add('is-visible');
}

function hideAlert(el) {
  el.classList.remove('is-visible');
  el.textContent = '';
}

function valStep1(form) {
  const d = form.querySelector('#data_inicio_turno').value;
  if (!d) return 'Informe a data de início do turno.';
  const eq = form.querySelector('input[name="equipe"]:checked');
  if (!eq) return 'Selecione a equipe (EQ1 a EQ4).';
  return '';
}

function valStep2() {
  return '';
}

function valStep3(form) {
  const el = form.querySelector('#producao_rolos');
  const v = el.value.trim();
  if (v === '') return 'Informe a produção em rolos.';
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
    return 'Use apenas números inteiros não negativos para a produção.';
  }
  return '';
}

function valStep4(form, nItems) {
  for (let i = 1; i <= nItems; i++) {
    const sel = form.querySelector(`input[name="checklist_${i}"]:checked`);
    if (!sel) return 'Responda Sim ou Não em todas as linhas do check list.';
  }
  return '';
}

function valStep5(form, pedidoQty) {
  const pr = form.querySelector('input[name="pedido_revisar"]:checked');
  if (!pr) return 'Indique se há pedido a ser revisado.';
  if (pr.value === 'sim') {
    const q = pedidoQty.value.trim();
    if (q === '') return 'Informe a quantidade de rolos a revisar.';
    const n = Number(q);
    if (!Number.isFinite(n) || n < 1 || !Number.isInteger(n)) {
      return 'A quantidade de pedidos deve ser um número inteiro maior ou igual a 1.';
    }
  }
  return '';
}

function valStep6() {
  return '';
}

function getFirstValidationError(form, nItems, pedidoQty) {
  const checks = [
    () => valStep1(form),
    () => valStep2(),
    () => valStep3(form),
    () => valStep4(form, nItems),
    () => valStep5(form, pedidoQty),
    () => valStep6()
  ];
  for (let i = 0; i < checks.length; i++) {
    const err = checks[i]();
    if (err) return { step: i + 1, message: err };
  }
  return null;
}

function validateCurrentStep(step, form, nItems, pedidoQty) {
  if (step === 1) return valStep1(form);
  if (step === 2) return valStep2();
  if (step === 3) return valStep3(form);
  if (step === 4) return valStep4(form, nItems);
  if (step === 5) return valStep5(form, pedidoQty);
  if (step === 6) return valStep6();
  return '';
}

function buildChecklistPayload(form) {
  const checklist = {};
  for (let i = 0; i < CHECKLIST_KEYS.length; i++) {
    const r = form.querySelector(`input[name="checklist_${i + 1}"]:checked`);
    checklist[CHECKLIST_KEYS[i]] = r ? simNaoFromRadio(r.value) : '';
  }
  return checklist;
}

function collectPayload(form) {
  const dataIso = form.querySelector('#data_inicio_turno').value;
  const equipe = form.querySelector('input[name="equipe"]:checked')?.value || '';
  const relatorio = form.querySelector('#relatorio').value.trim();
  const producaoQtd = Number(form.querySelector('#producao_rolos').value.trim());
  const checklist = buildChecklistPayload(form);
  const checklistObservacoes = form.querySelector('#observacoes').value.trim();

  const pr = form.querySelector('input[name="pedido_revisar"]:checked');
  const temPedido = pr ? simNaoFromRadio(pr.value) : 'Não';
  let pedidoQtd = null;
  if (pr && pr.value === 'sim') {
    pedidoQtd = Number(form.querySelector('#pedido_qtd_rolos').value.trim());
  }

  return {
    dataEntrada: isoDateToBr(dataIso),
    equipe,
    relatorio,
    producaoQtd,
    checklist,
    checklistObservacoes,
    temPedido,
    pedidoQtd,
    faltas: ''
  };
}

function fmtDateBrFromIso(iso) {
  return isoDateToBr(iso) || '—';
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br/>');
}

function buildSummaryHtml(form, reviewSummary) {
  const eq = form.querySelector('input[name="equipe"]:checked');
  const pr = form.querySelector('input[name="pedido_revisar"]:checked');
  const pedidoQty = form.querySelector('#pedido_qtd_rolos');
  let html = '';
  html += `<dt>Data de início do turno</dt><dd>${fmtDateBrFromIso(form.querySelector('#data_inicio_turno').value)}</dd>`;
  html += `<dt>Equipe</dt><dd>${eq ? eq.value : '—'}</dd>`;
  html += `<dt>Produção (rolos)</dt><dd>${form.querySelector('#producao_rolos').value}</dd>`;
  html += `<dt>Pedido a revisar</dt><dd>${pr ? (pr.value === 'sim' ? `Sim (${pedidoQty.value} rolos)` : 'Não') : '—'}</dd>`;
  const rel = form.querySelector('#relatorio').value.trim();
  const obs = form.querySelector('#observacoes').value.trim();
  if (rel) html += `<dt>Relatório</dt><dd>${escHtml(rel)}</dd>`;
  if (obs) html += `<dt>Observações</dt><dd>${escHtml(obs)}</dd>`;
  html += '<dt>Check list</dt><dd><ul style="margin:4px 0 0 18px;padding:0">';
  for (let i = 0; i < CHECKLIST_LABELS.length; i++) {
    const r = form.querySelector(`input[name="checklist_${i + 1}"]:checked`);
    const label = CHECKLIST_LABELS[i];
    const val = r ? simNaoFromRadio(r.value) : '—';
    html += `<li>${escHtml(label)}: <strong>${val}</strong></li>`;
  }
  html += '</ul></dd>';
  reviewSummary.innerHTML = html;
}

function syncPedidoQtyVisibility(pedidoSim, pedidoQtyWrap, pedidoQty) {
  if (pedidoSim.checked) {
    pedidoQtyWrap.classList.add('is-visible');
  } else {
    pedidoQtyWrap.classList.remove('is-visible');
    pedidoQty.value = '';
  }
}

function init() {
  const elIndicator = document.getElementById('step-indicator');
  const elFill = document.getElementById('progress-fill');
  const elAlert = document.getElementById('step-alert');
  const panels = document.querySelectorAll('.impressao-step-panel');
  const btnBack = document.getElementById('btn-back');
  const btnNext = document.getElementById('btn-next');
  const btnSubmit = document.getElementById('btn-submit');
  const form = document.getElementById('form-impressao');
  const tbody = document.getElementById('checklist-tbody');
  const pedidoQtyWrap = document.getElementById('pedido-qty-wrap');
  const pedidoSim = document.getElementById('pedido_sim');
  const pedidoNao = document.getElementById('pedido_nao');
  const pedidoQty = document.getElementById('pedido_qtd_rolos');
  const reviewSummary = document.getElementById('review-summary');
  const successPanel = document.getElementById('success-panel');
  const darkToggle = document.getElementById('dark-toggle');

  if (!form || !tbody || !successPanel) return;

  const nItems = CHECKLIST_LABELS.length;
  let step = 1;

  function setStep(s) {
    step = s;
    hideAlert(elAlert);
    panels.forEach((p) => {
      const n = parseInt(p.getAttribute('data-step'), 10);
      const on = n === step;
      p.classList.toggle('is-active', on);
      p.hidden = !on;
    });
    elIndicator.textContent = `Etapa ${step} de ${TOTAL}`;
    elFill.style.width = `${(100 * step) / TOTAL}%`;
    btnBack.style.visibility = step === 1 ? 'hidden' : 'visible';
    btnBack.disabled = step === 1;
    btnNext.hidden = step === TOTAL;
    btnSubmit.hidden = step !== TOTAL;
    if (step === TOTAL) buildSummaryHtml(form, reviewSummary);
    try {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      window.scrollTo(0, 0);
    }
  }

  CHECKLIST_LABELS.forEach((text, idx) => {
    const i = idx + 1;
    const tr = document.createElement('tr');
    const safeLabel = text.replace(/"/g, '&quot;');
    tr.innerHTML =
      `<th scope="row">${text}</th>` +
      `<td><input type="radio" name="checklist_${i}" value="sim" aria-label="${safeLabel} — Sim" /></td>` +
      `<td><input type="radio" name="checklist_${i}" value="nao" aria-label="${safeLabel} — Não" /></td>`;
    tbody.appendChild(tr);
  });

  form.addEventListener('change', (e) => {
    if (e.target && e.target.name === 'pedido_revisar') {
      syncPedidoQtyVisibility(pedidoSim, pedidoQtyWrap, pedidoQty);
    }
  });

  btnNext.addEventListener('click', () => {
    const err = validateCurrentStep(step, form, nItems, pedidoQty);
    if (err) {
      showAlert(elAlert, err);
      return;
    }
    if (step < TOTAL) setStep(step + 1);
  });

  btnBack.addEventListener('click', () => {
    if (step > 1) setStep(step - 1);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const ve = getFirstValidationError(form, nItems, pedidoQty);
    if (ve) {
      setStep(ve.step);
      showAlert(elAlert, ve.message);
      return;
    }

    if (btnSubmit.disabled) return;

    const btnMain = document.getElementById('btn-submit-main');
    btnSubmit.disabled = true;
    if (btnMain) btnMain.disabled = true;
    const prevLabel = btnSubmit.textContent || 'Enviar';
    btnSubmit.textContent = 'Enviando...';

    const base = collectPayload(form);
    const recordedAt = new Date();
    const eqVal = form.querySelector('input[name="equipe"]:checked')?.value || '—';
    const equipeLabel = eqVal.startsWith('EQ') ? eqVal : `Equipe ${eqVal}`;

    let persisted = false;
    try {
      await waitDbReady();
      const criadoPor = await resolveCriadoPorUid();
      await addDoc(collection(db, COLLECTION), {
        ...base,
        criadoEm: Timestamp.now(),
        criadoPor
      });
      persisted = true;
    } catch (err) {
      console.warn('[Impressão checklist] persistência indisponível — sucesso visual (demo):', err && (err.message || err));
    }

    const simulated = !persisted;
    appendCheckinToMatrizDemoRows(matrizRowFromCalandraOrImpressao('Impressão', base, recordedAt, simulated));

    form.style.display = 'none';

    mountCheckinSuccessUI({
      successPanel,
      sectorLabel: 'Impressão',
      sectorKey: 'impressao',
      equipeLabel,
      accentClass: 'nt-checkin-accent--impressao',
      panelHomeHref: '../../pages/supervisor/inicio.html',
      recordedAt,
      idleClassName: SUCCESS_PANEL_IDLE_CLASS,
      idleInnerHTML: SUCCESS_PANEL_IDLE_HTML,
      simulated,
      onAnother: () => {
        form.style.display = '';
        form.reset();
        syncPedidoQtyVisibility(pedidoSim, pedidoQtyWrap, pedidoQty);
        form.dispatchEvent(new Event('input', { bubbles: true }));
        form.dispatchEvent(new Event('change', { bubbles: true }));
        btnSubmit.disabled = false;
        btnSubmit.textContent = prevLabel;
        if (btnMain) btnMain.disabled = false;
        setStep(1);
        hideAlert(elAlert);
        try {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch {
          window.scrollTo(0, 0);
        }
      }
    });
  });

  if (darkToggle) {
    darkToggle.addEventListener('change', () => {
      document.body.classList.toggle('dark-mode', darkToggle.checked);
      try {
        localStorage.setItem('impressao-checklist-dark', darkToggle.checked ? '1' : '0');
      } catch {
        /* ignore */
      }
    });
    try {
      if (localStorage.getItem('impressao-checklist-dark') === '1') {
        darkToggle.checked = true;
        document.body.classList.add('dark-mode');
      }
    } catch {
      /* ignore */
    }
  }

  setStep(1);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
