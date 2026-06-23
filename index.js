const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

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
`);

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
  if(m==='2'){const mc=db.prepare('SELECT * FROM commandes WHERE telephone=? ORDER BY id DESC LIMIT 3').all(tel);if(!mc.length)return 'Aucune commande.';let r='MES COMMANDES:\n';mc.forEach(c=>r+=c.numero+' '+c.total+' FCFA - '+c.statut+'\n');return r;}
  if(m==='3')return 'Support: +237 600 000 000';
  if(s.e==='cat'&&!isNaN(m)&&m!=='0'){const p=P.find(x=>x.id===parseInt(m));if(!p)return 'Invalide';const ex=s.p.find(x=>x.id===p.id);if(ex)ex.q++;else s.p.push({...p,q:1});return p.nom+' ajoute!';}
  if(m==='0'){if(!s.p.length)return 'Panier vide';let t=0,r='PANIER:\n';s.p.forEach(p=>{t+=p.prix*p.q;r+=p.nom+' x'+p.q+'='+(p.prix*p.q)+'\n'});return r+'TOTAL:'+t+' FCFA\nTapez CONFIRMER';}
  if(m==='confirmer'){if(!s.p.length)return 'Panier vide';const t=s.p.reduce((a,p)=>a+p.prix*p.q,0);const n='CMD-'+Date.now().toString().slice(-6);const date=new Date().toLocaleDateString('fr-FR');db.prepare('INSERT OR IGNORE INTO commandes (numero,telephone,total,statut,date) VALUES (?,?,?,?,?)').run(n,tel,t,'En preparation',date);s.p=[];s.e='menu';return 'COMMANDE OK! '+n+' Total:'+t+' FCFA';}
  return 'Tapez MENU';
}

app.get('/test',(req,res)=>res.json({reponse:bot(req.query.tel||'237',req.query.msg||'bonjour')}));
app.get('/api/commandes',(req,res)=>res.json(db.prepare('SELECT * FROM commandes ORDER BY id DESC').all()));
app.post('/api/commandes/:num/statut',(req,res)=>{db.prepare('UPDATE commandes SET statut=? WHERE numero=?').run(req.body.statut,req.params.num);res.json({ok:true});});
const fs = require('fs');
app.get('/admin',(req,res)=>res.send(fs.readFileSync('admin.html','utf8')));
app.get('/',(req,res)=>res.redirect('/admin'));

const PORT=process.env.PORT||3000;
app.listen(PORT,()=>console.log('EasyOrder demarre sur port '+PORT));