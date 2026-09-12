const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  uid, byId, fullName, yearOf, dateRange, escapeHtml, personSubtitle,
  computeGenerations, getFocusedSet, buildLayoutLayers, _setPersons
} = require('../js/model.js');

function person(overrides){
  return Object.assign({
    id: uid(), prenom: '', nom: '', sexe: 'A',
    naissance: '', deces: '', lieu: '', notes: '',
    parents: [], conjoints: []
  }, overrides);
}

beforeEach(() => { _setPersons([]); });

test('uid() génère des identifiants uniques préfixés', () => {
  const a = uid(), b = uid();
  assert.match(a, /^p_/);
  assert.notEqual(a, b);
});

test('fullName() joint prénom et nom, ignore les champs vides', () => {
  assert.equal(fullName({ prenom: 'Awa', nom: 'Diop' }), 'Awa Diop');
  assert.equal(fullName({ prenom: 'Awa', nom: '' }), 'Awa');
  assert.equal(fullName({ prenom: '', nom: '' }), '');
});

test('yearOf() extrait l\'année d\'une date ISO', () => {
  assert.equal(yearOf('1980-05-12'), '1980');
  assert.equal(yearOf(''), '');
  assert.equal(yearOf(undefined), '');
});

test('dateRange() couvre les 4 cas (aucune date, naissance seule, les deux, décès seul)', () => {
  assert.equal(dateRange({ naissance: '', deces: '' }), '');
  assert.equal(dateRange({ naissance: '1950-01-01', deces: '' }), '1950 – présent');
  assert.equal(dateRange({ naissance: '1950-01-01', deces: '2020-01-01' }), '1950 – 2020');
  assert.equal(dateRange({ naissance: '', deces: '2020-01-01' }), '? – 2020');
});

