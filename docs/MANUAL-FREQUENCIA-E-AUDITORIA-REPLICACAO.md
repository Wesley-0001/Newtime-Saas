# Manual técnico — Módulo **Frequência e Auditoria** (replicação)

Este documento consolida a especificação para reimplementar o módulo em outro projeto (stack próprio). No repositório **New Time** atual, a referência de código está em:

| Área | Arquivo |
|------|---------|
| UI + estados + consolidado | `js/daily-attendance-module.js` |
| Firestore (payload + APIs `window._nt*`) | `js/firebase-db.js` |
| Markup da página + modal | `app.html` (`#page-supervisor-team-attendance`, `#da-falta-modal`) |
| Estilos e tokens `--da-*` | `css/style.css` |
| Regras / índices | `firestore.rules`, `firestore.indexes.json` |
| Navegação | `js/app.js` → `supervisor-team-attendance` chama `_dailyAttendanceRenderPage` |
| Portal (normalização alinhada, se existir `window._ntNormAttendanceStatus`) | `js/portal-app.js` |

---

## 1) Firestore — estrutura

### Coleção

`daily_attendance` — **um documento por equipe (`teamId`) + dia (`date`)**.

### ID do documento

Função: `_ntDailyAttendanceDocId(teamId, dateStr)` → `normalizeTeamId(teamId) + '_' + dateStr`  
Exemplo: `RENATO@NEWTIME_2026-05-11` ou `DANIEL_2026-05-11` conforme a função `normalizeTeamId` adotada no projeto.

**Especificação “estrita” (guia alvo):** NFD, remover acentos, **uppercase**, espaços/hífens → `_`, manter apenas `[A-Z0-9_]`.

**Implementação de referência neste repo:** `normalizeTeamId` em `firebase-db.js` faz apenas `trim`, `/` → `_`, espaços em branco → `_` (sem NFD nem uppercase). Para replicação pixel-a-pixel com outro backend, alinhar a função ao contrato desejado **antes** de gravar IDs legados.

### Campos no documento (raiz)

| Campo | Tipo / formato | Uso |
|--------|----------------|-----|
| `date` | string `YYYY-MM-DD` | Dia do registro |
| `month_year` | string `YYYY-MM` | Índice / dashboard (derivado de `date`) |
| `teamId` | string normalizado | Chave da equipe (líder); escopo do supervisor nas regras |
| `supervisor_id` | string | No código de referência = **mesmo valor que `teamId`** (queries + legado) |
| `status` | `'open'` \| `'closed'` | Fluxo (hoje costuma salvar `'open'`) |
| `records` | array | Uma entrada por colaborador |
| `createdAt`, `createdBy`, `createdRole` | Timestamp / string | Criação do documento |
| `updatedAt`, `updatedBy`, `updatedRole` | Timestamp / string | Última atualização do documento |

### Objeto em `records[]`

| Campo | Descrição |
|-------|-----------|
| `employeeId` | ID do colaborador (ex.: id interno ou matrícula, conforme o app) |
| `status` | Ver seção **Status canônicos** |
| `createdBy`, `createdRole` | Quem criou a linha |
| `updatedBy`, `updatedRole`, `updatedAt` | Última alteração; auditoria + chip “editado” |

### Índices compostos (`firestore.indexes.json`)

- `teamId` ASC + `month_year` ASC  
- `supervisor_id` ASC + `month_year` ASC  

### Regras (resumo)

- **Leitura:** `admin` / `boss` / `manager` / `rh` **ou** supervisor com `resource.data.teamId == userTeamId()` (`users.teamId` ou fallback `leaderKey` / e-mail normalizado, conforme Auth).
- **Create:** `admin` **ou** supervisor com `request.resource.data.teamId == userTeamId()`.
- **Update:** `admin` **ou** supervisor **mantendo** o mesmo `teamId`.
- **Delete:** apenas `admin`.

