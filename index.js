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
      categorie_en_cours TEXT DEFAULT '', updated_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS produits (
      id TEXT PRIMARY KEY, nom TEXT, prix INTEGER,
      categorie TEXT DEFAULT 'cat_boissons', actif BOOLEAN DEFAULT TRUE
    );
    CREATE TABLE IF NOT EXISTS demandes_agent (
      id SERIAL PRIMARY KEY, telephone TEXT, message TEXT,
      statut TEXT DEFAULT 'en_attente', date TEXT, heure TEXT
    );
  `).then(async () => {
    const r = await pool.query('SELECT COUNT(*) FROM produits');
    if (parseInt(r.rows[0].count) === 0) await initProduits();
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
      categorie_en_cours TEXT DEFAULT '', updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS produits (
      id TEXT PRIMARY KEY, nom TEXT, prix INTEGER,
      categorie TEXT DEFAULT 'cat_boissons', actif INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS demandes_agent (
      id INTEGER PRIMARY KEY AUTOINCREMENT, telephone TEXT, message TEXT,
      statut TEXT DEFAULT 'en_attente', date TEXT, heure TEXT
    );
  `);
  const count = db.prepare('SELECT COUNT(*) as c FROM produits').get();
  if (count.c === 0) initProduits();
  console.log('SQLite pret!');
}

// ─────────────────────────────────────────────
// CATALOGUE PAR CATÉGORIES
// ─────────────────────────────────────────────
const CATEGORIES = [
  { id:'cat_boissons', nom:'🥤 Boissons',    emoji:'🥤' },
  { id:'cat_alim',     nom:'🍪 Alimentation', emoji:'🍪' },
  { id:'cat_hygiene',  nom:'🧴 Hygiene',      emoji:'🧴' },
  { id:'cat_divers',   nom:'🚬 Tabac Divers', emoji:'🚬' }
];

const PRODUITS_DEFAUT = [
  // Boissons
  {id:'b1', nom:'Castel 65cl',         prix:500,  categorie:'cat_boissons'},
  {id:'b2', nom:'Beaufort 65cl',       prix:500,  categorie:'cat_boissons'},
  {id:'b3', nom:'Malta Guinness 65cl', prix:400,  categorie:'cat_boissons'},
  {id:'b4', nom:'Coca-Cola 50cl',      prix:400,  categorie:'cat_boissons'},
  {id:'b5', nom:'Fanta Orange 50cl',   prix:400,  categorie:'cat_boissons'},
  {id:'b6', nom:'Sprite 50cl',         prix:400,  categorie:'cat_boissons'},
  {id:'b7', nom:'Supermont 1.5L',      prix:300,  categorie:'cat_boissons'},
  {id:'b8', nom:'Tangui 1.5L',         prix:350,  categorie:'cat_boissons'},
  // Alimentation
  {id:'a1', nom:'Riz parfumé 5kg',     prix:3500, categorie:'cat_alim'},
  {id:'a2', nom:'Huile végétale 1L',   prix:1200, categorie:'cat_alim'},
  {id:'a3', nom:'Sardines Maïté 125g', prix:500,  categorie:'cat_alim'},
  {id:'a4', nom:'Cube Maggi x10',      prix:200,  categorie:'cat_alim'},
  {id:'a5', nom:'Biscuits Golda x10',  prix:300,  categorie:'cat_alim'},
  {id:'a6', nom:'Sucre 1kg',           prix:700,  categorie:'cat_alim'},
  {id:'a7', nom:'Lait Gloria 400g',    prix:1500, categorie:'cat_alim'},
  // Hygiène
  {id:'h1', nom:'Savon Camay',         prix:300,  categorie:'cat_hygiene'},
  {id:'h2', nom:'Lessive OMO 500g',    prix:800,  categorie:'cat_hygiene'},
  {id:'h3', nom:'Dentifrice Colgate',  prix:600,  categorie:'cat_hygiene'},
  {id:'h4', nom:'Déodorant Rexona',    prix:1200, categorie:'cat_hygiene'},
  {id:'h5', nom:'Couches Pampers S40', prix:5500, categorie:'cat_hygiene'},
  {id:'h6', nom:'Savon Protex',        prix:350,  categorie:'cat_hygiene'},
  // Divers
  {id:'d1', nom:'Marlboro x20',        prix:1500, categorie:'cat_divers'},
  {id:'d2', nom:'Piles AA Duracell x2',prix:500,  categorie:'cat_divers'},
  {id:'d3', nom:'Allumettes x10',      prix:100,  categorie:'cat_divers'},
  {id:'d4', nom:'Recharge MTN 500',    prix:500,  categorie:'cat_divers'},
  {id:'d5', nom:'Recharge Orange 500', prix:500,  categorie:'cat_divers'},
  {id:'d6', nom:'Bougies x5',          prix:200,  categorie:'cat_divers'},
];

