/* =================== ÉTAT UI =================== */
let currentDetailId=null;
let editingId=null;
let pendingQuickAction=null; // {type:'parent'|'conjoint'|'enfant', forId}

const PERSON_ICON='<svg viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>';

let nameCounts={};
function updateNameCounts(){
  nameCounts={};
  persons.forEach(p=>{
    const n=fullName(p).trim().toLowerCase();
    nameCounts[n]=(nameCounts[n]||0)+1;
  });
}
// Contenu de l'avatar : photo, sinon génération si homonyme, sinon icône générique
function avatarHtml(p,gen){
  if(p.photo) return `<img src="${p.photo}">`;
  const n=fullName(p).trim().toLowerCase();
  if((nameCounts[n]||0)>1){
    const g=gen?gen[p.id]:computeGenerations()[p.id];
    return `<span class="avatar-gen">G${(g||0)+1}</span>`;
  }
  return PERSON_ICON;
}

/* =================== INIT =================== */
async function init(){
  persons=await dbAll();
  renderAll();
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('sw.js').catch(()=>{});
  }
}
init();

function renderAll(){
  updateNameCounts();
  renderPersonsList();
  populateTreeFilters();
  renderTree();
  renderStats();
}

/* =================== NAVIGATION =================== */
function switchView(name){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.querySelectorAll('.bottomnav button').forEach(b=>b.classList.remove('active'));
  document.getElementById('view-'+name).classList.add('active');
  document.getElementById('nav-'+name).classList.add('active');
  const fab=document.getElementById('fabAdd');
  fab.style.display = (name==='donnees') ? 'none' : 'flex';
  const titles={arbre:["Arbre Généalogique","Vue d'ensemble"],personnes:["Arbre Généalogique","Personnes"],donnees:["Arbre Généalogique","Données"]};
  document.getElementById('headerSub').textContent=titles[name][1];
  if(name==='arbre') setTimeout(renderTree,30);
}

/* =================== LISTE PERSONNES =================== */
function renderPersonsList(){
  const q=(document.getElementById('searchInput').value||'').toLowerCase().trim();
  const list=document.getElementById('personsList');
  const empty=document.getElementById('personsEmpty');
  const sorted=[...persons].sort((a,b)=>fullName(a).localeCompare(fullName(b)));
  const filtered=sorted.filter(p=>fullName(p).toLowerCase().includes(q));
  if(persons.length===0){
    empty.style.display='flex';
    list.innerHTML='';
    return;
  }
  empty.style.display='none';
  const gen=computeGenerations();
  list.innerHTML=filtered.map(p=>`
    <div class="person-row sexe-${p.sexe}" onclick="openDetail('${p.id}')">
      <div class="avatar">${avatarHtml(p,gen)}</div>
      <div class="info">
        <div class="name">${escapeHtml(fullName(p))}</div>
        <div class="meta">${personSubtitle(p)}</div>
      </div>
      <div class="gen-badge">G${(gen[p.id]||0)+1}</div>
      <div class="chev">›</div>
    </div>
  `).join('') || `<p style="text-align:center;color:var(--ink-soft);padding:30px 0;">Aucun résultat</p>`;
}


/* =================== ARBRE =================== */
let treeZoom=1; // 0=compact, 1=normal, 2=grand

