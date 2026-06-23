const express = require('express');
const fs = require('fs');

const app = express();
app.use(express.json());

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

const P=[
  {id:1,nom:'Castel 65cl',prix:500},
  {id:2,nom:'Beaufort 65cl',prix:500},
  {id:3,nom:'Malta 65cl',prix:400},
  {id:4,nom:'CocaCola 50cl',prix:400},
  {id:5,nom:'Supermont 1.5L',prix:300}
];

const S={};
function gs(t){if(!S[t])S[t]={e:'menu',p:[]};return S[t];}

function bot(tel,msg){
  const s=gs(tel);
  const m=String(msg).trim().toLowerCase();
  if(m==='bonjour'||m==='menu'){s.e='menu';return 'Bienvenue EasyOrder Cameroun!\n1 COMMANDER\n2 MES COMMANDES\n3 CONTACT';}
  if(m==='commander'){s.e='cat';s.p=[];let r='CATALOGUE:\n';P.forEach(x=>r+=x.id+'. '+x.nom+' '+x.prix+' FCFA\n');return r+'0=panier CONFIRMER=valider';}
  if(m==='3')return 'Support: +237 600 000 000';
  if(s.e==='cat'&&!isNaN(m)&&m!=='0'){const p=P.find(x=>x.id===parseInt(m));if(!p)return 'Invalide';const ex=s.p.find(x=>x.id===p.id);if(ex)ex.q++;else s.p.push({...p,q:1});return p.nom+' ajoute!';}
  if(m==='0'){if(!s.p.length)return 'Panier vide';let t=0,r='PANIER:\n';s.p.forEach(p=>{t+=p.prix*p.q;r+=p.nom+' x'+p.q+'='+(p.prix*p.q)+'\n'});return r+'TOTAL:'+t+' FCFA\nTapez CONFIRMER';}
  if(m==='confirmer'){
    if(!s.p.length)return 'Panier vide';
    const t=s.p.reduce((a,p)=>a+p.prix*p.q,0);
    const n='CMD-'+Date.now().toString().slice(-6);
    const date=new Date().toLocaleDateString('fr-FR');
    insertCommande(n,tel,t,date);
    s.p=[];s.e='menu';
    return 'COMMANDE OK! '+n+' Total:'+t+' FCFA';
  }
  return 'Tapez MENU';
}

app.get('/test',(req,res)=>res.json({reponse:bot(req.query.tel||'237',req.query.msg||'bonjour')}));
app.get('/api/commandes',async(req,res)=>res.json(await getCommandes()));
app.post('/api/commandes/:num/statut',async(req,res)=>{await updateStatut(req.params.num,req.body.statut);res.json({ok:true});});
app.get('/admin',(req,res)=>res.send(fs.readFileSync('admin.html','utf8')));
app.get('/',(req,res)=>res.redirect('/admin'));

const PORT=process.env.PORT||3000;
app.listen(PORT,()=>console.log('EasyOrder demarre sur port '+PORT));