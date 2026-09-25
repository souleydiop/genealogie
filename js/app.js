/* =================== ÉTAT UI =================== */
let currentDetailId=null;
let editingId=null;
let pendingQuickAction=null; // {type:'parent'|'conjoint'|'enfant', forId}
let projets=[];
let currentProjetId=null;

const PERSON_ICON='<svg viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>';

let nameCounts={};
function updateNameCounts(){
  nameCounts={};
  persons.forEach(p=>{
    const n=fullName(p).trim().toLowerCase();
    nameCounts[n]=(nameCounts[n]||0)+1;
  });
}
// Contenu de l'avatar : photo, sinon génération si homonyme, sinon symbole homme/femme
// (ou icône générique si le sexe n'est pas renseigné)
function avatarHtml(p,gen){
  if(p.photo) return `<img src="${p.photo}">`;
  const n=fullName(p).trim().toLowerCase();
  if((nameCounts[n]||0)>1){
    const g=gen?gen[p.id]:computeGenerations()[p.id];
    return `<span class="avatar-gen">G${(g||0)+1}</span>`;
  }
  if(p.sexe==='H') return '<span class="avatar-symbol">♂</span>';
  if(p.sexe==='F') return '<span class="avatar-symbol">♀</span>';
  return PERSON_ICON;
}

