const express = require('express');
const fs = require('fs');

const app = express();
app.use(express.json());

// ─────────────────────────────────────────────
// BASE DE DONNÉES
// ─────────────────────────────────────────────
let db, pool, usePostgres = false;

if (process.env.DATABASE_URL) {
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  usePostgres = true;
  pool.query(`CREATE TABLE IF NOT EXISTS commandes (
    id SERIAL PRIMARY KEY,
    numero TEXT UNIQUE,
    telephone TEXT,
    total INTEGER,
    statut TEXT DEFAULT 'En preparation',
    date TEXT
  );`).then(()=>console.log('PostgreSQL pret!'));
} else {
  const Database = require('better-sqlite3');
  db = new Database('easyorder.db');
  db.exec(`CREATE TABLE IF NOT EXISTS commandes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    numero TEXT UNIQUE,
    telephone TEXT,
    total INTEGER,
    statut TEXT DEFAULT 'En preparation',
    date TEXT
  );`);
  console.log('SQLite pret!');
}

async function getCommandes() {
  if (usePostgres) {
    const r = await pool.query('SELECT * FROM commandes ORDER BY id DESC');
    return r.rows;
  }
  return db.prepare('SELECT * FROM commandes ORDER BY id DESC').all();
}

async function insertCommande(n, tel, t, date) {
  if (usePostgres) {
    await pool.query('INSERT INTO commandes (numero,telephone,total,statut,date) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [n, tel, t, 'En preparation', date]);
  } else {
    db.prepare('INSERT OR IGNORE INTO commandes (numero,telephone,total,statut,date) VALUES (?,?,?,?,?)').run(n, tel, t, 'En preparation', date);
  }
}

async function updateStatut(num, statut) {
  if (usePostgres) {
    await pool.query('UPDATE commandes SET statut=$1 WHERE numero=$2', [statut, num]);
  } else {
    db.prepare('UPDATE commandes SET statut=? WHERE numero=?').run(statut, num);
  }
}

// ─────────────────────────────────────────────
// CATALOGUE
// ─────────────────────────────────────────────
const P = [
  {id:1, nom:'Castel 65cl',     prix:500},
  {id:2, nom:'Beaufort 65cl',   prix:500},
  {id:3, nom:'Malta 65cl',      prix:400},
  {id:4, nom:'CocaCola 50cl',   prix:400},
  {id:5, nom:'Supermont 1.5L',  prix:300}
];

const S = {};
function gs(t) { if(!S[t]) S[t] = {e:'menu', p:[]}; return S[t]; }

function bot(tel, msg) {
  const s = gs(tel);
  const m = String(msg).trim().toLowerCase();

  console.log(`🔍 État session ${tel}: "${s.e}" | msg: "${m}"`);

  // ── COMMANDES GLOBALES (toujours disponibles) ──
  if (m === 'menu' || m === 'bonjour' || m === 'hello' || m === 'salut' || m === 'start') {
    s.e = 'menu';
    s.p = [];
    return 'Bienvenue sur ZYNTRA! 🛒\n\nTapez le numero de votre choix:\n\n1 - COMMANDER\n2 - MES COMMANDES\n3 - CONTACT\n\n(Tapez MENU a tout moment pour recommencer)';
  }

  if (m === 'confirmer') {
    if (!s.p.length) return 'Votre panier est vide.\nTapez 1 pour commander.';
    const t = s.p.reduce((a, p) => a + p.prix * p.q, 0);
    const n = 'CMD-' + Date.now().toString().slice(-6);
    const date = new Date().toLocaleDateString('fr-FR');
    insertCommande(n, tel, t, date);
    s.p = []; s.e = 'menu';
    return '✅ COMMANDE CONFIRMEE!\n\nNumero: ' + n + '\nTotal: ' + t + ' FCFA\n\nMerci pour votre commande ZYNTRA!\nTapez MENU pour continuer.';
  }

  if (m === '0') {
    if (!s.p.length) return 'Votre panier est vide.\nTapez 1 pour commander.';
    let t = 0, r = '🛒 VOTRE PANIER:\n\n';
    s.p.forEach(p => { t += p.prix * p.q; r += '• ' + p.nom + ' x' + p.q + ' = ' + (p.prix * p.q) + ' FCFA\n'; });
    return r + '\nTOTAL: ' + t + ' FCFA\n\nTapez CONFIRMER pour valider\nTapez MENU pour annuler';
  }

  // ── ÉTAT MENU ──
  if (s.e === 'menu') {
    if (m === '1' || m === 'commander') {
      s.e = 'cat';
      s.p = [];
      let r = '📦 CATALOGUE:\n\n';
      P.forEach(x => r += x.id + '. ' + x.nom + ' - ' + x.prix + ' FCFA\n');
      return r + '\nTapez le numero du produit pour l\'ajouter\n0 = voir panier\nCONFIRMER = valider';
    }
    if (m === '2') {
      return '📋 Vos commandes sont visibles sur le dashboard admin.\n\nTapez MENU pour revenir.';
    }
    if (m === '3') {
      return '📞 Support ZYNTRA:\n\n+237 651 16 15 77\n\nTapez MENU pour revenir.';
    }
    return 'Tapez 1, 2 ou 3 pour choisir une option.\nOu tapez MENU pour recommencer.';
  }

  // ── ÉTAT CATALOGUE ──
  if (s.e === 'cat') {
    const num = parseInt(m);
    if (!isNaN(num) && num >= 1 && num <= P.length) {
      const p = P.find(x => x.id === num);
      const ex = s.p.find(x => x.id === p.id);
      if (ex) ex.q++;
      else s.p.push({...p, q:1});
      const total = s.p.reduce((a, x) => a + x.prix * x.q, 0);
      return '✅ ' + p.nom + ' ajoute au panier!\n\nTotal panier: ' + total + ' FCFA\n\nContinuez a commander\n0 = voir panier\nCONFIRMER = valider';
    }
    return 'Tapez un numero entre 1 et ' + P.length + ' pour choisir un produit.\n0 = voir panier\nCONFIRMER = valider\nMENU = recommencer';
  }

  return 'Tapez MENU pour commencer.';
}

// ─────────────────────────────────────────────
// ENVOI MESSAGE WHATSAPP
// ─────────────────────────────────────────────
async function sendWhatsAppMessage(to, message) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_TOKEN;

  if (!phoneNumberId || !token) {
    console.error('❌ Variables manquantes');
    return;
  }

  return new Promise((resolve) => {
    const https = require('https');
    const data = JSON.stringify({
      messaging_product: 'whatsapp',
      to: to,
      type: 'text',
      text: { body: message }
    });

    const options = {
      hostname: 'graph.facebook.com',
      path: `/v19.0/${phoneNumberId}/messages`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };

    const req = https.request(options, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const result = JSON.parse(d);
          if (result.error) {
            console.error('❌ Erreur Meta:', JSON.stringify(result.error));
          } else {
            console.log('✅ Message envoyé à', to);
          }
          resolve(result);
        } catch(e) {
          console.error('❌ Erreur parsing:', e.message);
          resolve(null);
        }
      });
    });

    req.on('error', (err) => {
      console.error('❌ Erreur réseau:', err.message);
      resolve(null);
    });

    req.write(data);
    req.end();
  });
}

