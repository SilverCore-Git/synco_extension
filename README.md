# Synco Extension

Extension Chrome et Firefox pour [Synco](https://synco.one). Elle a deux rôles, **strictement séparés** :

1. **Coffre de clés** (`src/vault/`) : un type de coffre « extension » pour le chiffrement de bout en bout de Synco. Il ne répond **qu'aux origines Synco** de la liste blanche (correspondance exacte). Ce n'est pas un gestionnaire de passkeys : aucune interception de `navigator.credentials`, aucune réponse à d'autres sites.
2. **Actions de page** (`src/page-actions/`) : intégrations au navigateur valables sur tous les sites (par exemple « Créer une tâche dans Synco » sur une sélection de texte). Ce module n'a jamais accès au coffre.

> **État : phase P0 (socle).** Le build, les manifestes et les contrôles sont en place. Le coffre, le canal page ↔ extension et l'interface arrivent dans les phases suivantes ; `src/background/` et `src/bridge/` ne contiennent encore que des squelettes.

## Origines autorisées

Elles sont définies dans [config/origins.json](config/origins.json) et injectées dans le manifeste au build :

| Build | Origines |
| --- | --- |
| `--prod` | `https://app.synco.one` |
| `--dev` | `https://localhost:5174` |

Pas de joker ni de sous-domaine implicite. Le paquet de production ne contient aucune origine locale (vérifié au build et par les tests).

## Construire

Prérequis : [Bun](https://bun.sh) (installation et tests) et Node.js 22 ou plus (build et vérification de types). Ne pas lancer `tsc` ni le build avec Bun.

```sh
bun install --frozen-lockfile      # versions épinglées par bun.lock
node scripts/build.mjs --prod      # → dist/chrome/ et dist/firefox/
node scripts/build.mjs --dev       # origines de développement, nom « (dev) »
```

Le build est reproductible : versions exactes, `bun.lock` versionné, aucun horodatage, aucune minification (le code reste lisible pour la relecture de l'AMO). Il n'y a **aucune dépendance d'exécution** : seulement des outils de build et de test.

Charger en local : Chrome → `chrome://extensions` (mode développeur, « Charger l'extension non empaquetée » sur `dist/chrome`) ; Firefox → `about:debugging` (« Charger un module complémentaire temporaire » sur `dist/firefox/manifest.json`).

## Vérifications

```sh
bun test                              # tests
node node_modules/typescript/bin/tsc --noEmit   # types
node scripts/check-secrets.mjs --all  # secrets dans les fichiers du dépôt
node scripts/check-deps-age.mjs       # dépendances : versions exactes, publiées depuis ≥ 7 jours (réseau)
```

Le dépôt est public : `bun run setup` active le hook `pre-commit` qui exécute le contrôle de secrets sur chaque commit.

## Compatibilité

Une base de code, deux manifestes générés (`manifests/base.json` + `chrome.json` ou `firefox.json`), Manifest V3 des deux côtés :

- Chrome : `background.service_worker` (Chrome 121 ou plus).
- Firefox : `background.scripts` (page événementielle) et `browser_specific_settings.gecko` (identifiant obligatoire, `data_collection_permissions` obligatoire pour les nouvelles soumissions AMO, Firefox 128 ou plus).

## Sécurité

Voir [SECURITY.md](SECURITY.md). Le modèle de menace détaillé sera publié dans `doc/` (phase P6).

## Licence

Tous droits réservés, voir [LICENSE](LICENSE). Le code est public à des fins de transparence uniquement.
