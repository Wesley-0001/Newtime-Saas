/* =============================================
   FIREBASE-DB.JS — Banco de dados em nuvem
   New Time — Gestão de Carreira & Polivalência
   
   Projeto: new-time-2fa19
   Firestore em nuvem (Google Firebase)
============================================= */

// ─── SDK Firebase via CDN ───────────────────
import { initializeApp }       from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, collection, doc, getDocs, getDoc, setDoc, deleteDoc, writeBatch, onSnapshot, query, where, updateDoc, addDoc, Timestamp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ─── Configuração do projeto — New Time ─────
const firebaseConfig = {
  apiKey:            "AIzaSyCgW8G9CFJBALE9NjJCGnCLRk7y01v9BmU",
  authDomain:        "new-time-2fa19.firebaseapp.com",
  projectId:         "new-time-2fa19",
  storageBucket:     "new-time-2fa19.firebasestorage.app",
  messagingSenderId: "292225946902",
  appId:             "1:292225946902:web:513277b634995f96f0ec37"
};

const firebaseApp = initializeApp(firebaseConfig);
const db          = getFirestore(firebaseApp);

// ─── Versão dos dados ────────────────────────
// Mude este número para forçar re-população automática dos cargos.
const DATA_VERSION = 'v1.0-newtime';

// ─── Cache em memória ────────────────────────
window._cache = {
  employees:   [],
  careers:     [],
  evaluations: [],
  excecoes:    [],
  teams:       [],
  // Novos módulos
  purchases:   [],
  suppliers:   [],
  products:    [],
  users:       [],
  notifications: []
};
window._dbReady = false;

let _ntInAppUnsub = null;

// ─── Carrega coleção do Firestore ────────────
async function loadCollection(name) {
  const snap = await getDocs(collection(db, name));
  return snap.docs.map(d => ({ ...d.data(), id: d.id }));
}

// ─── Salva array inteiro via batch ───────────
async function persistCollection(name, arr) {
  try {
    const batch = writeBatch(db);
    arr.forEach(item => {
      const ref   = doc(db, name, String(item.id));
      const clean = JSON.parse(JSON.stringify(item)); // remove undefined
      batch.set(ref, clean, { merge: true });
    });
    await batch.commit();
  } catch(e) {
    console.error(`[Firebase] Erro ao salvar ${name}:`, e);
  }
}

// ─── Apaga e re-insere uma coleção inteira ───
async function wipeAndSeed(name, data) {
  try {
    const snap  = await getDocs(collection(db, name));
    const batch = writeBatch(db);
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
    if (data.length > 0) await persistCollection(name, data);
    console.log(`✅ ${name} re-populado com ${data.length} registros.`);
  } catch(e) {
    console.error(`[Firebase] Erro ao resetar ${name}:`, e);
  }
}

// ─── Popula banco verificando versão ─────────
async function seedIfNeeded() {
  const demoCars = window.DEMO_CAREERS || [];

  // Verifica versão salva no Firestore
  let storedVersion = null;
  try {
    const verSnap = await getDocs(collection(db, '_meta'));
    const verDoc  = verSnap.docs.find(d => d.id === 'version');
    if (verDoc) storedVersion = verDoc.data().v;
    console.log(`[Seed] Versão Firebase: ${storedVersion} | Atual: ${DATA_VERSION}`);
  } catch(e) { console.warn('[Seed] Sem _meta:', e.message); }

  const needsReseed = storedVersion !== DATA_VERSION;

  // Verifica careers
  const carSnap = await getDocs(collection(db, 'careers'));
  if (carSnap.size === 0 || needsReseed) {
    console.log(`🌱 Populando trilha de carreira (${demoCars.length} cargos)...`);
    await wipeAndSeed('careers', demoCars);
  } else {
    console.log(`✔️ Careers OK (${carSnap.size} cargos)`);
  }

  // ⚠️ Employees NÃO são populados automaticamente (banco limpo intencional)
  // Os funcionários serão cadastrados diretamente no sistema.

  // Salva versão atual
  try {
    await setDoc(doc(db, '_meta', 'version'), { v: DATA_VERSION, updatedAt: Date.now() });
    console.log(`📌 Versão ${DATA_VERSION} salva.`);
  } catch(e) { console.warn('[Seed] Erro ao salvar versão:', e.message); }

  console.log('✅ Firebase New Time pronto!');
}