let lastMaxGen=-1;
// Remplit les sélecteurs de filtre (personne ciblée + plage de générations)
function populateTreeFilters(){
  const focusSel=document.getElementById('treeFocus');
  const prevFocus=focusSel.value;
  const sortedP=[...persons].sort((a,b)=>fullName(a).localeCompare(fullName(b)));
  focusSel.innerHTML='<option value="">🌳 Arbre complet</option>'+
    sortedP.map(p=>`<option value="${p.id}">🎯 Centrer sur ${escapeHtml(fullName(p))}</option>`).join('');
  if(sortedP.some(p=>p.id===prevFocus)) focusSel.value=prevFocus;

  const fromSel=document.getElementById('genFrom'), toSel=document.getElementById('genTo');
  const prevFrom=fromSel.value, prevTo=toSel.value;
  let maxGen=0;
  if(persons.length){
    const gen=computeGenerations();
    maxGen=Math.max(...Object.values(gen));
  }
  let opts='';
  for(let g=0;g<=maxGen;g++) opts+=`<option value="${g+1}">${g+1}</option>`;
  fromSel.innerHTML=opts; toSel.innerHTML=opts;

  // Si l'utilisateur n'a pas restreint la plage (toujours "plage complète"), on la suit automatiquement
  const wasFullRange = prevFrom==='' || (prevFrom==='1' && prevTo===String(lastMaxGen+1));
  if(wasFullRange){
    fromSel.value='1';
    toSel.value=String(maxGen+1);
  }else{
    fromSel.value = (+prevFrom<=maxGen+1) ? prevFrom : '1';
    toSel.value = (+prevTo<=maxGen+1 && +prevTo>=+fromSel.value) ? prevTo : String(maxGen+1);
  }
  lastMaxGen=maxGen;
}

function onGenFilterChange(){
  const fromSel=document.getElementById('genFrom'), toSel=document.getElementById('genTo');
  if(+fromSel.value>+toSel.value) toSel.value=fromSel.value;
  renderTree();
}

function resetTreeFilters(){
  document.getElementById('treeFocus').value='';
  const fromSel=document.getElementById('genFrom'), toSel=document.getElementById('genTo');
  if(fromSel.options.length) fromSel.value=fromSel.options[0].value;
  if(toSel.options.length) toSel.value=toSel.options[toSel.options.length-1].value;
  renderTree();
}

function zoomTree(delta){
  treeZoom=Math.min(2,Math.max(0,treeZoom+delta));
  const grid=document.getElementById('treeGrid');
  grid.classList.remove('zoom-0','zoom-1','zoom-2');
  grid.classList.add('zoom-'+treeZoom);
  requestAnimationFrame(drawConnectors);
}

// Construit, pour chaque génération, une liste de "blocs" (une personne seule
// ou un groupe de conjoints) puis affine leur ordre par passes de barycentre
// (algorithme type Sugiyama) pour limiter les croisements de branches entre
// générations adjacentes — utile dès que le graphe a plusieurs ascendants/
// descendants (DAG) ou des couples répartis sur la largeur.

function renderTree(){
  const grid=document.getElementById('treeGrid');
  const emptyEl=document.getElementById('treeEmpty');
  const filteredEl=document.getElementById('treeFiltered');
  const toolbar=document.getElementById('treeToolbar');
  const infoEl=document.getElementById('treeFilterInfo');

  if(persons.length===0){
    emptyEl.style.display='flex';
    filteredEl.style.display='none';
    infoEl.style.display='none';
    toolbar.style.display='none';
    grid.innerHTML='';
    return;
  }
  toolbar.style.display='flex';
  const gen=computeGenerations();
  const maxGen=Math.max(...Object.values(gen));

  const focusId=document.getElementById('treeFocus').value;
  const fromSel=document.getElementById('genFrom'), toSel=document.getElementById('genTo');
  const genFrom=(+fromSel.value||1)-1;
  const genTo=(+toSel.value||(maxGen+1))-1;
  const focusSet = focusId ? getFocusedSet(focusId) : null;

  const byGen={};
  for(let g=0;g<=maxGen;g++) byGen[g]=[];
  persons.forEach(p=>{
    if(focusSet && !focusSet.has(p.id)) return;
    if(gen[p.id]<genFrom || gen[p.id]>genTo) return;
    byGen[gen[p.id]].push(p);
  });
  const totalShown=Object.values(byGen).reduce((s,a)=>s+a.length,0);

  const filtersActive = !!focusId || genFrom>0 || genTo<maxGen;
  if(filtersActive){
    infoEl.style.display='flex';
    infoEl.innerHTML=`<span>${totalShown} / ${persons.length} personnes affichées</span><button onclick="resetTreeFilters()">Réinitialiser</button>`;
  }else{
    infoEl.style.display='none';
  }

  if(totalShown===0){
    emptyEl.style.display='none';
    filteredEl.style.display='flex';
    grid.innerHTML='';
    return;
  }
  emptyEl.style.display='none';
  filteredEl.style.display='none';

  // Layout en couches (type Sugiyama) : ordonne les blocs (personne ou couple)
  // de chaque génération pour minimiser les croisements de branches
  const layers=buildLayoutLayers(byGen, maxGen);

  let html='';
  for(let g=0;g<=maxGen;g++){
    if(layers[g].length===0) continue;
    html+=`<div class="gen-row" data-gen="${g}"><div class="gen-label">Génération ${g+1}</div>`;
    layers[g].forEach(block=>{
      if(block.length>=2){
        html+='<div class="couple">';
        block.forEach((id,idx)=>{
          html+=cardHtml(byId(id),focusId,gen);
          if(idx<block.length-1) html+='<span class="heart">♥</span>';
        });
        html+='</div>';
      }else{
        html+=cardHtml(byId(block[0]),focusId,gen);
      }
    });
    html+='</div>';
  }
  grid.className='tree-grid zoom-'+treeZoom;
  grid.innerHTML = `<svg class="connectors" id="connSvg"></svg>` + html;
  requestAnimationFrame(drawConnectors);
}