**Nota (este repo):** `firestore.rules` pode incluir um `match /{document=**}` permissivo para não bloquear outras coleções sem Firebase Auth — **não** copiar isso para produção sem revisão.

### Fonte de colaboradores na UI

- Primário: `getEmployees()` (ou equivalente).
- Alternativa: CSV/RH (ex. colunas matrícula, nome, líder) com **equipe = colaboradores cujo líder normalizado = `teamId`**.

---

## 2) Status canônicos (`_ntNormAttendanceStatus`)

Valores persistidos / UI:

`pending`, `presente`, `falta`, `folga`, `turno_cancelado`, `atestado`

Legado: `P`/`F`, “presença”, “cancelado”, etc. → normalizar para os canônicos acima.

---

## 3) Lógica de estados — papéis

- Usar `window.currentUser.role` em **minúsculas**.
- **Supervisor:** `teamId` ativo = chave do líder inferida do usuário (nome ou parte do e-mail casando com líder do CSV/RH, conforme produto). Seletor de equipe: uma opção, **disabled** (só sua equipe).  
  Se **dia já salvo** (`docExists`) e **não destravado:** read-only — selects desabilitados, **Salvar** oculto; pode haver **Exportar CSV** e badge “Frequência consolidada”. Não salvar de novo nesse estado (cliente + regra de negócio).
- **Admin / Gerente** (`_isAdminOrManager` ou equivalente): seletor `__ALL__` (todas) ou um líder; resumo usa `_consolidatedScopeTeamId()` ou equivalente. Com documento existente: inicia read-only + **“Retificar frequência”** → `_editUnlocked = true` habilita edição e **Salvar**; **Cancelar** recarrega do Firestore.
- **Linha “editado”:** após merge, marcar quando `updatedRole ∈ {admin, manager}` e `updatedBy !== createdBy` (retificação após supervisor).

### Dia futuro / passado / hoje

- **Futuro:** painel “Planejamento”, sem edição; salvar/export desabilitados.
- **Edição liberada:** hoje; passado sem dados; admin após retificar (conforme regras do produto).

---

## 4) Assiduidade e cálculos

### Performance do dia (“Performance %”)

Função tipo `_computeSummaryFromStateRows`: contar **só** `presente` e `falta`.  
Comentário no código: *“Folga, turno cancelado e atestado não entram como falta.”*

`perfPct = round(presentes / (presentes + faltas) * 100)`; se denominador `0` → `null`.

### Calendário (heatmap / “is-low”)

- `denom = presentes + faltas`; `perf = presentes / denom`; **isLow** se `perf < 0.8` (ajustável).
- Folgas podem aparecer no **popover** como métrica separada, **não** no denominador.

### Resumos por dia (`_ntGetDailyAttendanceSummariesForTeam`)

Contar: presentes, faltas, atestados, folgas; **não** incrementar “faltas” para folga/cancelado/atestado.  
`turno_cancelado` pode não ter linha separada no agregado (só presente/falta/atestado/folga + faltantes), conforme produto.

### KPI “Aproveitamento da equipe (%)” (resumo geral)

Fórmula:

\[
\frac{(\text{ativos} \times \text{dias úteis no mês}) - \text{totalFaltas}}{\text{ativos} \times \text{dias úteis no mês}} \times 100
\]

(arredondado).

- **Dias úteis:** seg–sex no mês (dom/sáb excluídos).
- **Ativos:** colaboradores **sem** `rhDemissao` preenchido (e alinhamento RH opcional).
- Comentário explícito: *“(Folgas, atestados e turnos cancelados não entram como falta — não reduzem este %.)”* — só **faltas** reduzem o numerador; não é “contagem de presenças” no numerador.

### Tabela “Assiduidade %” por pessoa

- `denom = pres + falt`; barra = `pres / denom`.
- Folga / cancelado / just **fora** do denominador (podem ter colunas próprias).

### Matriz (quadrados) — slot → classe CSS

Função única, ex.: `_assiduitySlotToStatusClass(slot)`:

