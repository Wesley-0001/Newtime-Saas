/**
 * Regenera o array HR_EMPLOYEES_SEED em js/rh-data.js a partir de rh-newtime.xlsx (raiz do projeto).
 * Uso: node scripts/generate-rh-seed-from-xlsx.cjs
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const ROOT = path.join(__dirname, '..');
const XLSX_PATH = path.join(ROOT, 'rh-newtime.xlsx');
const RH_DATA = path.join(ROOT, 'js', 'rh-data.js');

function getSetorFromCargo(cargo) {
  if (!cargo) return 'Outros';
  const c = String(cargo).toLowerCase();
  if (c.includes('expediç') || c.includes('expedidor') || c.includes('logística') || c.includes('logistica') || c.includes('estoque')) return 'Expedição';
  if (c.includes('produção') || c.includes('producao') || c.includes('operador') || c.includes('impressor') || c.includes('revisor') || c.includes('líder de impressão') || c.includes('lider de impressao') || c.includes('calandra')) return 'Produção';
  if (c.includes('designer') || c.includes('supervisor designer') || (c.includes('supervisor de designer') && !c.includes('vendas'))) return 'Designer';
  if (c.includes('supervisor de designer e vendas')) return 'Vendas';
  if (c.includes('vendedor') || c.includes('vendedora') || c.includes('atendente') || c.includes('assistente de vendas') || c.includes('vendas')) return 'Vendas';
  if (c.includes('rh') || c.includes('dp') || c.includes('departamento pessoal') || c.includes('pcp') || c.includes('financeiro') || c.includes('analista') || c.includes('gerente') || c.includes('administrativo') || c.includes('recrutamento') || c.includes('seleção') || c.includes('operações') || c.includes('operacoes') || c.includes('processos') || c.includes('negócio') || c.includes('negocio') || c.includes('consultor') || c.includes('freelancer') || c.includes('estagiário') || c.includes('assistente de pcp') || c.includes('assistente de dep')) return 'Administrativo';
  if (c.includes('limpeza') || c.includes('faxineira') || c.includes('manutenção') || c.includes('manutencao') || c.includes('facilities') || c.includes('facilites') || c.includes('ajudante geral') || c.includes('1/2 oficial')) return 'Facilities';
  return 'Outros';
}

function sq(s) {
  return String(s ?? '')
    .trim()
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'");
}

function dateCode(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return "''";
  return `_parseDate('${sq(s)}')`;
}

function parseDias(v) {
  const n = parseInt(String(v ?? '').replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

function col(row, ...candidates) {
  const keys = Object.keys(row);
  for (const cand of candidates) {
    const up = cand.toUpperCase().replace(/\s+/g, ' ');
    const k = keys.find((key) => key.toUpperCase().replace(/\s+/g, ' ') === up);
    if (k !== undefined && row[k] !== undefined && String(row[k]).trim() !== '') return row[k];
  }
  for (const cand of candidates) {
    const sub = cand.slice(0, 4).toUpperCase();
    const k = keys.find((key) => key.toUpperCase().includes(sub));
    if (k !== undefined && row[k] !== undefined && String(row[k]).trim() !== '') return row[k];
  }
  return '';
}

function main() {
  if (!fs.existsSync(XLSX_PATH)) {
    console.error('Arquivo não encontrado:', XLSX_PATH);
    process.exit(1);
  }
  const wb = XLSX.readFile(XLSX_PATH, { cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { raw: false, defval: '' });

  const lines = rows.map((r) => {
    const matricula = String(col(r, 'MATRÍCULA', 'MATRICULA', 'MATR') ?? '').trim();
    const nome = String(col(r, 'COLABORADOR', 'NOME') ?? '').trim();
    const situacao = String(col(r, 'SITUAÇÃO', 'SITUACAO', 'STATUS') ?? '').trim();
    const jornada = String(col(r, 'JORNADA') ?? '').trim();
    const matriz = String(col(r, 'MATRIZ') ?? '').trim();
    const cargo = String(col(r, 'CARGO') ?? '').trim();
    const horario = String(col(r, 'HORÁRIO', 'HORARIO') ?? '').trim();
    const lider = String(col(r, 'LÍDER', 'LIDER') ?? '').trim();
    const admRaw = col(r, 'ADMISSÃO', 'ADMISSAO');
    const demRaw = col(r, 'DEMISSÃO', 'DEMISSAO');
    const nascRaw = col(r, 'NASCIMENTO');
    const diasRaw = col(r, 'DIAS DE CONTRATO', 'DIAS');
    const tipoExame = String(col(r, 'TIPO DE EXAME', 'TIPO EXAME') ?? '').trim();
    const dataExame = col(r, 'DATA DO EXAME', 'DATA EXAME');
    const telefone = String(col(r, 'TELEFONE', 'CELULAR') ?? '').trim();

    const setor = getSetorFromCargo(cargo);
    const diasContrato = parseDias(diasRaw);
    const admissao = dateCode(admRaw);
    const demissao = String(demRaw || '').trim() ? dateCode(demRaw) : "''";
    const nascimento = dateCode(nascRaw);
    const tipoEx = tipoExame ? `'${sq(tipoExame)}'` : "''";
    const dataEx = String(dataExame || '').trim() ? dateCode(dataExame) : "''";
    const tel = telefone ? `'${sq(telefone)}'` : "''";

    return (
      `  { matricula:'${sq(matricula)}', nome:'${sq(nome)}', situacao:'${sq(situacao)}', jornada:'${sq(jornada)}', matriz:'${sq(matriz)}', setor:'${sq(setor)}', cargo:'${sq(cargo)}', horario:'${sq(horario)}', lider:'${sq(lider)}', admissao:${admissao}, diasContrato:${diasContrato}, demissao:${demissao}, tipoExame:${tipoEx}, dataExame:${dataEx}, telefone:${tel}, nascimento:${nascimento} }`
    );
  });

  let src = fs.readFileSync(RH_DATA, 'utf8');
  const startToken = 'window.HR_EMPLOYEES_SEED = [';
  const endToken = '\n];\n\nwindow.getHREmployees';
  const i0 = src.indexOf(startToken);
  const i1 = src.indexOf(endToken);
  if (i0 === -1 || i1 === -1) {
    console.error('Marcadores não encontrados em rh-data.js');
    process.exit(1);
  }
  const head = src.slice(0, i0 + startToken.length);
  const tail = src.slice(i1);
  const body = '\n' + lines.join(',\n') + '\n';
  fs.writeFileSync(RH_DATA, head + body + tail, 'utf8');
  console.log('OK:', rows.length, 'registros gravados em js/rh-data.js');
}

main();
