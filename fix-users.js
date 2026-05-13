'use strict';

/**
 * Unifica documentos em `users` com e-mail @newtime.com vs @newtime
 * (mesmo login canónico). Remove duplicatas e grava `email` canónico.
 *
 * Uso: coloque a service account em scripts/serviceAccountKey.json
 *       npm install   (firebase-admin em package.json)
 *       node fix-users.js
 */

const path = require('path');
const fs = require('fs');
const admin = require('firebase-admin');

const KEY_CANDIDATES = [
  path.join(__dirname, 'scripts', 'serviceAccountKey.json'),
  path.join(__dirname, 'serviceAccountKey.json'),
];

function findServiceAccountPath() {
  for (const p of KEY_CANDIDATES) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/** Alinhado ao front: `@newtime.com` → `@newtime`. */
function canonicalUserEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return '';
  if (e.endsWith('@newtime.com')) return e.slice(0, -4);
  return e;
}

async function purgeDuplicates() {
  const keyPath = findServiceAccountPath();
  if (!keyPath) {
    console.error(
      'Nenhuma service account encontrada. Coloque o JSON em scripts/serviceAccountKey.json (ou na raiz como serviceAccountKey.json).'
    );
    process.exit(1);
  }

  if (!admin.apps.length) {
    const sa = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
    admin.initializeApp({ credential: admin.credential.cert(sa) });
  }

  const db = admin.firestore();
  const snapshot = await db.collection('users').get();

  const byCanon = new Map();

  for (const doc of snapshot.docs) {
    const data = doc.data() || {};
    const rawEmail = data.email;
    if (rawEmail == null || String(rawEmail).trim() === '') {
      console.warn('Documento sem campo email ignorado:', doc.id);
      continue;
    }
    const canon = canonicalUserEmail(rawEmail);
    if (!canon) continue;
    if (!byCanon.has(canon)) byCanon.set(canon, []);
    byCanon.get(canon).push({ ref: doc.ref, data, id: doc.id });
  }

  for (const [canon, list] of byCanon) {
    if (list.length <= 1) {
      const only = list[0];
      const cur = String((only.data && only.data.email) || '').trim().toLowerCase();
      if (cur !== canon) {
        console.log('Atualizando e-mail canônico:', only.id, '→', canon);
        await only.ref.update({ email: canon });
      }
      continue;
    }

    list.sort((a, b) => {
      const ae = String((a.data && a.data.email) || '').trim().toLowerCase();
      const be = String((b.data && b.data.email) || '').trim().toLowerCase();
      const aExact = ae === canon;
      const bExact = be === canon;
      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;
      const aDemo = String(a.id).startsWith('demo-');
      const bDemo = String(b.id).startsWith('demo-');
      if (!aDemo && bDemo) return -1;
      if (aDemo && !bDemo) return 1;
      return String(a.id).localeCompare(String(b.id));
    });

    const keeper = list[0];
    console.log(`Canônico «${canon}»: mantém documento ${keeper.id}`);
    await keeper.ref.update({ email: canon });

    for (let i = 1; i < list.length; i++) {
      const dup = list[i];
      console.log(`Removendo duplicata: ${dup.data.email} (${dup.id})`);
      await dup.ref.delete();
    }
  }

  console.log('Faxina concluída.');
}

purgeDuplicates().catch((err) => {
  console.error(err);
  process.exit(1);
});
