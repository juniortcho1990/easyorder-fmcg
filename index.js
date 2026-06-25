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

async function getCommandesClient(tel) {
  if (usePostgres) {
    const r = await pool.query(
      'SELECT * FROM commandes WHERE telephone=$1 ORDER BY id DESC LIMIT 5',
      [tel]
    );
    return r.rows;
  }
  return db.prepare(
    'SELECT * FROM commandes WHERE telephone=? ORDER BY id DESC LIMIT 5'
  ).all(tel);
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
  {id:'p1', nom:'Castel 65cl',    prix:500},
  {id:'p2', nom:'Beaufort 65cl',  prix:500},
  {id:'p3', nom:'Malta 65cl',     prix:400},
  {id:'p4', nom:'CocaCola 50cl',  prix:400},
  {id:'p5', nom:'Supermont 1.5L', prix:300}
];

const S = {};
function gs(t) { if(!S[t]) S[t] = {e:'menu', p:[]}; return S[t]; }

// ─────────────────────────────────────────────
// FONCTIONS D'ENVOI
// ─────────────────────────────────────────────
async function sendText(to, message) {
  return sendAPI(to, {
    messaging_product: 'whatsapp',
    to: to,
    type: 'text',
    text: { body: message }
  });
}

async function sendButtons(to, body, buttons) {
  return sendAPI(to, {
    messaging_product: 'whatsapp',
    to: to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: body },
      action: {
        buttons: buttons.map(b => ({
          type: 'reply',
          reply: { id: b.id, title: b.title }
        }))
      }
    }
  });
}

async function sendList(to, body, buttonText, sections) {
  return sendAPI(to, {
    messaging_product: 'whatsapp',
    to: to,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: body },
      action: {
        button: buttonText,
        sections: sections
      }
    }
  });
}