// ─── Reset manual (console do browser) ───────
window.resetFirebaseData = async function() {
  if (!confirm('⚠️ Isso vai APAGAR TODOS os dados no Firebase! Confirma?')) return;
  console.log('🔄 Resetando dados...');
  showLoadingScreen(true);
  await wipeAndSeed('employees',   []);
  await wipeAndSeed('evaluations', []);
  await wipeAndSeed('excecoes',    []);
  await wipeAndSeed('teams',       []);
  // Recria carreiras
  await wipeAndSeed('careers', window.DEMO_CAREERS || []);
  console.log('✅ Reset concluído! Recarregando...');
  setTimeout(() => location.reload(), 1500);
};

// ─── BOOT: carrega tudo e inicializa app ─────
window.initFirebase = async function() {
  try {
    showLoadingScreen(true);

    // Popula trilha de carreira se necessário
    await seedIfNeeded();

    // Carrega tudo para o cache
    const [emps, cars, evals, excs, tms, purs, sups, prods, usrs] = await Promise.all([
      loadCollection('employees'),
      loadCollection('careers'),
      loadCollection('evaluations'),
      loadCollection('excecoes'),
      loadCollection('teams'),
      loadCollection('purchases'),
      loadCollection('suppliers'),
      loadCollection('products'),
      loadCollection('users')
    ]);

    // ── Limpa employees sem vínculo RH (cadastrados manualmente, ex: Caio, Leonardo) ──
    const manualEmps = emps.filter(e => !e.rhMatricula);
    if (manualEmps.length > 0) {
      console.warn(`🧹 Removendo ${manualEmps.length} funcionário(s) sem vínculo RH (cadastro manual):`,
        manualEmps.map(e => e.name));
      try {
        const cleanBatch = writeBatch(db);
        manualEmps.forEach(e => cleanBatch.delete(doc(db, 'employees', String(e.id))));
        await cleanBatch.commit();
        console.log('✅ Funcionários manuais removidos com sucesso.');
      } catch(err) {
        console.error('❌ Erro ao remover funcionários manuais:', err.message);
      }
    }
    // Cache só com funcionários que têm vínculo RH
    const validEmps = emps.filter(e => e.rhMatricula);

    window._cache.employees   = validEmps;
    window._cache.careers     = cars;
    window._cache.evaluations = evals;
    window._cache.excecoes    = excs;
    window._cache.teams       = tms;
    window._cache.purchases   = purs;
    window._cache.suppliers   = sups;
    window._cache.products    = prods;
    window._cache.users       = usrs;

    window._dbReady = true;

    // Escuta mudanças em tempo real
    listenRealtime();

    // Esconde loading, mostra login
    showLoadingScreen(false);
    const loginPage = document.getElementById('page-login');
    if (loginPage) loginPage.style.display = '';
    window.bootApp();

  } catch(e) {
    console.error('[Firebase] Erro no boot:', e);
    showLoadingScreen(false, true);
  }
};

// ─── Listener tempo real ─────────────────────
function listenRealtime() {
  // Funcionários — filtra cadastros manuais (sem rhMatricula)
  onSnapshot(collection(db, 'employees'), snap => {
    if (!window._dbReady) return;
    window._cache.employees = snap.docs
      .map(d => ({ ...d.data(), id: d.id }))
      .filter(e => e.rhMatricula); // ignora cadastros manuais
    if (window.currentUser && window.updateNotifBadge) {
      window.updateNotifBadge();
      window.updateExcecoesBadges && window.updateExcecoesBadges();
    }
    if (window.currentPage && window.refreshCurrentPage) {
      window.refreshCurrentPage();
    }
  });

  // Exceções
  onSnapshot(collection(db, 'excecoes'), snap => {
    if (!window._dbReady) return;
    window._cache.excecoes = snap.docs.map(d => ({ ...d.data(), id: d.id }));
    if (window.updateExcecoesBadges) window.updateExcecoesBadges();
    if (window.currentPage && window.refreshCurrentPage) {
      window.refreshCurrentPage();
    }
  });

  // Avaliações
  onSnapshot(collection(db, 'evaluations'), snap => {
    if (!window._dbReady) return;
    window._cache.evaluations = snap.docs.map(d => ({ ...d.data(), id: d.id }));
    if (window.currentPage && window.refreshCurrentPage) {
      window.refreshCurrentPage();
    }
  });

  // Equipes de Produção
  onSnapshot(collection(db, 'teams'), snap => {
    if (!window._dbReady) return;
    window._cache.teams = snap.docs.map(d => ({ ...d.data(), id: d.id }));
    if (window.currentPage && window.refreshCurrentPage) {
      window.refreshCurrentPage();
    }
  });

  // Compras
  onSnapshot(collection(db, 'purchases'), snap => {
    if (!window._dbReady) return;
    window._cache.purchases = snap.docs.map(d => ({ ...d.data(), id: d.id }));
    if (window.currentPage === 'purchases' && window.refreshCurrentPage) window.refreshCurrentPage();
  });

  // Fornecedores
  onSnapshot(collection(db, 'suppliers'), snap => {
    if (!window._dbReady) return;
    window._cache.suppliers = snap.docs.map(d => ({ ...d.data(), id: d.id }));
  });

  // Produtos
  onSnapshot(collection(db, 'products'), snap => {
    if (!window._dbReady) return;
    window._cache.products = snap.docs.map(d => ({ ...d.data(), id: d.id }));
  });
}