async function initProduits() {
  for (const p of PRODUITS_DEFAUT) {
    if (usePostgres) {
      await pool.query('INSERT INTO produits (id,nom,prix,categorie) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [p.id,p.nom,p.prix,p.categorie]);
    } else {
      db.prepare('INSERT OR IGNORE INTO produits (id,nom,prix,categorie,actif) VALUES (?,?,?,?,1)').run(p.id,p.nom,p.prix,p.categorie);
    }
  }
}

// ─────────────────────────────────────────────
// FONCTIONS DB
// ─────────────────────────────────────────────
async function getProduits(categorie) {
  if (usePostgres) {
    const q = categorie
      ? 'SELECT * FROM produits WHERE actif=TRUE AND categorie=$1 ORDER BY id'
      : 'SELECT * FROM produits WHERE actif=TRUE ORDER BY categorie,id';
    const r = await pool.query(q, categorie ? [categorie] : []);
    return r.rows;
  }
  if (categorie) return db.prepare('SELECT * FROM produits WHERE actif=1 AND categorie=? ORDER BY id').all(categorie);
  return db.prepare('SELECT * FROM produits WHERE actif=1 ORDER BY categorie,id').all();
}

async function ajouterProduit(id, nom, prix, categorie) {
  if (usePostgres) await pool.query('INSERT INTO produits (id,nom,prix,categorie) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO UPDATE SET nom=$2,prix=$3,categorie=$4,actif=TRUE', [id,nom,prix,categorie]);
  else db.prepare('INSERT OR REPLACE INTO produits (id,nom,prix,categorie,actif) VALUES (?,?,?,?,1)').run(id,nom,prix,categorie);
}

async function supprimerProduit(id) {
  if (usePostgres) await pool.query('UPDATE produits SET actif=FALSE WHERE id=$1', [id]);
  else db.prepare('UPDATE produits SET actif=0 WHERE id=?').run(id);
}

async function getSession(tel) {
  if (usePostgres) {
    const r = await pool.query('SELECT * FROM sessions WHERE telephone=$1', [tel]);
    if (!r.rows.length) {
      await pool.query('INSERT INTO sessions (telephone,etat,panier,produit_en_cours,categorie_en_cours) VALUES ($1,$2,$3,$4,$5)', [tel,'menu','[]','','']);
      return {e:'menu', p:[], produit_en_cours:'', categorie_en_cours:''};
    }
    return {e:r.rows[0].etat, p:JSON.parse(r.rows[0].panier), produit_en_cours:r.rows[0].produit_en_cours||'', categorie_en_cours:r.rows[0].categorie_en_cours||''};
  } else {
    const row = db.prepare('SELECT * FROM sessions WHERE telephone=?').get(tel);
    if (!row) {
      db.prepare('INSERT INTO sessions (telephone,etat,panier,produit_en_cours,categorie_en_cours,updated_at) VALUES (?,?,?,?,?,?)').run(tel,'menu','[]','','',new Date().toISOString());
      return {e:'menu', p:[], produit_en_cours:'', categorie_en_cours:''};
    }
    return {e:row.etat, p:JSON.parse(row.panier), produit_en_cours:row.produit_en_cours||'', categorie_en_cours:row.categorie_en_cours||''};
  }
}

async function saveSession(tel, s) {
  if (usePostgres) await pool.query('INSERT INTO sessions (telephone,etat,panier,produit_en_cours,categorie_en_cours,updated_at) VALUES ($1,$2,$3,$4,$5,NOW()) ON CONFLICT (telephone) DO UPDATE SET etat=$2,panier=$3,produit_en_cours=$4,categorie_en_cours=$5,updated_at=NOW()', [tel,s.e,JSON.stringify(s.p),s.produit_en_cours||'',s.categorie_en_cours||'']);
  else db.prepare('INSERT OR REPLACE INTO sessions (telephone,etat,panier,produit_en_cours,categorie_en_cours,updated_at) VALUES (?,?,?,?,?,?)').run(tel,s.e,JSON.stringify(s.p),s.produit_en_cours||'',s.categorie_en_cours||'',new Date().toISOString());
}

async function getCommandes() {
  if (usePostgres) { const r = await pool.query('SELECT * FROM commandes ORDER BY id DESC'); return r.rows; }
  return db.prepare('SELECT * FROM commandes ORDER BY id DESC').all();
}

async function getCommandesClient(tel) {
  if (usePostgres) { const r = await pool.query('SELECT * FROM commandes WHERE telephone=$1 ORDER BY id DESC LIMIT 5', [tel]); return r.rows; }
  return db.prepare('SELECT * FROM commandes WHERE telephone=? ORDER BY id DESC LIMIT 5').all(tel);
}

async function insertCommande(n, tel, t, date) {
  if (usePostgres) await pool.query('INSERT INTO commandes (numero,telephone,total,statut,date) VALUES ($1,$2,$3,$4,$5)', [n,tel,t,'En preparation',date]);
  else db.prepare('INSERT OR IGNORE INTO commandes (numero,telephone,total,statut,date) VALUES (?,?,?,?,?)').run(n,tel,t,'En preparation',date);
}

async function updateStatut(num, statut) {
  if (usePostgres) await pool.query('UPDATE commandes SET statut=$1 WHERE numero=$2', [statut,num]);
  else db.prepare('UPDATE commandes SET statut=? WHERE numero=?').run(statut,num);
}

async function getCommande(num) {
  if (usePostgres) { const r = await pool.query('SELECT * FROM commandes WHERE numero=$1', [num]); return r.rows[0]; }
  return db.prepare('SELECT * FROM commandes WHERE numero=?').get(num);
}

async function insertDemandeAgent(tel, message) {
  const date = new Date().toLocaleDateString('fr-FR');
  const heure = new Date().toLocaleTimeString('fr-FR');
  if (usePostgres) await pool.query('INSERT INTO demandes_agent (telephone,message,statut,date,heure) VALUES ($1,$2,$3,$4,$5)', [tel,message,'en_attente',date,heure]);
  else db.prepare('INSERT INTO demandes_agent (telephone,message,statut,date,heure) VALUES (?,?,?,?,?)').run(tel,message,'en_attente',date,heure);
}

async function getDemandesAgent() {
  if (usePostgres) { const r = await pool.query('SELECT * FROM demandes_agent ORDER BY id DESC'); return r.rows; }
  return db.prepare('SELECT * FROM demandes_agent ORDER BY id DESC').all();
}

async function updateDemandeAgent(id, statut) {
  if (usePostgres) await pool.query('UPDATE demandes_agent SET statut=$1 WHERE id=$2', [statut,id]);
  else db.prepare('UPDATE demandes_agent SET statut=? WHERE id=?').run(statut,id);
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
      hostname:'graph.facebook.com', path:`/v19.0/${phoneNumberId}/messages`, method:'POST',
      headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}
    }, (res) => {
      let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{ try{const r=JSON.parse(d);if(r.error)console.error('❌ Meta:',JSON.stringify(r.error));else console.log('✅ Envoyé à',to);resolve(r);}catch(e){resolve(null);} });
    });
    req.on('error',(e)=>{console.error('❌ Réseau:',e.message);resolve(null);});
    req.write(data);req.end();
  });
}