test('escapeHtml() échappe les caractères dangereux', () => {
  assert.equal(escapeHtml(`<a href="x">&'</a>`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(escapeHtml(''), '');
});

test('byId() retrouve une personne par id via l\'état partagé', () => {
  const p = person({ prenom: 'Modou' });
  _setPersons([p]);
  assert.equal(byId(p.id), p);
  assert.equal(byId('inconnu'), undefined);
});

test('personSubtitle() combine dates, lieu et filiation', () => {
  const parent = person({ prenom: 'Fatou', nom: 'Ba', sexe: 'F' });
  const enfant = person({ prenom: 'Ibra', nom: 'Ba', sexe: 'H', naissance: '2000-01-01', lieu: 'Dakar', parents: [parent.id] });
  _setPersons([parent, enfant]);
  assert.equal(personSubtitle(enfant), '2000 – présent · Dakar · Fils de Fatou Ba');
  assert.equal(personSubtitle(parent), '\u00A0');
});

test('personSubtitle() ajoute "G<n>" en tête quand une carte de générations est fournie', () => {
  const p = person({ prenom: 'Awa', nom: 'Diop', lieu: 'Dakar' });
  _setPersons([p]);
  assert.equal(personSubtitle(p, { [p.id]: 2 }), 'G3 · Dakar');
  assert.equal(personSubtitle(p), 'Dakar', 'sans carte de générations, comportement inchangé');
});

test('computeGenerations() place les enfants une génération après leurs parents', () => {
  const gp = person({ prenom: 'GrandParent' });
  const parent = person({ prenom: 'Parent', parents: [gp.id] });
  const enfant = person({ prenom: 'Enfant', parents: [parent.id] });
  _setPersons([gp, parent, enfant]);
  const gen = computeGenerations();
  assert.equal(gen[gp.id], 0);
  assert.equal(gen[parent.id], 1);
  assert.equal(gen[enfant.id], 2);
});

test('computeGenerations() aligne un conjoint sans parents connus sur la génération de son époux/se', () => {
  const gp = person({ prenom: 'GrandParent' });
  const parent = person({ prenom: 'Parent', parents: [gp.id] });
  const conjoint = person({ prenom: 'Conjoint', parents: [], conjoints: [parent.id] });
  parent.conjoints = [conjoint.id];
  _setPersons([gp, parent, conjoint]);
  const gen = computeGenerations();
  assert.equal(gen[conjoint.id], gen[parent.id]);
});

test('computeGenerations() respecte genManuel comme point de départ et le propage aux enfants/conjoint', () => {
  const isole = person({ prenom: 'Isolé', genManuel: 3 });
  const conjoint = person({ prenom: 'Conjoint' });
  isole.conjoints = [conjoint.id];
  conjoint.conjoints = [isole.id];
  const enfant = person({ prenom: 'Enfant', parents: [isole.id] });
  _setPersons([isole, conjoint, enfant]);

  const gen = computeGenerations();
  assert.equal(gen[isole.id], 3);
  assert.equal(gen[conjoint.id], 3);
  assert.equal(gen[enfant.id], 4);
});

test('computeGenerations() ignore genManuel absent (comportement automatique inchangé)', () => {
  const p = person({ prenom: 'Normal' });
  _setPersons([p]);
  assert.equal(computeGenerations()[p.id], 0);
});

test('getFocusedSet() inclut ancêtres, descendants et conjoints', () => {
  const gp = person({ prenom: 'GrandParent' });
  const parent = person({ prenom: 'Parent', parents: [gp.id] });
  const oncle = person({ prenom: 'Oncle', parents: [gp.id] });
  const enfant = person({ prenom: 'Enfant', parents: [parent.id] });
  const conjoint = person({ prenom: 'Conjoint' });
  parent.conjoints = [conjoint.id];
  conjoint.conjoints = [parent.id];
  _setPersons([gp, parent, oncle, enfant, conjoint]);

  const focused = getFocusedSet(parent.id);
  assert.ok(focused.has(gp.id), 'ancêtre inclus');
  assert.ok(focused.has(enfant.id), 'descendant inclus');
  assert.ok(focused.has(conjoint.id), 'conjoint inclus');
  assert.ok(!focused.has(oncle.id), 'oncle non lié directement exclu');
});

test('getFocusedSet() retourne null pour un id inconnu', () => {
  _setPersons([person()]);
  assert.equal(getFocusedSet('inconnu'), null);
});

test('buildLayoutLayers() respecte un ordre manuel (ordreGen) et ignore les passes automatiques pour cette génération', () => {
  const a = person({ prenom: 'A', ordreGen: 2 });
  const b = person({ prenom: 'B', ordreGen: 0 });
  const c = person({ prenom: 'C', ordreGen: 1 });
  // Sans ordreGen, l'ordre alphabétique initial serait A,B,C ; ordreGen impose C,B,A → B... non : 0=B,1=C,2=A
  _setPersons([a, b, c]);
  const layers = buildLayoutLayers({ 0: [a, b, c] }, 0);
  const order = layers[0].map(block => byId(block[0]).prenom);
  assert.deepEqual(order, ['B', 'C', 'A']);
});

test('buildLayoutLayers() ignore ordreGen si un seul bloc de la génération en a un (verrou partiel refusé)', () => {
  const a = person({ prenom: 'A', ordreGen: 5 }); // un seul avec ordreGen
  const b = person({ prenom: 'B' });
  _setPersons([a, b]);
  const layers = buildLayoutLayers({ 0: [a, b] }, 0);
  // Pas de verrou : tri initial retombe sur l'ordre alphabétique (A avant B)
  const order = layers[0].map(block => byId(block[0]).prenom);
  assert.deepEqual(order, ['A', 'B']);
});

test('buildLayoutLayers() ordonne des conjoints décalés en génération selon la position de leur époux/se', () => {
  const a0 = person({ prenom: 'A0' }); // restera en position 0 de la génération 0
  const b0 = person({ prenom: 'B0' });
  const c0 = person({ prenom: 'C0' }); // restera en position 2 de la génération 0
  a0.conjoints=[]; b0.conjoints=[]; c0.conjoints=[];

  const spouseOfC0 = person({ prenom: 'SpouseC0', conjoints: [c0.id] });
  c0.conjoints.push(spouseOfC0.id);
  const spouseOfA0 = person({ prenom: 'SpouseA0', conjoints: [a0.id] });
  a0.conjoints.push(spouseOfA0.id);

  _setPersons([a0, b0, c0, spouseOfC0, spouseOfA0]);
  // Génération 1 volontairement dans le "mauvais" ordre au départ (spouseOfC0 avant spouseOfA0).
  const byGen = { 0: [a0, b0, c0], 1: [spouseOfC0, spouseOfA0] };
  const layers = buildLayoutLayers(byGen, 1);

  const idxA0 = layers[1].findIndex(block => block.includes(spouseOfA0.id));
  const idxC0 = layers[1].findIndex(block => block.includes(spouseOfC0.id));
  assert.ok(idxA0 < idxC0, 'le conjoint de A0 (position 0) doit passer avant celui de C0 (position 2)');
});

test('buildLayoutLayers() regroupe conjoints dans le même bloc et conserve toutes les personnes', () => {
  const a = person({ prenom: 'A' });
  const b = person({ prenom: 'B', conjoints: [a.id] });
  a.conjoints = [b.id];
  const enfant = person({ prenom: 'Enfant', parents: [a.id] });
  _setPersons([a, b, enfant]);

  const byGen = { 0: [a, b], 1: [enfant] };
  const layers = buildLayoutLayers(byGen, 1);

  assert.equal(layers.length, 2);
  const gen0Ids = layers[0].flat();
  assert.ok(gen0Ids.includes(a.id) && gen0Ids.includes(b.id));
  const sameBlock = layers[0].find(block => block.includes(a.id));
  assert.ok(sameBlock.includes(b.id), 'les conjoints doivent partager un bloc');
  assert.deepEqual(layers[1].flat().sort(), [enfant.id]);
});