// ─── FUNÇÕES SÍNCRONAS (usadas pelo app.js) ──
// Leem/escrevem no cache e salvam no Firebase em background.

window.getEmployees = function() { return window._cache.employees || []; };
window.saveEmployees = function(arr) {
  window._cache.employees = arr;
  persistCollection('employees', arr);
};

window.getCareers = function() { return window._cache.careers || []; };
window.saveCareers = function(arr) {
  window._cache.careers = arr;
  persistCollection('careers', arr);
};

window.getEvaluations = function() { return window._cache.evaluations || []; };
window.saveEvaluations = function(arr) {
  window._cache.evaluations = arr;
  persistCollection('evaluations', arr);
};

window.getExcecoes = function() { return window._cache.excecoes || []; };
window.saveExcecoes = function(arr) {
  window._cache.excecoes = arr;
  persistCollection('excecoes', arr);
};

window.getTeams = function() { return window._cache.teams || []; };
window.saveTeams = function(arr) {
  window._cache.teams = arr;
  persistCollection('teams', arr);
};

// Alias usado pelo teams-module.js
window.persistTeams = function(arr) {
  window._cache.teams = arr;
  persistCollection('teams', arr);
};

// ─── FUNÇÕES COMPRAS / FORNECEDORES / PRODUTOS ──
window.persistCollection = persistCollection; // expõe para os módulos

window.getSuppliers = function() { return window._cache.suppliers || []; };
window.saveSuppliers = function(arr) {
  window._cache.suppliers = arr;
  persistCollection('suppliers', arr);
};

window.getProducts = function() { return window._cache.products || []; };
window.saveProducts = function(arr) {
  window._cache.products = arr;
  persistCollection('products', arr);
};

window.getPurchases = function() { return window._cache.purchases || []; };
window.savePurchases = function(arr) {
  window._cache.purchases = arr;
  persistCollection('purchases', arr);
};

// ─── Notificações in-app (coleção: in_app_notifications) ──
const IN_APP_COL = 'in_app_notifications';

window._ntSubscribeInAppNotifications = function(userEmail) {
  if (_ntInAppUnsub) {
    try { _ntInAppUnsub(); } catch (_) {}
    _ntInAppUnsub = null;
  }
  if (!userEmail || !window._dbReady) {
    window._cache.notifications = [];
    return;
  }
  const em = String(userEmail).trim().toLowerCase();
  const q = query(collection(db, IN_APP_COL), where('userEmail', '==', em));
  _ntInAppUnsub = onSnapshot(q, snap => {
    window._cache.notifications = snap.docs.map(d => ({ ...d.data(), id: d.id }));
    if (window.updateNotifBadge) window.updateNotifBadge();
    else if (window._ntRefreshInAppBadge) window._ntRefreshInAppBadge();
  }, err => console.warn('[in_app_notifications]', err.message));
};

window._ntUnsubscribeInAppNotifications = function() {
  if (_ntInAppUnsub) {
    try { _ntInAppUnsub(); } catch (_) {}
    _ntInAppUnsub = null;
  }
  window._cache.notifications = [];
};