| Slot interno | Classe CSS |
|--------------|------------|
| `presente` | `status-presente` |
| `falta` | `status-falta` |
| `just` (atestado) | `status-justificada` |
| `folga` | `status-folga` |
| `turno_cancelado` | `status-cancelado` |
| `future` | `status-futuro` |
| `neu` / `empty` | `status-sem-registro` |

Após processar docs: célula vazia → `future` se `date > hoje`, senão `neu`.

---

## 5) Componentes de UI

### Página raiz

- `#page-supervisor-team-attendance`
- Entrada: `window._dailyAttendanceRenderPage` (em `app.js` ao navegar para `supervisor-team-attendance`).

### Tabela de assiduidade (matriz mensal)

**Especificação alvo (HTML gerado em JS):**

- Container: `#da-assiduity-table-mount` (nome sugerido no guia).
- **Neste repo:** a matriz é montada em `#da-matrix-wrap` com `<table class="data-table da-matrix">` e spans `.da-assid-cell-sq.status-*`.

Estrutura alvo por célula:

```html
<td class="da-assid-td-cell">
  <span class="da-assid-cell-sq status-XXXX"
    role="img" aria-label="..."
    data-da-date="YYYY-MM-DD" data-da-status="..." data-da-just="..."></span>
</td>
```

Skeleton opcional: `_renderAssiduitySkeleton` (`da-assiduity-table--skel`, `nt-skel`).

### Tabela diária (selects)

- `#da-attendance-tbody` — `select.da-status-select`, opções de `STATUS_OPTIONS`.

### Ações em massa

- **HTML sugerido:** `#da-mark-all-row` com botões `data-da-bulk="presente" | "folga" | "turno_cancelado"`.
- **Neste repo:** `#da-bulk-bar` com os mesmos `data-da-bulk`.
- **Exibição:** só na **Visão diária**; exige área de edição visível (`#da-edit-wrap` no guia); há selects **não** disabled; e pelo menos um `value === 'pending'`. Caso contrário, **hidden**.
- **Lógica:** `bulkApplyStatus` — só `presente`, `folga`, `turno_cancelado`; **confirm** para folga e cancelado; iterar selects: ignorar `disabled`; só `pending`; `dispatchEvent('change')`; **não** persistir até **Salvar frequência do dia**.
- Botões individuais podem ter ids `da-bulk-presente`, `da-bulk-folga`, `da-bulk-cancelado` e ficar **disabled** quando não houver `pending`.

### Modal

- Guia menciona `#da-emp-modal`; **neste repo:** `#da-falta-modal` — faltas por colaborador + “Retificar dia”.

### APIs globais (`firebase-db.js`)

`window._ntGetDailyAttendance`, `_ntSaveDailyAttendance`, `_ntListDailyAttendanceDatesForTeam`, `_ntGetDailyAttendanceSummariesForTeam`, `_ntListDailyAttendanceDocsForDashboard`, `_ntListAttendanceDocsForTeam`, `_ntNormAttendanceStatus`, e opcionalmente `normalizeTeamId`, `_ntDeleteDailyAttendance`.

---

## 6) Tokens CSS — claro / escuro

Definir em `:root` e sobrescrever em `body.dark-mode` (nomes estáveis):

| Variável | Uso |
|----------|-----|
| `--color-folga` | Folga |
| `--color-turno-cancelado` | Turno cancelado |
| `--da-ss-ok` | Presente (pode ser gradiente) |
| `--da-ss-bad` | Falta |
| `--da-ss-warn` | Justificada / alerta |
| `--da-ss-neu-bg`, `--da-ss-neu-border` | Sem registro |
| `--da-ss-future-bg`, `--da-ss-future-border` | Futuro |
| Bordas derivadas | `--da-ss-ok-border`, `--da-ss-bad-border`, `--da-ss-warn-border` se necessário |

