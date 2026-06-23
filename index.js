const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
app.use(express.json());

// ===== BASE DE DONNÉES =====
const db = new Database('easyorder.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS commandes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    numero TEXT UNIQUE,
    telephone TEXT,
    total INTEGER,
    statut TEXT DEFAULT 'En preparation',
    date TEXT
  );
  CREATE TABLE IF NOT EXISTS lignes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    commande_id INTEGER,
    nom TEXT,
    prix INTEGER,
    quantite INTEGER
  );
`);

// ===== PRODUITS =====
const P=[
  {id:1,nom:'Castel 65cl',prix:500},
  {id:2,nom:'Beaufort 65cl',prix:500},
  {id:3,nom:'Malta 65cl',prix:400},
  {id:4,nom:'CocaCola 50cl',prix:400},
  {id:5,nom:'Supermont 1.5L',prix:300}
];

// ===== SESSIONS EN MEMOIRE =====
const S={};
function gs(t){if(!S[t])S[t]={e:'menu',p:[]};return S[t];}

// ===== BOT =====
function bot(tel,msg){
  const s=gs(tel);
  const m=String(msg).trim().toLowerCase();
  if(m==='bonjour'||m==='menu'){
    s.e='menu';
    return 'Bienvenue sur EasyOrder FMCG Cameroun!\n\n1 COMMANDER\n2 MES COMMANDES\n3 CONTACT';
  }
  if(m==='commander'){
    s.e='cat';s.p=[];
    let r='CATALOGUE PRODUITS:\n\n';
    P.forEach(x=>r+=x.id+'. '+x.nom+' - '+x.prix+' FCFA\n');
    return r+'\nTapez le numero du produit\n0 = Voir panier\nCONFIRMER = Valider';
  }
  if(m==='2'){
    const mc=db.prepare('SELECT * FROM commandes WHERE telephone=? ORDER BY id DESC LIMIT 3').all(tel);
    if(!mc.length)return 'Aucune commande.\nTapez COMMANDER pour commencer!';
    let r='MES COMMANDES:\n\n';
    mc.forEach(c=>r+=c.numero+'\n'+c.total+' FCFA - '+c.statut+'\n'+c.date+'\n\n');
    return r;
  }
  if(m==='3')return 'SUPPORT EASYORDER\n\nTel: +237 600 000 000\nLun-Sam 7h-20h\n\nTapez MENU pour revenir.';
  if(s.e==='cat'&&!isNaN(m)&&m!=='0'){
    const p=P.find(x=>x.id===parseInt(m));
    if(!p)return 'Numero invalide. Choisissez entre 1 et '+P.length+'.';
    const ex=s.p.find(x=>x.id===p.id);
    if(ex)ex.q++;else s.p.push({...p,q:1});
    return p.nom+' ajoute!\n\nPanier: '+s.p.length+' article(s)\n\nContinuez ou tapez:\n0 = Voir panier\nCONFIRMER = Valider';
  }
  if(m==='0'){
    if(!s.p.length)return 'Panier vide.\nTapez COMMANDER pour choisir.';
    let t=0,r='MON PANIER:\n\n';
    s.p.forEach(p=>{t+=p.prix*p.q;r+=p.nom+' x'+p.q+' = '+(p.prix*p.q)+' FCFA\n';});
    return r+'\nTOTAL: '+t+' FCFA\n\nTapez CONFIRMER pour valider.';
  }
  if(m==='confirmer'){
    if(!s.p.length)return 'Panier vide! Tapez COMMANDER.';
    const t=s.p.reduce((a,p)=>a+p.prix*p.q,0);
    const n='CMD-'+Date.now().toString().slice(-6);
    const date=new Date().toLocaleDateString('fr-FR');
    const stmt=db.prepare('INSERT INTO commandes (numero,telephone,total,statut,date) VALUES (?,?,?,?,?)');
    const info=stmt.run(n,tel,t,'En preparation',date);
    const stmtL=db.prepare('INSERT INTO lignes (commande_id,nom,prix,quantite) VALUES (?,?,?,?)');
    s.p.forEach(p=>stmtL.run(info.lastInsertRowid,p.nom,p.prix,p.q));
    s.p=[];s.e='menu';
    return 'COMMANDE CONFIRMEE!\n\nNumero: '+n+'\nTotal: '+t+' FCFA\nStatut: En preparation\n\nTapez MES COMMANDES pour suivre.';
  }
  s.e='menu';
  return 'Je comprends pas.\nTapez MENU pour les options.';
}

// ===== ROUTES =====
app.get('/test',(req,res)=>res.json({reponse:bot(req.query.tel||'237',req.query.msg||'bonjour')}));

app.get('/api/commandes',(req,res)=>{
  const commandes=db.prepare('SELECT * FROM commandes ORDER BY id DESC').all();
  res.json(commandes);
});

app.post('/api/commandes/:num/statut',(req,res)=>{
  const cmd=db.prepare('UPDATE commandes SET statut=? WHERE numero=?').run(req.body.statut,req.params.num);
  res.json({ok:true});
});

app.use(express.static(path.join(__dirname,'public')));

app.get('/',(req,res)=>res.redirect('/admin.html'));

app.listen(3000,()=>console.log('EasyOrder demarre sur http://localhost:3000'));