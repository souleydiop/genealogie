const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mergePersonSets } = require('../js/merge.js');

function p(id, overrides){
  return Object.assign({ id, prenom:'', nom:'', sexe:'', naissance:'', deces:'', lieu:'', notes:'', parents:[], conjoints:[] }, overrides);
}

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