**`.da-assid-cell-sq.status-*`:** `background` com `var(--da-ss-*)` + `border` com `var(--da-ss-*-border)`.

**`status-folga`:** gradiente com `#2980b9` + `var(--color-folga)`; borda `rgba(52, 152, 219, 0.65)`.

**`status-cancelado`:** gradiente com `#4c1d95` + `var(--color-turno-cancelado)` (segundo stop pode mudar no tema escuro para legibilidade).

Globais de app (`--bg-primary`, `--text-main`, etc.) devem harmonizar com os blocos acima.

---

## 7) Legenda padronizada

Rodapé **sem classe duplicada**; último item unifica **sem registro** e **futuro** com **`status-sem-registro`**.

HTML canônico (região `da-assiduity-foot`):

```html
<div class="da-assiduity-foot" aria-label="Legenda de cores">
  <span class="da-legend-item"><span class="da-assid-cell-sq da-legend-swatch status-presente" aria-hidden="true"></span> Presença confirmada</span>
  <span class="da-legend-item"><span class="da-assid-cell-sq da-legend-swatch status-falta" aria-hidden="true"></span> Falta</span>
  <span class="da-legend-item"><span class="da-assid-cell-sq da-legend-swatch status-justificada" aria-hidden="true"></span> Justificada</span>
  <span class="da-legend-item"><span class="da-assid-cell-sq da-legend-swatch status-folga" aria-hidden="true"></span> Folga</span>
  <span class="da-legend-item"><span class="da-assid-cell-sq da-legend-swatch status-cancelado" aria-hidden="true"></span> Turno cancelado</span>
  <span class="da-legend-item"><span class="da-assid-cell-sq da-legend-swatch status-sem-registro" aria-hidden="true"></span> Sem registro / futuro</span>
</div>
```

Geração em JS (dedupe por classe):

```javascript
const DA_ASSID_LEGEND = [
  { cls: 'status-presente', label: 'Presença confirmada' },
  { cls: 'status-falta', label: 'Falta' },
  { cls: 'status-justificada', label: 'Justificada' },
  { cls: 'status-folga', label: 'Folga' },
  { cls: 'status-cancelado', label: 'Turno cancelado' },
  { cls: 'status-sem-registro', label: 'Sem registro / futuro' }
];

function renderAssiduityLegendFoot(containerEl) {
  const seen = new Set();
  const parts = [];
  for (const { cls, label } of DA_ASSID_LEGEND) {
    if (seen.has(cls)) continue;
    seen.add(cls);
    parts.push(
      `<span class="da-legend-item"><span class="da-assid-cell-sq da-legend-swatch ${cls}" aria-hidden="true"></span> ${label}</span>`
    );
  }
  containerEl.innerHTML = parts.join('');
}
```

---

## 8) Checklist de arquivos a portar

| Arquivo | Função |
|---------|--------|
| `js/daily-attendance-module.js` | UI, estados, consolidado, bulk, calendário |
| `js/firebase-db.js` | `_nt*` + payload + `normalizeTeamId` |
| `app.html` | Seção `#page-supervisor-team-attendance` + modal(is) |
| `css/style.css` | Tokens `--da-*`, `--color-folga`, `.da-assid-cell-sq.status-*` |
| `firestore.rules` | `match /daily_attendance/{docId}` |
| `firestore.indexes.json` | Índices compostos |
| `js/app.js` | Rota → `_dailyAttendanceRenderPage` |
| Dados RH | CSV / `getEmployees()` alinhados ao `teamId` |

---

## 9) Prompt único para colar no novo chat

Use no **primeiro** prompt da conversa nova, ajustando stack (“é React”, “já tenho Firebase”, “não uso CSV”, etc.):

