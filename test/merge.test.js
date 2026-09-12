const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mergePersonSets, suggestMatches } = require('../js/merge.js');

function p(id, overrides){
  return Object.assign({ id, prenom:'', nom:'', sexe:'', naissance:'', deces:'', lieu:'', notes:'', parents:[], conjoints:[] }, overrides);
}

test('conflit de parents sur "meme" : par défaut la base gagne, avec avertissement explicite', () => {
  const base = [ p('a1', { parents:['x','y'] }) ]; // a1 a déjà 2 parents dans le projet de base
  const incoming = [ p('b1', { parents:['z'] }) ]; // b1 (même personne) a un parent différent
  const { persons, warnings } = mergePersonSets(base, incoming, [{ baseId:'a1', incomingId:'b1', type:'meme' }]);
  const a = persons.find(x=>x.id==='a1');
  assert.deepEqual(a.parents, ['x','y'], 'les parents de la base sont conservés par défaut');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /entrant ignoré/);
});

test('conflit de parents sur "meme" avec parentsFrom:"incoming" : les parents entrants remplacent ceux de la base', () => {
  const base = [ p('a1', { parents:['x','y'] }) ];
  const incoming = [ p('b1', { parents:['z1','z2'] }) ];
  const { persons, warnings } = mergePersonSets(base, incoming, [{ baseId:'a1', incomingId:'b1', type:'meme', parentsFrom:'incoming' }]);
  const a = persons.find(x=>x.id==='a1');
  assert.deepEqual(a.parents, ['z1','z2']);
  assert.equal(warnings.length, 0);
});

test('suggestMatches() propose une paire quand même nom+prénom ET un parent en commun', () => {
  const baseParent = p('bp1', { prenom:'Sidy', nom:'Diop' });
  const base = [ baseParent, p('a1', { prenom:'Lobé', nom:'Diop', parents:['bp1'] }) ];
  const incParent = p('ip1', { prenom:'Sidy', nom:'Diop' });
  const incoming = [ incParent, p('b1', { prenom:'Lobé', nom:'Diop', parents:['ip1'] }) ];
  const suggestions = suggestMatches(base, incoming);
  assert.deepEqual(suggestions, [{ baseId:'a1', incomingId:'b1' }]);
});

test('suggestMatches() ne propose rien si même nom mais parents différents (cas Lobé Diop)', () => {
  const base = [ p('bp1', { prenom:'Sidy', nom:'Diop' }), p('a1', { prenom:'Lobé', nom:'Diop', parents:['bp1'] }) ];
  const incoming = [ p('ip1', { prenom:'El Hadji Sidy', nom:'Diop' }), p('b1', { prenom:'Lobé', nom:'Diop', parents:['ip1'] }) ];
  assert.deepEqual(suggestMatches(base, incoming), []);
});

test('suggestMatches() ne propose rien si un des deux côtés n\'a aucun parent connu', () => {
  const base = [ p('a1', { prenom:'Lobé', nom:'Diop' }) ]; // pas de parent
  const incoming = [ p('ip1', { prenom:'Sidy', nom:'Diop' }), p('b1', { prenom:'Lobé', nom:'Diop', parents:['ip1'] }) ];
  assert.deepEqual(suggestMatches(base, incoming), []);
});

test('suggestMatches() ignore les noms différents même avec des parents communs', () => {
  const parent = p('bp1', { prenom:'Sidy', nom:'Diop' });
  const base = [ parent, p('a1', { prenom:'Awa', nom:'Diop', parents:['bp1'] }) ];
  const incoming = [ p('ip1', { prenom:'Sidy', nom:'Diop' }), p('b1', { prenom:'Fatou', nom:'Diop', parents:['ip1'] }) ];
  assert.deepEqual(suggestMatches(base, incoming), []);
});

test('suggestMatches() est insensible aux accents et à la casse', () => {
  const base = [ p('bp1', { prenom:'sidy', nom:'DIOP' }), p('a1', { prenom:'lobe', nom:'diop', parents:['bp1'] }) ];
  const incoming = [ p('ip1', { prenom:'Sídy', nom:'Diöp' }), p('b1', { prenom:'Lobé', nom:'Diop', parents:['ip1'] }) ];
  assert.deepEqual(suggestMatches(base, incoming), [{ baseId:'a1', incomingId:'b1' }]);
});

