const express = require('express');
const fs = require('fs');

const app = express();
app.use(express.json({ limit: '10mb' })); // Pour les images base64
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

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
      categorie TEXT DEFAULT 'cat_boissons', actif BOOLEAN DEFAULT TRUE,
      image_url TEXT DEFAULT '', description TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS demandes_agent (
      id SERIAL PRIMARY KEY, telephone TEXT, message TEXT,
      statut TEXT DEFAULT 'en_attente', date TEXT, heure TEXT
    );
    CREATE TABLE IF NOT EXISTS promotions (
      id SERIAL PRIMARY KEY, titre TEXT, description TEXT,
      type TEXT DEFAULT 'pourcentage', valeur INTEGER DEFAULT 10,
      categorie TEXT DEFAULT '', produit_id TEXT DEFAULT '',
      actif BOOLEAN DEFAULT TRUE, date_debut TEXT, date_fin TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS config (
      cle TEXT PRIMARY KEY, valeur TEXT
    );
  `).then(async () => {
    const r = await pool.query('SELECT COUNT(*) FROM produits');
    if (parseInt(r.rows[0].count) === 0) await initProduits();
    // Config par défaut
    await pool.query(`INSERT INTO config (cle,valeur) VALUES ('welcome_message','Bienvenue sur ZYNTRA! 🛒\n\nVotre plateforme de commande FMCG au Cameroun.\n\nComment puis-je vous aider?') ON CONFLICT DO NOTHING`);
    await pool.query(`INSERT INTO config (cle,valeur) VALUES ('logo_url','') ON CONFLICT DO NOTHING`);
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
      categorie TEXT DEFAULT 'cat_boissons', actif INTEGER DEFAULT 1,
      image_url TEXT DEFAULT '', description TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS demandes_agent (
      id INTEGER PRIMARY KEY AUTOINCREMENT, telephone TEXT, message TEXT,
      statut TEXT DEFAULT 'en_attente', date TEXT, heure TEXT
    );
    CREATE TABLE IF NOT EXISTS promotions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, titre TEXT, description TEXT,
      type TEXT DEFAULT 'pourcentage', valeur INTEGER DEFAULT 10,
      categorie TEXT DEFAULT '', produit_id TEXT DEFAULT '',
      actif INTEGER DEFAULT 1, date_debut TEXT, date_fin TEXT
    );
    CREATE TABLE IF NOT EXISTS config (
      cle TEXT PRIMARY KEY, valeur TEXT
    );
  `);
  const count = db.prepare('SELECT COUNT(*) as c FROM produits').get();
  if (count.c === 0) initProduits();
  try { db.prepare(`INSERT OR IGNORE INTO config (cle,valeur) VALUES ('welcome_message','Bienvenue sur ZYNTRA!')`).run(); } catch(e){}
  console.log('SQLite pret!');
}

// ─────────────────────────────────────────────
// CATALOGUE PAR DÉFAUT
// ─────────────────────────────────────────────
const CATEGORIES = [
  { id:'cat_boissons', nom:'🥤 Boissons',    emoji:'🥤' },
  { id:'cat_alim',     nom:'🍪 Alimentation', emoji:'🍪' },
  { id:'cat_hygiene',  nom:'🧴 Hygiene',      emoji:'🧴' },
  { id:'cat_divers',   nom:'🚬 Tabac Divers', emoji:'🚬' }
];