// ─────────────────────────────────────────────
// WEBHOOK META — VÉRIFICATION (GET)
// ─────────────────────────────────────────────
app.get('/webhook', (req, res) => {
  const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN;
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  console.log('📡 Webhook GET - mode:', mode, '| token ok:', token === VERIFY_TOKEN);

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ Webhook vérifié par Meta!');
    res.status(200).send(challenge);
  } else {
    console.error('❌ Webhook: token invalide');
    res.sendStatus(403);
  }
});

// ─────────────────────────────────────────────
// WEBHOOK META — RÉCEPTION DES MESSAGES (POST)
// ─────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);

  try {
    const body = req.body;
    if (body.object !== 'whatsapp_business_account') return;

    const entry   = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value   = changes?.value;
    const message = value?.messages?.[0];

    if (!message) return;

    const from = message.from;
    const text = message.text?.body || '';

    console.log(`📨 Message WhatsApp de ${from}: "${text}"`);

    const reponse = bot(from, text);
    await sendWhatsAppMessage(from, reponse);

  } catch (err) {
    console.error('❌ Erreur traitement webhook:', err.message);
  }
});

// ─────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  next();
});

app.get('/test', (req, res) => res.json({reponse: bot(req.query.tel||'237', req.query.msg||'menu')}));
app.get('/api/commandes', async (req, res) => res.json(await getCommandes()));
app.post('/api/commandes/:num/statut', async (req, res) => { await updateStatut(req.params.num, req.body.statut); res.json({ok:true}); });
app.get('/admin', (req, res) => res.send(fs.readFileSync('admin.html', 'utf8')));
app.get('/', (req, res) => res.redirect('/admin'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('ZYNTRA demarre sur port ' + PORT));