test('lien "meme" fusionne deux fiches : champs scalaires de la base, parents/conjoints en union', () => {
  const base = [ p('a1', { prenom:'Awa', nom:'Diop', conjoints:['a2'] }), p('a2', { prenom:'Modou' }) ];
  const incoming = [ p('b1', { prenom:'Awa (import)', nom:'Diop', parents:['b2'] }), p('b2', { prenom:'GrandPere' }) ];
  const { persons, warnings } = mergePersonSets(base, incoming, [{ baseId:'a1', incomingId:'b1', type:'meme' }]);

  assert.equal(warnings.length, 0);
  const awa = persons.find(x=>x.id==='a1');
  assert.equal(awa.prenom, 'Awa', 'les champs scalaires viennent de la base, pas de l\'entrant');
  assert.ok(awa.parents.includes('b2'), 'le parent de la fiche entrante est reporté sur la base');
  assert.ok(awa.conjoints.includes('a2'), 'le conjoint existant de la base est conservé');
  assert.equal(persons.find(x=>x.id==='b1'), undefined, 'la fiche entrante fusionnée disparaît');
  assert.ok(persons.find(x=>x.id==='b2'), 'le grand-parent entrant non fusionné est conservé tel quel');
});

test('lien "meme" remappe les références vers la personne fusionnée dans le reste du lot entrant', () => {
  const base = [ p('a1') ];
  const incoming = [ p('b1'), p('b2', { parents:['b1'] }) ]; // b1 == a1, b2 est enfant de b1
  const { persons } = mergePersonSets(base, incoming, [{ baseId:'a1', incomingId:'b1', type:'meme' }]);
  const enfant = persons.find(x=>x.id==='b2');
  assert.deepEqual(enfant.parents, ['a1']);
});

test('lien "enfant-de" ajoute la personne base comme parent de la personne entrante', () => {
  const base = [ p('a1') ];
  const incoming = [ p('b1') ];
  const { persons } = mergePersonSets(base, incoming, [{ baseId:'a1', incomingId:'b1', type:'enfant-de' }]);
  const enfant = persons.find(x=>x.id==='b1');
  assert.ok(enfant.parents.includes('a1'));
});

test('lien "parent-de" ajoute la personne entrante comme parent de la personne base', () => {
  const base = [ p('a1') ];
  const incoming = [ p('b1') ];
  const { persons } = mergePersonSets(base, incoming, [{ baseId:'a1', incomingId:'b1', type:'parent-de' }]);
  const baseP = persons.find(x=>x.id==='a1');
  assert.ok(baseP.parents.includes('b1'));
});

test('lien "conjoint-de" crée une union bidirectionnelle', () => {
  const base = [ p('a1') ];
  const incoming = [ p('b1') ];
  const { persons } = mergePersonSets(base, incoming, [{ baseId:'a1', incomingId:'b1', type:'conjoint-de' }]);
  const a = persons.find(x=>x.id==='a1'), b = persons.find(x=>x.id==='b1');
  assert.ok(a.conjoints.includes('b1'));
  assert.ok(b.conjoints.includes('a1'));
});

test('un parent supplémentaire au-delà de 2 est ignoré avec un avertissement', () => {
  const base = [ p('a1', { parents:['x','y'] }) ];
  const incoming = [ p('b1') ];
  const { persons, warnings } = mergePersonSets(base, incoming, [{ baseId:'a1', incomingId:'b1', type:'parent-de' }]);
  const a = persons.find(x=>x.id==='a1');
  assert.deepEqual(a.parents, ['x','y']);
  assert.equal(warnings.length, 1);
});

test('sans aucun lien, les deux listes sont simplement concaténées', () => {
  const base = [ p('a1') ];
  const incoming = [ p('b1'), p('b2') ];
  const { persons, warnings } = mergePersonSets(base, incoming, []);
  assert.equal(persons.length, 3);
  assert.equal(warnings.length, 0);
});

test('ne modifie pas les listes passées en entrée (immutabilité)', () => {
  const base = [ p('a1', { conjoints:[] }) ];
  const incoming = [ p('b1') ];
  mergePersonSets(base, incoming, [{ baseId:'a1', incomingId:'b1', type:'conjoint-de' }]);
  assert.deepEqual(base[0].conjoints, [], 'la liste base originale ne doit pas être mutée');
});

test('lien "meme" avec personne introuvable produit un avertissement et ne casse pas', () => {
  const base = [ p('a1') ];
  const incoming = [ p('b1') ];
  const { persons, warnings } = mergePersonSets(base, incoming, [{ baseId:'a1', incomingId:'inconnu', type:'meme' }]);
  assert.equal(warnings.length, 1);
  assert.equal(persons.length, 2);
});