const PRODUITS_DEFAUT = [
  {id:'b1',nom:'Castel 65cl',prix:500,categorie:'cat_boissons'},
  {id:'b2',nom:'Beaufort 65cl',prix:500,categorie:'cat_boissons'},
  {id:'b3',nom:'Malta Guinness 65cl',prix:400,categorie:'cat_boissons'},
  {id:'b4',nom:'Coca-Cola 50cl',prix:400,categorie:'cat_boissons'},
  {id:'b5',nom:'Fanta Orange 50cl',prix:400,categorie:'cat_boissons'},
  {id:'b6',nom:'Sprite 50cl',prix:400,categorie:'cat_boissons'},
  {id:'b7',nom:'Supermont 1.5L',prix:300,categorie:'cat_boissons'},
  {id:'b8',nom:'Tangui 1.5L',prix:350,categorie:'cat_boissons'},
  {id:'a1',nom:'Riz parfume 5kg',prix:3500,categorie:'cat_alim'},
  {id:'a2',nom:'Huile vegetale 1L',prix:1200,categorie:'cat_alim'},
  {id:'a3',nom:'Sardines Maite 125g',prix:500,categorie:'cat_alim'},
  {id:'a4',nom:'Cube Maggi x10',prix:200,categorie:'cat_alim'},
  {id:'a5',nom:'Biscuits Golda x10',prix:300,categorie:'cat_alim'},
  {id:'a6',nom:'Sucre 1kg',prix:700,categorie:'cat_alim'},
  {id:'a7',nom:'Lait Gloria 400g',prix:1500,categorie:'cat_alim'},
  {id:'h1',nom:'Savon Camay',prix:300,categorie:'cat_hygiene'},
  {id:'h2',nom:'Lessive OMO 500g',prix:800,categorie:'cat_hygiene'},
  {id:'h3',nom:'Dentifrice Colgate',prix:600,categorie:'cat_hygiene'},
  {id:'h4',nom:'Deodorant Rexona',prix:1200,categorie:'cat_hygiene'},
  {id:'h5',nom:'Couches Pampers S40',prix:5500,categorie:'cat_hygiene'},
  {id:'h6',nom:'Savon Protex',prix:350,categorie:'cat_hygiene'},
  {id:'d1',nom:'Marlboro x20',prix:1500,categorie:'cat_divers'},
  {id:'d2',nom:'Piles AA Duracell x2',prix:500,categorie:'cat_divers'},
  {id:'d3',nom:'Allumettes x10',prix:100,categorie:'cat_divers'},
  {id:'d4',nom:'Recharge MTN 500',prix:500,categorie:'cat_divers'},
  {id:'d5',nom:'Recharge Orange 500',prix:500,categorie:'cat_divers'},
  {id:'d6',nom:'Bougies x5',prix:200,categorie:'cat_divers'},
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
// FONCTIONS DB — PRODUITS
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

async function getProduit(id) {
  if (usePostgres) { const r = await pool.query('SELECT * FROM produits WHERE id=$1', [id]); return r.rows[0]; }
  return db.prepare('SELECT * FROM produits WHERE id=?').get(id);
}

async function ajouterProduit(id, nom, prix, categorie, image_url, description) {
  if (usePostgres) await pool.query('INSERT INTO produits (id,nom,prix,categorie,image_url,description) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO UPDATE SET nom=$2,prix=$3,categorie=$4,image_url=$5,description=$6,actif=TRUE', [id,nom,prix,categorie,image_url||'',description||'']);
  else db.prepare('INSERT OR REPLACE INTO produits (id,nom,prix,categorie,actif,image_url,description) VALUES (?,?,?,?,1,?,?)').run(id,nom,prix,categorie,image_url||'',description||'');
}

async function updateProduitImage(id, image_url) {
  if (usePostgres) await pool.query('UPDATE produits SET image_url=$1 WHERE id=$2', [image_url, id]);
  else db.prepare('UPDATE produits SET image_url=? WHERE id=?').run(image_url, id);
}

async function supprimerProduit(id) {
  if (usePostgres) await pool.query('UPDATE produits SET actif=FALSE WHERE id=$1', [id]);
  else db.prepare('UPDATE produits SET actif=0 WHERE id=?').run(id);
}

// ─────────────────────────────────────────────
// FONCTIONS DB — CONFIG
// ─────────────────────────────────────────────
async function getConfig(cle) {
  if (usePostgres) { const r = await pool.query('SELECT valeur FROM config WHERE cle=$1', [cle]); return r.rows[0]?.valeur || ''; }
  const row = db.prepare('SELECT valeur FROM config WHERE cle=?').get(cle);
  return row?.valeur || '';
}

async function setConfig(cle, valeur) {
  if (usePostgres) await pool.query('INSERT INTO config (cle,valeur) VALUES ($1,$2) ON CONFLICT (cle) DO UPDATE SET valeur=$2', [cle, valeur]);
  else db.prepare('INSERT OR REPLACE INTO config (cle,valeur) VALUES (?,?)').run(cle, valeur);
}

// ─────────────────────────────────────────────
// FONCTIONS DB — PROMOTIONS
// ─────────────────────────────────────────────
async function getPromotions(actifOnly) {
  if (usePostgres) {
    const q = actifOnly ? 'SELECT * FROM promotions WHERE actif=TRUE ORDER BY id DESC' : 'SELECT * FROM promotions ORDER BY id DESC';
    const r = await pool.query(q); return r.rows;
  }
  const q = actifOnly ? 'SELECT * FROM promotions WHERE actif=1 ORDER BY id DESC' : 'SELECT * FROM promotions ORDER BY id DESC';
  return db.prepare(q).all();
}

async function ajouterPromotion(titre, description, type, valeur, categorie, produit_id, date_debut, date_fin) {
  if (usePostgres) await pool.query('INSERT INTO promotions (titre,description,type,valeur,categorie,produit_id,date_debut,date_fin) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [titre,description,type,valeur,categorie||'',produit_id||'',date_debut||'',date_fin||'']);
  else db.prepare('INSERT INTO promotions (titre,description,type,valeur,categorie,produit_id,actif,date_debut,date_fin) VALUES (?,?,?,?,?,?,1,?,?)').run(titre,description,type,valeur,categorie||'',produit_id||'',date_debut||'',date_fin||'');
}

async function togglePromotion(id, actif) {
  if (usePostgres) await pool.query('UPDATE promotions SET actif=$1 WHERE id=$2', [actif, id]);
  else db.prepare('UPDATE promotions SET actif=? WHERE id=?').run(actif?1:0, id);
}

async function supprimerPromotion(id) {
  if (usePostgres) await pool.query('DELETE FROM promotions WHERE id=$1', [id]);
  else db.prepare('DELETE FROM promotions WHERE id=?').run(id);
}

// Calculer prix après promo
async function getPrixAvecPromo(produit) {
  const promos = await getPromotions(true);
  let prixFinal = parseInt(produit.prix);
  let promoAppliquee = null;

  for (const p of promos) {
    const matchProduit = p.produit_id && p.produit_id === produit.id;
    const matchCategorie = p.categorie && p.categorie === produit.categorie;
    if (matchProduit || matchCategorie) {
      if (p.type === 'pourcentage') {
        prixFinal = Math.round(produit.prix * (1 - p.valeur/100));
      } else {
        prixFinal = Math.max(0, produit.prix - p.valeur);
      }
      promoAppliquee = p;
      break;
    }
  }
  return { prixFinal, promoAppliquee };
}

// ─────────────────────────────────────────────
// FONCTIONS DB — SESSIONS & COMMANDES
// ─────────────────────────────────────────────
async function getSession(tel) {
  if (usePostgres) {
    const r = await pool.query('SELECT * FROM sessions WHERE telephone=$1', [tel]);
    if (!r.rows.length) { await pool.query('INSERT INTO sessions (telephone,etat,panier,produit_en_cours,categorie_en_cours) VALUES ($1,$2,$3,$4,$5)', [tel,'menu','[]','','']); return {e:'menu',p:[],produit_en_cours:'',categorie_en_cours:''}; }
    return {e:r.rows[0].etat, p:JSON.parse(r.rows[0].panier), produit_en_cours:r.rows[0].produit_en_cours||'', categorie_en_cours:r.rows[0].categorie_en_cours||''};
  } else {
    const row = db.prepare('SELECT * FROM sessions WHERE telephone=?').get(tel);
    if (!row) { db.prepare('INSERT INTO sessions (telephone,etat,panier,produit_en_cours,categorie_en_cours,updated_at) VALUES (?,?,?,?,?,?)').run(tel,'menu','[]','','',new Date().toISOString()); return {e:'menu',p:[],produit_en_cours:'',categorie_en_cours:''}; }
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
  if (!phoneNumberId || !token) { console.error('Variables manquantes'); return; }
  return new Promise((resolve) => {
    const https = require('https');
    const data = JSON.stringify(payload);
    const req = https.request({
      hostname:'graph.facebook.com', path:`/v19.0/${phoneNumberId}/messages`, method:'POST',
      headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}
    }, (res) => {
      let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{ try{const r=JSON.parse(d);if(r.error)console.error('Meta:',JSON.stringify(r.error));else console.log('Envoyé à',to);resolve(r);}catch(e){resolve(null);} });
    });
    req.on('error',(e)=>{console.error('Réseau:',e.message);resolve(null);});
    req.write(data); req.end();
  });
}

async function sendText(to, body) {
  return sendAPI(to, {messaging_product:'whatsapp',to,type:'text',text:{body}});
}

async function sendImage(to, imageUrl, caption) {
  return sendAPI(to, {
    messaging_product:'whatsapp', to, type:'image',
    image:{ link: imageUrl, caption: caption || '' }
  });
}

async function sendButtons(to, body, buttons) {
  return sendAPI(to, {messaging_product:'whatsapp',to,type:'interactive',interactive:{type:'button',body:{text:body},action:{buttons:buttons.map(b=>({type:'reply',reply:{id:b.id,title:b.title}}))}}});
}

async function sendList(to, body, buttonText, sections) {
  return sendAPI(to, {messaging_product:'whatsapp',to,type:'interactive',interactive:{type:'list',body:{text:body},action:{button:buttonText,sections}}});
}

// Notifications statut
const MESSAGES_STATUT = {
  'En preparation': '⏳ Commande *{num}* en préparation.\n\n✅ Reçue → ⏳ Préparation → ⬜ Livraison → ⬜ Livrée',
  'En livraison':   '🚚 Commande *{num}* en route!\n\n✅ Reçue → ✅ Préparation → 🚚 Livraison → ⬜ Livrée',
  'Livree':         '✅ Commande *{num}* livrée!\n\n✅ Reçue → ✅ Préparation → ✅ Livraison → ✅ Livrée\n\nMerci! Tapez MENU pour recommander.',
  'Annulee':        '❌ Commande *{num}* annulée.\n\nContactez-nous: +237 651 16 15 77'
};

async function notifierClient(telephone, numero, statut) {
  const template = MESSAGES_STATUT[statut];
  if (!template) return;
  await sendText(telephone, template.replace('{num}', numero));
}

async function notifierAdmin(telephone, message) {
  const adminTel = process.env.ADMIN_PHONE;
  if (!adminTel) return;
  await sendText(adminTel, `🆘 AGENT ZYNTRA\n\nClient: +${telephone}\n"${message}"\n\nRépondez depuis le dashboard.`);
}

// ─────────────────────────────────────────────
// BOT — AFFICHER PROMOTIONS ACTIVES
// ─────────────────────────────────────────────
async function getMessagePromos() {
  const promos = await getPromotions(true);
  if (!promos.length) return '';
  let msg = '\n\n🔥 *OFFRES EN COURS:*\n';
  promos.slice(0,3).forEach(p => {
    const remise = p.type === 'pourcentage' ? `-${p.valeur}%` : `-${parseInt(p.valeur).toLocaleString()} FCFA`;
    msg += `• ${p.titre} ${remise}\n`;
  });
  return msg;
}

// ─────────────────────────────────────────────
// BOT — CATALOGUE
// ─────────────────────────────────────────────
async function afficherCategories(from, s) {
  s.e = 'categories'; s.categorie_en_cours = ''; s.produit_en_cours = '';
  await saveSession(from, s);
  let panierInfo = '';
  if (s.p.length > 0) {
    const total = s.p.reduce((a,x)=>a+x.prix*x.q,0);
    panierInfo = '\n\n🛒 Panier: '+total.toLocaleString()+' FCFA';
  }
  const promoMsg = await getMessagePromos();
  return sendList(from,
    '🏪 Choisissez une catégorie:'+panierInfo+promoMsg,
    '📂 Categories',
    [{title:'Catégories', rows:CATEGORIES.map(c=>({id:c.id,title:c.nom,description:'Voir les produits'}))}]
  );
}

async function afficherProduits(from, s, categorieId) {
  s.e = 'cat'; s.categorie_en_cours = categorieId;
  await saveSession(from, s);
  const cat = CATEGORIES.find(c=>c.id===categorieId);
  const produits = await getProduits(categorieId);
  if (!produits.length) {
    return sendButtons(from, 'Aucun produit disponible.',
      [{id:'btn_categories',title:'⬅️ Catégories'},{id:'btn_menu',title:'🏠 Menu'}]
    );
  }
  let panierInfo = '';
  if (s.p.length > 0) {
    const total = s.p.reduce((a,x)=>a+x.prix*x.q,0);
    panierInfo = '\n\n🛒 Panier: '+total.toLocaleString()+' FCFA';
  }
  // Préparer les rows avec prix promo
  const rows = [];
  for (const x of produits) {
    const {prixFinal, promoAppliquee} = await getPrixAvecPromo(x);
    const label = promoAppliquee ? `🔥 ${prixFinal.toLocaleString()} FCFA (-${promoAppliquee.type==='pourcentage'?promoAppliquee.valeur+'%':promoAppliquee.valeur+' F'})` : `${parseInt(x.prix).toLocaleString()} FCFA`;
    rows.push({id:x.id, title:x.nom.slice(0,24), description:label.slice(0,72)});
  }
  return sendList(from,
    `${cat.nom}\n\nChoisissez un produit:${panierInfo}`,
    '📦 Voir les produits',
    [{title:cat.nom, rows}]
  );
}

// Timeline suivi
function getTimeline(statut) {
  const etapes = ['En preparation','En livraison','Livree'];
  const labels = ['Préparation','Livraison','Livrée'];
  const emojis = ['⏳','🚚','✅'];
  const idx = etapes.indexOf(statut);
  let t = '📍 *SUIVI DE COMMANDE:*\n\n✅ Commande reçue\n';
  labels.forEach((l,i) => {
    if(i<idx) t+='✅ '+l+'\n';
    else if(i===idx) t+=emojis[i]+' '+l+' ← ici\n';
    else t+='⬜ '+l+'\n';
  });
  return t;
}

// ─────────────────────────────────────────────
// LOGIQUE BOT PRINCIPALE
// ─────────────────────────────────────────────
async function handleMessage(from, msg, buttonId) {
  const s = await getSession(from);
  const m = String(msg).trim().toLowerCase();
  const bid = buttonId || '';
  console.log(`État: "${s.e}" | msg: "${m}" | bid: "${bid}"`);

  // ── MENU ──
  if (['menu','bonjour','hello','salut','start','hi'].includes(m) || bid==='btn_menu') {
    s.e='menu'; s.p=[]; s.produit_en_cours=''; s.categorie_en_cours='';
    await saveSession(from, s);
    const welcomeMsg = await getConfig('welcome_message') || 'Bienvenue sur ZYNTRA! 🛒';
    const promoMsg = await getMessagePromos();
    const logoUrl = await getConfig('logo_url');
    // Envoyer logo si configuré
    if (logoUrl && logoUrl.startsWith('http')) {
      await sendImage(from, logoUrl, 'ZYNTRA — Votre plateforme FMCG');
    }
    return sendButtons(from,
      welcomeMsg + promoMsg + '\n\n_(Tapez AGENT pour un conseiller)_',
      [{id:'btn_commander',title:'🛒 Commander'},{id:'btn_commandes',title:'📦 Mes commandes'},{id:'btn_contact',title:'📞 Contact'}]
    );
  }

  // ── PROMOTIONS ──
  if (m==='promo' || m==='offres' || bid==='btn_promos') {
    const promos = await getPromotions(true);
    if (!promos.length) {
      return sendButtons(from, '😊 Aucune promotion en cours.\n\nRestez à l\'écoute pour les prochaines offres!',
        [{id:'btn_commander',title:'🛒 Commander'},{id:'btn_menu',title:'🏠 Menu'}]
      );
    }
    let msg2 = '🔥 *PROMOTIONS EN COURS:*\n\n';
    promos.forEach(p => {
      const remise = p.type==='pourcentage'?`-${p.valeur}%`:`-${parseInt(p.valeur).toLocaleString()} FCFA`;
      msg2 += `*${p.titre}* ${remise}\n${p.description||''}\n\n`;
    });
    return sendButtons(from, msg2,
      [{id:'btn_commander',title:'🛒 Commander'},{id:'btn_menu',title:'🏠 Menu'}]
    );
  }

  // ── AGENT ──
  if (m==='agent'||m==='aide'||m==='help'||bid==='btn_agent') {
    await insertDemandeAgent(from, msg);
    await notifierAdmin(from, msg);
    const adminTel = process.env.ADMIN_PHONE || '237651161577';
    return sendButtons(from,
      '🙋 Parlez à un agent ZYNTRA!\n\nhttps://wa.me/'+adminTel+'\n\nDisponible 8h - 20h 📞',
      [{id:'btn_commander',title:'🛒 Commander'},{id:'btn_menu',title:'🏠 Menu'}]
    );
  }

  // ── COMMANDER ──
  if (bid==='btn_commander'||(s.e==='menu'&&(m==='1'||m==='commander'))) {
    return afficherCategories(from, s);
  }

  // ── RETOUR CATÉGORIES ──
  if (bid==='btn_categories') { return afficherCategories(from, s); }

  // ── SÉLECTION CATÉGORIE ──
  if (bid && bid.startsWith('cat_')) { return afficherProduits(from, s, bid); }

  // ── AJOUTER PRODUIT ──
  if (bid==='btn_ajouter') { return afficherCategories(from, s); }

  // ── SÉLECTION PRODUIT → quantité + image ──
  if (bid && !bid.startsWith('cat_') && !bid.startsWith('btn_') && !bid.startsWith('qte_') && s.e==='cat') {
    const produits = await getProduits();
    const p = produits.find(x=>x.id===bid);
    if (p) {
      s.e='qte'; s.produit_en_cours=bid;
      await saveSession(from, s);
      const {prixFinal, promoAppliquee} = await getPrixAvecPromo(p);
      // Envoyer image si disponible
      if (p.image_url && p.image_url.startsWith('http')) {
        await sendImage(from, p.image_url, p.nom);
      }
      let promoTxt = '';
      if (promoAppliquee) {
        promoTxt = `\n🔥 PROMO: ${promoAppliquee.type==='pourcentage'?`-${promoAppliquee.valeur}%`:`-${promoAppliquee.valeur} FCFA`} (${prixFinal.toLocaleString()} FCFA)`;
      }
      return sendButtons(from,
        `📦 *${p.nom}*\n💰 ${parseInt(p.prix).toLocaleString()} FCFA${promoTxt}\n\nQuelle quantité?`,
        [
          {id:'qte_1',title:`x1 — ${prixFinal.toLocaleString()} F`},
          {id:'qte_2',title:`x2 — ${(prixFinal*2).toLocaleString()} F`},
          {id:'qte_5',title:`x5 — ${(prixFinal*5).toLocaleString()} F`}
        ]
      );
    }
  }

  // ── QUANTITÉ ──
  if (bid && bid.startsWith('qte_') && s.e==='qte') {
    const qte = parseInt(bid.replace('qte_',''));
    const produits = await getProduits();
    const p = produits.find(x=>x.id===s.produit_en_cours);
    if (p && qte>0) {
      const {prixFinal} = await getPrixAvecPromo(p);
      const ex = s.p.find(x=>x.id===p.id);
      if (ex) ex.q+=qte; else s.p.push({id:p.id,nom:p.nom,prix:prixFinal,q:qte});
      s.e='cat'; s.produit_en_cours='';
      await saveSession(from, s);
      const total = s.p.reduce((a,x)=>a+x.prix*x.q,0);
      let detail=''; s.p.forEach(x=>{detail+='• '+x.nom+' x'+x.q+' = '+(x.prix*x.q).toLocaleString()+' FCFA\n';});
      return sendButtons(from,
        '✅ '+p.nom+' x'+qte+' ajouté!\n\n🛒 PANIER:\n'+detail+'\nTOTAL: '+total.toLocaleString()+' FCFA',
        [{id:'btn_ajouter',title:'➕ Ajouter produit'},{id:'btn_confirmer',title:'✅ Confirmer'},{id:'btn_menu',title:'❌ Annuler'}]
      );
    }
  }

  // ── PANIER ──
  if (m==='0'||bid==='btn_panier') {
    if (!s.p.length) return sendButtons(from,'🛒 Panier vide.',[{id:'btn_commander',title:'🛒 Commander'},{id:'btn_menu',title:'🏠 Menu'}]);
    let t=0,r='🛒 VOTRE PANIER:\n\n';
    s.p.forEach(p=>{t+=p.prix*p.q;r+='• '+p.nom+' x'+p.q+' = '+(p.prix*p.q).toLocaleString()+' FCFA\n';});
    return sendButtons(from,r+'\nTOTAL: '+t.toLocaleString()+' FCFA',[
      {id:'btn_confirmer',title:'✅ Confirmer'},
      {id:'btn_ajouter',title:'➕ Ajouter'},
      {id:'btn_menu',title:'❌ Annuler'}
    ]);
  }

  // ── CONFIRMER ──
  if (m==='confirmer'||bid==='btn_confirmer') {
    if (!s.p.length) return sendButtons(from,'🛒 Panier vide.',[{id:'btn_commander',title:'🛒 Commander'}]);
    const t = s.p.reduce((a,p)=>a+p.prix*p.q,0);
    const n = 'CMD-'+Date.now().toString().slice(-6);
    const date = new Date().toLocaleDateString('fr-FR');
    await insertCommande(n,from,t,date);
    s.p=[]; s.e='menu'; s.produit_en_cours=''; s.categorie_en_cours='';
    await saveSession(from, s);
    return sendButtons(from,
      '✅ COMMANDE CONFIRMÉE!\n\nNuméro: *'+n+'*\nTotal: *'+t.toLocaleString()+' FCFA*\nDate: '+date+'\n\n'+getTimeline('En preparation')+'\nMerci pour votre commande ZYNTRA! 🎉',
      [{id:'btn_commander',title:'🛒 Nouvelle commande'},{id:'btn_suivi',title:'📍 Suivi commande'}]
    );
  }

  // ── MES COMMANDES ──
  if (bid==='btn_commandes'||bid==='btn_suivi'||(s.e==='menu'&&m==='2')) {
    const commandes = await getCommandesClient(from);
    if (!commandes.length) return sendButtons(from,"Pas encore de commandes.",[{id:'btn_commander',title:'🛒 Commander'},{id:'btn_menu',title:'🏠 Menu'}]);
    let msg2='📋 VOS COMMANDES:\n\n';
    commandes.forEach(c=>{msg2+='━━━━━━━━━━━━━━\n🔖 *'+c.numero+'*\n💰 '+parseInt(c.total).toLocaleString()+' FCFA\n📅 '+c.date+'\n'+getTimeline(c.statut)+'\n';});
    return sendButtons(from,msg2,[{id:'btn_commander',title:'🛒 Commander'},{id:'btn_menu',title:'🏠 Menu'}]);
  }

  // ── CONTACT ──
  if (bid==='btn_contact'||(s.e==='menu'&&m==='3')) {
    return sendButtons(from,'📞 Support ZYNTRA:\n\n+237 651 16 15 77\n8h - 20h\n\nTapez PROMO pour les offres!',[
      {id:'btn_agent',title:'🙋 Parler agent'},
      {id:'btn_promos',title:'🔥 Promotions'},
      {id:'btn_menu',title:'🏠 Menu'}
    ]);
  }

  // ── FALLBACK ──
  return sendButtons(from,'Tapez MENU pour recommencer ou AGENT pour un conseiller. 👋',
    [{id:'btn_menu',title:'🏠 Menu'},{id:'btn_agent',title:'🙋 Agent'}]
  );
}

// ─────────────────────────────────────────────
// WEBHOOK
// ─────────────────────────────────────────────
app.get('/webhook', (req, res) => {
  const {'hub.mode':mode,'hub.verify_token':token,'hub.challenge':challenge} = req.query;
  if (mode==='subscribe'&&token===process.env.WEBHOOK_VERIFY_TOKEN) res.status(200).send(challenge);
  else res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message) return;
    const from = message.from;
    if (message.type==='text') await handleMessage(from,message.text?.body||'',null);
    if (message.type==='interactive') {
      const i=message.interactive;
      if (i.type==='button_reply') await handleMessage(from,i.button_reply.title,i.button_reply.id);
      if (i.type==='list_reply') await handleMessage(from,i.list_reply.title,i.list_reply.id);
    }
  } catch(err){console.error('Webhook:',err.message);}
});

