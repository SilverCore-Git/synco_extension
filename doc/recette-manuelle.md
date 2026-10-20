# Recette manuelle (Chrome et Firefox)

Les tests automatiques (`bun test`) valident la logique avec des API simulées. **Ils ne prouvent pas que l'extension
fonctionne dans un navigateur.** Cette liste couvre ce que seul un navigateur réel peut confirmer. À rejouer pour
chaque version, dans **Chrome** et dans **Firefox**.

Légende : ✅ conforme · ❌ écart (noter le message exact) · ➖ non applicable.

## 0. Préparation

1. `node scripts/build.mjs --dev` (le build de développement n'autorise que `https://localhost:5174`).
2. **Chrome** : `chrome://extensions` → mode développeur → « Charger l'extension non empaquetée » → `dist/chrome`.
3. **Firefox** : `about:debugging#/runtime/this-firefox` → « Charger un module complémentaire temporaire » →
   `dist/firefox/manifest.json`, puis `about:addons` → Synco Extension (dev) → Autorisations : accorder l'accès au site.
   - Si plusieurs profils Firefox sont ouverts, travailler dans **la même fenêtre** que `about:debugging` (une extension
     chargée dans un profil n'existe pas dans l'autre).
   - **Ne pas laisser la console de l'extension ouverte** pour les tests de mise en veille (§4) : elle empêche l'endormissement.
4. Ouvrir l'application sur `https://localhost:5174/` (ou toute page servie à cette adresse), la recharger (F5).

### Outil de test dans la console de la page

À coller une fois par chargement de page (fonctionne sur Chrome et Firefox ; le `hello` est envoyé comme un message de
la fenêtre elle-même, ce que la console de Firefox ne fait pas avec `postMessage`) :

```js
window.__synco = async () => {
  const port = await new Promise((resolve, reject) => {
    const t = setTimeout(() => { removeEventListener('message', h); reject(new Error('pas de « ready » : ' + document.documentElement.dataset.syncoDebug)); }, 2000);
    function h(e) {
      if (e.data?.source !== 'synco-extension') return;
      clearTimeout(t); removeEventListener('message', h);
      e.data.type === 'ready' && e.ports[0] ? resolve(e.ports[0]) : reject(new Error('réponse : ' + JSON.stringify(e.data)));
    }
    addEventListener('message', h);
    dispatchEvent(new MessageEvent('message', { data: { source: 'synco-page', type: 'hello', protocol: 1 }, origin: location.origin, source: window }));
  });
  let n = 0; const waiting = new Map();
  port.onmessage = (e) => { const w = waiting.get(e.data.id); if (w) { waiting.delete(e.data.id); w(e.data); } };
  // La clé DK n'est jamais affichée : seule sa taille l'est.
  const show = (r) => (r.ok && r.result?.dk ? { ...r, result: { dk: `ArrayBuffer(${r.result.dk.byteLength} octets)` } } : r);
  const call = (op, args = {}) => new Promise((res) => { const id = ++n; waiting.set(id, (r) => res(show(r))); port.postMessage({ id, op, args }); });
  call.raw = (op, args = {}) => new Promise((res) => { const id = ++n; waiting.set(id, res); port.postMessage({ id, op, args }); });
  return call;
};
window.DEV = '3f2b8c1e-5a7d-4e90-9b6a-1c2d3e4f5a6b'; // identifiant d'appareil de test
window.hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
```

Utilisation : `const call = await __synco(); await call('status')`.

## 1. Installation et accès au site

| # | Étape | Résultat attendu | Chrome | Firefox |
| --- | --- | --- | :-: | :-: |
| R01 | Charger l'extension | Nom « Synco Extension (dev) », icône (cadenas vert), aucune erreur ni avertissement | | |
| R02 | Clic sur l'icône de l'extension | Un **popup** s'affiche sous l'icône (pas d'onglet) : version, accès au site, « Aucune clé… » | | |
| R03 | Accès au site (Chrome : Détails → Accès au site ; Firefox : Autorisations) | Accès à `localhost` accordé | | |
| R04 | Sur la page, F5 puis `document.documentElement.dataset.syncoDebug` | `injecté,page-prête` (build de développement) | | |
| R05 | À l'installation, regarder la demande de permissions du navigateur | Aucune demande « tous les sites » ; seulement l'accès à l'adresse Synco, le menu contextuel et le stockage | | |

## 2. Canal page ↔ extension

| # | Étape | Résultat attendu | Chrome | Firefox |
| --- | --- | --- | :-: | :-: |
| R06 | `const call = await __synco(); await call('status')` | `ok: true`, `present: true`, `protocol: 1`, `version`, `allowedOrigins: ['https://localhost:5174']`, `records: []` | | |
| R07 | `await call('nimporte')`, `await call('has', {deviceId:'x'})`, `await call('has', {deviceId: DEV, extra: 1})` | Chaque appel : `ok: false`, `code: 'bad-request'` | | |
| R08 | `await call('has', {deviceId: DEV})` | `exists: false` | | |
| R09 | `await call('load', {deviceId: DEV})` | `code: 'missing'`, **aucune fenêtre** ne s'ouvre | | |

## 3. Coffre : création, déverrouillage, essais

| # | Étape | Résultat attendu | Chrome | Firefox |
| --- | --- | --- | :-: | :-: |
| R10 | `await call('create', {deviceId: DEV, reason: 'Relier cet appareil'})` | Une **fenêtre** s'ouvre : « Choisir un code PIN », `https://localhost:5174` bien visible sous « Demandé par », la raison entre guillemets, pavé numérique | | |
| R11 | Saisir `4821`, Continuer, saisir `4822`, Valider | « Les deux codes ne correspondent pas », retour au choix ; **rien n'est enregistré** (`has` → `exists: false`) | | |
| R12 | Refaire : `4821` puis `4821` | La fenêtre se ferme ; la page reçoit `ok: true`, `dk: ArrayBuffer(32 octets)` | | |
| R13 | Popup de l'extension | La clé apparaît (« Appareil 3f2b8c1e… », « Prêt ») | | |
| R14 | `const a = await call.raw('load', {deviceId: DEV})`, saisir `4821` ; garder `hex(a.result.dk)` ; refaire un `load` | Les deux `dk` sont **identiques** (comparer `hex(...)`) ; chaque `load` redemande le PIN (aucune session) | | |
| R15 | `load` puis `0000` | « Code PIN incorrect. », la fenêtre **reste ouverte**, saisie vidée | | |
| R16 | Enchaîner des erreurs (même fenêtre) | Les 5 premières sans attente ; à la 6ᵉ : pavé bloqué, « Prochain essai possible dans 30 s », compte à rebours ; la 7ᵉ : 2 min | | |
| R17 | **Effacement après 10 erreurs** (procédure ci-dessous) | `wiped` renvoyé à la page, message « clé effacée » dans la fenêtre ; `has` → `exists: false` ; popup : « Aucune clé » | | |
| R18 | `create` puis **Annuler** | La page reçoit `code: 'cancelled'` ; fenêtre fermée | | |
| R19 | `create` puis fermer la fenêtre avec la croix | `code: 'cancelled'` | | |
| R20 | `create` puis **fermer l'onglet** de la page | La fenêtre de PIN se ferme toute seule | | |
| R21 | `create` puis laisser la fenêtre ouverte **2 minutes** | Minuterie « Cette demande expire dans … », puis « Demande expirée » ; la page reçoit `cancelled` | | |
| R22 | Deux `create` coup sur coup (`call('create',…); call('create',…)`) | **Une seule fenêtre** ; l'autre demande reçoit `cancelled` | | |
| R23 | Quatre invites en moins d'une minute (créer/annuler 4 fois) | La 4ᵉ : `code: 'locked'` avec `retryAfterSeconds`, **sans fenêtre** | | |
| R24 | `remove` : `await call('remove', {deviceId: DEV})` | `removed: true`, sans PIN, sans fenêtre ; idempotent (rejouer) | | |

**Procédure R17 (effacement sans attendre les délais).** Les délais après la 6ᵉ erreur (30 s, 2 min, 10 min, 1 h)
rendent l'effacement long. Pour le tester, après chaque erreur à partir de la 6ᵉ, lever le délai depuis la console de
l'extension (Chrome : « service worker » → Inspecter ; Firefox : « Inspecter ») :

```js
(async () => { const all = await chrome.storage.local.get(null);   // Firefox : browser.storage.local
  const k = Object.keys(all).find((x) => x.startsWith('vault:'));
  if (k) await chrome.storage.local.set({ [k]: { ...all[k], lockedUntil: null } }); })();
```

À la 10ᵉ erreur, la clé doit être effacée. (Cette astuce ne modifie pas le compteur d'échecs, seulement le délai.)

## 4. Cycle de vie

| # | Étape | Résultat attendu | Chrome | Firefox |
| --- | --- | --- | :-: | :-: |
| R25 | **Chrome** : `chrome://serviceworker-internals` → Stop sur le worker de l'extension, puis `await call('status')` | Réponse normale (le worker se réveille, tout est relu depuis `storage.local`) | | ➖ |
| R26 | Attendre 1 minute sans activité (console de l'extension **fermée**), puis `call('status')` | Réponse normale | | |
| R27 | `create` : laisser la fenêtre de PIN ouverte **plus de 40 s** sans rien faire, puis saisir le PIN | La saisie aboutit (le signe de vie de la fenêtre garde le worker éveillé) ; sinon : « Demande expirée » (noter) | | |
| R28 | Recharger la page pendant une invite | L'invite reste ouverte jusqu'à son délai ; la clé obtenue ne parvient à personne (noter le comportement) | | |
| R29 | **Chrome** : fermer et rouvrir le navigateur, puis `load` | Le PIN est redemandé et la même clé revient (le second secret en IndexedDB persiste) | | ➖ |

Firefox : un module temporaire est supprimé à la fermeture du navigateur ; R29 se rejoue avec l'extension signée.

## 5. Sécurité

| # | Étape | Résultat attendu | Chrome | Firefox |
| --- | --- | --- | :-: | :-: |
| R30 | **Permission refusée** : retirer l'accès au site (Chrome : « Sur clic » ou « Sur tous les sites » désactivé ; Firefox : Autorisations), recharger la page, refaire `__synco()` | « pas de « ready » » ; le **popup** affiche « Accès refusé » et un bouton « Accorder l'accès » ; après avoir accordé et recharge, tout refonctionne | | |
| R31 | **iframe** : `const f = document.createElement('iframe'); f.srcdoc = ''; document.body.append(f); f.onload = () => { addEventListener('message', (e) => console.log('REPONSE iframe', e.data)); f.contentWindow.dispatchEvent(new MessageEvent('message', { data: { source: 'synco-page', type: 'hello', protocol: 1 }, origin: location.origin, source: f.contentWindow })); }` | Aucune réponse « ready » (le content script n'est pas injecté dans les cadres) | | |
| R32 | **Autre origine** : ouvrir `https://localhost:5175/` (autre port) | Chrome : script non injecté. Firefox : injecté mais `dataset.syncoDebug` finit par `hello-refusé:liste` ; **jamais de « ready »** | | |
| R33 | **Autre site** (ex. `https://example.org`), console : `document.documentElement.dataset.syncoDebug` | `undefined` ; aucune réponse à un `hello` | | |
| R34 | Sur la page de l'app, ouvrir la console du **service worker / de la page de fond** : aucune ligne ne contient de PIN ni de clé | Aucune fuite dans les journaux | | |
| R35 | Surveiller l'onglet Réseau de la console de l'extension pendant R10–R24 | **Aucune requête réseau** émise par l'extension | | |

## 6. Interface

| # | Étape | Résultat attendu | Chrome | Firefox |
| --- | --- | --- | :-: | :-: |
| R37 | Thème clair puis sombre (réglage du système) : fenêtre de PIN, popup, options | Lisible, contrastes corrects, couleur primaire verte | | |
| R38 | Clavier physique dans la fenêtre de PIN : chiffres, Retour arrière, Entrée, Échap | Comme les boutons ; Échap annule | | |
| R39 | Popup : taille et défilement avec 3 clés ou plus | Contenu entièrement atteignable, pas de coupure | | |
| R40 | Popup/options : « Supprimer » une clé | Une **fenêtre de confirmation de l'extension** (jamais une boîte du navigateur) ; focus sur « Annuler » ; Échap annule ; « Supprimer » efface | | |
| R41 | Aucun `alert`, `confirm` ou `prompt` du navigateur n'apparaît nulle part | Conforme | | |
| R42 | Page d'options (popup → « Plus d'informations et réglages ») | S'ouvre ; limites expliquées (pas de matériel, effacement après 10 erreurs) | | |
| R43 | Page d'options, carte « Accès aux sites Synco » (accès retiré, puis « Accorder l'accès ») | Une invite du navigateur ; l'état passe à « Accès accordé » (**Firefox** : le popup peut se fermer pendant l'invite, noter) | | |

## 7. Actions de page

| # | Étape | Résultat attendu | Chrome | Firefox |
| --- | --- | --- | :-: | :-: |
| R44 | Sur un site `https://`, sélectionner du texte, clic droit | Entrée « Créer une tâche dans Synco » | | |
| R45 | Sans sélection ; sur `about:blank` / `chrome://extensions` / `about:addons` | L'entrée **n'apparaît pas** | | |
| R46 | Cliquer l'entrée | Pastille « 1 » sur l'icône ; le popup affiche « Brouillon de tâche en attente » (texte, titre, URL) et « pas encore transmis à Synco » | | |
| R47 | « Ignorer le brouillon » | Brouillon et pastille disparaissent | | |
| R48 | Créer un second brouillon | Il **remplace** le premier ; fermeture du navigateur : disparu | | |
| R49 | Page d'options → « Autoriser tous les sites » puis « Retirer » | Invite du navigateur (geste requis) ; l'état suit ; le coffre n'est pas affecté (R06 toujours ✅) | | |
| R50 | Pendant R44–R49, console de l'extension | Aucune requête réseau | | |

## 8. Paquets de production

| # | Étape | Résultat attendu | Chrome | Firefox |
| --- | --- | --- | :-: | :-: |
| R51 | Charger le paquet de **production** (`node scripts/package.mjs`, puis `dist/chrome` / `dist/firefox`) | Nom « Synco Extension » (sans « (dev) ») | | |
| R52 | Sur `https://localhost:5174/` | Aucune injection (`dataset.syncoDebug` → `undefined`), aucun « ready » | | |
| R53 | Sur l'application de production | `dataset.syncoDebug` → `undefined` (le diagnostic n'existe pas en production) ; handshake et `status` fonctionnent | | |
| R54 | `node scripts/lint-firefox.mjs` | 0 erreur, 0 avertissement | ➖ | |
| R55 | Reconstruire depuis l'archive source (voir `build-reproductible.md`) | Empreintes de chaque fichier identiques à `SHA256SUMS.txt` | | |

## 9. Interface (charte Synco, onglets)

| # | Étape | Résultat attendu | Chrome | Firefox |
| --- | --- | --- | :-: | :-: |
| R56 | Ouvrir le popup (thème sombre du système, puis clair) | Logo « Synco. » (point vert), icônes visibles (cadenas, clé, globe…), couleurs sobres comme l'application ; aucune icône carrée vide ni texte « ? » | | |
| R57 | Popup sans brouillon de tâche | Aucun onglet : un seul grand état (« Prête à protéger vos clés » ou « Cet appareil est protégé »), une phrase, et « Comment ça marche ? » ; aucun identifiant d'appareil, aucune adresse, aucun jargon | | |
| R58 | Retirer l'accès au site (R06 inverse) | Le popup dit « Autorisation nécessaire » avec un seul bouton « Autoriser » | | |
| R59 | Créer un brouillon (R44–R46), rouvrir le popup | Deux onglets apparaissent (« Coffre », « Tâches » avec la pastille « 1 ») et « Tâches » est ouvert ; après « Ignorer le brouillon », l'onglet disparaît | | |
| R59b | « Comment ça marche ? » dans le popup | Trois phrases simples s'affichent ; « Plus de détails » ouvre la page des réglages ; « Masquer » les referme | | |
| R60 | Roue dentée du popup | Ouvre la page d'options ; colonne latérale avec les mêmes onglets ; l'adresse change (`#vault`, `#tasks`) | | |
| R61 | Page d'options réduite à moins de 720 px de large | Onglets en barre horizontale au-dessus du contenu, pas de défilement horizontal | | |
| R62 | Fenêtre du PIN | Basse (environ 560 px), sans défilement : scène Synco ↔ extension, titre, emplacements de saisie, pavé, boutons, une ligne de limites ; aucun bandeau vide ; erreur visible après un mauvais PIN ; ouverte à droite de la carte de Synco si la page fait 880 px ou plus | | |
| R63 | Navigation au clavier (Tab) dans le popup, la page d'options et la fenêtre du PIN | Anneau de focus vert visible partout ; la suppression d'une clé ne prend jamais le focus par défaut (« Annuler » d'abord) | | |
| R64 | Système réglé sur « réduire les animations » | Pas d'animation de chargement ni de transition | | |

## Ce que cette recette ne couvre pas

- **Firefox pour Android** : non pris en charge (pas de fenêtres, pas de menu contextuel).
- **Navigateurs dérivés** (Edge, Brave, Opera…) : non testés.
- **Résistance au vol de profil** : le second secret n'est pas du matériel (voir SECURITY.md) ; rien à vérifier à la main.
- **Faille de l'application elle-même** (XSS sur Synco) : l'extension la limite (le PIN n'est jamais saisi dans la page) mais
  ne la corrige pas ; elle relève d'une revue de sécurité de l'application.
