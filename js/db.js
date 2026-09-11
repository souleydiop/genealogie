/* =================== STOCKAGE (IndexedDB) =================== */
// v2 : ajout des stores "projets" (un arbre = un projet) et "meta" (petites clés/valeurs,
// ex. projet actif). Les fonctions génériques prennent un store en dernier paramètre
// optionnel (par défaut STORE_PERSONS) pour rester compatibles avec le code existant.
const DB_NAME='genealogie_db', DB_VERSION=2;
const STORE_PERSONS='personnes', STORE_PROJETS='projets', STORE_META='meta';
let db=null;

function openDB(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded=e=>{
      const d=e.target.result;
      if(!d.objectStoreNames.contains(STORE_PERSONS)) d.createObjectStore(STORE_PERSONS,{keyPath:'id'});
      if(!d.objectStoreNames.contains(STORE_PROJETS)) d.createObjectStore(STORE_PROJETS,{keyPath:'id'});
      if(!d.objectStoreNames.contains(STORE_META)) d.createObjectStore(STORE_META,{keyPath:'key'});
    };
    req.onsuccess=e=>resolve(e.target.result);
    req.onerror=e=>reject(e);
  });
}
async function dbAll(store=STORE_PERSONS){
  db=db||await openDB();
  return new Promise((res,rej)=>{
    const tx=db.transaction(store,'readonly');
    const r=tx.objectStore(store).getAll();
    r.onsuccess=()=>res(r.result);
    r.onerror=e=>rej(e);
  });
}
async function dbPut(item, store=STORE_PERSONS){
  db=db||await openDB();
  return new Promise((res,rej)=>{
    const tx=db.transaction(store,'readwrite');
    tx.objectStore(store).put(item);
    tx.oncomplete=()=>res();
    tx.onerror=e=>rej(e);
  });
}
async function dbDelete(id, store=STORE_PERSONS){
  db=db||await openDB();
  return new Promise((res,rej)=>{
    const tx=db.transaction(store,'readwrite');
    tx.objectStore(store).delete(id);
    tx.oncomplete=()=>res();
    tx.onerror=e=>rej(e);
  });
}
async function dbClear(store=STORE_PERSONS){
  db=db||await openDB();
  return new Promise((res,rej)=>{
    const tx=db.transaction(store,'readwrite');
    tx.objectStore(store).clear();
    tx.oncomplete=()=>res();
    tx.onerror=e=>rej(e);
  });
}
async function dbBulkReplace(list, store=STORE_PERSONS){
  db=db||await openDB();
  return new Promise((res,rej)=>{
    const tx=db.transaction(store,'readwrite');
    const s=tx.objectStore(store);
    s.clear();
    list.forEach(p=>s.put(p));
    tx.oncomplete=()=>res();
    tx.onerror=e=>rej(e);
  });
}
// Remplace uniquement les personnes d'UN projet (les autres projets ne sont pas touchés) —
// contrairement à dbBulkReplace qui vide tout le store.
async function dbReplaceProjectPersons(projetId, list){
  db=db||await openDB();
  return new Promise((res,rej)=>{
    const tx=db.transaction(STORE_PERSONS,'readwrite');
    const s=tx.objectStore(STORE_PERSONS);
    const req=s.openCursor();
    req.onsuccess=e=>{
      const c=e.target.result;
      if(c){ if(c.value.projetId===projetId) c.delete(); c.continue(); }
      else { list.forEach(p=>s.put(Object.assign({},p,{projetId}))); }
    };
    tx.oncomplete=()=>res();
    tx.onerror=e=>rej(e);
  });
}
async function dbGetMeta(key){
  const all=await dbAll(STORE_META);
  const row=all.find(r=>r.key===key);
  return row?row.value:undefined;
}
async function dbSetMeta(key, value){
  return dbPut({key,value}, STORE_META);
}

if(typeof module!=='undefined') module.exports={
  openDB,dbAll,dbPut,dbDelete,dbClear,dbBulkReplace,dbReplaceProjectPersons,dbGetMeta,dbSetMeta,
  STORE_PERSONS,STORE_PROJETS,STORE_META
};