function cardHtml(p,focusId,gen){
  const cls = (focusId && p.id===focusId) ? ' focus-root' : '';
  return `<div class="card sexe-${p.sexe}${cls}" data-id="${p.id}" onclick="openDetail('${p.id}')">
    <div class="avatar">${avatarHtml(p,gen)}</div>
    <div class="name">${escapeHtml(fullName(p))}</div>
  </div>`;
}

function drawConnectors(){
  const container=document.getElementById('treeGrid');
  const svg=document.getElementById('connSvg');
  if(!container||!svg) return;
  const cRect=container.getBoundingClientRect();
  svg.setAttribute('width',container.scrollWidth);
  svg.setAttribute('height',container.scrollHeight);
  svg.innerHTML='';
  const cards={};
  container.querySelectorAll('.card').forEach(el=>{cards[el.dataset.id]=el;});

  function center(el){
    const r=el.getBoundingClientRect();
    return {
      x:r.left-cRect.left+r.width/2,
      top:r.top-cRect.top,
      bottom:r.top-cRect.top+r.height,
      y:r.top-cRect.top+r.height/2
    };
  }
  // parent -> child branches
  persons.forEach(p=>{
    const childEl=cards[p.id];
    if(!childEl || !p.parents || p.parents.length===0) return;
    const parentEls=p.parents.map(pid=>cards[pid]).filter(Boolean);
    if(parentEls.length===0) return;
    let sumX=0,sumY=0;
    parentEls.forEach(el=>{const c=center(el); sumX+=c.x; sumY+=c.bottom;});
    const px=sumX/parentEls.length, py=sumY/parentEls.length;
    const cc=center(childEl);
    const midY=(py+cc.top)/2;
    const path=document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d',`M ${px} ${py} C ${px} ${midY}, ${cc.x} ${midY}, ${cc.x} ${cc.top}`);
    path.setAttribute('class','branch');
    svg.appendChild(path);
  });
  // couple union lines
  const drawn=new Set();
  persons.forEach(p=>{
    (p.conjoints||[]).forEach(cid=>{
      const key=[p.id,cid].sort().join('|');
      if(drawn.has(key)) return; drawn.add(key);
      const a=cards[p.id], b=cards[cid];
      if(!a||!b) return;
      const ca=center(a), cb=center(b);
      const line=document.createElementNS('http://www.w3.org/2000/svg','line');
      line.setAttribute('x1',ca.x);line.setAttribute('y1',ca.y);
      line.setAttribute('x2',cb.x);line.setAttribute('y2',cb.y);
      line.setAttribute('class','union');
      svg.appendChild(line);
    });
  });
}
window.addEventListener('resize',()=>{ if(document.getElementById('view-arbre').classList.contains('active')) drawConnectors(); });