async function sendText(to, body) {
  return sendAPI(to, {messaging_product:'whatsapp',to,type:'text',text:{body}});
}

async function sendButtons(to, body, buttons) {
  return sendAPI(to, {messaging_product:'whatsapp',to,type:'interactive',interactive:{type:'button',body:{text:body},action:{buttons:buttons.map(b=>({type:'reply',reply:{id:b.id,title:b.title}}))}}});
}

async function sendList(to, body, buttonText, sections) {
  return sendAPI(to, {messaging_product:'whatsapp',to,type:'interactive',interactive:{type:'list',body:{text:body},action:{button:buttonText,sections}}});
}

// Notifications statut
const MESSAGES_STATUT = {
  'En preparation': '⏳ Votre commande *{num}* est en cours de préparation.\n\n📍 Étape 1/4 — Commande reçue\n✅ Étape 2/4 — En préparation\n⬜ Étape 3/4 — En livraison\n⬜ Étape 4/4 — Livrée',
  'En livraison':   '🚚 Votre commande *{num}* est en route!\n\n📍 Étape 1/4 — Commande reçue\n✅ Étape 2/4 — En préparation\n✅ Étape 3/4 — En livraison\n⬜ Étape 4/4 — Livrée',
  'Livree':         '🎉 Votre commande *{num}* a été livrée!\n\n✅ Étape 1/4 — Commande reçue\n✅ Étape 2/4 — En préparation\n✅ Étape 3/4 — En livraison\n✅ Étape 4/4 — Livrée\n\nMerci pour votre confiance ZYNTRA! Tapez MENU pour recommander.',
  'Annulee':        '❌ Votre commande *{num}* a été annulée.\n\nContactez-nous au +237 651 16 15 77 pour plus d\'informations.'
};

