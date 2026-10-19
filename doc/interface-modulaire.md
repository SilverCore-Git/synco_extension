# Interface de l'extension : charte Synco et modules

L'extension a plusieurs fonctions indépendantes : le **coffre de clés**, les **actions de page**, et bientôt Synco AI /
Tinko. L'interface est construite pour que chacune soit un **module** qui s'ajoute sans toucher aux autres, avec la
même charte graphique que l'application Synco.

## Charte

Les jetons sont ceux de l'application (`src/style.css` de `synco_app`) ; les noms sont les mêmes, pour qu'un composant
de l'application se porte sans traduction.

| Jeton | Sombre (défaut) | Clair | Usage |
| --- | --- | --- | --- |
| `--primary` | `#16ac77` | `#108e62` | boutons principaux, accents, focus |
| `--bg` | `#121214` | `#fafafa` | fond de page |
| `--bg2` | `#09090a` | `#f4f4f5` | cartes, colonne latérale |
| `--text` / `--text2` | `#fff` / 60 % | `#27272a` / 62 % | texte, texte secondaire |
| `--border-color` | blanc 10 % | noir 10 % | bordures |
| `--warn` / `--danger` | ambre / rouge | variantes plus foncées | avertissements, suppression |

- **Sombre par défaut**, comme l'application ; clair quand le système le demande (`prefers-color-scheme`).
- Boutons : `primary`, `second`, `default`, `danger`, comme dans l'application. Pastilles `chip-ok|warn|bad|off`.
  Petits titres en capitales, carrés d'icône arrondis (cartes d'appareils).
- Icônes : un sous-ensemble de Bootstrap Icons, la bibliothèque de l'application (MIT, licence dans
  `assets/vendor/bootstrap-icons/`). Logo : celui de l'application, lettres à la couleur du texte et point vert.
- Rien de distant : pas de police web, pas de ressource externe. Icônes et logo sont des masques CSS générés dans
  `src/ui/icons.css` (voir « Icônes »).
- Accessibilité : focus visible, contrastes de l'application, `prefers-reduced-motion` respecté, onglets au clavier
  (flèches, Début, Fin), rôles ARIA, erreurs annoncées (`role="alert"`).

## Architecture

```
src/ui/
  kit.ts          composants : icon, chip, tile, button, banner, card, panelHeader, emptyState, skeleton, wordmark
  shell.ts        cadre : en-tête (logo, version), onglets, contenu du module actif
  modules.ts      contrat : UiModule, UiState, UiHandlers, ModuleContext
  registry.ts     liste ordonnée des modules affichés
  app.ts          assemble les modules dans le shell (un module qui plante n'arrête pas les autres)
  runApp.ts       dessine à chaque changement d'état, rend le focus au même élément
  modules/        un fichier par module : vault.ts, tasks.ts
  popup/ options/ prompt/   pages d'entrée (popup et options : mêmes modules ; prompt : fenêtre du PIN)
```

Le **popup** (380 px) et la **page d'options** (colonne latérale) affichent les mêmes modules : un module reçoit
`surface: 'popup' | 'options'` et adapte son contenu (version compacte dans le popup). Un module sans contenu sur une
surface disparaît des onglets ; avec un seul module visible, il n'y a pas d'onglets. À l'ouverture du popup, c'est le
premier module qui attend quelque chose de l'utilisateur (pastille) qui s'ouvre. La page d'options s'ouvre sur
l'adresse `#<id du module>`.

## Ajouter un module (Synco AI, Tinko…)

1. **Créer** `src/ui/modules/<nom>.ts` :

   ```ts
   import { h } from '../dom';
   import { card, panelHeader } from '../kit';
   import type { UiModule } from '../modules';

   export const aiModule: UiModule = {
     id: 'ai',                       // minuscules et tirets ; sert d'adresse (#ai)
     title: 'Synco AI',
     icon: 'shield-lock-fill',       // une icône de IconName (voir « Icônes »)
     render: ({ doc, surface, state, handlers }) =>
       h(doc, 'div', { class: 'stack' },
         surface === 'popup' ? null : panelHeader(doc, 'Synco AI', 'Ce que fait ce module.'),
         card(doc, { title: 'Un titre' }, h(doc, 'p', { text: 'Du texte.' })),
       ),
     badge: ({ state }) => null,     // { text: '2', tone: 'primary' } pour signaler une action attendue
   };
   ```

2. **Données** : ajouter une clé à `UiState` (`modules.ts`), alimentée par la page d'entrée (`popup/index.ts`,
   `options/index.ts`), et les actions éventuelles à `UiHandlers`. Le module ne lit jamais le navigateur directement :
   tout lui arrive par `ModuleContext`, ce qui le rend testable avec un faux DOM.
3. **Enregistrer** le module dans `registry.ts`.
4. **Tester** : un fichier de test avec le faux DOM (`tests/helpers/fakeDom.ts`) qui rend le module, vérifie les
   textes, les gestionnaires, et un contenu hostile inséré en texte.

Règles que les tests vérifient (`tests/ui-static.test.ts`, `tests/ui-shell.test.ts`, `tests/ui-assets.test.ts`) :

- tout texte passe par `h()` (`textContent`) : jamais de HTML interprété, attributs en liste fermée ;
- **seul le module coffre peut importer `vault/` ou `background/`, et seulement en types** ; les autres modules n'en
  ont aucune connaissance. Un module d'IA n'a donc aucun chemin vers le coffre ;
- un module ne dépend d'aucun autre module ; ils ne se parlent que par `UiState` et `UiHandlers` ;
- aucun dialogue natif, aucun réseau, aucun `console.*`, aucun stockage web dans le code de l'interface ;
- les icônes utilisées existent, et chaque icône déclarée est utilisée.

Un module qui a besoin du réseau ou d'un service (Synco AI, Tinko) n'appelle pas ce service depuis l'interface : il
passe par un module de fonctionnalité dédié (comme `src/page-actions/`), avec ses propres permissions, déclarées à
l'exécution (`optional_host_permissions`), jamais à l'installation.

## Icônes et logo

Les SVG sont versionnés ; `src/ui/icons.css` en est **généré** :

```sh
node scripts/make-ui-assets.mjs           # régénère src/ui/icons.css
node scripts/make-ui-assets.mjs --check   # échoue si le fichier est périmé (aussi vérifié par les tests)
```

Pour ajouter une icône : copier son SVG dans `assets/vendor/bootstrap-icons/`, l'ajouter au type `IconName`
(`kit.ts`), régénérer. Le générateur refuse tout SVG qui contiendrait un script, un lien, un style ou une ressource
externe.

## Fenêtre du PIN

Même charte (logo, carte du demandeur, pavé, points), mais pas un module : c'est une page de sécurité à part, sans
onglets, qui ne se parle qu'au worker. Son contenu ne change pas avec les modules.
