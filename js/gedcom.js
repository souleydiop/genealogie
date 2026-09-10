const GED_MONTHS=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

function isoToGedDate(iso){
  if(!iso) return '';
  const parts=iso.split('-').map(Number);
  const [y,m,d]=parts;
  if(!y) return '';
  if(!m) return String(y);
  if(!d) return `${GED_MONTHS[m-1]} ${y}`;
  return `${d} ${GED_MONTHS[m-1]} ${y}`;
}

function gedDateToIso(s){
  if(!s) return '';
  s=s.replace(/^(ABT|EST|CAL|BEF|AFT)\.?\s+/i,'').trim();
  const months={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
  let m=s.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
  if(m && months[m[2].toUpperCase()]) return `${m[3]}-${months[m[2].toUpperCase()]}-${m[1].padStart(2,'0')}`;
  m=s.match(/^([A-Za-z]{3})\s+(\d{4})$/);
  if(m && months[m[1].toUpperCase()]) return `${m[2]}-${months[m[1].toUpperCase()]}-01`;
  m=s.match(/^(\d{4})$/);
  if(m) return `${m[1]}-01-01`;
  return '';
}

function buildGedcomLines(persons){
  const lines=[];
  lines.push('0 HEAD');
  lines.push('1 SOUR ArbreGenealogique');
  lines.push('1 GEDC');
  lines.push('2 VERS 5.5.1');
  lines.push('2 FORM LINEAGE-LINKED');
  lines.push('1 CHAR UTF-8');

  const gedId={};
  persons.forEach((p,i)=>gedId[p.id]='I'+(i+1));

  // Regroupe les personnes par "famille" : couple (+ enfants) ou parent(s)+enfants
  const famKey=(a,b)=>[a,b].filter(Boolean).sort().join('|');
  const famMap=new Map(); // key -> {parents:[id,id?], children:[id,...]}
  persons.forEach(p=>{
    if(p.parents && p.parents.length){
      const key=famKey(p.parents[0],p.parents[1]);
      if(!famMap.has(key)) famMap.set(key,{parents:[...p.parents],children:[]});
      famMap.get(key).children.push(p.id);
    }
  });
  const seenPairs=new Set();
  persons.forEach(p=>{
    (p.conjoints||[]).forEach(cid=>{
      const key=famKey(p.id,cid);
      if(seenPairs.has(key)) return; seenPairs.add(key);
      if(!famMap.has(key)) famMap.set(key,{parents:[p.id,cid],children:[]});
    });
  });
  const famId={};
  let fi=0;
  famMap.forEach((fam,key)=>{ fi++; famId[key]='F'+fi; });

  persons.forEach(p=>{
    lines.push(`0 @${gedId[p.id]}@ INDI`);
    lines.push(`1 NAME ${p.prenom||''} /${p.nom||''}/`);
    lines.push(`1 SEX ${p.sexe==='F'?'F':p.sexe==='H'?'M':'U'}`);
    if(p.naissance||p.lieu){
      lines.push('1 BIRT');
      if(p.naissance) lines.push(`2 DATE ${isoToGedDate(p.naissance)}`);
      if(p.lieu) lines.push(`2 PLAC ${p.lieu}`);
    }
    if(p.deces){
      lines.push('1 DEAT');
      lines.push(`2 DATE ${isoToGedDate(p.deces)}`);
    }
    if(p.notes) lines.push(`1 NOTE ${p.notes.replace(/\r?\n/g,' ')}`);
    if(p.parents && p.parents.length){
      const fid=famId[famKey(p.parents[0],p.parents[1])];
      if(fid) lines.push(`1 FAMC @${fid}@`);
    }
    famMap.forEach((fam,key)=>{
      if(fam.parents.includes(p.id)) lines.push(`1 FAMS @${famId[key]}@`);
    });
  });

  famMap.forEach((fam,key)=>{
    lines.push(`0 @${famId[key]}@ FAM`);
    fam.parents.forEach(pid=>{
      const person=persons.find(p=>p.id===pid);
      if(!person) return;
      lines.push(`1 ${person.sexe==='F'?'WIFE':'HUSB'} @${gedId[pid]}@`);
    });
    fam.children.forEach(cid=>{
      if(persons.find(p=>p.id===cid)) lines.push(`1 CHIL @${gedId[cid]}@`);
    });
  });
  lines.push('0 TRLR');
  return lines;
}

function parseGedcomLines(text){
  const lines=text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  const records=[];
  let stack=[];
  lines.forEach(raw=>{
    const m=raw.match(/^(\d+)\s+(@[^@]+@\s+)?(\S+)(?:\s+(.*))?$/);
    if(!m) return;
    const level=parseInt(m[1],10);
    const xref=m[2]?m[2].trim().replace(/@/g,''):null;
    const node={level,tag:m[3],value:m[4]||'',xref,children:[]};
    if(level===0){
      records.push(node);
      stack=[node];
    }else{
      while(stack.length>level) stack.pop();
      const parent=stack[stack.length-1];
      if(parent) parent.children.push(node);
      stack.push(node);
    }
  });
  return records;
}

// Note : dépend de uid() (défini dans model.js, chargé avant ce fichier dans index.html).
function gedcomToPersons(records){
  const indi=records.filter(r=>r.tag==='INDI');
  const fam=records.filter(r=>r.tag==='FAM');
  const idMap={};
  indi.forEach(r=>{ idMap[r.xref]=uid(); });

  const list=indi.map(r=>{
    const p={id:idMap[r.xref],prenom:'',nom:'',sexe:'A',naissance:'',deces:'',lieu:'',photo:'',notes:'',parents:[],conjoints:[]};
    r.children.forEach(c=>{
      if(c.tag==='NAME'){
        const m=c.value.match(/^([^\/]*)\/([^\/]*)\/?/);
        if(m){ p.prenom=m[1].trim(); p.nom=m[2].trim(); }
        else p.prenom=c.value.trim();
      }else if(c.tag==='SEX'){
        p.sexe = c.value==='M'?'H':c.value==='F'?'F':'A';
      }else if(c.tag==='BIRT'){
        c.children.forEach(cc=>{
          if(cc.tag==='DATE') p.naissance=gedDateToIso(cc.value);
          if(cc.tag==='PLAC') p.lieu=cc.value;
        });
      }else if(c.tag==='DEAT'){
        c.children.forEach(cc=>{ if(cc.tag==='DATE') p.deces=gedDateToIso(cc.value); });
      }else if(c.tag==='NOTE'){
        p.notes=(p.notes?p.notes+' ':'')+c.value;
      }
    });
    return p;
  });
  const byUid=id=>list.find(x=>x.id===id);

  fam.forEach(r=>{
    const husbs=[], wifes=[], chil=[];
    r.children.forEach(c=>{
      const ref=(c.value||'').replace(/@/g,'');
      if(c.tag==='HUSB') husbs.push(idMap[ref]);
      else if(c.tag==='WIFE') wifes.push(idMap[ref]);
      else if(c.tag==='CHIL') chil.push(idMap[ref]);
    });
    const allParents=[...husbs,...wifes].filter(Boolean);
    if(allParents.length===2){
      const [pa,pb]=allParents;
      const a=byUid(pa), b=byUid(pb);
      if(a && b){
        if(!a.conjoints.includes(pb)) a.conjoints.push(pb);
        if(!b.conjoints.includes(pa)) b.conjoints.push(pa);
      }
    }
    chil.forEach(cid=>{
      const pc=byUid(cid);
      if(!pc) return;
      allParents.forEach(pid=>{
        if(!pc.parents.includes(pid) && pc.parents.length<2) pc.parents.push(pid);
      });
    });
  });
  return list;
}


if(typeof module!=='undefined') module.exports={isoToGedDate,gedDateToIso,buildGedcomLines,parseGedcomLines,gedcomToPersons};