async function notifierClient(telephone, numero, statut) {
  const template = MESSAGES_STATUT[statut];
  if (!template) return;
  await sendText(telephone, template.replace('{num}', numero));
  console.log(`📱 Notification → ${telephone} | ${numero} → ${statut}`);
}

async function notifierAdmin(telephone, message) {
  const adminTel = process.env.ADMIN_PHONE;
  if (!adminTel) return;
  await sendText(adminTel, `🆘 DEMANDE AGENT ZYNTRA\n\nClient: +${telephone}\nMessage: "${message}"\n\nConnectez-vous au dashboard pour répondre.`);
}

// ─────────────────────────────────────────────
// BOT — AFFICHER CATÉGORIES
// ─────────────────────────────────────────────
async function afficherCategories(from, s) {
  s.e = 'categories'; s.categorie_en_cours = ''; s.produit_en_cours = '';
  await saveSession(from, s);
  let panierInfo = '';
  if (s.p.length > 0) {
    const total = s.p.reduce((a,x) => a+x.prix*x.q, 0);
    panierInfo = '\n\n🛒 Panier en cours: ' + total.toLocaleString() + ' FCFA';
  }
  return sendList(from,
    '🏪 Choisissez une catégorie:' + panierInfo,
    '📂 Categories',
    [{ title:'Catégories', rows: CATEGORIES.map(c => ({ id:c.id, title:c.nom, description:'Appuyez pour voir les produits' })) }]
  );
}

// ─────────────────────────────────────────────
// BOT — AFFICHER PRODUITS D'UNE CATÉGORIE
// ─────────────────────────────────────────────
async function afficherProduits(from, s, categorieId) {
  s.e = 'cat'; s.categorie_en_cours = categorieId;
  await saveSession(from, s);
  const cat = CATEGORIES.find(c => c.id === categorieId);
  const produits = await getProduits(categorieId);
  if (!produits.length) {
    return sendButtons(from, '😕 Aucun produit disponible dans cette catégorie.',
      [{ id:'btn_categories', title:'⬅️ Catégories' }, { id:'btn_menu', title:'🏠 Menu' }]
    );
  }
  let panierInfo = '';
  if (s.p.length > 0) {
    const total = s.p.reduce((a,x) => a+x.prix*x.q, 0);
    panierInfo = '\n\n🛒 Panier: ' + total.toLocaleString() + ' FCFA';
  }
  return sendList(from,
    cat.nom + '\n\nChoisissez un produit:' + panierInfo,
    '📦 Voir les produits',
    [{ title: cat.nom, rows: produits.map(x => ({ id:x.id, title:x.nom, description:parseInt(x.prix).toLocaleString()+' FCFA' })) }]
  );
}