/* =================== INIT =================== */
async function init(){
  await ensureProjets();
  await reloadPersonsForProjet();
  updateHeaderTitle();
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
  const titles={arbre:"Vue d'ensemble",personnes:"Personnes",donnees:"Données"};
  document.getElementById('headerSub').textContent=titles[name];
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
      <div class="gen-badge">G${(gen[p.id]||0)+1}${typeof p.numero==='number'?' · #'+p.numero:''}</div>
      <div class="chev">›</div>
    </div>
  `).join('') || `<p style="text-align:center;color:var(--ink-soft);padding:30px 0;">Aucun résultat</p>`;
}


/* =================== ARBRE =================== */
let treeZoom=1; // 0=compact, 1=normal, 2=grand

let lastMaxGen=-1;
// Remplit les sélecteurs de filtre (personne ciblée + plage de générations)
function populateTreeFilters(){
  const gen=persons.length?computeGenerations():{};
  const focusSel=document.getElementById('treeFocus');
  const prevFocus=focusSel.value;
  const sortedP=[...persons].sort((a,b)=>fullName(a).localeCompare(fullName(b)));
  focusSel.innerHTML='<option value="">🌳 Arbre complet</option>'+
    sortedP.map(p=>`<option value="${p.id}">🎯 Centrer sur ${personOptionLabel(p,gen)}</option>`).join('')+
    sortedP.map(p=>`<option value="asc:${p.id}">⬆️ Ascendants de ${personOptionLabel(p,gen)}</option>`).join('');
  if(sortedP.some(p=>p.id===prevFocus)) focusSel.value=prevFocus;

  const fromSel=document.getElementById('genFrom'), toSel=document.getElementById('genTo');
  const prevFrom=fromSel.value, prevTo=toSel.value;
  let maxGen=0;
  if(persons.length){
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

  const rawFocus=document.getElementById('treeFocus').value;
  const ascMode=rawFocus.startsWith('asc:');
  const focusId=ascMode ? rawFocus.slice(4) : rawFocus;
  const fromSel=document.getElementById('genFrom'), toSel=document.getElementById('genTo');
  const genFrom=(+fromSel.value||1)-1;
  const genTo=(+toSel.value||(maxGen+1))-1;
  const focusSet = focusId ? (ascMode ? getAncestors(focusId) : getFocusedSet(focusId)) : null;

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
    const locked = layers[g].every(block=>block.some(id=>typeof byId(id).ordreGen==='number'));
    html+=`<div class="gen-row" data-gen="${g}"><div class="gen-label">Génération ${g+1}${locked?`<button class="gen-reset" onclick="resetGenOrder(${g})" title="Rétablir l\'ordre automatique">🔀</button>`:''}</div>`;
    layers[g].forEach(block=>{
      html+=`<div class="block" data-block="${block.join(',')}">`;
      html+=`<button class="drag-handle" title="Glisser pour réordonner" onpointerdown="event.stopPropagation()" onclick="event.stopPropagation()">⠿</button>`;
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
      html+='</div>';
    });
    html+='</div>';
  }
  grid.className='tree-grid zoom-'+treeZoom;
  grid.innerHTML = `<svg class="connectors" id="connSvg"></svg>` + html;
  enableDragReorder();
  requestAnimationFrame(drawConnectors);
}

/* ---- Glisser-déposer pour réordonner une génération (Pointer Events, tactile inclus) ---- */
let _dragCtx=null;
function enableDragReorder(){
  document.querySelectorAll('.drag-handle').forEach(handle=>{
    handle.onpointerdown=e=>startBlockDrag(e, handle.closest('.block'), handle.closest('.gen-row'));
  });
}
function startBlockDrag(e, blockEl, rowEl){
  e.preventDefault();
  blockEl.setPointerCapture(e.pointerId);
  blockEl.classList.add('dragging');
  _dragCtx={blockEl, rowEl, pointerId:e.pointerId};
  blockEl.onpointermove=onBlockDragMove;
  blockEl.onpointerup=endBlockDrag;
  blockEl.onpointercancel=endBlockDrag;
}
function onBlockDragMove(e){
  if(!_dragCtx) return;
  const {blockEl, rowEl}=_dragCtx;
  const siblings=[...rowEl.querySelectorAll('.block')].filter(el=>el!==blockEl);
  for(const sib of siblings){
    const r=sib.getBoundingClientRect();
    if(e.clientX>=r.left && e.clientX<=r.right && e.clientY>=r.top && e.clientY<=r.bottom){
      const before=e.clientX < r.left+r.width/2;
      rowEl.insertBefore(blockEl, before?sib:sib.nextSibling);
      break;
    }
  }
}
async function endBlockDrag(e){
  if(!_dragCtx) return;
  const {blockEl, rowEl}=_dragCtx;
  try{ blockEl.releasePointerCapture(e.pointerId); }catch(err){}
  blockEl.classList.remove('dragging');
  blockEl.onpointermove=null; blockEl.onpointerup=null; blockEl.onpointercancel=null;
  _dragCtx=null;

  const blocks=[...rowEl.querySelectorAll('.block')].map(el=>el.dataset.block.split(','));
  let ordre=0;
  for(const ids of blocks){
    for(const id of ids){
      const p=byId(id);
      if(p){ p.ordreGen=ordre; await dbPut(p); }
    }
    ordre+=10;
  }
  await reloadPersonsForProjet();
  renderTree();
  showToast('Ordre enregistré pour cette génération');
}
async function resetGenOrder(g){
  const gen=computeGenerations();
  const membres=persons.filter(p=>gen[p.id]===Number(g) && typeof p.ordreGen==='number');
  for(const p of membres){ delete p.ordreGen; await dbPut(p); }
  await reloadPersonsForProjet();
  renderTree();
  showToast('Ordre automatique rétabli');
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
  function addLine(x1,y1,x2,y2,cssClass,color){
    const line=document.createElementNS('http://www.w3.org/2000/svg','line');
    line.setAttribute('x1',x1);line.setAttribute('y1',y1);
    line.setAttribute('x2',x2);line.setAttribute('y2',y2);
    line.setAttribute('class',cssClass);
    if(color) line.setAttribute('stroke',color);
    svg.appendChild(line);
    return line;
  }
  // Palette pour distinguer les fratries dont les traits se croisent : chaque groupe de
  // frères et sœurs a sa propre couleur plutôt qu'une seule couleur pour tout l'arbre,
  // pour rester lisible quand plusieurs liaisons s'entrelacent dans une zone chargée.
  const BRANCH_PALETTE=['#C7923A','#4F7A8B','#B5707A','#5C7C66','#8B5E3C','#7A5C99','#4A90A4','#A45C4A'];
  // parent -> enfants : tracé "chaînette" groupé par fratrie (mêmes parents) — un trait
  // vertical depuis le couple, une barre horizontale commune, puis un trait vertical par
  // enfant. Plus lisible qu'un faisceau de diagonales quand les enfants sont dispersés.
  const fratries={};
  persons.forEach(p=>{
    if(!cards[p.id] || !p.parents || p.parents.length===0) return;
    const key=p.parents.slice().sort().join(',');
    (fratries[key]=fratries[key]||[]).push(p.id);
  });
  Object.entries(fratries).forEach(([key,childIds],idx)=>{
    const parentIds=key.split(',');
    const parentEls=parentIds.map(pid=>cards[pid]).filter(Boolean);
    if(parentEls.length===0) return;
    const color=BRANCH_PALETTE[idx % BRANCH_PALETTE.length];
    let sumX=0,sumY=0;
    parentEls.forEach(el=>{const c=center(el); sumX+=c.x; sumY+=c.bottom;});
    const px=sumX/parentEls.length, py=sumY/parentEls.length;

    const childCenters=childIds.map(id=>({id,...center(cards[id])}));
    const busY=py+(childCenters[0].top-py)/2;

    addLine(px,py,px,busY,'branch',color); // trait vertical depuis le couple
    const xs=childCenters.map(c=>c.x).concat([px]);
    addLine(Math.min(...xs),busY,Math.max(...xs),busY,'branch',color); // barre horizontale

    childCenters.forEach(c=>{
      addLine(c.x,busY,c.x,c.top,'branch',color); // trait vertical vers l'enfant
      const hit=addLine(c.x,busY,c.x,c.top,'link-hit');
      hit.addEventListener('click',()=>openLinkEditSheet('branch',{childId:c.id,parentIds}));
    });
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
      const id1=p.id, id2=cid;
      const hit=document.createElementNS('http://www.w3.org/2000/svg','line');
      hit.setAttribute('x1',ca.x);hit.setAttribute('y1',ca.y);
      hit.setAttribute('x2',cb.x);hit.setAttribute('y2',cb.y);
      hit.setAttribute('class','link-hit');
      hit.addEventListener('click',()=>openLinkEditSheet('union',{id1,id2}));
      svg.appendChild(hit);
    });
  });
}
window.addEventListener('resize',()=>{ if(document.getElementById('view-arbre').classList.contains('active')) drawConnectors(); });

/* ---- Édition d'une liaison depuis l'arbre (clic sur un trait) ---- */
function openLinkEditSheet(kind, data){
  if(kind==='union'){
    const {id1,id2}=data;
    const p1=byId(id1), p2=byId(id2);
    if(!p1||!p2) return;
    openToolSheet(`
      <h2 style="margin:0 0 10px;font-size:18px;">Lien conjoint</h2>
      <p style="font-size:14px;">${escapeHtml(fullName(p1))} et ${escapeHtml(fullName(p2))} sont enregistrés comme conjoints.</p>
      <button class="btn danger block" onclick="deleteUnionLink('${id1}','${id2}')">Délier ce couple</button>
      <button class="btn outline block" style="margin-top:8px;" onclick="closeToolSheet()">Annuler</button>
    `);
  } else if(kind==='branch'){
    const {childId, parentIds}=data;
    const child=byId(childId);
    if(!child) return;
    const rows=parentIds.map(pid=>{
      const p=byId(pid);
      if(!p) return '';
      return `<div class="merge-row"><span>${escapeHtml(fullName(p))} → ${escapeHtml(fullName(child))}</span>
        <button class="icon-btn" title="Délier" onclick="deleteParentLink('${childId}','${pid}')">✕</button></div>`;
    }).join('');
    openToolSheet(`
      <h2 style="margin:0 0 10px;font-size:18px;">Lien parent → enfant</h2>
      ${rows}
      <button class="btn outline block" style="margin-top:12px;" onclick="closeToolSheet()">Fermer</button>
    `);
  }
}
async function deleteUnionLink(id1,id2){
  if(!confirm('Délier ce couple ?')) return;
  const p1=byId(id1), p2=byId(id2);
  if(p1){ p1.conjoints=(p1.conjoints||[]).filter(x=>x!==id2); await dbPut(p1); }
  if(p2){ p2.conjoints=(p2.conjoints||[]).filter(x=>x!==id1); await dbPut(p2); }
  await reloadPersonsForProjet();
  closeToolSheet();
  renderTree();
  showToast('Couple délié');
}
async function deleteParentLink(childId,parentId){
  if(!confirm('Retirer ce lien parent-enfant ?')) return;
  const child=byId(childId);
  if(child){ child.parents=(child.parents||[]).filter(x=>x!==parentId); await dbPut(child); }
  await reloadPersonsForProjet();
  closeToolSheet();
  renderTree();
  showToast('Lien retiré');
}

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
  if(typeof p.numero==='number') dates += (dates?' · ':'')+'#'+p.numero;
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
function personOptionLabel(p, gen){
  const g=gen && gen[p.id]!==undefined ? ' (G'+(gen[p.id]+1)+')' : '';
  const n=typeof p.numero==='number' ? ' #'+p.numero : '';
  return escapeHtml(fullName(p))+g+n;
}
// Tri nom puis prénom (ordre alphabétique) — utilisé dans les listes de fusion/import,
// où repérer un homonyme est plus facile en triant par nom de famille.
function parNomPrenom(a,b){
  return (a.nom||'').localeCompare(b.nom||'','fr') || (a.prenom||'').localeCompare(b.prenom||'','fr');
}
// Calcule les générations pour un lot de personnes qui n'est pas l'état courant
// (ex. l'autre projet dans l'assistant de fusion, ou un fichier importé) sans
// perturber l'état global — computeGenerations()/byId() lisent la variable
// partagée `persons`, donc on la substitue temporairement le temps du calcul.
function computeGenerationsFor(list){
  const backup=persons;
  persons=list;
  const gen=computeGenerations();
  persons=backup;
  return gen;
}

function fillSelect(sel,excludeId,placeholder){
  const gen=persons.length?computeGenerations():{};
  sel.innerHTML=`<option value="">${placeholder}</option>`+
    persons.filter(p=>p.id!==excludeId).sort((a,b)=>fullName(a).localeCompare(fullName(b)))
      .map(p=>`<option value="${p.id}">${personOptionLabel(p,gen)}</option>`).join('');
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
    projetId: editingId ? (byId(editingId).projetId||currentProjetId) : currentProjetId,
    prenom:document.getElementById('formPrenom').value.trim(),
    nom:document.getElementById('formNom').value.trim(),
    sexe:document.getElementById('formSexe').value,
    naissance:document.getElementById('formNaissance').value,
    deces:document.getElementById('formDeces').value,
    lieu:document.getElementById('formLieu').value.trim(),
    genManuel:(()=>{ const v=document.getElementById('formGenManuel').value; return v===''?null:(parseInt(v,10)-1); })(),
    ordreGen: editingId ? byId(editingId).ordreGen : undefined,
    numero: editingId ? byId(editingId).numero : await nextNumero(),
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
  await shareOrDownload(blob,`${slug((currentProjet()||{}).nom||'arbre-genealogique')}-${dateStamp()}.json`,'Sauvegarde Arbre Généalogique');
  showToast('Fichier exporté');
}
function dateStamp(){
  const d=new Date();
  return d.toISOString().slice(0,10);
}
function slug(s){
  return (s||'export').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')||'export';
}

function importData(file){
  if(!file) return;
  const reader=new FileReader();
  reader.onload=async e=>{
    try{
      const data=JSON.parse(e.target.result);
      const list=Array.isArray(data)?data:data.persons;
      if(!Array.isArray(list)) throw new Error('format invalide');
      if(!confirm(`Importer ${list.length} personne(s) ? Cela remplacera les données du projet "${(currentProjet()||{}).nom}" (les autres projets ne sont pas affectés).`)) return;
      await dbReplaceProjectPersons(currentProjetId, list);
      await reloadPersonsForProjet();
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

// Import JSON en reliant une personne du fichier à une personne déjà présente dans ce projet
// (ou sans lien, pour simplement ajouter les personnes du fichier comme nouvelles entrées).
function importDataAvecLien(file){
  if(!file) return;
  const reader=new FileReader();
  reader.onload=e=>{
    try{
      const data=JSON.parse(e.target.result);
      const list=Array.isArray(data)?data:data.persons;
      if(!Array.isArray(list) || list.length===0) throw new Error('format invalide ou vide');
      openImportLinkSheet(list, 'JSON');
    }catch(err){
      alert('Fichier invalide : '+err.message);
    }
  };
  reader.readAsText(file);
  document.getElementById('importFileLien').value='';
}

/* ---- GEDCOM ---- */

async function exportGedcom(){
  const lines=buildGedcomLines(persons);
  const blob=new Blob([lines.join('\r\n')],{type:'text/plain'});
  await shareOrDownload(blob,`${slug((currentProjet()||{}).nom||'arbre-genealogique')}-${dateStamp()}.ged`,'Export GEDCOM');
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
      if(!confirm(`Importer ${list.length} personne(s) depuis ce fichier GEDCOM ? Cela remplacera les données du projet "${(currentProjet()||{}).nom}" (les autres projets ne sont pas affectés).`)) return;
      await dbReplaceProjectPersons(currentProjetId, list);
      await reloadPersonsForProjet();
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

function importGedcomAvecLien(file){
  if(!file) return;
  const reader=new FileReader();
  reader.onload=e=>{
    try{
      const list=gedcomToPersons(parseGedcomLines(e.target.result));
      if(list.length===0) throw new Error('aucune personne trouvée');
      openImportLinkSheet(list, 'GEDCOM');
    }catch(err){
      alert('Fichier GEDCOM invalide : '+err.message);
    }
  };
  reader.readAsText(file);
  document.getElementById('importGedFileLien').value='';
}

function personRowHtml(p){
  const parentsNames=(p.parents||[]).map(pid=>{ const pp=byId(pid); return pp?fullName(pp):''; }).filter(Boolean).join(' & ');
  const conjointsNames=(p.conjoints||[]).map(cid=>{ const c=byId(cid); return c?fullName(c):''; }).filter(Boolean).join(', ');
  let filiation='';
  if(parentsNames) filiation+='Enfant de '+parentsNames+'. ';
  if(conjointsNames) filiation+='Conjoint(e) de '+conjointsNames+'.';
  return `<tr><td>${escapeHtml(fullName(p))}</td><td>${escapeHtml(dateRange(p))}</td><td>${escapeHtml(p.lieu||'')}</td><td>${escapeHtml(filiation)}</td></tr>`;
}

function exportPdf(){
  const gen=computeGenerations();
  const byGen={};
  persons.forEach(p=>{ (byGen[gen[p.id]]=byGen[gen[p.id]]||[]).push(p); });
  const gens=Object.keys(byGen).map(Number).sort((a,b)=>a-b);

  let html=`<h1>Arbre Généalogique — ${escapeHtml((currentProjet()||{}).nom||'')}</h1><p class="print-date">Généré le ${new Date().toLocaleDateString('fr-FR')} — ${persons.length} personne(s)</p>`;
  gens.forEach(g=>{
    html+=`<h2>Génération ${g+1}</h2><table><thead><tr><th>Nom</th><th>Dates</th><th>Lieu</th><th>Filiation</th></tr></thead><tbody>`;
    byGen[g].slice().sort((a,b)=>fullName(a).localeCompare(fullName(b),'fr')).forEach(p=>{ html+=personRowHtml(p); });
    html+=`</tbody></table>`;
  });

  document.getElementById('printArea').innerHTML=html;
  window.print();
}

// Un PDF par ancêtre fondateur (personne sans parent connu, avec au moins un enfant) :
// une section par lignée, avec une génération LOCALE à cette lignée (l'ancêtre = 1),
// séparées par un saut de page. Évite une liste unique de centaines de personnes quand
// l'arbre regroupe plusieurs lignées distinctes (ex. après une fusion de projets).
function exportPdfParAncetre(){
  const racines=persons.filter(p=>(p.parents||[]).length===0 && persons.some(c=>(c.parents||[]).includes(p.id)));
  if(racines.length===0){ alert("Aucun ancêtre fondateur trouvé (personne sans parent connu, avec au moins un enfant, dans ce projet)."); return; }
  racines.sort((a,b)=>fullName(a).localeCompare(fullName(b),'fr'));

  let html=`<h1>Arbres généalogiques par ancêtre — ${escapeHtml((currentProjet()||{}).nom||'')}</h1>
    <p class="print-date">Généré le ${new Date().toLocaleDateString('fr-FR')} — ${racines.length} ancêtre(s) fondateur(s), ${persons.length} personne(s) au total</p>`;

  racines.forEach((racine,idx)=>{
    const {ids,gen}=getDescendants(racine.id);
    const byGen={};
    ids.forEach(id=>{ const p=byId(id); (byGen[gen[id]]=byGen[gen[id]]||[]).push(p); });
    const gens=Object.keys(byGen).map(Number).sort((a,b)=>a-b);
    html+=`<div${idx>0?' style="page-break-before:always;"':''}>
      <h1>${escapeHtml(fullName(racine))}</h1>
      <p class="print-date">${ids.length} personne(s) dans cette lignée</p>`;
    gens.forEach(g=>{
      html+=`<h2>Génération ${g+1}</h2><table><thead><tr><th>Nom</th><th>Dates</th><th>Lieu</th><th>Filiation</th></tr></thead><tbody>`;
      byGen[g].slice().sort((a,b)=>fullName(a).localeCompare(fullName(b),'fr')).forEach(p=>{ html+=personRowHtml(p); });
      html+=`</tbody></table>`;
    });
    html+=`</div>`;
  });

  document.getElementById('printArea').innerHTML=html;
  window.print();
}

async function resetAll(){
  if(!confirm(`Supprimer toutes les personnes du projet "${(currentProjet()||{}).nom}" ? Cette action est irréversible (les autres projets ne sont pas affectés).`)) return;
  await dbReplaceProjectPersons(currentProjetId, []);
  persons=[];
  renderAll();
  showToast('Données du projet effacées');
}

/* =================== PROJETS (arbres multiples) =================== */
function currentProjet(){ return projets.find(p=>p.id===currentProjetId); }

function updateHeaderTitle(){
  const el=document.getElementById('headerTitle');
  if(el) el.textContent=((currentProjet()||{}).nom||'Arbre Généalogique')+' \u25be';
}

async function ensureProjets(){
  projets=await dbAll(STORE_PROJETS);
  if(projets.length===0){
    const defaut={id:uid(),nom:'Projet principal',creeLe:new Date().toISOString()};
    await dbPut(defaut, STORE_PROJETS);
    projets=[defaut];
    const existantes=await dbAll();
    for(const p of existantes){
      if(!p.projetId){ p.projetId=defaut.id; await dbPut(p); }
    }
  }
  currentProjetId=await dbGetMeta('currentProjetId');
  if(!currentProjetId || !projets.some(p=>p.id===currentProjetId)){
    currentProjetId=projets[0].id;
    await dbSetMeta('currentProjetId', currentProjetId);
  }
}
async function reloadPersonsForProjet(){
  const all=await dbAll();
  persons=all.filter(p=>p.projetId===currentProjetId);
  await ensureNumeros();
}
// Attribue un numéro d'identification stable (#1, #2…) aux personnes qui n'en ont pas
// encore (import, fusion, ou données créées avant l'ajout de ce champ). Une fois posé,
// un numéro ne change jamais, même si d'autres personnes sont ajoutées ou supprimées.
// Réutilisable pour N'IMPORTE QUEL projet (pas seulement le projet actif) — utile par ex.
// pour numéroter "l'autre projet" avant de l'afficher dans l'assistant de fusion.
async function ensureNumerosPourProjet(projetId, liste){
  const projet=projets.find(p=>p.id===projetId);
  if(!projet) return;
  let next=projet.prochainNumero||1;
  const sansNumero=liste.filter(p=>typeof p.numero!=='number').sort((a,b)=>fullName(a).localeCompare(fullName(b)));
  for(const p of sansNumero){
    p.numero=next++;
    await dbPut(p);
  }
  if(sansNumero.length || projet.prochainNumero!==next){
    projet.prochainNumero=next;
    await dbPut(projet, STORE_PROJETS);
  }
}
async function ensureNumeros(){
  if(!currentProjetId) return;
  await ensureNumerosPourProjet(currentProjetId, persons);
}
async function nextNumero(){
  const projet=currentProjet();
  if(!projet) return 1;
  const n=projet.prochainNumero||1;
  projet.prochainNumero=n+1;
  await dbPut(projet, STORE_PROJETS);
  return n;
}

function openToolSheet(html){
  document.getElementById('toolSheetBody').innerHTML=html;
  document.getElementById('toolOverlay').classList.add('active');
}
function closeToolSheet(){
  document.getElementById('toolOverlay').classList.remove('active');
}

function openProjetSwitcher(){
  const rows=projets.map(pr=>`
    <div class="projet-row">
      <button class="projet-name-btn" onclick="switchProjet('${pr.id}')">${pr.id===currentProjetId?'✓ ':''}${escapeHtml(pr.nom)}</button>
      <button class="icon-btn" title="Renommer" onclick="renameProjetPrompt('${pr.id}')">✏️</button>
      <button class="icon-btn" title="Supprimer" onclick="deleteProjetConfirm('${pr.id}')">🗑️</button>
    </div>`).join('');
  openToolSheet(`
    <h2 style="margin:0 0 14px;font-size:18px;">Projets (arbres)</h2>
    <div>${rows}</div>
    <button class="btn outline block" style="margin-top:12px;" onclick="promptNewProjet()">➕ Nouveau projet</button>
    <hr class="sep">
    <button class="btn block" onclick="closeToolSheet()">Fermer</button>
  `);
}
async function switchProjet(id){
  if(id!==currentProjetId){
    currentProjetId=id;
    await dbSetMeta('currentProjetId', id);
    await reloadPersonsForProjet();
    updateHeaderTitle();
    renderAll();
    switchView('arbre');
    showToast('Projet : '+(currentProjet()||{}).nom);
  }
  closeToolSheet();
}
async function promptNewProjet(){
  const nom=prompt('Nom du nouveau projet :','');
  if(nom===null) return;
  const proj={id:uid(),nom:nom.trim()||'Nouveau projet',creeLe:new Date().toISOString()};
  await dbPut(proj, STORE_PROJETS);
  projets.push(proj);
  await switchProjet(proj.id);
}
async function renameProjetPrompt(id){
  const pr=projets.find(p=>p.id===id);
  if(!pr) return;
  const nom=prompt('Nouveau nom :', pr.nom);
  if(nom===null || !nom.trim()) return;
  pr.nom=nom.trim();
  await dbPut(pr, STORE_PROJETS);
  updateHeaderTitle();
  openProjetSwitcher();
}
async function deleteProjetConfirm(id){
  if(projets.length<=1){ alert('Impossible de supprimer le seul projet restant.'); return; }
  const pr=projets.find(p=>p.id===id);
  if(!pr) return;
  if(!confirm(`Supprimer le projet "${pr.nom}" et toutes ses personnes ? Cette action est irréversible.`)) return;
  await dbReplaceProjectPersons(id, []);
  await dbDelete(id, STORE_PROJETS);
  projets=projets.filter(p=>p.id!==id);
  if(currentProjetId===id){ await switchProjet(projets[0].id); }
  else { openProjetSwitcher(); }
}

/* ---- Fusionner deux projets ---- */
function openMergeWizard(){
  const autres=projets.filter(p=>p.id!==currentProjetId);
  if(autres.length===0){ alert('Il n\'y a pas d\'autre projet à fusionner.'); return; }
  const rows=autres.map(p=>`<button class="btn outline block" style="margin-bottom:8px;" onclick="openMergeWizardStep2('${p.id}')">${escapeHtml(p.nom)}</button>`).join('');
  openToolSheet(`
    <h2 style="margin:0 0 14px;font-size:18px;">Fusionner avec…</h2>
    <p style="font-size:13px;color:var(--ink-soft);margin-top:0;">Choisissez le projet à fusionner dans "${escapeHtml((currentProjet()||{}).nom)}". Il sera supprimé après la fusion.</p>
    ${rows}
    <button class="btn block" onclick="closeToolSheet()">Annuler</button>
  `);
}
let _mergeState=null;
async function openMergeWizardStep2(autreProjetId){
  const all=await dbAll();
  const autresPersonnes=all.filter(p=>p.projetId===autreProjetId);
  await ensureNumerosPourProjet(autreProjetId, autresPersonnes);
  const suggestions=suggestMatches(persons, autresPersonnes).map(s=>Object.assign({type:'meme',parentsFrom:'base'},s));
  _mergeState={autreProjetId, autresPersonnes, correspondances:suggestions};
  renderMergeStep2();
  if(suggestions.length) showToast(`${suggestions.length} correspondance(s) suggérée(s) automatiquement — à vérifier`);
}
function renderMergeStep2(){
  const {autresPersonnes, correspondances}=_mergeState;
  const genCourant=persons.length?computeGenerations():{};
  const genAutre=autresPersonnes.length?computeGenerationsFor(autresPersonnes):{};
  const incomingUtilises=new Set(correspondances.map(c=>c.incomingId));
  const baseUtilises=new Set(correspondances.map(c=>c.baseId));
  const optsCourant=persons.filter(p=>!baseUtilises.has(p.id)).sort(parNomPrenom)
    .map(p=>`<option value="${p.id}">${personOptionLabel(p,genCourant)}</option>`).join('');
  const optsAutre=autresPersonnes.filter(p=>!incomingUtilises.has(p.id)).sort(parNomPrenom)
    .map(p=>`<option value="${p.id}">${personOptionLabel(p,genAutre)}</option>`).join('');
  const rows=correspondances.map((c,i)=>{
    const inc=autresPersonnes.find(p=>p.id===c.incomingId)||{};
    const base=persons.find(p=>p.id===c.baseId)||{};
    return `
    <div class="merge-row">
      <span>${personOptionLabel(inc,genAutre)}</span> = 
      <span>${personOptionLabel(base,genCourant)}</span>
      <span style="opacity:.6;">(${c.parentsFrom==='incoming'?'parents entrants':'parents de ce projet'})</span>
      <button class="icon-btn" onclick="removeMergeRow(${i})">✕</button>
    </div>`;
  }).join('');
  openToolSheet(`
    <h2 style="margin:0 0 10px;font-size:18px;">Faire correspondre les doublons</h2>
    <p style="font-size:13px;color:var(--ink-soft);margin-top:0;">Uniquement pour les personnes qui existent dans les deux projets. Les autres seront simplement ajoutées, avec toute leur descendance. Chaque personne ne peut être utilisée que dans une seule correspondance. Les lignes déjà présentes ci-dessous sont des suggestions automatiques (même nom + un parent en commun) — vérifiez-les avant de fusionner.</p>
    ${rows}
    <div style="display:flex;flex-direction:column;gap:8px;margin:10px 0;">
      <select id="mergePickAutre" onchange="renderParentsPreview('mergePickAutre','mergePickCourant','mergeParentsPreview',_mergeState.autresPersonnes)"><option value="">Personne de l'autre projet…</option>${optsAutre}</select>
      <select id="mergePickCourant" onchange="renderParentsPreview('mergePickAutre','mergePickCourant','mergeParentsPreview',_mergeState.autresPersonnes)"><option value="">= Personne de ce projet…</option>${optsCourant}</select>
      <div id="mergeParentsPreview"></div>
      <label>Si les deux ont déjà des parents différents, garder :</label>
      <select id="mergePickParentsFrom">
        <option value="base">Les parents de ce projet</option>
        <option value="incoming">Les parents de l'autre projet</option>
      </select>
      <button class="btn outline block" onclick="addMergeRow()">➕ Ajouter cette correspondance</button>
    </div>
    <hr class="sep">
    <button class="btn block" onclick="confirmMerge()">Fusionner (${autresPersonnes.length} personne(s) entrantes)</button>
    <button class="btn outline block" style="margin-top:8px;" onclick="closeToolSheet()">Annuler</button>
  `);
}
// Compare les parents des deux côtés d'une correspondance envisagée, pour repérer un
// conflit AVANT de valider (c'est l'absence de cette vérification qui avait causé le
// problème avec "Lobé Diop" : deux personnes du même nom mais de lignées différentes).
function renderParentsPreview(selIncomingId, selBaseId, previewId, incomingListe){
  const incomingId=document.getElementById(selIncomingId).value;
  const baseId=document.getElementById(selBaseId).value;
  const el=document.getElementById(previewId);
  if(!el) return;
  if(!incomingId || !baseId){ el.innerHTML=''; return; }
  const inc=incomingListe.find(p=>p.id===incomingId);
  const base=persons.find(p=>p.id===baseId);
  if(!inc || !base){ el.innerHTML=''; return; }
  const nomParent=(pid,liste)=>{ const p=liste.find(x=>x.id===pid); return p?fullName(p):null; };
  const incParents=(inc.parents||[]).map(pid=>nomParent(pid,incomingListe)).filter(Boolean);
  const baseParents=(base.parents||[]).map(pid=>nomParent(pid,persons)).filter(Boolean);
  const norm=s=>s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
  const uneCorrespondance=incParents.some(a=>baseParents.some(b=>norm(a)===norm(b)));
  const conflit=incParents.length && baseParents.length && !uneCorrespondance;
  let statut;
  if(uneCorrespondance) statut='✅ Au moins un parent correspond des deux côtés';
  else if(conflit) statut='⚠️ Parents différents des deux côtés — vérifiez avant de fusionner, ce n\'est peut-être pas la même personne (ou choisissez lequel garder)';
  else statut='ℹ️ Au moins un côté n\'a pas de parent connu — rien à comparer';
  el.innerHTML=`<div style="font-size:12px;background:rgba(0,0,0,.04);border-radius:10px;padding:8px 10px;">
    <div><b>Parents (entrant)</b> : ${incParents.length?escapeHtml(incParents.join(' & ')):'aucun connu'}</div>
    <div><b>Parents (ce projet)</b> : ${baseParents.length?escapeHtml(baseParents.join(' & ')):'aucun connu'}</div>
    <div style="margin-top:4px;">${statut}</div>
  </div>`;
}
function addMergeRow(){
  const incomingId=document.getElementById('mergePickAutre').value;
  const baseId=document.getElementById('mergePickCourant').value;
  const parentsFrom=document.getElementById('mergePickParentsFrom').value;
  if(!incomingId || !baseId){ return; }
  _mergeState.correspondances.push({incomingId, baseId, type:'meme', parentsFrom});
  renderMergeStep2();
}
function removeMergeRow(i){
  _mergeState.correspondances.splice(i,1);
  renderMergeStep2();
}
async function confirmMerge(){
  const {autreProjetId, autresPersonnes, correspondances}=_mergeState;
  const {persons:fusionnees, warnings}=mergePersonSets(persons, autresPersonnes, correspondances);
  await dbReplaceProjectPersons(currentProjetId, fusionnees);
  await dbReplaceProjectPersons(autreProjetId, []);
  await dbDelete(autreProjetId, STORE_PROJETS);
  projets=projets.filter(p=>p.id!==autreProjetId);
  await reloadPersonsForProjet();
  _mergeState=null;
  renderAll();
  closeToolSheet();
  if(warnings.length){ alert('Fusion effectuée, mais :\n\n'+warnings.join('\n')); }
  else { showToast('Fusion effectuée ✓'); }
}

/* ---- Importer en reliant une personne ---- */
let _importLinkState=null;
function openImportLinkSheet(incomingList, formatLabel){
  _importLinkState={incomingList};
  const genIncoming=incomingList.length?computeGenerationsFor(incomingList):{};
  const genCourant=persons.length?computeGenerations():{};
  const optsIncoming=incomingList.slice().sort(parNomPrenom).map(p=>`<option value="${p.id}">${personOptionLabel(p,genIncoming)}</option>`).join('');
  const optsCourant=persons.slice().sort(parNomPrenom).map(p=>`<option value="${p.id}">${personOptionLabel(p,genCourant)}</option>`).join('');
  openToolSheet(`
    <h2 style="margin:0 0 10px;font-size:18px;">Importer (${formatLabel}) — ${incomingList.length} personne(s)</h2>
    <p style="font-size:13px;color:var(--ink-soft);margin-top:0;">Reliez éventuellement une personne du fichier à une personne déjà connue de ce projet. Le reste du fichier sera ajouté normalement.</p>
    <div style="display:flex;flex-direction:column;gap:8px;">
      <label>Personne du fichier importé</label>
      <select id="linkIncoming" onchange="renderParentsPreview('linkIncoming','linkBase','linkParentsPreview',_importLinkState.incomingList)"><option value="">— Aucune (importer sans relier) —</option>${optsIncoming}</select>
      <label>Est reliée à, dans ce projet :</label>
      <select id="linkBase" onchange="renderParentsPreview('linkIncoming','linkBase','linkParentsPreview',_importLinkState.incomingList)"><option value="">— sélectionner —</option>${optsCourant}</select>
      <div id="linkParentsPreview"></div>
      <label>Type de lien</label>
      <select id="linkType" onchange="document.getElementById('linkParentsFromField').style.display=this.value==='meme'?'block':'none';">
        <option value="meme">C'est la même personne</option>
        <option value="enfant-de">La personne du fichier est enfant de celle du projet</option>
        <option value="parent-de">La personne du fichier est parent de celle du projet</option>
        <option value="conjoint-de">Elles sont conjointes</option>
      </select>
      <div id="linkParentsFromField">
        <label>Si les deux ont déjà des parents différents, garder :</label>
        <select id="linkParentsFrom">
          <option value="base">Les parents déjà dans ce projet</option>
          <option value="incoming">Les parents du fichier importé</option>
        </select>
      </div>
    </div>
    <hr class="sep">
    <button class="btn block" onclick="confirmImportLink()">Importer</button>
    <button class="btn outline block" style="margin-top:8px;" onclick="closeToolSheet()">Annuler</button>
  `);
}
async function confirmImportLink(){
  const incomingId=document.getElementById('linkIncoming').value;
  const baseId=document.getElementById('linkBase').value;
  const type=document.getElementById('linkType').value;
  const parentsFrom=document.getElementById('linkParentsFrom').value;
  const links=(incomingId && baseId) ? [{incomingId, baseId, type, parentsFrom}] : [];
  const {persons:fusionnees, warnings}=mergePersonSets(persons, _importLinkState.incomingList, links);
  await dbReplaceProjectPersons(currentProjetId, fusionnees);
  await reloadPersonsForProjet();
  _importLinkState=null;
  renderAll();
  switchView('personnes');
  closeToolSheet();
  if(warnings.length){ alert('Importation effectuée, mais :\n\n'+warnings.join('\n')); }
  else { showToast('Importation réussie ✓'); }
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
