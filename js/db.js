/* =================== STOCKAGE (IndexedDB) =================== */
/* =================== STOCKAGE (IndexedDB) =================== */
const DB_NAME='genealogie_db', STORE='personnes';
let db=null;
function openDB(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,1);
    req.onupgradeneeded=e=>{
      const d=e.target.result;
      if(!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE,{keyPath:'id'});
    };
    req.onsuccess=e=>resolve(e.target.result);
    req.onerror=e=>reject(e);
  });
}
async function dbAll(){
  db=db||await openDB();
  return new Promise((res,rej)=>{
    const tx=db.transaction(STORE,'readonly');
    const r=tx.objectStore(STORE).getAll();
    r.onsuccess=()=>res(r.result);
    r.onerror=e=>rej(e);
  });
}
async function dbPut(p){
  db=db||await openDB();
  return new Promise((res,rej)=>{
    const tx=db.transaction(STORE,'readwrite');
    tx.objectStore(STORE).put(p);
    tx.oncomplete=()=>res();
    tx.onerror=e=>rej(e);
  });
}
async function dbDelete(id){
  db=db||await openDB();
  return new Promise((res,rej)=>{
    const tx=db.transaction(STORE,'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete=()=>res();
    tx.onerror=e=>rej(e);
  });
}
async function dbClear(){
  db=db||await openDB();
  return new Promise((res,rej)=>{
    const tx=db.transaction(STORE,'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete=()=>res();
    tx.onerror=e=>rej(e);
  });
}
async function dbBulkReplace(list){
  db=db||await openDB();
  return new Promise((res,rej)=>{
    const tx=db.transaction(STORE,'readwrite');
    const store=tx.objectStore(STORE);
    store.clear();
    list.forEach(p=>store.put(p));
    tx.oncomplete=()=>res();
    tx.onerror=e=>rej(e);
  });
}


if(typeof module!=='undefined') module.exports={openDB,dbAll,dbPut,dbDelete,dbClear,dbBulkReplace};