// Liaisons adaptatives : redessiner dès que la taille de l'arbre ou de la fenêtre change
if(typeof ResizeObserver!=='undefined'){
  let roTimer=null;
  const treeResizeObserver=new ResizeObserver(()=>{
    if(!document.getElementById('view-arbre').classList.contains('active')) return;
    clearTimeout(roTimer);
    roTimer=setTimeout(drawConnectors,80);
  });
  window.addEventListener('load',()=>{
    treeResizeObserver.observe(document.getElementById('treeScroll'));
    treeResizeObserver.observe(document.getElementById('treeGrid'));
  });
}
window.addEventListener('orientationchange',()=>{
  setTimeout(()=>{ if(document.getElementById('view-arbre').classList.contains('active')) drawConnectors(); },200);
});

/* =================== STATS =================== */
function renderStats(){
  document.getElementById('statCount').textContent=persons.length;
  if(persons.length===0){document.getElementById('statGen').textContent='0';return;}
  const gen=computeGenerations();
  document.getElementById('statGen').textContent=(Math.max(...Object.values(gen))+1);
}

/* =================== DÉTAIL =================== */
function openDetail(id){
  currentDetailId=id;
  const p=byId(id);
  if(!p) return;
  document.getElementById('detailAvatar').innerHTML = avatarHtml(p);
  document.getElementById('detailName').textContent=fullName(p);
  let dates=dateRange(p);
  if(p.lieu) dates += (dates?' · ':'')+p.lieu;
  document.getElementById('detailDates').textContent=dates;
  document.getElementById('detailNotes').textContent=p.notes||'';
  document.getElementById('detailOverlay').classList.add('active');
}
function closeDetail(){
  document.getElementById('detailOverlay').classList.remove('active');
  currentDetailId=null;
}
function deleteCurrentPerson(){
  if(!currentDetailId) return;
  const p=byId(currentDetailId);
  if(!confirm(`Supprimer ${fullName(p)} ? Les liens familiaux vers cette personne seront aussi retirés.`)) return;
  const id=currentDetailId;
  persons=persons.filter(x=>x.id!==id);
  persons.forEach(x=>{
    x.parents=(x.parents||[]).filter(pid=>pid!==id);
    x.conjoints=(x.conjoints||[]).filter(cid=>cid!==id);
  });
  Promise.all(persons.map(x=>dbPut(x))).then(()=>dbDelete(id)).then(()=>{
    closeDetail(); renderAll(); showToast('Personne supprimée');
  });
}
function editCurrentPerson(){
  const id=currentDetailId;
  closeDetail();
  openPersonForm(id);
}
function quickAdd(type){
  pendingQuickAction={type,forId:currentDetailId};
  closeDetail();
  openPersonForm(null);
}
function focusInTree(){
  const id=currentDetailId;
  closeDetail();
  switchView('arbre');
  populateTreeFilters();
  document.getElementById('treeFocus').value=id;
  renderTree();
}

/* =================== FORMULAIRE =================== */
function fillSelect(sel,excludeId,placeholder){
  sel.innerHTML=`<option value="">${placeholder}</option>`+
    persons.filter(p=>p.id!==excludeId).sort((a,b)=>fullName(a).localeCompare(fullName(b)))
      .map(p=>`<option value="${p.id}">${escapeHtml(fullName(p))}</option>`).join('');
}