window._ntAddInAppNotification = async function(n) {
  const id = n.id || ('ntn-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10));
  const clean = JSON.parse(JSON.stringify({ ...n, id, read: !!n.read, createdAt: n.createdAt || Date.now() }));
  await setDoc(doc(db, IN_APP_COL, id), clean);
  return id;
};

window._ntBatchAddInAppNotifications = async function(list) {
  if (!list || !list.length) return;
  const chunk = 450;
  for (let i = 0; i < list.length; i += chunk) {
    const batch = writeBatch(db);
    list.slice(i, i + chunk).forEach(raw => {
      const id = raw.id || ('ntn-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10));
      const clean = JSON.parse(JSON.stringify({
        ...raw, id, read: !!raw.read, createdAt: raw.createdAt || Date.now()
      }));
      batch.set(doc(db, IN_APP_COL, id), clean);
    });
    await batch.commit();
  }
};

window._ntMarkInAppNotificationRead = async function(id) {
  if (!id) return;
  await updateDoc(doc(db, IN_APP_COL, id), { read: true });
};

window._ntMarkAllInAppNotificationsRead = async function() {
  const arr = window._cache.notifications || [];
  const unread = arr.filter(n => !n.read);
  for (let i = 0; i < unread.length; i += 450) {
    const batch = writeBatch(db);
    unread.slice(i, i + 450).forEach(n => {
      if (n.id) batch.update(doc(db, IN_APP_COL, n.id), { read: true });
    });
    await batch.commit();
  }
};

/** Coleção Firestore usada pelo portal e pelo módulo RH (holerites). */
const HOLERITES_COL = 'holerites';

/**
 * TEMPORÁRIO (demo / ambiente local): grava o PDF em Firestore como data URL — sem Firebase Storage
 * (evita CORS no Storage). NÃO usar em produção: limite de 1 MiB por documento no Firestore.
 *
 * @param {{ employeeId: string, employeeName: string, rhMatricula: string, competence: string, fileName: string, fileDataUrl: string, uploadedBy: string }} opts
 * @returns {Promise<{ id: string }>}
 */
window._ntPublishHolerite = async function(opts) {
  if (!window._dbReady) throw new Error('Firebase ainda não está pronto. Aguarde e tente de novo.');
  const employeeId    = String(opts.employeeId || '').trim();
  const employeeName  = String(opts.employeeName || '').trim();
  const rhMatricula   = String(opts.rhMatricula || '').trim();
  const competence    = String(opts.competence || '').trim();
  const fileDataUrl   = String(opts.fileDataUrl || '').trim();
  const uploadedBy    = String(opts.uploadedBy || '').trim();
  const rawName       = String(opts.fileName || 'holerite.pdf').trim();

  if (!employeeId || !fileDataUrl) throw new Error('Colaborador e arquivo são obrigatórios.');
  if (!competence) throw new Error('Informe a competência (mês/ano de referência).');
  if (!/^data:application\/pdf/i.test(fileDataUrl)) {
    throw new Error('Conteúdo inválido: era esperado um PDF (data URL).');
  }
  /* Firestore: documento máx. ~1 MiB — reforço no servidor de dados */
  if (fileDataUrl.length > 950000) {
    throw new Error('PDF muito grande para gravar no Firestore neste modo demo. Use um arquivo menor.');
  }

  const safeBase = rawName
    .replace(/[^\w.\-()\s\u00C0-\u024F]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 180);

  const now = Timestamp.now();
  const payload = {
    employeeId,
    employeeName,
    rhMatricula,
    competence,
    competencia: competence,
    fileName: rawName || safeBase,
    nomeArquivo: rawName || safeBase,
    fileDataUrl,
    uploadedAt: now,
    publishedAt: now,
    dataPublicacao: now,
    uploadedBy,
    status: 'published',
    _demoInlinePdfFirestore: true
  };
  const docRef = await addDoc(collection(db, HOLERITES_COL), payload);
  return { id: docRef.id };
};

/** Frequência / ocorrências — portal lê por `employeeId`; supervisão registra. */
const EMPLOYEE_EVENTS_COL = 'employee_events';

/**
 * Registra ocorrência (falta, folga, turno cancelado) na coleção employee_events.
 *
 * @param {{ employeeId: string, employeeName: string, rhMatricula?: string, type: string, date: string, description?: string, createdBy: string }} opts
 * @returns {Promise<{ id: string }>}
 */
window._ntPublishEmployeeEvent = async function(opts) {
  if (!window._dbReady) throw new Error('Firebase ainda não está pronto. Aguarde e tente de novo.');
  const employeeId   = String(opts.employeeId || '').trim();
  const employeeName = String(opts.employeeName || '').trim();
  const rhMatricula  = String(opts.rhMatricula || '').trim();
  const type         = String(opts.type || '').trim();
  const dateStr      = String(opts.date || '').trim();
  const description  = String(opts.description || '').trim();
  const createdBy    = String(opts.createdBy || '').trim();

  if (!employeeId || !employeeName) throw new Error('Colaborador inválido.');
  if (!dateStr) throw new Error('Informe a data.');
  const allowed = ['falta', 'folga', 'turno_cancelado'];
  if (!allowed.includes(type)) throw new Error('Tipo de ocorrência inválido.');
  if (!createdBy) throw new Error('Usuário não identificado.');

  const now = Timestamp.now();
  const payload = {
    employeeId,
    employeeName,
    rhMatricula,
    type,
    date: dateStr,
    description: description || '',
    createdAt: now,
    createdBy
  };
  const docRef = await addDoc(collection(db, EMPLOYEE_EVENTS_COL), payload);
  return { id: docRef.id };
};

/** Frequência diária por equipe (supervisor) — coleção `daily_attendance`. */
const DAILY_ATTENDANCE_COL = 'daily_attendance';

function _ntNormalizeTeamId(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  try {
    return s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[\s\-]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/[^A-Z0-9_]/g, '');
  } catch (_) {
    return s
      .toUpperCase()
      .replace(/[\s\-]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/[^A-Z0-9_]/g, '');
  }
}
window._ntNormalizeTeamId = _ntNormalizeTeamId;
window.normalizeTeamId = function(teamId) {
  return _ntNormalizeTeamId(teamId);
};

function _ntNormAttendanceStatus(st) {
  const raw = String(st == null ? '' : st).trim().toLowerCase();
  const sKey = raw.replace(/\s+/g, '_').replace(/-/g, '_');
  if (raw === 'p' || raw === 'presenca' || raw === 'presença' || raw === 'presente') return 'presente';
  if (raw === 'f' || raw === 'falta') return 'falta';
  if (raw === 'folga' || sKey === 'folga') return 'folga';
  if (sKey === 'turno_cancelado' || raw === 'cancelado' || sKey === 'cancelado') return 'turno_cancelado';
  if (raw === 'atestado' || sKey === 'atestado' || sKey === 'justificada' || raw === 'justificada' || sKey === 'justificado' || raw === 'justificado') return 'atestado';
  return raw || 'pending';
}
window._ntNormAttendanceStatus = _ntNormAttendanceStatus;

function _ntDailyAttendanceDocId(teamId, dateStr) {
  const t = _ntNormalizeTeamId(teamId).replace(/\//g, '_');
  const d = String(dateStr || '').trim();
  return `${t}_${d}`;
}

/**
 * Busca documento de frequência do dia para a equipe (teamId = e-mail do supervisor / escopo).
 * @returns {Promise<{ exists: boolean, docId: string, data: object|null }>}
 */
window._ntGetDailyAttendance = async function(teamId, dateStr) {
  if (!window._dbReady) throw new Error('Firebase ainda não está pronto. Aguarde e tente de novo.');
  const tid = _ntNormalizeTeamId(teamId);
  const d = String(dateStr || '').trim();
  if (!tid || !d) throw new Error('Equipe e data são obrigatórios.');
  const docId = _ntDailyAttendanceDocId(tid, d);
  const ref = doc(db, DAILY_ATTENDANCE_COL, docId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return { exists: false, docId, data: null };
  return { exists: true, docId, data: { id: snap.id, ...snap.data() } };
};

/**
 * Cria ou atualiza frequência do dia (setDoc com merge; não duplica documento).
 * @param {{
 *   teamId: string,
 *   date: string,
 *   status?: 'open'|'closed',
 *   records: Array<{employeeId:string,status:string}>,
 *   savedBy: string,
 *   savedRole?: string,
 *   isNew: boolean,
 *   priorRecords?: Array<object>
 * }} opts
 */
window._ntSaveDailyAttendance = async function(opts) {
  if (!window._dbReady) throw new Error('Firebase ainda não está pronto. Aguarde e tente de novo.');
  const teamId = _ntNormalizeTeamId(opts.teamId);
  const dateStr = String(opts.date || '').trim();
  const savedBy = String(opts.savedBy || '').trim();
  const savedRole = String(opts.savedRole || '').trim().toLowerCase();
  const isNew = !!opts.isNew;
  const records = Array.isArray(opts.records) ? opts.records : [];
  const priorRecords = Array.isArray(opts.priorRecords) ? opts.priorRecords : [];
  const st = opts.status === 'closed' ? 'closed' : 'open';

  if (!teamId || !dateStr || !savedBy) throw new Error('Equipe, data e usuário são obrigatórios.');

  const priorById = {};
  for (const p of priorRecords) {
    if (p && p.employeeId) priorById[String(p.employeeId)] = p;
  }

  const now = Timestamp.now();

  const cleaned = records.map(r => {
    const empId = String(r.employeeId || '').trim();
    const status = _ntNormAttendanceStatus(r.status);
    const prior = priorById[empId];
    if (!prior) {
      return {
        employeeId: empId,
        status,
        createdBy: savedBy,
        createdRole: savedRole || 'supervisor',
        updatedBy: savedBy,
        updatedRole: savedRole || 'supervisor',
        updatedAt: now
      };
    }
    const statusChanged = _ntNormAttendanceStatus(prior.status) !== status;
    return {
      employeeId: empId,
      status,
      createdBy: prior.createdBy || prior.updatedBy || savedBy,
      createdRole: prior.createdRole || prior.updatedRole || 'supervisor',
      updatedBy: statusChanged ? savedBy : (prior.updatedBy || savedBy),
      updatedRole: statusChanged ? (savedRole || 'supervisor') : (prior.updatedRole || 'supervisor'),
      updatedAt: statusChanged ? now : (prior.updatedAt || now)
    };
  }).filter(r => r.employeeId);

  const docId = _ntDailyAttendanceDocId(teamId, dateStr);
  const ref = doc(db, DAILY_ATTENDANCE_COL, docId);
  const monthYear = dateStr.length >= 7 ? dateStr.slice(0, 7) : '';

  const payload = {
    date: dateStr,
    month_year: monthYear,
    teamId,
    supervisor_id: teamId,
    status: st,
    records: cleaned,
    updatedAt: now,
    updatedBy: savedBy,
    updatedRole: savedRole || 'supervisor'
  };

  if (isNew) {
    payload.createdAt = now;
    payload.createdBy = savedBy;
    payload.createdRole = savedRole || 'supervisor';
  }

  await setDoc(ref, payload, { merge: true });
  return { docId };
};

/**
 * Lista datas (YYYY-MM-DD) que possuem documento `daily_attendance` para um time em um intervalo.
 * @param {{ teamId: string, startDate: string, endDate: string }} opts
 * @returns {Promise<Set<string>>}
 */
window._ntListDailyAttendanceDatesForTeam = async function(opts) {
  if (!window._dbReady) throw new Error('Firebase ainda não está pronto. Aguarde e tente de novo.');
  const teamId = _ntNormalizeTeamId(opts && opts.teamId ? opts.teamId : '');
  const startDate = String(opts && opts.startDate ? opts.startDate : '').trim();
  const endDate = String(opts && opts.endDate ? opts.endDate : '').trim();
  if (!teamId || !startDate || !endDate) throw new Error('Equipe e intervalo são obrigatórios.');

  const q = query(
    collection(db, DAILY_ATTENDANCE_COL),
    where('teamId', '==', teamId),
    where('date', '>=', startDate),
    where('date', '<=', endDate)
  );
  let snap;
  try {
    snap = await getDocs(q);
  } catch (e) {
    const detail = e && (e.message || String(e)) ? (e.message || String(e)) : 'erro desconhecido';
    throw new Error(`Falha ao listar datas de frequência (daily_attendance): ${detail}`);
  }
  const out = new Set();
  snap.docs.forEach(d => {
    const data = d.data();
    const ds = data && data.date != null ? String(data.date).trim() : '';
    const tid = data && data.teamId != null ? String(data.teamId).trim() : '';
    if (ds && tid === teamId) out.add(ds);
  });
  return out;
};

/**
 * @param {{ teamId: string, startDate: string, endDate: string }} opts
 * @returns {Promise<Map<string, object>>}
 */
window._ntGetDailyAttendanceSummariesForTeam = async function(opts) {
  if (!window._dbReady) throw new Error('Firebase ainda não está pronto. Aguarde e tente de novo.');
  const teamId = _ntNormalizeTeamId(opts && opts.teamId ? opts.teamId : '');
  const startDate = String(opts && opts.startDate ? opts.startDate : '').trim();
  const endDate = String(opts && opts.endDate ? opts.endDate : '').trim();
  if (!teamId || !startDate || !endDate) throw new Error('Equipe e intervalo são obrigatórios.');

  const q = query(
    collection(db, DAILY_ATTENDANCE_COL),
    where('teamId', '==', teamId),
    where('date', '>=', startDate),
    where('date', '<=', endDate)
  );
  let snap;
  try {
    snap = await getDocs(q);
  } catch (e) {
    const detail = e && (e.message || String(e)) ? (e.message || String(e)) : 'erro desconhecido';
    throw new Error(`Falha ao carregar resumos de frequência (daily_attendance): ${detail}`);
  }
  const out = new Map();
  snap.docs.forEach(d => {
    const data = d.data() || {};
    const tid = data.teamId != null ? String(data.teamId).trim() : '';
    if (tid !== teamId) return;
    const dateStr = data.date != null ? String(data.date).trim() : '';
    if (!dateStr) return;
    const records = Array.isArray(data.records) ? data.records : [];
    let presentes = 0;
    let faltas = 0;
    let atestados = 0;
    let folgas = 0;
    let hasAdminEdits = false;
    const faltantes = [];
    for (const r of records) {
      if (!r || !r.employeeId) continue;
      const st = _ntNormAttendanceStatus(r.status);
      if (st === 'presente') presentes += 1;
      else if (st === 'falta') { faltas += 1; faltantes.push(String(r.employeeId)); }
      else if (st === 'atestado') atestados += 1;
      else if (st === 'folga') folgas += 1;
      const updRole = String(r.updatedRole || '').trim().toLowerCase();
      const crtRole = String(r.createdRole || '').trim().toLowerCase();
      if ((updRole === 'admin' || updRole === 'manager') && updRole !== crtRole) {
        hasAdminEdits = true;
      }
    }
    out.set(dateStr, {
      presentes,
      faltas,
      atestados,
      folgas,
      faltantes,
      hasAdminEdits,
      total: records.length
    });
  });
  return out;
};

/**
 * @param {{ teamId: string, startDate: string, endDate: string, monthYear?: string }} opts
 */
window._ntListDailyAttendanceDocsForTeam = async function(opts) {
  if (!window._dbReady) throw new Error('Firebase ainda não está pronto. Aguarde e tente de novo.');
  const teamId = _ntNormalizeTeamId(opts && opts.teamId ? opts.teamId : '');
  const startDate = String(opts && opts.startDate ? opts.startDate : '').trim();
  const endDate = String(opts && opts.endDate ? opts.endDate : '').trim();
  if (!teamId || !startDate || !endDate) throw new Error('Equipe e intervalo são obrigatórios.');

  const monthYear = String(opts && opts.monthYear ? opts.monthYear : '').trim();
  const useMonthYear = /^\d{4}-\d{2}$/.test(monthYear);

  const col = collection(db, DAILY_ATTENDANCE_COL);
  const qRange = query(
    col,
    where('teamId', '==', teamId),
    where('date', '>=', startDate),
    where('date', '<=', endDate)
  );

  const snaps = [];

  if (useMonthYear) {
    const qMy = query(col, where('teamId', '==', teamId), where('month_year', '==', monthYear));
    try {
      snaps.push(await getDocs(qMy));
    } catch (e) {
      console.warn('[daily_attendance] consulta month_year:', e && (e.message || String(e)));
    }
  }

  let snapRange;
  try {
    snapRange = await getDocs(qRange);
  } catch (e) {
    const detail = e && (e.message || String(e)) ? (e.message || String(e)) : 'erro desconhecido';
    throw new Error(`Falha ao listar documentos de frequência (daily_attendance): ${detail}`);
  }
  snaps.push(snapRange);

  const byId = new Map();
  for (const snap of snaps) {
    snap.docs.forEach(d => {
      const raw = d.data() || {};
      const dateStr = raw.date != null ? String(raw.date).trim() : '';
      if (!dateStr) return;
      if (dateStr < startDate || dateStr > endDate) return;
      const tid = _ntNormalizeTeamId(raw.teamId);
      if (tid !== teamId) return;
      byId.set(d.id, {
        id: String(d.id || ''),
        date: dateStr,
        teamId: tid,
        records: Array.isArray(raw.records) ? raw.records : []
      });
    });
  }

  return Array.from(byId.values()).sort((a, b) => String(a.date).localeCompare(String(b.date)));
};

window._ntListAttendanceDocsForTeam = async function(opts) {
  const rows = await window._ntListDailyAttendanceDocsForTeam(opts);
  return rows.map(d => ({
    ...d,
    date: String(d.date || '').trim(),
    teamId: _ntNormalizeTeamId(d.teamId),
    records: (Array.isArray(d.records) ? d.records : []).map(r => ({
      ...r,
      status: _ntNormAttendanceStatus(r && r.status)
    }))
  }));
};

/**
 * @param {{ monthYear: string, startDate: string, endDate: string, supervisorId?: string }} opts
 */
window._ntListDailyAttendanceDocsForDashboard = async function(opts) {
  if (!window._dbReady) throw new Error('Firebase ainda não está pronto. Aguarde e tente de novo.');
  const monthYear = String(opts && opts.monthYear ? opts.monthYear : '').trim();
  const startDate = String(opts && opts.startDate ? opts.startDate : '').trim();
  const endDate = String(opts && opts.endDate ? opts.endDate : '').trim();
  const supervisorIdRaw = opts && opts.supervisorId != null ? String(opts.supervisorId).trim() : '';
  const supervisorId = supervisorIdRaw ? _ntNormalizeTeamId(supervisorIdRaw) : '';

  if (!/^\d{4}-\d{2}$/.test(monthYear) || !startDate || !endDate) {
    throw new Error('monthYear (YYYY-MM), startDate e endDate são obrigatórios.');
  }

  const col = collection(db, DAILY_ATTENDANCE_COL);
  const byId = new Map();

  const ingestSnap = (snap) => {
    snap.docs.forEach(d => {
      const raw = d.data() || {};
      const dateStr = raw.date != null ? String(raw.date).trim() : '';
      if (!dateStr || dateStr < startDate || dateStr > endDate) return;
      const tid = _ntNormalizeTeamId(raw.teamId);
      byId.set(d.id, {
        id: String(d.id || ''),
        date: dateStr,
        teamId: tid,
        records: Array.isArray(raw.records) ? raw.records : []
      });
    });
  };

  try {
    if (!supervisorId) {
      const qAll = query(col, where('month_year', '==', monthYear));
      const snapAll = await getDocs(qAll);
      ingestSnap(snapAll);
    } else {
      const qSid = query(
        col,
        where('supervisor_id', '==', supervisorId),
        where('month_year', '==', monthYear)
      );
      const qTid = query(
        col,
        where('teamId', '==', supervisorId),
        where('month_year', '==', monthYear)
      );
      try {
        ingestSnap(await getDocs(qSid));
      } catch (e) {
        console.warn('[daily_attendance] dashboard supervisor_id:', e && (e.message || String(e)));
      }
      try {
        ingestSnap(await getDocs(qTid));
      } catch (e) {
        console.warn('[daily_attendance] dashboard teamId:', e && (e.message || String(e)));
      }
    }
  } catch (e) {
    const detail = e && (e.message || String(e)) ? (e.message || String(e)) : 'erro desconhecido';
    throw new Error(`Falha ao listar frequência (dashboard): ${detail}`);
  }

  const rows = Array.from(byId.values()).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return rows.map(d => ({
    ...d,
    date: String(d.date || '').trim(),
    teamId: _ntNormalizeTeamId(d.teamId),
    records: (Array.isArray(d.records) ? d.records : []).map(r => ({
      ...r,
      status: _ntNormAttendanceStatus(r && r.status)
    }))
  }));
};

/** Remove documento do dia (uso restrito a admin nas regras). */
window._ntDeleteDailyAttendance = async function(teamId, dateStr) {
  if (!window._dbReady) throw new Error('Firebase ainda não está pronto. Aguarde e tente de novo.');
  const tid = _ntNormalizeTeamId(teamId);
  const d = String(dateStr || '').trim();
  if (!tid || !d) throw new Error('Equipe e data são obrigatórios.');
  const docId = _ntDailyAttendanceDocId(tid, d);
  await deleteDoc(doc(db, DAILY_ATTENDANCE_COL, docId));
  return { docId };
};

// ─── Tela de loading ─────────────────────────
function showLoadingScreen(show, error = false) {
  const el = document.getElementById('firebase-loading');
  if (!el) return;
  if (show) {
    el.classList.remove('hidden');
  } else {
    if (error) {
      el.innerHTML = `
        <div style="text-align:center;color:white;padding:32px">
          <div style="font-size:52px;margin-bottom:16px">⚠️</div>
          <h3 style="font-size:20px;margin-bottom:8px">Erro de conexão</h3>
          <p style="font-size:14px;opacity:0.8;margin-bottom:20px">
            Verifique se o Firestore está ativado no console Firebase<br>
            e se as regras de segurança permitem leitura/escrita.
          </p>
          <button onclick="location.reload()" style="background:white;color:#002B5B;border:none;padding:12px 28px;border-radius:8px;font-weight:700;cursor:pointer;font-size:14px">
            🔄 Tentar novamente
          </button>
        </div>`;
    } else {
      el.classList.add('hidden');
    }
  }
}

// ─── Auto-inicialização ───────────────────────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => window.initFirebase());
} else {
  window.initFirebase();
}

export default {};
