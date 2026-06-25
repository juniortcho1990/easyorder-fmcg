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
  pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  usePostgres = true;
  pool.query(`
    CREATE TABLE IF NOT EXISTS commandes (
      id SERIAL PRIMARY KEY, numero TEXT UNIQUE, telephone TEXT,
      total INTEGER, statut TEXT DEFAULT 'En preparation', date TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (
      telephone TEXT PRIMARY KEY, etat TEXT DEFAULT 'menu',
      panier TEXT DEFAULT '[]', produit_en_cours TEXT DEFAULT '',
      updated_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS produits (
      id TEXT PRIMARY KEY, nom TEXT, prix INTEGER, actif BOOLEAN DEFAULT TRUE
    );
  `).then(async () => {
    // Insérer produits par défaut si table vide
    const r = await pool.query('SELECT COUNT(*) FROM produits');
    if (parseInt(r.rows[0].count) === 0) {
      await pool.query(`INSERT INTO produits (id,nom,prix) VALUES
        ('p1','Castel 65cl',500),('p2','Beaufort 65cl',500),
        ('p3','Malta 65cl',400),('p4','CocaCola 50cl',400),
        ('p5','Supermont 1.5L',300)`);
    }
    console.log('PostgreSQL pret!');
  });
} else {
  const Database = require('better-sqlite3');
  db = new Database('easyorder.db');
  db.exec(`
    CREATE TABLE IF NOT EXISTS commandes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, numero TEXT UNIQUE, telephone TEXT,
      total INTEGER, statut TEXT DEFAULT 'En preparation', date TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (
      telephone TEXT PRIMARY KEY, etat TEXT DEFAULT 'menu',
      panier TEXT DEFAULT '[]', produit_en_cours TEXT DEFAULT '',
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS produits (
      id TEXT PRIMARY KEY, nom TEXT, prix INTEGER, actif INTEGER DEFAULT 1
    );
  `);
  const count = db.prepare('SELECT COUNT(*) as c FROM produits').get();
  if (count.c === 0) {
    db.prepare(`INSERT INTO produits (id,nom,prix) VALUES ('p1','Castel 65cl',500)`).run();
    db.prepare(`INSERT INTO produits (id,nom,prix) VALUES ('p2','Beaufort 65cl',500)`).run();
    db.prepare(`INSERT INTO produits (id,nom,prix) VALUES ('p3','Malta 65cl',400)`).run();
    db.prepare(`INSERT INTO produits (id,nom,prix) VALUES ('p4','CocaCola 50cl',400)`).run();
    db.prepare(`INSERT INTO produits (id,nom,prix) VALUES ('p5','Supermont 1.5L',300)`).run();
  }
  console.log('SQLite pret!');
}

// ─────────────────────────────────────────────
// FONCTIONS DB — PRODUITS
// ─────────────────────────────────────────────
async function getProduits() {
  if (usePostgres) {
    const r = await pool.query('SELECT * FROM produits WHERE actif=TRUE ORDER BY id');
    return r.rows;
  }
  return db.prepare('SELECT * FROM produits WHERE actif=1 ORDER BY id').all();
}

async function ajouterProduit(id, nom, prix) {
  if (usePostgres) {
    await pool.query('INSERT INTO produits (id,nom,prix) VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET nom=$2,prix=$3,actif=TRUE', [id, nom, prix]);
  } else {
    db.prepare('INSERT OR REPLACE INTO produits (id,nom,prix,actif) VALUES (?,?,?,1)').run(id, nom, prix);
  }
}

async function supprimerProduit(id) {
  if (usePostgres) {
    await pool.query('UPDATE produits SET actif=FALSE WHERE id=$1', [id]);
  } else {
    db.prepare('UPDATE produits SET actif=0 WHERE id=?').run(id);
  }
}