function openPersonForm(id=null){
  editingId=id;
  const form=document.getElementById('personForm');
  form.reset();
  document.getElementById('formAvatarPreview').innerHTML='＋';
  document.getElementById('formAvatarPreview').dataset.photo='';
  document.getElementById('conjointChips').innerHTML='';
  document.getElementById('conjointChips').dataset.ids='[]';

  const excludeId = id || (pendingQuickAction?pendingQuickAction.forId:null);
  fillSelect(document.getElementById('formParent1'), id, 'Parent 1 (aucun)');
  fillSelect(document.getElementById('formParent2'), id, 'Parent 2 (aucun)');
  fillSelect(document.getElementById('formConjointAdd'), id, '+ Ajouter un conjoint');

  if(id){
    const p=byId(id);
    document.getElementById('formTitle').textContent='Modifier '+fullName(p);
    document.getElementById('formPrenom').value=p.prenom||'';
    document.getElementById('formNom').value=p.nom||'';
    document.getElementById('formSexe').value=p.sexe||'H';
    document.getElementById('formNaissance').value=p.naissance||'';
    document.getElementById('formDeces').value=p.deces||'';
    document.getElementById('formLieu').value=p.lieu||'';
    document.getElementById('formGenManuel').value=(typeof p.genManuel==='number')?(p.genManuel+1):'';
    document.getElementById('formNotes').value=p.notes||'';
    document.getElementById('formParent1').value=(p.parents&&p.parents[0])||'';
    document.getElementById('formParent2').value=(p.parents&&p.parents[1])||'';
    if(p.photo){
      document.getElementById('formAvatarPreview').innerHTML=`<img src="${p.photo}">`;
      document.getElementById('formAvatarPreview').dataset.photo=p.photo;
    }
    (p.conjoints||[]).forEach(cid=>addConjointChip(cid));
  } else {
    document.getElementById('formTitle').textContent='Ajouter une personne';
    document.getElementById('formSexe').value='H';
    // pré-remplissage selon action rapide
    if(pendingQuickAction){
      const ref=byId(pendingQuickAction.forId);
      if(pendingQuickAction.type==='enfant' && ref){
        document.getElementById('formParent1').value=ref.id;
        if(ref.conjoints && ref.conjoints[0]) document.getElementById('formParent2').value=ref.conjoints[0];
      }
      if(pendingQuickAction.type==='conjoint' && ref){
        addConjointChip(ref.id);
      }
      // pour 'parent', le lien sera créé après sauvegarde (étape suivante)
    }
  }
  document.getElementById('formOverlay').classList.add('active');
}
function closeForm(){
  document.getElementById('formOverlay').classList.remove('active');
  editingId=null;
  pendingQuickAction=null;
}

function onPhotoChange(input){
  const file=input.files[0];
  if(!file) return;
  const reader=new FileReader();
  reader.onload=e=>{
    const img=new Image();
    img.onload=()=>{
      const max=240;
      let {width,height}=img;
      if(width>height && width>max){height*=max/width;width=max;}
      else if(height>=width && height>max){width*=max/height;height=max;}
      const canvas=document.createElement('canvas');
      canvas.width=width;canvas.height=height;
      canvas.getContext('2d').drawImage(img,0,0,width,height);
      const dataUrl=canvas.toDataURL('image/jpeg',0.75);
      document.getElementById('formAvatarPreview').innerHTML=`<img src="${dataUrl}">`;
      document.getElementById('formAvatarPreview').dataset.photo=dataUrl;
    };
    img.src=e.target.result;
  };
  reader.readAsDataURL(file);
}

function addConjointChip(id){
  if(!id) return;
  const chips=document.getElementById('conjointChips');
  let ids=JSON.parse(chips.dataset.ids||'[]');
  if(ids.includes(id)) return;
  ids.push(id);
  chips.dataset.ids=JSON.stringify(ids);
  renderConjointChips();
}
function removeConjointChip(id){
  const chips=document.getElementById('conjointChips');
  let ids=JSON.parse(chips.dataset.ids||'[]');
  ids=ids.filter(x=>x!==id);
  chips.dataset.ids=JSON.stringify(ids);
  renderConjointChips();
}
function renderConjointChips(){
  const chips=document.getElementById('conjointChips');
  const ids=JSON.parse(chips.dataset.ids||'[]');
  chips.innerHTML=ids.map(id=>{
    const p=byId(id);
    const name=p?fullName(p):'(nouveau)';
    return `<span class="chip">${escapeHtml(name)} <button type="button" onclick="removeConjointChip('${id}')">×</button></span>`;
  }).join('');
}

