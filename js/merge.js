/* =================== FUSION DE JEUX DE PERSONNES (pure, sans DOM) =================== */
// Combine une liste "base" (ex. le projet actif) et une liste "entrante" (ex. un autre
// projet, ou des personnes importées) selon des liens explicites donnés par l'utilisateur.
//
// links: [{baseId, incomingId, type}]
//   'meme'        : incomingId est la même personne que baseId -> fusion en une seule fiche
//                   (la fiche base garde ses champs scalaires ; parents/conjoints = union)
//   'enfant-de'   : la personne entrante est enfant de la personne base
//   'parent-de'   : la personne entrante est parent de la personne base
//   'conjoint-de' : les deux sont conjoints
//
// Ne modifie aucune des listes passées en paramètre. Retourne { persons, warnings }.

function mergePersonSets(baseList, incomingList, links){
  links = links || [];
  const warnings = [];
  const incomingById = new Map(incomingList.map(p=>[p.id,p]));

  // 1) Table de correspondance incomingId -> baseId pour les liens "meme" uniquement.
  const idMap = new Map();
  links.filter(l=>l.type==='meme').forEach(l=>{
    if(!baseList.some(p=>p.id===l.baseId) || !incomingById.has(l.incomingId)){
      warnings.push('Lien "même personne" ignoré (personne introuvable).');
      return;
    }
    idMap.set(l.incomingId, l.baseId);
  });
  const remap = id => idMap.has(id) ? idMap.get(id) : id;

  // 2) Copie profonde (des tableaux) de la liste base : c'est elle qu'on va enrichir.
  const result = baseList.map(p=>Object.assign({}, p, {
    parents:(p.parents||[]).slice(),
    conjoints:(p.conjoints||[]).slice()
  }));
  const resultById = new Map(result.map(p=>[p.id,p]));

  // 3) Personnes entrantes non fusionnées : on les garde telles quelles, avec leurs
  //    parents/conjoints remappés (une référence vers une personne fusionnée pointe
  //    désormais vers l'id base correspondant).
  const newPersons = [];
  incomingList.forEach(p=>{
    if(idMap.has(p.id)) return;
    newPersons.push(Object.assign({}, p, {
      parents:(p.parents||[]).map(remap),
      conjoints:(p.conjoints||[]).map(remap)
    }));
  });
  const newById = new Map(newPersons.map(p=>[p.id,p]));

  // 4) Pour chaque lien "meme", reporter les parents/conjoints de la fiche entrante sur
  //    la fiche base. Si les deux fiches ont déjà des parents différents (deux lignées
  //    connues indépendamment pour la même personne), l.parentsFrom tranche le conflit :
  //    'base' (défaut) garde les parents actuels, 'incoming' les remplace par ceux du
  //    fichier/projet entrant. Sans choix explicite, un parent excédentaire est ignoré
  //    avec un avertissement explicite plutôt que silencieux.
  links.filter(l=>l.type==='meme').forEach(l=>{
    const base = resultById.get(l.baseId);
    const inc = incomingById.get(l.incomingId);
    if(!base || !inc) return;
    const incParents = (inc.parents||[]).map(remap);

    if(l.parentsFrom==='incoming' && incParents.length){
      base.parents = incParents.slice(0,2);
      if(incParents.length>2) warnings.push(`${base.prenom} ${base.nom}: plus de 2 parents entrants, seuls les 2 premiers sont conservés.`);
    } else {
      incParents.forEach(pid=>{
        if(!base.parents.includes(pid)){
          if(base.parents.length<2) base.parents.push(pid);
          else warnings.push(`${base.prenom} ${base.nom}: parent du fichier/projet entrant ignoré car la fiche a déjà 2 parents différents — relancez la fusion avec "parents de la personne entrante" pour ce lien si c'est la bonne lignée.`);
        }
      });
    }
    (inc.conjoints||[]).map(remap).forEach(cid=>{
      if(cid!==base.id && !base.conjoints.includes(cid)) base.conjoints.push(cid);
    });
  });

  // 5) Liens explicites hors "meme".
  links.filter(l=>l.type!=='meme').forEach(l=>{
    const baseP = resultById.get(l.baseId);
    const incId = remap(l.incomingId);
    const incP = resultById.get(incId) || newById.get(incId);
    if(!baseP || !incP){ warnings.push('Lien ignoré (personne introuvable).'); return; }

    if(l.type==='enfant-de'){
      if(!incP.parents.includes(baseP.id)){
        if(incP.parents.length<2) incP.parents.push(baseP.id);
        else warnings.push(`${incP.prenom} ${incP.nom}: lien "enfant de" ignoré (déjà 2 parents).`);
      }
    } else if(l.type==='parent-de'){
      if(!baseP.parents.includes(incP.id)){
        if(baseP.parents.length<2) baseP.parents.push(incP.id);
        else warnings.push(`${baseP.prenom} ${baseP.nom}: lien "parent de" ignoré (déjà 2 parents).`);
      }
    } else if(l.type==='conjoint-de'){
      if(!baseP.conjoints.includes(incP.id)) baseP.conjoints.push(incP.id);
      if(!incP.conjoints.includes(baseP.id)) incP.conjoints.push(baseP.id);
    } else {
      warnings.push(`Type de lien inconnu ignoré : ${l.type}`);
    }
  });

  return { persons: result.concat(newPersons), warnings };
}

/* =================== SUGGESTION AUTOMATIQUE DE CORRESPONDANCES (pure) =================== */
// Repère les paires (personne base, personne entrante) qui sont probablement la même
// personne, selon deux critères cumulatifs :
//   1. même prénom + nom (comparaison insensible aux accents/casse)
//   2. au moins un parent en commun (par nom), sur les deux côtés
// Le critère 2 est volontairement exigé : un nom identique seul ne suffit pas (cas vécu
// de deux "Lobé Diop" sans lien de parenté). Sans parent connu d'un côté ou de l'autre,
// la paire n'est PAS suggérée — mieux vaut une vérification manuelle qu'un faux positif.
// Retourne une liste de {baseId, incomingId} à proposer, jamais à appliquer aveuglément.

function normaliserNom(s){
  return (s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim();
}

function suggestMatches(baseList, incomingList){
  const nomComplet = p => normaliserNom((p.prenom||'')+' '+(p.nom||''));
  const nomsParents = (p, liste) => (p.parents||[])
    .map(pid => liste.find(x=>x.id===pid))
    .filter(Boolean)
    .map(nomComplet);

  const suggestions=[];
  incomingList.forEach(inc=>{
    const incNom=nomComplet(inc);
    const incParents=nomsParents(inc, incomingList);
    if(!incParents.length) return; // rien à comparer côté entrant

    baseList.forEach(base=>{
      if(nomComplet(base)!==incNom) return;
      const baseParents=nomsParents(base, baseList);
      if(!baseParents.length) return; // rien à comparer côté base
      const parentCommun=incParents.some(n=>baseParents.includes(n));
      if(parentCommun) suggestions.push({baseId:base.id, incomingId:inc.id});
    });
  });
  return suggestions;
}

if(typeof module!=='undefined') module.exports={mergePersonSets, suggestMatches};
