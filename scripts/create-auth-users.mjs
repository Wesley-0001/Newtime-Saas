// scripts/create-auth-users.mjs
// Cria usuários no Firebase Auth + documento em /users/{uid} no Firestore
// Projeto: new-time-2fa19
//
// Como rodar:
//   npm install firebase-admin
//   node scripts/create-auth-users.mjs

import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth }             from 'firebase-admin/auth';
import { getFirestore }        from 'firebase-admin/firestore';

// ⚠️  Coloque aqui o caminho para sua service account key
import serviceAccount from './serviceAccountKey.json' with { type: 'json' };

initializeApp({ credential: cert(serviceAccount) });

const adminAuth = getAuth();
const db        = getFirestore();

// Emails com .com no final (Firebase Auth exige domínio válido)
const USERS = [
  { email: 'admin@newtime.com',  password: 'Newtime123',    role: 'admin',      name: 'Wesley' },
  { email: 'carlos@newtime.com', password: 'Carlosdiretor', role: 'boss',       name: 'Carlos' },
  { email: 'andre@newtime.com',  password: 'Andresup3',     role: 'manager',    name: 'André'  },
  { email: 'renato@newtime.com', password: 'Renatosup1',    role: 'supervisor', name: 'Renato' },
  { email: 'heleno@newtime.com', password: 'Helenosup2',    role: 'supervisor', name: 'Heleno' },
  { email: 'wesleycruz@newtime.com', password: 'Wesleycruz1', role: 'supervisor', name: 'Wesley Cruz' },
  { email: 'wesleyreis@newtime.com', password: 'Wesleyreis1', role: 'supervisor', name: 'Wesley Reis' },
  { email: 'rh@newtime.com',     password: 'RHNewtime1',    role: 'rh',         name: 'RH'     },
];

for (const u of USERS) {
  try {
    // Tenta criar — se já existir, busca o UID existente
    let uid;
    try {
      const record = await adminAuth.createUser({ email: u.email, password: u.password });
      uid = record.uid;
      console.log(`✅ Auth criado: ${u.email} (${uid})`);
    } catch (err) {
      if (err.code === 'auth/email-already-exists') {
        const existing = await adminAuth.getUserByEmail(u.email);
        uid = existing.uid;
        console.log(`⚠️  Já existia no Auth: ${u.email} (${uid})`);
      } else {
        throw err;
      }
    }

    // Cria/garante o documento no Firestore em /users/{uid}
    const ref  = db.collection('users').doc(uid);
    const snap = await ref.get();
    if (!snap.exists) {
      await ref.set({
        uid,
        email: u.email,
        name:  u.name,
        role:  u.role,
        createdAt: new Date()
      });
      console.log(`   📄 Firestore doc criado: /users/${uid}`);
    } else {
      console.log(`   📄 Firestore doc já existe: /users/${uid}`);
    }
  } catch (err) {
    console.error(`❌ Erro com ${u.email}:`, err.message);
  }
}

console.log('\n🏁 Concluído.');