async function savePerson(e){
  e.preventDefault();
  const id=editingId||uid();
  const conjointIds=JSON.parse(document.getElementById('conjointChips').dataset.ids||'[]');
  const parents=[document.getElementById('formParent1').value,document.getElementById('formParent2').value].filter(Boolean);

  const data={
    id,
    prenom:document.getElementById('formPrenom').value.trim(),
    nom:document.getElementById('formNom').value.trim(),
    sexe:document.getElementById('formSexe').value,
    naissance:document.getElementById('formNaissance').value,
    deces:document.getElementById('formDeces').value,
    lieu:document.getElementById('formLieu').value.trim(),
    genManuel:(()=>{ const v=document.getElementById('formGenManuel').value; return v===''?null:(parseInt(v,10)-1); })(),
    notes:document.getElementById('formNotes').value.trim(),
    photo:document.getElementById('formAvatarPreview').dataset.photo||'',
    parents,
    conjoints: editingId ? (byId(editingId).conjoints||[]).slice() : []
  };

  // gérer les conjoints (relation bidirectionnelle)
  const previousConjoints = editingId ? (byId(editingId).conjoints||[]).slice() : [];
  data.conjoints = conjointIds.slice();

  if(!editingId){
    persons.push(data);
  } else {
    const idx=persons.findIndex(p=>p.id===id);
    persons[idx]=data;
  }

  // retirer ce lien chez les anciens conjoints qui ne sont plus sélectionnés
  previousConjoints.filter(c=>!conjointIds.includes(c)).forEach(cid=>{
    const c=byId(cid);
    if(c) c.conjoints=(c.conjoints||[]).filter(x=>x!==id);
  });
  // ajouter le lien chez les nouveaux conjoints
  conjointIds.forEach(cid=>{
    const c=byId(cid);
    if(c && !(c.conjoints||[]).includes(id)){
      c.conjoints=c.conjoints||[];
      c.conjoints.push(id);
    }
  });

  // action rapide : lien "ajouter un parent" / "ajouter un enfant" depuis le détail
  if(!editingId && pendingQuickAction){
    const ref=byId(pendingQuickAction.forId);
    if(ref){
      if(pendingQuickAction.type==='parent'){
        ref.parents=ref.parents||[];
        if(ref.parents.length<2 && !ref.parents.includes(id)) ref.parents.push(id);
      }
      if(pendingQuickAction.type==='enfant'){
        // déjà géré via parents pré-remplis dans le formulaire
      }
    }
  }

  // sauvegarder toutes les personnes modifiées
  const toSave=new Set([id]);
  previousConjoints.forEach(c=>toSave.add(c));
  conjointIds.forEach(c=>toSave.add(c));
  if(pendingQuickAction) toSave.add(pendingQuickAction.forId);
  for(const pid of toSave){
    const pp=byId(pid);
    if(pp) await dbPut(pp);
  }

  closeForm();
  renderAll();
  showToast('Enregistré ✓');
}

/* =================== EXPORT / IMPORT =================== */