// ─────────────────────────────────────────────
// FONCTIONS DB — SESSIONS
// ─────────────────────────────────────────────
async function getSession(tel) {
  if (usePostgres) {
    const r = await pool.query('SELECT * FROM sessions WHERE telephone=$1', [tel]);
    if (!r.rows.length) {
      await pool.query('INSERT INTO sessions (telephone,etat,panier,produit_en_cours) VALUES ($1,$2,$3,$4)', [tel,'menu','[]','']);
      return { e:'menu', p:[], produit_en_cours:'' };
    }
    return { e:r.rows[0].etat, p:JSON.parse(r.rows[0].panier), produit_en_cours:r.rows[0].produit_en_cours||'' };
  } else {
    const row = db.prepare('SELECT * FROM sessions WHERE telephone=?').get(tel);
    if (!row) {
      db.prepare('INSERT INTO sessions (telephone,etat,panier,produit_en_cours,updated_at) VALUES (?,?,?,?,?)').run(tel,'menu','[]','',new Date().toISOString());
      return { e:'menu', p:[], produit_en_cours:'' };
    }
    return { e:row.etat, p:JSON.parse(row.panier), produit_en_cours:row.produit_en_cours||'' };
  }
}

async function saveSession(tel, s) {
  if (usePostgres) {
    await pool.query(
      'INSERT INTO sessions (telephone,etat,panier,produit_en_cours,updated_at) VALUES ($1,$2,$3,$4,NOW()) ON CONFLICT (telephone) DO UPDATE SET etat=$2,panier=$3,produit_en_cours=$4,updated_at=NOW()',
      [tel, s.e, JSON.stringify(s.p), s.produit_en_cours||'']
    );
  } else {
    db.prepare('INSERT OR REPLACE INTO sessions (telephone,etat,panier,produit_en_cours,updated_at) VALUES (?,?,?,?,?)').run(tel, s.e, JSON.stringify(s.p), s.produit_en_cours||'', new Date().toISOString());
  }
}

// ─────────────────────────────────────────────
// FONCTIONS DB — COMMANDES
// ─────────────────────────────────────────────
async function getCommandes() {
  if (usePostgres) {
    const r = await pool.query('SELECT * FROM commandes ORDER BY id DESC');
    return r.rows;
  }
  return db.prepare('SELECT * FROM commandes ORDER BY id DESC').all();
}

async function getCommandesClient(tel) {
  if (usePostgres) {
    const r = await pool.query('SELECT * FROM commandes WHERE telephone=$1 ORDER BY id DESC LIMIT 5', [tel]);
    return r.rows;
  }
  return db.prepare('SELECT * FROM commandes WHERE telephone=? ORDER BY id DESC LIMIT 5').all(tel);
}

async function insertCommande(n, tel, t, date) {
  if (usePostgres) {
    await pool.query('INSERT INTO commandes (numero,telephone,total,statut,date) VALUES ($1,$2,$3,$4,$5)', [n,tel,t,'En preparation',date]);
  } else {
    db.prepare('INSERT OR IGNORE INTO commandes (numero,telephone,total,statut,date) VALUES (?,?,?,?,?)').run(n,tel,t,'En preparation',date);
  }
}

async function updateStatut(num, statut) {
  if (usePostgres) {
    await pool.query('UPDATE commandes SET statut=$1 WHERE numero=$2', [statut, num]);
  } else {
    db.prepare('UPDATE commandes SET statut=? WHERE numero=?').run(statut, num);
  }
}

async function getCommande(num) {
  if (usePostgres) {
    const r = await pool.query('SELECT * FROM commandes WHERE numero=$1', [num]);
    return r.rows[0];
  }
  return db.prepare('SELECT * FROM commandes WHERE numero=?').get(num);
}

// ─────────────────────────────────────────────
// ENVOI WHATSAPP
// ─────────────────────────────────────────────
async function sendAPI(to, payload) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_TOKEN;
  if (!phoneNumberId || !token) { console.error('❌ Variables manquantes'); return; }

  return new Promise((resolve) => {
    const https = require('https');
    const data = JSON.stringify(payload);
    const req = https.request({
      hostname: 'graph.facebook.com',
      path: `/v19.0/${phoneNumberId}/messages`,
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const result = JSON.parse(d);
          if (result.error) console.error('❌ Meta:', JSON.stringify(result.error));
          else console.log('✅ Envoyé à', to);
          resolve(result);
        } catch(e) { resolve(null); }
      });
    });
    req.on('error', (e) => { console.error('❌ Réseau:', e.message); resolve(null); });
    req.write(data); req.end();
  });
}

