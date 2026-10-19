# Actions de page (`src/page-actions/`)

Fonctions d'intégration au navigateur valables sur **tous les sites**. Ce rôle est strictement séparé du coffre de clés :
il ne peut ni importer, ni lire, ni écrire quoi que ce soit du coffre (voir « Isolation »).

## État de la phase actuelle

Squelette : **aucun appel réseau, aucun jeton, aucun envoi.** Le menu contextuel « Créer une tâche dans Synco »
construit un brouillon local, validé, que le popup de l'extension affiche (« Brouillon de tâche en attente »).

## Menu contextuel

- Élément : « Créer une tâche dans Synco », contexte `selection`, uniquement sur les pages `http(s)`.
- Permissions : `contextMenus` et `activeTab` (accès temporaire à l'onglet au moment du clic, pour son URL et son titre).
  Le texte sélectionné vient du menu lui-même : **ni `scripting`, ni accès à tous les sites ne sont nécessaires**.
- Données capturées : texte sélectionné (≤ 4000 caractères), URL de la page (http/https, sans identifiants, ≤ 2048),
  titre de la page (une ligne, ≤ 300). Tout est traité comme une donnée non fiable : caractères de contrôle et marques
  bidi neutralisés, plafonds, affichage en `textContent` uniquement.
- Stockage : un seul brouillon, dans `storage.session` (clé `page-actions:draft`), jusqu'à la fermeture du navigateur.
  Une pastille « 1 » sur l'icône le signale ; « Ignorer le brouillon » le supprime.

## Contrat de message (pour le futur branchement)

```ts
interface TaskDraft {
  v: 1;
  text: string;       // sélection
  url: string;        // vide si absente ou inutilisable
  title: string;
  capturedAt: number; // ms
}
interface CreateTaskMessage {
  kind: 'synco-page-action';
  v: 1;
  action: 'create-task';
  draft: TaskDraft;
}
```

`parseDraft` et `parseMessage` ([contract.ts](../src/page-actions/contract.ts)) relisent strictement : un brouillon n'est
valide que s'il est déjà sous sa forme nettoyée ; rien n'est « réparé » en silence.

Deux voies de transmission sont envisagées, **aucune n'est branchée** :

1. **Onglet Synco déjà ouvert** : le worker enverrait le message au content script de l'onglet, qui le remettrait à la page
   (`{ source: 'synco-extension', type: 'draft', v: 1, draft }`). Réservé aux origines Synco, comme le coffre.
2. **Ouverture de l'application avec un brouillon** : l'application recevrait le brouillon à l'ouverture. L'adresse et le
   mode de transport (le brouillon ne doit pas finir dans des journaux de serveur) restent à définir avec l'équipe de l'app.

Dans les deux cas, l'utilisateur doit **relire le brouillon dans Synco avant tout enregistrement** : l'URL d'une page peut
contenir un jeton (lien de réinitialisation, lien de partage), et le texte sélectionné peut être sensible.

## Permissions optionnelles

`optional_host_permissions: ["<all_urls>"]` : jamais demandé à l'installation. L'utilisateur peut l'accorder ou le retirer
depuis la page d'options (« Actions de page sur tous les sites »), par un clic (geste requis par le navigateur).
Aujourd'hui, rien n'en dépend ; il est réservé aux futures fonctions (par exemple Tinko).

Cet accès **ne donne jamais accès au coffre** : le coffre ne répond qu'aux origines de sa liste blanche, validées par le
worker sur `sender` (jamais sur le message), et le content script du coffre n'est injecté que sur ces origines.

## Isolation vis-à-vis du coffre

Vérifiée par [tests/isolation.test.ts](../tests/isolation.test.ts), qui suit les imports de `src/page-actions/`
(directs et transitifs) :

- `page-actions/` n'atteint que `page-actions/` et `shared/` : jamais `vault/`, `background/`, `bridge/` ni `ui/` ;
- aucune référence à `storage.local`, IndexedDB, aux clés `vault:`, ni à `crypto.subtle` ;
- aucun réseau, aucune journalisation ;
- réciproquement, `vault/` n'atteint que `vault/` et `shared/`, et `shared/` n'importe rien d'autre.

Le branchement dans le worker (`src/background/index.ts`) passe par une interface (`PageActionsHost`) : le module reçoit
des fonctions, jamais le coffre.

## Emplacement de Tinko

Voir [src/page-actions/tinko/README.md](../src/page-actions/tinko/README.md). Rien n'est implémenté : une future action
s'ajoutera comme une `PageAction` de plus, avec les mêmes contraintes d'isolation, et exigera une décision à part sur
l'envoi de contenu vers un service (déclaration `data_collection_permissions`, consentement).
