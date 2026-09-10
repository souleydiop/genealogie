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