async function sendText(to, body) {
  return sendAPI(to, { messaging_product:'whatsapp', to, type:'text', text:{ body } });
}

async function sendButtons(to, body, buttons) {
  return sendAPI(to, {
    messaging_product:'whatsapp', to, type:'interactive',
    interactive: { type:'button', body:{ text:body }, action:{ buttons: buttons.map(b => ({ type:'reply', reply:{ id:b.id, title:b.title } })) } }
  });
}

async function sendList(to, body, buttonText, sections) {
  return sendAPI(to, {
    messaging_product:'whatsapp', to, type:'interactive',
    interactive: { type:'list', body:{ text:body }, action:{ button:buttonText, sections } }
  });
}

// ─────────────────────────────────────────────
// NOTIFICATION STATUT AU CLIENT
// ─────────────────────────────────────────────
const MESSAGES_STATUT = {
  'En preparation': '⏳ Votre commande *{num}* est en cours de préparation.\n\nNous vous notifierons dès qu\'elle sera expédiée.',
  'En livraison':   '🚚 Votre commande *{num}* est en cours de livraison!\n\nElle sera bientôt chez vous.',
  'Livree':         '✅ Votre commande *{num}* a été livrée!\n\nMerci de votre confiance. Tapez MENU pour recommander.',
  'Annulee':        '❌ Votre commande *{num}* a été annulée.\n\nContactez-nous au +237 651 16 15 77 pour plus d\'informations.'
};

async function notifierClient(telephone, numero, statut) {
  const template = MESSAGES_STATUT[statut];
  if (!template) return;
  const message = template.replace('{num}', numero);
  await sendText(telephone, message);
  console.log(`📱 Notification envoyée à ${telephone} pour ${numero} → ${statut}`);
}

// ─────────────────────────────────────────────
// OUVRIR CATALOGUE
// ─────────────────────────────────────────────
async function ouvrirCatalogue(from, s) {
  s.e = 'cat';
  s.produit_en_cours = '';
  await saveSession(from, s);
  const P = await getProduits();
  let panierInfo = '';
  if (s.p.length > 0) {
    const total = s.p.reduce((a, x) => a + x.prix * x.q, 0);
    panierInfo = '\n\n🛒 Panier: ' + total + ' FCFA (' + s.p.length + ' produit(s))';
  }
  return sendList(from,
    '📦 Choisissez un produit:' + panierInfo,
    '📦 Voir le catalogue',
    [{ title: 'Nos produits', rows: P.map(x => ({ id: x.id, title: x.nom, description: x.prix + ' FCFA' })) }]
  );
}