// ─────────────────────────────────────────────
// BOT — SUIVI COMMANDE TIMELINE
// ─────────────────────────────────────────────
function getTimeline(statut) {
  const etapes = ['En preparation', 'En livraison', 'Livree'];
  const emojis = ['⏳', '🚚', '✅'];
  const labels = ['En préparation', 'En livraison', 'Livrée'];
  const idx = etapes.indexOf(statut);
  let timeline = '📍 SUIVI DE COMMANDE:\n\n';
  timeline += '✅ Commande reçue\n';
  labels.forEach((label, i) => {
    if (i < idx) timeline += '✅ ' + label + '\n';
    else if (i === idx) timeline += emojis[i] + ' ' + label + ' ← Vous êtes ici\n';
    else timeline += '⬜ ' + label + '\n';
  });
  return timeline;
}

// ─────────────────────────────────────────────
// LOGIQUE BOT PRINCIPALE
// ─────────────────────────────────────────────
async function handleMessage(from, msg, buttonId) {
  const s = await getSession(from);
  const m = String(msg).trim().toLowerCase();
  const bid = buttonId || '';

  console.log(`🔍 État: "${s.e}" | msg: "${m}" | bid: "${bid}"`);

  // ── DEMANDE AGENT ──
  if (m === 'agent' || m === 'aide' || m === 'help' || bid === 'btn_agent') {
    s.e = 'agent'; s.p = []; s.produit_en_cours = ''; s.categorie_en_cours = '';
    await saveSession(from, s);
    await insertDemandeAgent(from, msg);
    await notifierAdmin(from, msg);
    return sendButtons(from,
      '🙋 Un agent ZYNTRA va vous contacter très prochainement!\n\nNos agents sont disponibles de 8h à 20h.',
      [{ id:'btn_commander', title:'🛒 Commander' }, { id:'btn_menu', title:'🏠 Menu principal' }]
    );
  }

  // ── MENU PRINCIPAL ──
  if (['menu','bonjour','hello','salut','start'].includes(m) || bid === 'btn_menu') {
    s.e = 'menu'; s.p = []; s.produit_en_cours = ''; s.categorie_en_cours = '';
    await saveSession(from, s);
    return sendButtons(from,
      'Bienvenue sur ZYNTRA! 🛒\n\nComment puis-je vous aider?\n\n_(Tapez AGENT pour parler à un conseiller)_',
      [
        { id:'btn_commander', title:'🛒 Commander' },
        { id:'btn_commandes', title:'📦 Mes commandes' },
        { id:'btn_contact',   title:'📞 Contact' }
      ]
    );
  }

  // ── COMMANDER → afficher catégories ──
  if (bid === 'btn_commander' || (s.e === 'menu' && (m === '1' || m === 'commander'))) {
    return afficherCategories(from, s);
  }

  // ── RETOUR CATÉGORIES ──
  if (bid === 'btn_categories') {
    return afficherCategories(from, s);
  }

  // ── SÉLECTION CATÉGORIE ──
  if (bid && bid.startsWith('cat_')) {
    return afficherProduits(from, s, bid);
  }

  // ── AJOUTER PRODUIT → retour catégorie courante ──
  if (bid === 'btn_ajouter') {
    if (s.categorie_en_cours) return afficherProduits(from, s, s.categorie_en_cours);
    return afficherCategories(from, s);
  }

  // ── SÉLECTION PRODUIT → demander quantité ──
  if (bid && !bid.startsWith('cat_') && !bid.startsWith('btn_') && !bid.startsWith('qte_') && s.e === 'cat') {
    const produits = await getProduits();
    const p = produits.find(x => x.id === bid);
    if (p) {
      s.e = 'qte'; s.produit_en_cours = bid;
      await saveSession(from, s);
      return sendButtons(from,
        '📦 *' + p.nom + '*\n💰 ' + parseInt(p.prix).toLocaleString() + ' FCFA\n\nQuelle quantité souhaitez-vous?',
        [
          { id:'qte_1', title:'x1 — ' + parseInt(p.prix).toLocaleString() + ' F' },
          { id:'qte_2', title:'x2 — ' + (p.prix*2).toLocaleString() + ' F' },
          { id:'qte_5', title:'x5 — ' + (p.prix*5).toLocaleString() + ' F' }
        ]
      );
    }
  }

  // ── SÉLECTION QUANTITÉ ──
  if (bid && bid.startsWith('qte_') && s.e === 'qte') {
    const qte = parseInt(bid.replace('qte_', ''));
    const produits = await getProduits();
    const p = produits.find(x => x.id === s.produit_en_cours);
    if (p && qte > 0) {
      const ex = s.p.find(x => x.id === p.id);
      if (ex) ex.q += qte; else s.p.push({id:p.id, nom:p.nom, prix:parseInt(p.prix), q:qte});
      s.e = 'cat'; s.produit_en_cours = '';
      await saveSession(from, s);
      const total = s.p.reduce((a,x) => a+x.prix*x.q, 0);
      let detail = ''; s.p.forEach(x => { detail += '• ' + x.nom + ' x' + x.q + ' = ' + (x.prix*x.q).toLocaleString() + ' FCFA\n'; });
      return sendButtons(from,
        '✅ ' + p.nom + ' x' + qte + ' ajouté!\n\n🛒 PANIER:\n' + detail + '\nTOTAL: ' + total.toLocaleString() + ' FCFA',
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
    if (!s.p.length) return sendButtons(from, '🛒 Votre panier est vide.',
      [{ id:'btn_commander', title:'🛒 Commander' }, { id:'btn_menu', title:'🏠 Menu' }]
    );
    let t = 0, r = '🛒 VOTRE PANIER:\n\n';
    s.p.forEach(p => { t += p.prix*p.q; r += '• ' + p.nom + ' x' + p.q + ' = ' + (p.prix*p.q).toLocaleString() + ' FCFA\n'; });
    return sendButtons(from, r + '\nTOTAL: ' + t.toLocaleString() + ' FCFA', [
      { id:'btn_confirmer', title:'✅ Confirmer' },
      { id:'btn_ajouter',   title:'➕ Ajouter' },
      { id:'btn_menu',      title:'❌ Annuler' }
    ]);
  }

  // ── CONFIRMER COMMANDE ──
  if (m === 'confirmer' || bid === 'btn_confirmer') {
    if (!s.p.length) return sendButtons(from, '🛒 Votre panier est vide.', [{ id:'btn_commander', title:'🛒 Commander' }]);
    const t = s.p.reduce((a,p) => a+p.prix*p.q, 0);
    const n = 'CMD-' + Date.now().toString().slice(-6);
    const date = new Date().toLocaleDateString('fr-FR');
    await insertCommande(n, from, t, date);
    s.p = []; s.e = 'menu'; s.produit_en_cours = ''; s.categorie_en_cours = '';
    await saveSession(from, s);
    return sendButtons(from,
      '✅ COMMANDE CONFIRMÉE!\n\nNuméro: *' + n + '*\nTotal: *' + t.toLocaleString() + ' FCFA*\nDate: ' + date + '\n\n' + getTimeline('En preparation') + '\nMerci pour votre commande ZYNTRA! 🎉',
      [{ id:'btn_commander', title:'🛒 Nouvelle commande' }, { id:'btn_suivi', title:'📍 Suivi commande' }]
    );
  }

  // ── MES COMMANDES ──
  if (bid === 'btn_commandes' || bid === 'btn_suivi' || (s.e === 'menu' && m === '2')) {
    const commandes = await getCommandesClient(from);
    if (!commandes.length) return sendButtons(from, '📋 Vous n\'avez pas encore de commandes.',
      [{ id:'btn_commander', title:'🛒 Commander' }, { id:'btn_menu', title:'🏠 Menu' }]
    );
    let msg = '📋 VOS COMMANDES:\n\n';
    commandes.forEach(c => {
      msg += '━━━━━━━━━━━━━━\n';
      msg += '🔖 *' + c.numero + '*\n';
      msg += '💰 ' + parseInt(c.total).toLocaleString() + ' FCFA\n';
      msg += '📅 ' + c.date + '\n';
      msg += getTimeline(c.statut) + '\n';
    });
    return sendButtons(from, msg,
      [{ id:'btn_commander', title:'🛒 Commander' }, { id:'btn_menu', title:'🏠 Menu' }]
    );
  }

  // ── CONTACT ──
  if (bid === 'btn_contact' || (s.e === 'menu' && m === '3')) {
    return sendButtons(from,
      '📞 Support ZYNTRA:\n\n+237 651 16 15 77\nDisponible 8h - 20h\n\nOu tapez AGENT pour un conseiller.',
      [{ id:'btn_agent', title:'🙋 Parler à un agent' }, { id:'btn_menu', title:'🏠 Menu principal' }]
    );
  }

  // ── FALLBACK ──
  return sendButtons(from, 'Tapez MENU pour recommencer ou AGENT pour un conseiller. 👋',
    [{ id:'btn_menu', title:'🏠 Menu principal' }, { id:'btn_agent', title:'🙋 Agent' }]
  );
}

// ─────────────────────────────────────────────
// WEBHOOK
// ─────────────────────────────────────────────
app.get('/webhook', (req, res) => {
  const {'hub.mode':mode,'hub.verify_token':token,'hub.challenge':challenge} = req.query;
  if (mode==='subscribe' && token===process.env.WEBHOOK_VERIFY_TOKEN) res.status(200).send(challenge);
  else res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message) return;
    const from = message.from;
    if (message.type==='text') await handleMessage(from, message.text?.body||'', null);
    if (message.type==='interactive') {
      const i = message.interactive;
      if (i.type==='button_reply') await handleMessage(from, i.button_reply.title, i.button_reply.id);
      if (i.type==='list_reply')   await handleMessage(from, i.list_reply.title,   i.list_reply.id);
    }
  } catch (err) { console.error('❌ Webhook:', err.message); }
});