async function sendAPI(to, payload) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_TOKEN;

  if (!phoneNumberId || !token) {
    console.error('❌ Variables manquantes');
    return;
  }

  return new Promise((resolve) => {
    const https = require('https');
    const data = JSON.stringify(payload);

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
// FONCTION CATALOGUE — ouvre directement la liste
// ─────────────────────────────────────────────
async function ouvrirCatalogue(from, s) {
  s.e = 'cat';
  // NE PAS vider le panier pour permettre l'ajout multiple
  let panierInfo = '';
  if (s.p.length > 0) {
    const total = s.p.reduce((a, x) => a + x.prix * x.q, 0);
    panierInfo = '\n\n🛒 Panier actuel: ' + total + ' FCFA (' + s.p.length + ' produit(s))';
  }
  return sendList(from,
    '📦 Choisissez un produit à ajouter:' + panierInfo,
    '📦 Voir le catalogue',
    [{
      title: 'Nos produits',
      rows: P.map(x => ({
        id: x.id,
        title: x.nom,
        description: x.prix + ' FCFA'
      }))
    }]
  );
}

// ─────────────────────────────────────────────
// LOGIQUE BOT PRINCIPALE
// ─────────────────────────────────────────────
async function handleMessage(from, msg, buttonId) {
  const s = gs(from);
  const m = String(msg).trim().toLowerCase();
  const bid = buttonId || '';

  console.log(`🔍 État: "${s.e}" | msg: "${m}" | buttonId: "${bid}"`);

  // ── MENU PRINCIPAL ──
  if (m === 'menu' || m === 'bonjour' || m === 'hello' || m === 'salut' || m === 'start' || bid === 'btn_menu') {
    s.e = 'menu';
    s.p = [];
    return sendButtons(from,
      'Bienvenue sur ZYNTRA! 🛒\n\nComment puis-je vous aider?',
      [
        { id: 'btn_commander', title: '🛒 Commander' },
        { id: 'btn_commandes', title: '📦 Mes commandes' },
        { id: 'btn_contact',   title: '📞 Contact' }
      ]
    );
  }

  // ── COMMANDER — ouvre directement le catalogue ──
  if (bid === 'btn_commander' || (s.e === 'menu' && (m === '1' || m === 'commander'))) {
    return ouvrirCatalogue(from, s);
  }

  // ── AJOUTER UN PRODUIT — rouvre le catalogue sans vider le panier ──
  if (bid === 'btn_ajouter') {
    return ouvrirCatalogue(from, s);
  }

  // ── SÉLECTION PRODUIT DEPUIS LA LISTE ──
  if (bid && bid.startsWith('p')) {
    const p = P.find(x => x.id === bid);
    if (p) {
      s.e = 'cat';
      const ex = s.p.find(x => x.id === p.id);
      if (ex) ex.q++;
      else s.p.push({...p, q:1});
      const total = s.p.reduce((a, x) => a + x.prix * x.q, 0);
      let panierDetail = '';
      s.p.forEach(x => { panierDetail += '• ' + x.nom + ' x' + x.q + ' = ' + (x.prix * x.q) + ' FCFA\n'; });
      return sendButtons(from,
        '✅ ' + p.nom + ' ajouté!\n\n🛒 PANIER:\n' + panierDetail + '\nTOTAL: ' + total + ' FCFA',
        [
          { id: 'btn_ajouter',   title: '➕ Ajouter produit' },
          { id: 'btn_confirmer', title: '✅ Confirmer' },
          { id: 'btn_menu',      title: '❌ Annuler' }
        ]
      );
    }
  }

  // ── VOIR PANIER ──
  if (m === '0' || bid === 'btn_panier') {
    if (!s.p.length) {
      return sendButtons(from,
        '🛒 Votre panier est vide.',
        [
          { id: 'btn_commander', title: '🛒 Commander' },
          { id: 'btn_menu',      title: '🏠 Menu principal' }
        ]
      );
    }
    let t = 0, r = '🛒 VOTRE PANIER:\n\n';
    s.p.forEach(p => { t += p.prix * p.q; r += '• ' + p.nom + ' x' + p.q + ' = ' + (p.prix * p.q) + ' FCFA\n'; });
    r += '\nTOTAL: ' + t + ' FCFA';
    return sendButtons(from, r, [
      { id: 'btn_confirmer', title: '✅ Confirmer' },
      { id: 'btn_ajouter',   title: '➕ Ajouter' },
      { id: 'btn_menu',      title: '❌ Annuler' }
    ]);
  }

  // ── CONFIRMER COMMANDE ──
  if (m === 'confirmer' || bid === 'btn_confirmer') {
    if (!s.p.length) {
      return sendButtons(from,
        '🛒 Votre panier est vide.',
        [{ id: 'btn_commander', title: '🛒 Commander' }]
      );
    }
    const t = s.p.reduce((a, p) => a + p.prix * p.q, 0);
    const n = 'CMD-' + Date.now().toString().slice(-6);
    const date = new Date().toLocaleDateString('fr-FR');
    await insertCommande(n, from, t, date);
    s.p = []; s.e = 'menu';
    return sendButtons(from,
      '✅ COMMANDE CONFIRMEE!\n\nNumero: ' + n + '\nTotal: ' + t + ' FCFA\n\nMerci pour votre commande ZYNTRA! 🎉',
      [
        { id: 'btn_commander', title: '🛒 Nouvelle commande' },
        { id: 'btn_menu',      title: '🏠 Menu principal' }
      ]
    );
  }

  // ── MES COMMANDES — affiche les commandes du client ──
  if (bid === 'btn_commandes' || (s.e === 'menu' && m === '2')) {
    const commandes = await getCommandesClient(from);
    if (!commandes.length) {
      return sendButtons(from,
        '📋 Vous n\'avez pas encore de commandes.\n\nPassez votre première commande!',
        [
          { id: 'btn_commander', title: '🛒 Commander' },
          { id: 'btn_menu',      title: '🏠 Menu principal' }
        ]
      );
    }
    let msg = '📋 VOS COMMANDES:\n\n';
    commandes.forEach(c => {
      msg += '• ' + c.numero + '\n';
      msg += '  ' + c.total + ' FCFA - ' + c.statut + '\n';
      msg += '  📅 ' + c.date + '\n\n';
    });
    return sendButtons(from, msg,
      [
        { id: 'btn_commander', title: '🛒 Commander' },
        { id: 'btn_menu',      title: '🏠 Menu principal' }
      ]
    );
  }

  // ── CONTACT ──
  if (bid === 'btn_contact' || (s.e === 'menu' && m === '3')) {
    return sendButtons(from,
      '📞 Support ZYNTRA:\n\n+237 651 16 15 77\nDisponible 8h - 20h',
      [{ id: 'btn_menu', title: '🏠 Menu principal' }]
    );
  }

  // ── FALLBACK ──
  return sendButtons(from,
    'Tapez MENU pour recommencer. 👋',
    [{ id: 'btn_menu', title: '🏠 Menu principal' }]
  );
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

    if (message.type === 'text') {
      const text = message.text?.body || '';
      console.log(`📨 Texte de ${from}: "${text}"`);
      await handleMessage(from, text, null);
    }

    if (message.type === 'interactive') {
      const interactive = message.interactive;
      if (interactive.type === 'button_reply') {
        const buttonId    = interactive.button_reply.id;
        const buttonTitle = interactive.button_reply.title;
        console.log(`🔘 Bouton de ${from}: "${buttonTitle}" (${buttonId})`);
        await handleMessage(from, buttonTitle, buttonId);
      }
      if (interactive.type === 'list_reply') {
        const listId    = interactive.list_reply.id;
        const listTitle = interactive.list_reply.title;
        console.log(`📋 Liste de ${from}: "${listTitle}" (${listId})`);
        await handleMessage(from, listTitle, listId);
      }
    }

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

app.get('/test', (req, res) => res.json({status: 'ZYNTRA bot actif'}));
app.get('/api/commandes', async (req, res) => res.json(await getCommandes()));
app.post('/api/commandes/:num/statut', async (req, res) => { await updateStatut(req.params.num, req.body.statut); res.json({ok:true}); });
app.get('/admin', (req, res) => res.send(fs.readFileSync('admin.html', 'utf8')));
app.get('/', (req, res) => res.redirect('/admin'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('ZYNTRA demarre sur port ' + PORT));