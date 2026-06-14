# Arbre Généalogique — Guide de déploiement

Application 100 % autonome (1 page HTML), stockage local sur le téléphone
(IndexedDB), avec export/import JSON pour sauvegarder vers Google Drive.

## Fichiers du projet

```
index.html      → l'application complète
manifest.json   → fiche d'identité PWA (nom, icônes, couleurs)
sw.js           → permet le fonctionnement hors-ligne
icons/          → icônes de l'application (192, 512, 512 maskable)
```

## Étape 1 — Mettre en ligne avec GitHub Pages

1. Crée un nouveau dépôt sur GitHub (ex. `arbre-genealogique`), public.
2. Depuis l'app GitHub (mobile), ajoute les fichiers `index.html`,
   `manifest.json`, `sw.js` et le dossier `icons/` à la racine du dépôt.
3. Dans **Settings → Pages**, choisis la branche `main` et le dossier `/ (root)`.
4. GitHub te donne une adresse du type :
   `https://TON-PSEUDO.github.io/arbre-genealogique/`
5. Ouvre cette adresse — vérifie que l'app se charge et que tu peux ajouter
   une personne.

## Étape 2 — Générer l'APK avec PWABuilder

1. Va sur **pwabuilder.com** depuis ton téléphone.
2. Colle l'URL GitHub Pages de l'étape 1 et lance l'analyse.
3. PWABuilder doit détecter automatiquement le `manifest.json` et le
   service worker (3 coches vertes).
4. Choisis **Android** → génère le package (APK ou Bundle).
5. Télécharge le fichier, installe-le sur ton téléphone (autorise les
   sources inconnues si demandé).

## Étape 3 — Sauvegarde sur Google Drive

- Dans l'onglet **Données** de l'app → **Exporter vers un fichier** :
  un fichier `arbre-genealogique-AAAA-MM-JJ.json` est créé.
- Sur certains téléphones, le menu de partage s'ouvre directement :
  choisis **Drive** pour l'enregistrer dans le cloud.
- Sinon, le fichier va dans **Téléchargements** : ouvre l'app **Fichiers**,
  puis "Déplacer vers" ou "Partager" → Drive.
- Pour restaurer : **Importer** dans l'app, puis sélectionne le fichier
  JSON depuis Drive (ou Téléchargements).

## Mises à jour futures

À chaque modification de `index.html`, il suffit de remplacer le fichier
dans le dépôt GitHub. GitHub Pages se met à jour automatiquement
(quelques minutes). L'APK installé chargera la nouvelle version au
prochain lancement avec connexion (le service worker se met à jour seul).

Si tu changes beaucoup de fonctionnalités et veux forcer la mise à jour
immédiate, change `genealogie-cache-v1` en `v2` dans `sw.js`.