// ─────────────────────────────────────────────
// ROUTES API
// ─────────────────────────────────────────────
app.use((req,res,next)=>{res.header('Access-Control-Allow-Origin','*');res.header('Access-Control-Allow-Methods','GET,POST,DELETE,PUT');res.header('Access-Control-Allow-Headers','Content-Type');next();});

app.get('/test',(req,res)=>res.json({status:'ZYNTRA actif'}));
app.get('/api/commandes',async(req,res)=>res.json(await getCommandes()));
app.post('/api/commandes/:num/statut',async(req,res)=>{
  const {num}=req.params,{statut}=req.body;
  await updateStatut(num,statut);
  const cmd=await getCommande(num);
  if(cmd) await notifierClient(cmd.telephone,num,statut);
  res.json({ok:true});
});
app.get('/api/produits',async(req,res)=>res.json(await getProduits(req.query.categorie)));
app.post('/api/produits',async(req,res)=>{
  const{nom,prix,categorie,description}=req.body;
  if(!nom||!prix) return res.status(400).json({error:'nom et prix requis'});
  const id='p'+Date.now();
  await ajouterProduit(id,nom,parseInt(prix),categorie||'cat_boissons','',description||'');
  res.json({ok:true,id});
});
app.post('/api/produits/:id/image',async(req,res)=>{
  const{image_base64,image_url}=req.body;
  // Si URL directe fournie
  if(image_url){await updateProduitImage(req.params.id,image_url);return res.json({ok:true,url:image_url});}
  // Si base64 — stocker directement
  if(image_base64){await updateProduitImage(req.params.id,image_base64);return res.json({ok:true});}
  res.status(400).json({error:'image_base64 ou image_url requis'});
});
app.delete('/api/produits/:id',async(req,res)=>{await supprimerProduit(req.params.id);res.json({ok:true});});

