# Construire, vérifier et publier

L'extension est construite par `esbuild` à partir de TypeScript : le code publié est donc « regroupé ». Les stores
(en particulier l'AMO) exigent de pouvoir le reconstruire à l'identique depuis les sources.

## Prérequis

| Outil | Version | Usage |
| --- | --- | --- |
| Node.js | 22 ou plus (testé avec 22.22) | build, vérification de types, lint, packaging |
| Bun | 1.3.14 | installation des dépendances (`bun.lock`) et tests |

Ne pas lancer le build ni `tsc` avec Bun : seul Node est supporté pour ces étapes.

## Reconstruire (procédure pour les relecteurs)

Depuis l'archive source `synco-extension-<version>-source.zip` (ou un clone du dépôt) :

```sh
bun install --frozen-lockfile        # versions exactes de bun.lock, aucun paquet d'exécution
node scripts/build.mjs --prod        # → dist/chrome/ et dist/firefox/
```

Le résultat est déterministe : pas d'horodatage, pas de minification, versions épinglées. Les fichiers de `dist/firefox/`
doivent être **identiques octet pour octet** à ceux du module soumis. Les empreintes de chaque fichier figurent dans
`dist/SHA256SUMS.txt` (lignes `<sha256>  chrome/…` et `<sha256>  firefox/…`).

> Vérifié : une reconstruction dans un dossier vide à partir de l'archive source seule donne, pour les 14 fichiers de
> chaque paquet, les mêmes empreintes que le paquet publié.

**Les empreintes des archives `.zip` ne sont pas la référence** : la compression peut varier d'une version de zlib à
l'autre. La référence est le contenu de chaque fichier.

### Texte à reprendre dans les « notes pour les relecteurs » de l'AMO

> Le code est écrit en TypeScript et regroupé avec esbuild (aucune bibliothèque tierce n'est embarquée : zéro
> dépendance d'exécution). Source : archive `synco-extension-<version>-source.zip`.
> Prérequis : Node.js ≥ 22, Bun 1.3.14. Commandes : `bun install --frozen-lockfile` puis `node scripts/build.mjs --prod`.
> Résultat : `dist/firefox/` (le contenu du module soumis). Détail : `doc/build-reproductible.md`.

## Vérifications avant publication

```sh
bun test                                         # tests
node node_modules/typescript/bin/tsc --noEmit    # types
node scripts/check-secrets.mjs --all             # aucun secret dans le dépôt
node scripts/check-deps-age.mjs                  # dépendances : versions exactes, publiées depuis ≥ 7 jours (réseau)
node scripts/lint-firefox.mjs                    # addons-linter (moteur de web-ext lint), avertissements = erreurs
```

La lint utilise `addons-linter`, le moteur de `web-ext lint` et de la validation de l'AMO, sans les outils de lancement
de Firefox et d'Android que `web-ext` embarque : un arbre de dépendances bien plus court à auditer.

## Fabriquer les paquets

```sh
node scripts/package.mjs
```

Le script refuse de continuer si le dépôt contient des modifications non commitées (la source remise à l'AMO doit
correspondre au paquet). Il construit la production, **contrôle chaque paquet**, puis écrit dans `dist/` :

| Fichier | Destination |
| --- | --- |
| `synco-extension-<version>-chrome.zip` | Chrome Web Store |
| `synco-extension-<version>-firefox.zip` | AMO (module) |
| `synco-extension-<version>-source.zip` | AMO (code source) : fichiers suivis par Git |
| `SHA256SUMS.txt` | empreintes des archives et de chaque fichier |

Contrôles du paquet (un échec bloque la publication) : seuls les fichiers attendus ; manifeste en version 3 ; version
identique à `package.json` ; aucun nom « (dev) », aucun `version_name`, aucun identifiant Firefox de développement ;
aucune origine locale ; aucun diagnostic de développement ; aucun `console.*` ; `host_permissions` jamais élargi à
`<all_urls>` ; pas de `externally_connectable` ; CSP des pages d'extension inchangée ; taille ≤ 5 Mo.

## Ce qui reste à faire avec les comptes des stores (hors dépôt)

Rien de ceci n'est dans le dépôt public (aucun identifiant, aucune clé) :

- Chrome Web Store : création de l'élément, déclaration des permissions (`storage`, `contextMenus`, `activeTab`,
  accès à `https://app.synco.one`), justification de chacune, politique de confidentialité.
- AMO : identifiant `synco-extension@synco.one` (définitif après la première publication), déclaration « aucune donnée
  collectée » (`data_collection_permissions`), et **retirer la compatibilité Firefox pour Android** : l'extension ne
  fonctionne pas sur Android (pas de fenêtres `windows.create`, pas de menu contextuel).
