/**
 * Check List — Amostras e Perdas (Papel / Tecido)
 * Identificação do turno + perdas; envio demonstração (sem Firestore).
 */
import { mountCheckinSuccessUI, appendCheckinToMatrizDemoRows, matrizRowFromAmostrasForm } from './checkin-flow.js';

const TOTAL = 2;

const SUCCESS_PANEL_IDLE_CLASS = 'calandra-card calandra-success';
const SUCCESS_PANEL_IDLE_HTML =
  '<div class="calandra-success-ico" aria-hidden="true">✅</div>' +
  '<h3>Check-in registrado (demonstração)</h3>' +
  '<p>Visual apenas — sem gravação no servidor. Redirecionando…</p>';

function showAlert(el, msg) {
  if (!el) return;
  el.textContent = msg;
  el.classList.add('is-visible');
}

function hideAlert(el) {
  if (!el) return;
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

function getMaterialFluxo(form) {
  const r = form.querySelector('input[name="material_fluxo"]:checked');
  return r && r.value === 'tecido' ? 'tecido' : 'papel';
}

function valStep2(form) {
  const flux = getMaterialFluxo(form);
  if (flux === 'papel') {
    const el = form.querySelector('#qtd_papel');
    const v = el ? el.value.trim() : '';
    if (v === '') return 'Informe a quantidade (papel).';
    const n = Number(v);
    if (!Number.isFinite(n) || n < 1 || !Number.isInteger(n)) {
      return 'Quantidade em papel deve ser um número inteiro maior ou igual a 1.';
    }
    if (!form.querySelector('input[name="equipe_perda"]:checked')) {
      return 'Selecione a equipe que perdeu (papel).';
    }
    if (!form.querySelector('input[name="motivo_perda_papel"]:checked')) {
      return 'Selecione o motivo da perda em papel.';
    }
    return '';
  }
  const qa = form.querySelector('#qtd_metros_amostra');
  const rawA = qa ? qa.value.trim().replace(',', '.') : '';
  if (rawA === '') return 'Informe a quantidade em metros em Amostras (use 0 se não houver).';
  const na = Number(rawA);
  if (!Number.isFinite(na) || na < 0) {
    return 'Metros em Amostras deve ser um número válido (zero ou maior).';
  }
  if (na > 0 && !form.querySelector('input[name="tipo_tecido_amostra"]:checked')) {
    return 'Selecione o tipo de tecido em Amostras.';
  }

  const qp = form.querySelector('#qtd_metros_perda');
  const rawP = qp ? qp.value.trim().replace(',', '.') : '';
  if (rawP === '') return 'Informe a quantidade em metros em Perdas.';
  const np = Number(rawP);
  if (!Number.isFinite(np) || np <= 0) {
    return 'Metros em Perdas deve ser um número maior que zero.';
  }
  if (!form.querySelector('input[name="tipo_tecido_perda"]:checked')) {
    return 'Selecione o tipo de tecido em Perdas.';
  }
  if (!form.querySelector('input[name="motivo_perda_tecido"]:checked')) {
    return 'Selecione o motivo da perda em Perdas.';
  }
  return '';
}

function getFirstValidationError(form) {
  const checks = [() => valStep1(form), () => valStep2(form)];
  for (let i = 0; i < checks.length; i++) {
    const err = checks[i]();
    if (err) return { step: i + 1, message: err };
  }
  return null;
}

function validateCurrentStep(step, form) {
  if (step === 1) return valStep1(form);
  if (step === 2) return valStep2(form);
  return '';
}

function init() {
  const elIndicator = document.getElementById('step-indicator');
  const elFill = document.getElementById('progress-fill');
  const elAlert = document.getElementById('step-alert');
  const panels = document.querySelectorAll('.calandra-step-panel');
  const btnBack = document.getElementById('btn-back');
  const btnNext = document.getElementById('btn-next');
  const btnSubmit = document.getElementById('btn-submit');
  const form = document.getElementById('form-amostras');
  const successPanel = document.getElementById('success-panel');
  const darkToggle = document.getElementById('dark-toggle');

  if (!form) return;

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
    if (elIndicator) elIndicator.textContent = `Etapa ${step} de ${TOTAL}`;
    if (elFill) elFill.style.width = `${(100 * step) / TOTAL}%`;
    if (btnBack) {
      btnBack.style.visibility = step === 1 ? 'hidden' : 'visible';
      btnBack.disabled = step === 1;
    }
    if (btnNext) btnNext.hidden = step === TOTAL;
    if (btnSubmit) btnSubmit.hidden = step !== TOTAL;
    try {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      window.scrollTo(0, 0);
    }
  }

  if (btnNext) {
    btnNext.addEventListener('click', () => {
      const err = validateCurrentStep(step, form);
      if (err) {
        showAlert(elAlert, err);
        return;
      }
      if (step < TOTAL) setStep(step + 1);
    });
  }

  if (btnBack) {
    btnBack.addEventListener('click', () => {
      if (step > 1) setStep(step - 1);
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const ve = getFirstValidationError(form);
    if (ve) {
      setStep(ve.step);
      showAlert(elAlert, ve.message);
      return;
    }

    if (!successPanel || (btnSubmit && btnSubmit.disabled)) return;

    const btnMain = document.getElementById('btn-submit-main');
    if (btnSubmit) btnSubmit.disabled = true;
    if (btnMain) btnMain.disabled = true;
    const prevLabel = btnSubmit ? btnSubmit.textContent || 'Enviar' : 'Enviar';
    if (btnSubmit) btnSubmit.textContent = 'Enviando...';

    try {
      await new Promise((r) => setTimeout(r, 650));

      const recordedAt = new Date();
      const eqVal = form.querySelector('input[name="equipe"]:checked')?.value || '—';
      const equipeLabel = eqVal.startsWith('EQ') ? eqVal : `Equipe ${eqVal}`;

      appendCheckinToMatrizDemoRows(matrizRowFromAmostrasForm(form, recordedAt, true));

      form.style.display = 'none';

      mountCheckinSuccessUI({
        successPanel,
        sectorLabel: 'Amostras e Perdas',
        sectorKey: 'amostras',
        equipeLabel,
        accentClass: 'nt-checkin-accent--amostras',
        panelHomeHref: '../../pages/supervisor/inicio.html',
        recordedAt,
        idleClassName: SUCCESS_PANEL_IDLE_CLASS,
        idleInnerHTML: SUCCESS_PANEL_IDLE_HTML,
        simulated: false,
        onAnother: () => {
          form.style.display = '';
          form.reset();
          form.dispatchEvent(new Event('input', { bubbles: true }));
          form.dispatchEvent(new Event('change', { bubbles: true }));
          if (btnSubmit) {
            btnSubmit.disabled = false;
            btnSubmit.textContent = prevLabel;
          }
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
    } catch (err) {
      const detail = err && (err.message || String(err));
      showAlert(elAlert, detail || 'Erro ao processar. Tente novamente.');
      if (btnSubmit) {
        btnSubmit.disabled = false;
        btnSubmit.textContent = prevLabel;
      }
      if (btnMain) btnMain.disabled = false;
    }
  });

  if (darkToggle) {
    darkToggle.addEventListener('change', () => {
      document.body.classList.toggle('dark-mode', darkToggle.checked);
      try {
        localStorage.setItem('amostras-checklist-dark', darkToggle.checked ? '1' : '0');
      } catch {
        /* ignore */
      }
    });
    try {
      if (localStorage.getItem('amostras-checklist-dark') === '1') {
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
