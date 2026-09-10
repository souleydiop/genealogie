/* =================== ÉTAT PARTAGÉ =================== */
let persons=[]; // {id,prenom,nom,sexe,naissance,deces,lieu,photo,parents:[],conjoints:[],notes}

/* =================== LOGIQUE MÉTIER (pure, sans DOM) =================== */
function uid(){return 'p_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8);}
function byId(id){return persons.find(p=>p.id===id);}
function fullName(p){return [p.prenom,p.nom].filter(Boolean).join(' ');}

function yearOf(d){return d?d.slice(0,4):'';}
function dateRange(p){
  const n=yearOf(p.naissance), d=yearOf(p.deces);
  if(!n && !d) return '';
  if(n && !d) return n+' – présent';
  if(n && d) return n+' – '+d;
  return '? – '+d;
}


function personSubtitle(p){
  const parts=[];
  const dr=dateRange(p);
  if(dr) parts.push(dr);
  if(p.lieu) parts.push(p.lieu);
  const parentNames=(p.parents||[]).map(pid=>byId(pid)).filter(Boolean).map(fullName);
  if(parentNames.length){
    const rel = p.sexe==='F' ? 'Fille de' : p.sexe==='H' ? 'Fils de' : 'Enfant de';
    parts.push(rel+' '+parentNames.join(' & '));
  }
  return parts.join(' · ')||'\u00A0';
}

function escapeHtml(s){
  return (s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}


function computeGenerations(){
  const gen={};
  persons.forEach(p=>gen[p.id]=(typeof p.genManuel==='number' ? p.genManuel : 0));

  // 1) Remonte la génération d'un enfant si elle est inférieure à celle de ses parents + 1
  function recomputeFromParents(){
    let changed=false;
    persons.forEach(p=>{
      if(p.parents && p.parents.length){
        let max=-1;
        p.parents.forEach(pid=>{ if(byId(pid)) max=Math.max(max,gen[pid]); });
        if(max>=0 && gen[p.id]<max+1){ gen[p.id]=max+1; changed=true; }
      }
    });
    return changed;
  }

  // 2) Aligne une personne sans parents connus sur la génération de son/ses conjoint(s)
  //    (sinon elle resterait toujours en génération 1, désaligné des liaisons)
  function alignRootsToSpouses(){
    let changed=false;
    persons.forEach(p=>{
      if(!p.parents || p.parents.length===0){
        (p.conjoints||[]).forEach(cid=>{
          if(byId(cid) && gen[cid]>gen[p.id]){ gen[p.id]=gen[cid]; changed=true; }
        });
      }
    });
    return changed;
  }

  // Itère jusqu'à stabilisation (bornée par le nombre de personnes)
  for(let i=0;i<persons.length+2;i++){
    const c1=recomputeFromParents();
    const c2=alignRootsToSpouses();
    if(!c1 && !c2) break;
  }
  return gen;
}

// Ancêtres + descendants + conjoints autour d'une personne (vue centrée)
function getFocusedSet(focusId){
  if(!byId(focusId)) return null;
  const include=new Set([focusId]);
  function addAncestors(id){
    const p=byId(id);
    (p.parents||[]).forEach(pid=>{
      if(byId(pid) && !include.has(pid)){ include.add(pid); addAncestors(pid); }
    });
  }
  function addDescendants(id){
    persons.filter(x=>(x.parents||[]).includes(id)).forEach(c=>{
      if(!include.has(c.id)){ include.add(c.id); addDescendants(c.id); }
    });
  }
  addAncestors(focusId);
  addDescendants(focusId);
  // conjoints des personnes incluses, pour le contexte
  Array.from(include).forEach(id=>{
    const p=byId(id);
    (p.conjoints||[]).forEach(cid=>{ if(byId(cid)) include.add(cid); });
  });
  return include;
}


function buildLayoutLayers(byGen, maxGen){
  const layers=[];
  for(let g=0;g<=maxGen;g++){
    const arr=[...byGen[g]];
    arr.sort((a,b)=>{
      const pa=(a.parents&&a.parents[0])||'', pb=(b.parents&&b.parents[0])||'';
      if(pa!==pb) return pa.localeCompare(pb);
      return fullName(a).localeCompare(fullName(b));
    });
    const idsInLayer=new Set(arr.map(p=>p.id));
    const placed=new Set();
    const blocks=[];
    arr.forEach(p=>{
      if(placed.has(p.id)) return;
      const block=[p.id]; placed.add(p.id);
      (p.conjoints||[]).forEach(cid=>{
        if(idsInLayer.has(cid) && !placed.has(cid)){ block.push(cid); placed.add(cid); }
      });
      blocks.push(block);
    });
    layers.push(blocks);
  }

  const shownIds=new Set();
  layers.forEach(l=>l.forEach(b=>b.forEach(id=>shownIds.add(id))));

  function childrenOf(id){
    return persons.filter(x=>shownIds.has(x.id) && (x.parents||[]).includes(id)).map(x=>x.id);
  }
  function posMap(layer){
    const m={};
    layer.forEach((block,idx)=>block.forEach(id=>m[id]=idx));
    return m;
  }
  function pass(g, refLayer, useParents){
    const refPos=posMap(refLayer);
    const withBary=layers[g].map((block,idx)=>{
      let sum=0,count=0;
      block.forEach(id=>{
        const p=byId(id);
        const neighbors = useParents ? (p.parents||[]).filter(nid=>shownIds.has(nid)) : childrenOf(id);
        neighbors.forEach(nid=>{ if(refPos[nid]!==undefined){ sum+=refPos[nid]; count++; } });
      });
      return {block, bary: count?sum/count:idx};
    });
    withBary.sort((a,b)=>a.bary-b.bary);
    layers[g]=withBary.map(x=>x.block);
  }

  const passes=4;
  for(let it=0;it<passes;it++){
    if(it%2===0){
      for(let g=1;g<=maxGen;g++) if(layers[g-1]) pass(g, layers[g-1], true);
    }else{
      for(let g=maxGen-1;g>=0;g--) if(layers[g+1]) pass(g, layers[g+1], false);
    }
  }
  return layers;
}

// Helpers réservés aux tests (Node) : permettent d'injecter un jeu de données
// sans dépendre du DOM/IndexedDB, puisque `persons` est autrement alimenté par app.js.
function _setPersons(list){ persons=list; }
function _getPersons(){ return persons; }

if(typeof module!=='undefined') module.exports={uid,byId,fullName,yearOf,dateRange,escapeHtml,personSubtitle,computeGenerations,getFocusedSet,buildLayoutLayers,_setPersons,_getPersons};