// Promotions
app.get('/api/promotions',async(req,res)=>res.json(await getPromotions(false)));
app.post('/api/promotions',async(req,res)=>{
  const{titre,description,type,valeur,categorie,produit_id,date_debut,date_fin}=req.body;
  if(!titre||!valeur) return res.status(400).json({error:'titre et valeur requis'});
  await ajouterPromotion(titre,description,type||'pourcentage',parseInt(valeur),categorie,produit_id,date_debut,date_fin);
  res.json({ok:true});
});
app.post('/api/promotions/:id/toggle',async(req,res)=>{
  await togglePromotion(req.params.id,req.body.actif);
  res.json({ok:true});
});
app.delete('/api/promotions/:id',async(req,res)=>{await supprimerPromotion(req.params.id);res.json({ok:true});});

// Config
app.get('/api/config',async(req,res)=>{
  const welcome=await getConfig('welcome_message');
  const logo=await getConfig('logo_url');
  res.json({welcome_message:welcome,logo_url:logo});
});
app.post('/api/config',async(req,res)=>{
  const{welcome_message,logo_url}=req.body;
  if(welcome_message!==undefined) await setConfig('welcome_message',welcome_message);
  if(logo_url!==undefined) await setConfig('logo_url',logo_url);
  res.json({ok:true});
});

// Agent
app.get('/api/agent/demandes',async(req,res)=>res.json(await getDemandesAgent()));
app.post('/api/agent/:id/statut',async(req,res)=>{await updateDemandeAgent(req.params.id,req.body.statut);res.json({ok:true});});
app.post('/api/agent/message',async(req,res)=>{
  const{telephone,message}=req.body;
  if(!telephone||!message) return res.status(400).json({error:'requis'});
  await sendText(telephone,'👤 Agent ZYNTRA:\n\n'+message);
  res.json({ok:true});
});
app.get('/api/categories',(req,res)=>res.json(CATEGORIES));
app.get('/admin',(req,res)=>res.send(fs.readFileSync('admin.html','utf8')));
app.get('/',(req,res)=>res.redirect('/admin'));

const PORT=process.env.PORT||3000;
app.listen(PORT,()=>console.log('ZYNTRA demarre sur port '+PORT));