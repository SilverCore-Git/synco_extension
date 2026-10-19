# Emplacement réservé : intégration de l'IA Tinko

**Rien n'est implémenté ici.** Cet emplacement indique où la future intégration de Tinko viendra se brancher :
comme une `PageAction` supplémentaire (voir `../actions.ts`), enregistrée avec `registerPageActions`.

Contraintes à respecter le moment venu :

- aucun import de `src/vault/`, `src/background/` ni `src/bridge/` (vérifié par `tests/isolation.test.ts`) ;
- aucun accès à `storage.local` ni à IndexedDB (ils contiennent le coffre) ;
- aucune permission requise à l'installation : l'accès élargi reste `optional_host_permissions`, demandé sur geste ;
- l'envoi de contenu de pages vers un service (réseau) est une décision à part : il faudra mettre à jour la
  déclaration `data_collection_permissions` du manifeste Firefox, la politique de confidentialité et obtenir le
  consentement explicite de l'utilisateur avant le premier envoi.