// ─────────────────────────────────────────────
// LOGIQUE BOT
// ─────────────────────────────────────────────
async function handleMessage(from, msg, buttonId) {
  const s = await getSession(from);
  const m = String(msg).trim().toLowerCase();
  const bid = buttonId || '';

  console.log(`🔍 État: "${s.e}" | msg: "${m}" | bid: "${bid}"`);

  // ── MENU PRINCIPAL ──
  if (['menu','bonjour','hello','salut','start'].includes(m) || bid === 'btn_menu') {
    s.e = 'menu'; s.p = []; s.produit_en_cours = '';
    await saveSession(from, s);
    return sendButtons(from,
      'Bienvenue sur ZYNTRA! 🛒\n\nComment puis-je vous aider?',
      [
        { id:'btn_commander', title:'🛒 Commander' },
        { id:'btn_commandes', title:'📦 Mes commandes' },
        { id:'btn_contact',   title:'📞 Contact' }
      ]
    );
  }

  // ── COMMANDER ──
  if (bid === 'btn_commander' || (s.e === 'menu' && (m === '1' || m === 'commander'))) {
    return ouvrirCatalogue(from, s);
  }

  // ── AJOUTER UN AUTRE PRODUIT ──
  if (bid === 'btn_ajouter') {
    return ouvrirCatalogue(from, s);
  }

  // ── SÉLECTION PRODUIT → demander la quantité ──
  if (bid && bid.startsWith('p') && s.e === 'cat') {
    const P = await getProduits();
    const p = P.find(x => x.id === bid);
    if (p) {
      s.e = 'qte';
      s.produit_en_cours = bid;
      await saveSession(from, s);
      return sendButtons(from,
        '📦 *' + p.nom + '* — ' + p.prix + ' FCFA\n\nQuelle quantité souhaitez-vous?',
        [
          { id:'qte_1',  title:'x1 — ' + p.prix + ' FCFA' },
          { id:'qte_2',  title:'x2 — ' + (p.prix*2) + ' FCFA' },
          { id:'qte_5',  title:'x5 — ' + (p.prix*5) + ' FCFA' }
        ]
      );
    }
  }

  // ── SÉLECTION QUANTITÉ ──
  if (bid && bid.startsWith('qte_') && s.e === 'qte') {
    const qte = parseInt(bid.replace('qte_', ''));
    const P = await getProduits();
    const p = P.find(x => x.id === s.produit_en_cours);
    if (p && qte > 0) {
      const ex = s.p.find(x => x.id === p.id);
      if (ex) ex.q += qte;
      else s.p.push({ id:p.id, nom:p.nom, prix:p.prix, q:qte });
      s.e = 'cat';
      s.produit_en_cours = '';
      await saveSession(from, s);
      const total = s.p.reduce((a, x) => a + x.prix * x.q, 0);
      let panierDetail = '';
      s.p.forEach(x => { panierDetail += '• ' + x.nom + ' x' + x.q + ' = ' + (x.prix * x.q) + ' FCFA\n'; });
      return sendButtons(from,
        '✅ ' + p.nom + ' x' + qte + ' ajouté!\n\n🛒 PANIER:\n' + panierDetail + '\nTOTAL: ' + total + ' FCFA',
        [
          { id:'btn_ajouter',   title:'➕ Ajouter produit' },
          { id:'btn_confirmer', title:'✅ Confirmer' },
          { id:'btn_menu',      title:'❌ Annuler' }
        ]
      );
    }
  }

  // ── VOIR PANIER ──
  if (m === '0' || bid === 'btn_panier') {
    if (!s.p.length) {
      return sendButtons(from, '🛒 Votre panier est vide.',
        [{ id:'btn_commander', title:'🛒 Commander' }, { id:'btn_menu', title:'🏠 Menu' }]
      );
    }
    let t = 0, r = '🛒 VOTRE PANIER:\n\n';
    s.p.forEach(p => { t += p.prix * p.q; r += '• ' + p.nom + ' x' + p.q + ' = ' + (p.prix * p.q) + ' FCFA\n'; });
    r += '\nTOTAL: ' + t + ' FCFA';
    return sendButtons(from, r, [
      { id:'btn_confirmer', title:'✅ Confirmer' },
      { id:'btn_ajouter',   title:'➕ Ajouter' },
      { id:'btn_menu',      title:'❌ Annuler' }
    ]);
  }

  // ── CONFIRMER COMMANDE ──
  if (m === 'confirmer' || bid === 'btn_confirmer') {
    if (!s.p.length) return sendButtons(from, '🛒 Votre panier est vide.', [{ id:'btn_commander', title:'🛒 Commander' }]);
    const t = s.p.reduce((a, p) => a + p.prix * p.q, 0);
    const n = 'CMD-' + Date.now().toString().slice(-6);
    const date = new Date().toLocaleDateString('fr-FR');
    await insertCommande(n, from, t, date);
    s.p = []; s.e = 'menu'; s.produit_en_cours = '';
    await saveSession(from, s);
    return sendButtons(from,
      '✅ COMMANDE CONFIRMEE!\n\nNumero: ' + n + '\nTotal: ' + t + ' FCFA\n\nMerci pour votre commande ZYNTRA! 🎉',
      [
        { id:'btn_commander', title:'🛒 Nouvelle commande' },
        { id:'btn_menu',      title:'🏠 Menu principal' }
      ]
    );
  }

  // ── MES COMMANDES ──
  if (bid === 'btn_commandes' || (s.e === 'menu' && m === '2')) {
    const commandes = await getCommandesClient(from);
    if (!commandes.length) {
      return sendButtons(from, '📋 Vous n\'avez pas encore de commandes.',
        [{ id:'btn_commander', title:'🛒 Commander' }, { id:'btn_menu', title:'🏠 Menu' }]
      );
    }
    let msg = '📋 VOS COMMANDES:\n\n';
    commandes.forEach(c => {
      msg += '• ' + c.numero + '\n  ' + c.total + ' FCFA — ' + c.statut + '\n  📅 ' + c.date + '\n\n';
    });
    return sendButtons(from, msg,
      [{ id:'btn_commander', title:'🛒 Commander' }, { id:'btn_menu', title:'🏠 Menu' }]
    );
  }

  // ── CONTACT ──
  if (bid === 'btn_contact' || (s.e === 'menu' && m === '3')) {
    return sendButtons(from,
      '📞 Support ZYNTRA:\n\n+237 651 16 15 77\nDisponible 8h - 20h',
      [{ id:'btn_menu', title:'🏠 Menu principal' }]
    );
  }

  // ── FALLBACK ──
  return sendButtons(from, 'Tapez MENU pour recommencer. 👋', [{ id:'btn_menu', title:'🏠 Menu principal' }]);
}

