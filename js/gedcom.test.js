const { test } = require('node:test');
const assert = require('node:assert/strict');

// gedcom.js s'appuie sur uid() (défini dans model.js) pour générer les ids
// lors de l'import GEDCOM — même dépendance qu'en production, où model.js
// est chargé avant gedcom.js dans index.html.
const model = require('../js/model.js');
global.uid = model.uid;

const {
  isoToGedDate, gedDateToIso, buildGedcomLines, parseGedcomLines, gedcomToPersons
} = require('../js/gedcom.js');

test('isoToGedDate() convertit une date ISO complète, partielle, ou vide', () => {
  assert.equal(isoToGedDate('1980-05-12'), '12 MAY 1980');
  assert.equal(isoToGedDate('1980-05'), 'MAY 1980');
  assert.equal(isoToGedDate('1980'), '1980');
  assert.equal(isoToGedDate(''), '');
});

test('gedDateToIso() est l\'inverse de isoToGedDate() pour une date complète', () => {
  assert.equal(gedDateToIso('12 MAY 1980'), '1980-05-12');
  assert.equal(gedDateToIso('MAY 1980'), '1980-05-01');
  assert.equal(gedDateToIso('1980'), '1980-01-01');
  assert.equal(gedDateToIso('ABT 1980'), '1980-01-01');
  assert.equal(gedDateToIso('texte invalide'), '');
});

test('buildGedcomLines() produit un en-tête, un TRLR et une fiche INDI par personne', () => {
  const persons = [
    { id: 'p1', prenom: 'Awa', nom: 'Diop', sexe: 'F', naissance: '1950-01-01', deces: '', lieu: 'Dakar', notes: '', parents: [], conjoints: [] }
  ];
  const lines = buildGedcomLines(persons);
  assert.equal(lines[0], '0 HEAD');
  assert.equal(lines[lines.length - 1], '0 TRLR');
  assert.ok(lines.some(l => l === '1 NAME Awa /Diop/'));
  assert.ok(lines.some(l => l === '1 SEX F'));
  assert.ok(lines.some(l => l === '2 PLAC Dakar'));
});

test('buildGedcomLines() crée une famille FAM lorsqu\'un enfant a des parents', () => {
  const parent = { id: 'par', prenom: 'Modou', nom: 'Fall', sexe: 'H', naissance: '', deces: '', lieu: '', notes: '', parents: [], conjoints: [] };
  const enfant = { id: 'enf', prenom: 'Ibra', nom: 'Fall', sexe: 'H', naissance: '', deces: '', lieu: '', notes: '', parents: ['par'], conjoints: [] };
  const lines = buildGedcomLines([parent, enfant]);
  assert.ok(lines.some(l => /^0 @F1@ FAM$/.test(l)));
  assert.ok(lines.some(l => l === '1 CHIL @I2@'));
  assert.ok(lines.some(l => l === '1 FAMC @F1@'));
});

test('parseGedcomLines() reconstruit l\'arborescence par niveaux', () => {
  const text = [
    '0 @I1@ INDI',
    '1 NAME Awa /Diop/',
    '1 SEX F',
    '1 BIRT',
    '2 DATE 1 JAN 1950',
    '0 TRLR'
  ].join('\n');
  const records = parseGedcomLines(text);
  assert.equal(records.length, 2);
  const indi = records[0];
  assert.equal(indi.tag, 'INDI');
  assert.equal(indi.xref, 'I1');
  const birt = indi.children.find(c => c.tag === 'BIRT');
  assert.equal(birt.children[0].tag, 'DATE');
  assert.equal(birt.children[0].value, '1 JAN 1950');
});

test('gedcomToPersons() convertit les records en objets personne, avec parents et conjoints liés', () => {
  const text = [
    '0 HEAD',
    '0 @I1@ INDI',
    '1 NAME Modou /Fall/',
    '1 SEX M',
    '0 @I2@ INDI',
    '1 NAME Awa /Diop/',
    '1 SEX F',
    '0 @I3@ INDI',
    '1 NAME Ibra /Fall/',
    '1 SEX M',
    '0 @F1@ FAM',
    '1 HUSB @I1@',
    '1 WIFE @I2@',
    '1 CHIL @I3@',
    '0 TRLR'
  ].join('\n');
  const persons = gedcomToPersons(parseGedcomLines(text));
  assert.equal(persons.length, 3);

  const modou = persons.find(p => p.prenom === 'Modou');
  const awa = persons.find(p => p.prenom === 'Awa');
  const ibra = persons.find(p => p.prenom === 'Ibra');

  assert.equal(modou.sexe, 'H');
  assert.ok(modou.conjoints.includes(awa.id));
  assert.ok(awa.conjoints.includes(modou.id));
  assert.ok(ibra.parents.includes(modou.id));
  assert.ok(ibra.parents.includes(awa.id));
});

test('aller-retour : buildGedcomLines() -> parseGedcomLines() -> gedcomToPersons() préserve les données clés', () => {
  const original = [
    { id: 'a', prenom: 'Modou', nom: 'Fall', sexe: 'H', naissance: '1970-03-05', deces: '', lieu: 'Kaolack', notes: '', parents: [], conjoints: ['b'] },
    { id: 'b', prenom: 'Awa', nom: 'Diop', sexe: 'F', naissance: '1972-06-15', deces: '', lieu: '', notes: '', parents: [], conjoints: ['a'] },
    { id: 'c', prenom: 'Ibra', nom: 'Fall', sexe: 'H', naissance: '2000-01-01', deces: '', lieu: '', notes: '', parents: ['a', 'b'], conjoints: [] }
  ];
  const gedText = buildGedcomLines(original).join('\n');
  const roundTripped = gedcomToPersons(parseGedcomLines(gedText));

  assert.equal(roundTripped.length, 3);
  const modou = roundTripped.find(p => p.prenom === 'Modou');
  const ibra = roundTripped.find(p => p.prenom === 'Ibra');
  assert.equal(modou.naissance, '1970-03-05');
  assert.equal(modou.lieu, 'Kaolack');
  assert.equal(ibra.parents.length, 2);
});