async function shareOrDownload(blob, filename, title){
  const file=new File([blob],filename,{type:blob.type});
  if(navigator.canShare && navigator.canShare({files:[file]})){
    try{
      await navigator.share({files:[file],title});
      return;
    }catch(e){ /* annulé ou non supporté -> fallback */ }
  }
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url; a.download=filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

async function exportData(){
  const payload={app:'arbre-genealogique',version:1,exportedAt:new Date().toISOString(),persons};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
  await shareOrDownload(blob,`arbre-genealogique-${dateStamp()}.json`,'Sauvegarde Arbre Généalogique');
  showToast('Fichier exporté');
}
function dateStamp(){
  const d=new Date();
  return d.toISOString().slice(0,10);
}

function importData(file){
  if(!file) return;
  const reader=new FileReader();
  reader.onload=async e=>{
    try{
      const data=JSON.parse(e.target.result);
      const list=Array.isArray(data)?data:data.persons;
      if(!Array.isArray(list)) throw new Error('format invalide');
      if(!confirm(`Importer ${list.length} personne(s) ? Cela remplacera toutes les données actuelles.`)) return;
      await dbBulkReplace(list);
      persons=list;
      renderAll();
      switchView('personnes');
      showToast('Importation réussie ✓');
    }catch(err){
      alert('Fichier invalide : '+err.message);
    }
  };
  reader.readAsText(file);
  document.getElementById('importFile').value='';
}

/* ---- GEDCOM ---- */

async function exportGedcom(){
  const lines=buildGedcomLines(persons);
  const blob=new Blob([lines.join('\r\n')],{type:'text/plain'});
  await shareOrDownload(blob,`arbre-genealogique-${dateStamp()}.ged`,'Export GEDCOM');
  showToast('Fichier GEDCOM exporté');
}

function importGedcom(file){
  if(!file) return;
  const reader=new FileReader();
  reader.onload=async e=>{
    try{
      const records=parseGedcomLines(e.target.result);
      const list=gedcomToPersons(records);
      if(list.length===0) throw new Error('aucune personne trouvée');
      if(!confirm(`Importer ${list.length} personne(s) depuis ce fichier GEDCOM ? Cela remplacera toutes les données actuelles.`)) return;
      await dbBulkReplace(list);
      persons=list;
      renderAll();
      switchView('personnes');
      showToast('Importation GEDCOM réussie ✓');
    }catch(err){
      alert('Fichier GEDCOM invalide : '+err.message);
    }
  };
  reader.readAsText(file);
  document.getElementById('importGedFile').value='';
}


function exportPdf(){
  const gen=computeGenerations();
  const byGen={};
  persons.forEach(p=>{ (byGen[gen[p.id]]=byGen[gen[p.id]]||[]).push(p); });
  const gens=Object.keys(byGen).map(Number).sort((a,b)=>a-b);

  let html=`<h1>Arbre Généalogique</h1><p class="print-date">Généré le ${new Date().toLocaleDateString('fr-FR')} — ${persons.length} personne(s)</p>`;
  gens.forEach(g=>{
    html+=`<h2>Génération ${g+1}</h2><table><thead><tr><th>Nom</th><th>Dates</th><th>Lieu</th><th>Filiation</th></tr></thead><tbody>`;
    byGen[g].slice().sort((a,b)=>fullName(a).localeCompare(fullName(b),'fr')).forEach(p=>{
      const parentsNames=(p.parents||[]).map(pid=>{ const pp=byId(pid); return pp?fullName(pp):''; }).filter(Boolean).join(' & ');
      const conjointsNames=(p.conjoints||[]).map(cid=>{ const c=byId(cid); return c?fullName(c):''; }).filter(Boolean).join(', ');
      let filiation='';
      if(parentsNames) filiation+='Enfant de '+parentsNames+'. ';
      if(conjointsNames) filiation+='Conjoint(e) de '+conjointsNames+'.';
      html+=`<tr><td>${escapeHtml(fullName(p))}</td><td>${escapeHtml(dateRange(p))}</td><td>${escapeHtml(p.lieu||'')}</td><td>${escapeHtml(filiation)}</td></tr>`;
    });
    html+=`</tbody></table>`;
  });

  document.getElementById('printArea').innerHTML=html;
  window.print();
}

async function resetAll(){
  if(!confirm("Supprimer toutes les personnes de l'arbre ? Cette action est irréversible.")) return;
  await dbClear();
  persons=[];
  renderAll();
  showToast('Données effacées');
}

/* =================== TOAST =================== */
let toastTimer=null;
function showToast(msg){
  const t=document.getElementById('toast');
  t.textContent=msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>t.classList.remove('show'),2000);
}