// ─────────────────────────────────────────────
// ROUTES API
// ─────────────────────────────────────────────
app.use((req, res, next) => { res.header('Access-Control-Allow-Origin','*'); next(); });

app.get('/test', (req,res) => res.json({status:'ZYNTRA actif'}));
app.get('/api/commandes', async (req,res) => res.json(await getCommandes()));
app.post('/api/commandes/:num/statut', async (req,res) => {
  const {num} = req.params; const {statut} = req.body;
  await updateStatut(num, statut);
  const commande = await getCommande(num);
  if (commande) await notifierClient(commande.telephone, num, statut);
  res.json({ok:true});
});
app.get('/api/produits', async (req,res) => res.json(await getProduits(req.query.categorie)));
app.post('/api/produits', async (req,res) => {
  const {nom, prix, categorie} = req.body;
  if (!nom||!prix) return res.status(400).json({error:'nom et prix requis'});
  const id = 'p'+Date.now();
  await ajouterProduit(id, nom, parseInt(prix), categorie||'cat_boissons');
  res.json({ok:true, id});
});
app.delete('/api/produits/:id', async (req,res) => { await supprimerProduit(req.params.id); res.json({ok:true}); });
app.get('/api/agent/demandes', async (req,res) => res.json(await getDemandesAgent()));
app.post('/api/agent/:id/statut', async (req,res) => { await updateDemandeAgent(req.params.id, req.body.statut); res.json({ok:true}); });
app.post('/api/agent/message', async (req,res) => {
  const {telephone, message} = req.body;
  if (!telephone||!message) return res.status(400).json({error:'telephone et message requis'});
  await sendText(telephone, '👤 Agent ZYNTRA:\n\n'+message);
  res.json({ok:true});
});
app.get('/api/categories', (req,res) => res.json(CATEGORIES));
app.get('/admin', (req,res) => res.send(fs.readFileSync('admin.html','utf8')));
app.get('/', (req,res) => res.redirect('/admin'));

const PORT = process.env.PORT||3000;
app.listen(PORT, () => console.log('ZYNTRA demarre sur port '+PORT));