// ─────────────────────────────────────────────
// WEBHOOK META
// ─────────────────────────────────────────────
app.get('/webhook', (req, res) => {
  const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN;
  const { 'hub.mode':mode, 'hub.verify_token':token, 'hub.challenge':challenge } = req.query;
  if (mode === 'subscribe' && token === VERIFY_TOKEN) { res.status(200).send(challenge); }
  else res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message) return;
    const from = message.from;
    if (message.type === 'text') {
      await handleMessage(from, message.text?.body || '', null);
    }
    if (message.type === 'interactive') {
      const i = message.interactive;
      if (i.type === 'button_reply') await handleMessage(from, i.button_reply.title, i.button_reply.id);
      if (i.type === 'list_reply')   await handleMessage(from, i.list_reply.title,   i.list_reply.id);
    }
  } catch (err) { console.error('❌ Webhook:', err.message); }
});

// ─────────────────────────────────────────────
// ROUTES API
// ─────────────────────────────────────────────
app.use((req, res, next) => { res.header('Access-Control-Allow-Origin', '*'); next(); });

app.get('/test', (req, res) => res.json({status: 'ZYNTRA actif'}));
app.get('/api/commandes', async (req, res) => res.json(await getCommandes()));

// Changer statut + notifier client
app.post('/api/commandes/:num/statut', async (req, res) => {
  const { num } = req.params;
  const { statut } = req.body;
  await updateStatut(num, statut);
  // Récupérer la commande pour notifier le client
  const commande = await getCommande(num);
  if (commande) {
    await notifierClient(commande.telephone, num, statut);
  }
  res.json({ok: true});
});

// API Produits
app.get('/api/produits', async (req, res) => res.json(await getProduits()));

app.post('/api/produits', async (req, res) => {
  const { nom, prix } = req.body;
  if (!nom || !prix) return res.status(400).json({error: 'nom et prix requis'});
  const id = 'p' + Date.now();
  await ajouterProduit(id, nom, parseInt(prix));
  res.json({ok: true, id});
});

app.delete('/api/produits/:id', async (req, res) => {
  await supprimerProduit(req.params.id);
  res.json({ok: true});
});

app.get('/admin', (req, res) => res.send(fs.readFileSync('admin.html', 'utf8')));
app.get('/', (req, res) => res.redirect('/admin'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('ZYNTRA demarre sur port ' + PORT));