```text
Replicar o módulo "Frequência e Auditoria" (equipe diária + dashboard consolidado) com esta especificação:

FIRESTORE
- Coleção: daily_attendance
- Document ID: normalizeTeamId(teamId) + "_" + dateStr (YYYY-MM-DD)
- Campos raiz: date, month_year (YYYY-MM), teamId (string normalizada), supervisor_id (= teamId no código de referência), status ('open'|'closed'), records[], createdAt/createdBy/createdRole, updatedAt/updatedBy/updatedRole
- Cada item de records: employeeId, status, createdBy, createdRole, updatedBy, updatedRole, updatedAt
- Status canônicos (normalizar P/F e legado): pending, presente, falta, folga, turno_cancelado, atestado
- Índices compostos: (teamId, month_year) e (supervisor_id, month_year)
- Regras: admin/boss/manager/rh leem tudo; supervisor só documentos onde data.teamId == user.teamId (ou leaderKey); create/update supervisor só próprio teamId; delete só admin

LÓGICA DE NEGÓCIO
- Roles: supervisor vs admin|manager (currentUser.role em minúsculas)
- Supervisor: equipe inferida do líder (CSV/RH); após salvar dia existente = read-only até admin retificar; sem salvar de novo sozinho
- Admin/gerente: seletor todas as equipes ou uma; com doc existente começa read-only + botão "Retificar" desbloqueia edição; cancelar recarrega Firestore
- Linha "editado": updatedRole em admin|manager e updatedBy != createdBy
- Dia futuro: só planejamento, sem edição
- Performance do dia e heatmap: denominador presentes+faltas apenas; folga, turno_cancelado e atestado NÃO entram como falta
- KPI mensal "aproveitamento": (ativos * dias úteis no mês - totalFaltas) / (ativos * dias úteis); ativos = sem rhDemissao; dias úteis = seg-sex; folgas/atestados/cancelados não reduzem esse %
- Ranking: pres/(pres+falt); folga/cancel/just fora do denom
- Matriz: slots → status-presente, status-falta, status-justificada, status-folga, status-cancelado, status-futuro, status-sem-registro (função única slot→classe)

UI
- Página #page-supervisor-team-attendance: toggle Visão Diária vs Resumo Geral, stepper de mês, calendário com dots e popover, resumo executivo do dia, dashboard read-only, #da-attendance-tbody com selects, modal de faltas com link para retificar dia
- Ações em massa: só visão diária com edição visível; data-da-bulk presente|folga|turno_cancelado; só selects não disabled com value pending; confirm para folga e cancelado; disparam change; persistem só ao Salvar

APIs globais
- _ntGetDailyAttendance, _ntSaveDailyAttendance, _ntListDailyAttendanceDatesForTeam, _ntGetDailyAttendanceSummariesForTeam, _ntListDailyAttendanceDocsForDashboard, _ntListAttendanceDocsForTeam, _ntNormAttendanceStatus

CSS / LEGENDA
- .da-assid-cell-sq + .status-* com tokens :root --da-ss-*, --color-folga, --color-turno-cancelado
- Legenda: 6 itens, uma classe cada; último "Sem registro / futuro" com status-sem-registro

Implementar módulo JS + camada Firebase equivalentes, HTML/CSS alinhados ao stack do projeto destino.
```

---

## Diferenças rápidas: guia “alvo” × este repositório

| Tópico | Guia alvo | Este repo (referência) |
|--------|-----------|-------------------------|
| `normalizeTeamId` | NFD, uppercase, `[A-Z0-9_]` | `trim` + `/` e espaços → `_` |
| Mount da matriz | `#da-assiduity-table-mount` | `#da-matrix-wrap` |
| Modal empregado | `#da-emp-modal` | `#da-falta-modal` |
| Barra bulk | `#da-mark-all-row` + `#da-edit-wrap` | `#da-bulk-bar` + visibilidade por view/edit |
| Exportar CSV | Mencionado no guia | Pode não existir — adicionar se obrigatório |
| `supervisor_id` em queries “legado” | Duplo índice com `teamId` | Ambos gravados iguais ao `teamId` normalizado |

---

*Última consolidação: alinhada ao módulo New Time e ao texto de especificação fornecido para replicação.*
