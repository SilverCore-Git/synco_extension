# §16 — Coffre de l'extension

Cette section complète la spécification du chiffrement de bout en bout « v4 multi-appareil » de Synco. Elle décrit le
coffre de type `extension` fourni par Synco Extension (Chrome et Firefox) et son modèle de menace. Elle est publique :
elle ne contient ni identifiant de store, ni détail d'infrastructure, et rien de ce qu'elle décrit ne repose sur le
secret du code.

Les valeurs citées ici sont celles du code ; un test ([tests/doc-spec.test.ts](../tests/doc-spec.test.ts)) échoue si
elles divergent.

## 16.1 Rôle

Dans Synco v4, chaque appareil possède une paire de clés. Sa clé privée est scellée par une clé locale **DK**
(256 bits), elle-même gardée par un **coffre** propre à la plateforme. L'application web connaît trois coffres : passkey
WebAuthn avec extension PRF (matériel), PIN local (IndexedDB de l'origine de la page) et, avec cette extension, le
coffre `extension`.

Le coffre `extension` garde DK **hors de l'origine de la page** : dans le stockage de l'extension, inaccessible au
JavaScript de `https://app.synco.one`. Le PIN est saisi dans une fenêtre de l'extension, jamais dans la page.

Ce que le coffre n'est pas :

- un gestionnaire de passkeys : il n'intercepte pas `navigator.credentials` et ne fait pas de WebAuthn ;
- un service pour d'autres sites : il ne répond qu'aux origines Synco de la liste blanche ;
- une session de déverrouillage : chaque `load` redemande le PIN ;
- un composant réseau : le coffre ne fait aucun appel réseau, aucune télémétrie, et ne journalise rien.

L'extension a un second rôle, les **actions de page** (tous sites, voir [page-actions.md](page-actions.md)). Ce
module n'importe rien du coffre et n'a pas accès à son stockage ; un test d'imports transitifs le vérifie.

## 16.2 Interface vue par l'application

L'extension expose les opérations de l'interface `DeviceVault` de l'application, avec ses codes d'erreur.

| Opération | Arguments | Résultat | PIN demandé |
| --- | --- | --- | --- |
| `status` | aucun | `{ present, protocol, version, allowedOrigins, records }` | non |
| `has` | `deviceId` | `{ exists }` | non |
| `create` | `deviceId`, `reason?` | `{ dk }` (nouvelle DK, remplace l'enregistrement existant) | oui, deux fois |
| `load` | `deviceId`, `reason?` | `{ dk }` | oui |
| `remove` | `deviceId` | `{ removed: true }` (idempotent) | non |
| `cancel` | aucun | `{ cancelled }` : vrai si une invite de cette origine et de cet onglet a été fermée | non |

- `deviceId` est un UUID. `records` ne liste que les `deviceId` de **l'origine appelante** ; `has` ne renseigne que sur
  elle.
- `remove` ne demande pas de PIN : supprimer est toujours permis (déconnexion d'un appareil, réinitialisation).
- `dk` arrive dans la page comme un `ArrayBuffer` de 32 octets transféré. L'application l'efface (`fill(0)`) dès
  qu'elle a ouvert la clé privée de l'appareil.

Capacités à déclarer côté application : `kind = 'extension'`, `hardwareBacked = false`, `biometric = false`,
`needsPin = false` (le PIN est géré par l'extension), `rateLimit = 'software'`.

### Codes d'erreur

| Code | Sens | `retryAfterSeconds` |
| --- | --- | --- |
| `pin-required` | aucun PIN fourni (code de l'interface `DeviceVault`, pas émis dans le parcours normal) | — |
| `wrong-pin` | PIN incorrect ; en pratique traité dans l'invite, qui redemande le PIN : la page reçoit l'issue finale | parfois |
| `locked` | trop d'essais, ou trop d'invites ouvertes par cette origine | oui |
| `wiped` | 10ᵉ échec : l'enregistrement est effacé, l'appareil doit être relié de nouveau | — |
| `cancelled` | invite annulée, fermée, expirée, onglet fermé, ou une autre invite est déjà ouverte | — |
| `unavailable` | enregistrement illisible, second secret absent, origine refusée, extension sans réponse | — |
| `missing` | aucun enregistrement pour ce `deviceId` sur cette origine | — |
| `bad-request` | requête mal formée (propre au protocole) | — |
| `unsupported-protocol` | version de protocole inconnue (propre au protocole) | — |

L'application traite tout code qu'elle ne connaît pas comme `unavailable`. Les messages d'erreur sont en français,
destinés à l'affichage, plafonnés à 300 caractères, et ne contiennent jamais de PIN ni de clé.

## 16.3 Canal page ↔ extension (protocole 1)

```
page (app.synco.one)          content script (monde isolé)          worker de l'extension
  │ postMessage hello  ───────────▶ │
  │ ◀─────── ready + MessagePort    │
  │ { id, op, args }  ══ port ════▶ │ validation stricte
  │                                 │ runtime.sendMessage ─────────────▶ │ authentification sur `sender`
  │                                 │                                    │ invite du PIN (fenêtre de l'extension)
  │ ◀══ port ══ réponse (dk transférée) ◀──────────────────────────────── │ dk en base64, effacée côté worker
```

1. **Handshake.** La page envoie
   `window.postMessage({ source: 'synco-page', type: 'hello', protocol: 1 }, location.origin)`.
   Le content script ne le traite que si :
   - `event.source === window` et `event.origin === location.origin` ;
   - l'origine de la page figure **exactement** (schéma, hôte, port) dans la liste blanche ;
   - le message a exactement ces trois clés.

   Il répond alors `{ source: 'synco-extension', type: 'ready', protocol: 1 }` en transférant un `MessagePort`.
   Pour une autre version, il répond `type: 'unsupported'` sans port.
2. **Requêtes.** Toutes les requêtes passent par ce port, jamais en diffusion sur `window`.
   - Forme : requête `{ id, op, args }`, réponse `{ id, ok: true, result }` ou `{ id, ok: false, error: { code, message?, retryAfterSeconds? } }`.
   - Validation : seulement les clés connues ; `id` entier de 0 à 2³¹−1 ; `op` connue ; `deviceId` UUID ; `reason` d'au
     plus 200 caractères ; requête sérialisée d'au plus 1024 octets.
   - La requête est reconstruite champ par champ : rien de ce que la page ajoute ne traverse.
   - Au plus 8 canaux restent ouverts par page ; au-delà, le plus ancien est fermé.
3. **Relais.** Le content script relaie au worker par `runtime.sendMessage`. Le message ne contient **aucun champ
   d'origine** : le worker lit l'origine sur `sender`, fourni par le navigateur, et exige tout ce qui suit.
   - `sender.id` est l'identifiant de cette extension.
   - `sender.frameId === 0` : cadre principal, pas d'iframe.
   - L'onglet est connu.
   - `sender.origin` et l'origine de `sender.url` concordent et sont dans la liste blanche, en correspondance exacte.

   La requête est ensuite revalidée.
4. **Retour de DK.** Le worker renvoie DK en base64 au content script et efface ses octets. Le content script la
   décode et la **transfère** à la page en `ArrayBuffer` ; si le transfert échoue, il l'efface.

Pas d'`externally_connectable` : le même canal sert sur les deux navigateurs.

### Détection par l'application

Le content script est injecté à `document_start` : il écoute avant que les scripts de la page ne s'exécutent.
L'application envoie `hello` et attend `ready` pendant un court délai. Sans réponse, elle conclut « extension
absente » ; elle ne doit jamais bloquer. Une réponse `ready` ne prouve pas l'identité de l'extension (voir 16.7, M7).

## 16.4 Saisie du PIN

`create` et `load` ouvrent une **fenêtre de l'extension**, `windows.create({ type: 'popup' })`, qui fonctionne sur
Chrome et sur Firefox.

Ce que la fenêtre affiche : une scène (l'application Synco et l'extension reliées par un lien animé), un titre, un
emplacement de saisie, un pavé numérique (clavier physique accepté), « Annuler », et en une ligne les limites (vérifié
par l'extension, effacement après 10 erreurs).

**Rien de ce que la page fournit n'est affiché**, ni l'origine ni la raison. L'origine n'informe pas l'utilisateur : elle
est forcément l'une des adresses exactes de la liste blanche (une seule en production), et la menace M2 ne change pas
avec : un script injecté dans l'application *est* sur la bonne origine. Un texte venu de la page dans une fenêtre de
sécurité ne ferait qu'ouvrir la porte à l'hameçonnage. La raison est quand même reçue, nettoyée et plafonnée, pour qu'une
version ultérieure puisse s'en servir sans changer le protocole.

**Annulation par la page.** `cancel` ferme la fenêtre ouverte par **cette** origine dans **cet** onglet ; la demande en
attente reçoit `cancelled`. Une autre origine ou un autre onglet ne peut pas fermer l'invite d'un tiers (le résultat est
alors `{ cancelled: false }`). Une extension plus ancienne qui ne connaît pas `cancel` répond `bad-request` : l'application
l'ignore, la fenêtre se ferme alors d'elle-même au bout de 2 minutes ou quand l'utilisateur la ferme.

`create` demande le PIN deux fois et signale qu'il remplacera un enregistrement existant. Le PIN compte de 4 à 32
chiffres.

Garde-fous :

| Règle | Valeur |
| --- | --- |
| Invites simultanées | une seule ; une demande concurrente reçoit `cancelled` sans fenêtre |
| Limite par origine | 3 invites par minute (fenêtre glissante), au-delà `locked` sans fenêtre |
| Durée d'une invite | 2 minutes, puis `cancelled` |
| Fenêtre fermée, onglet demandeur fermé | `cancelled` |
| Mauvais PIN | la saisie reprend dans la même invite ; le compteur d'essais (16.5) s'applique |

Le PIN n'existe que dans la page d'invite et dans le worker. Ses octets sont effacés après la dérivation ; la chaîne
JavaScript ne peut pas l'être (voir 16.8). Si l'invite expire pendant la vérification, la DK obtenue est effacée et
n'est remise à personne.

La page d'invite n'est pas exposée au web (aucune `web_accessible_resources`). Elle est liée à la demande par un
identifiant aléatoire de 128 bits, et seul le worker en tient la correspondance.

## 16.5 Stockage et cryptographie

### Enregistrement (format `v: 1`)

Clé `storage.local` : `vault:<origine>:<deviceId>`. L'espace de noms par origine empêche une origine Synco d'ouvrir
les enregistrements d'une autre (développement et production, par exemple).

| Champ | Contenu |
| --- | --- |
| `v` | `1` ; toute autre version est refusée à la lecture (`unavailable`), jamais réécrite |
| `salt` | 16 octets aléatoires (base64) |
| `iterations` | 600 000 (PBKDF2-SHA-256), refusé en dessous ou au-delà de 10 000 000 |
| `wrapped` | double scellement de DK (ci-dessous), base64 |
| `failures` | échecs consécutifs (0 à 10) |
| `lockedUntil` | instant (ms) jusqu'auquel les essais sont refusés, ou `null` |
| `createdAt` | instant de création (ms) |

Un enregistrement altéré ou de forme inattendue est traité comme illisible. Il reste listé dans la page d'options
pour pouvoir être supprimé.

### Double scellement

```
clé PIN    = PBKDF2-SHA-256(PIN, salt, 600 000 itérations) → AES-256-GCM
intérieur  = IV ‖ AES-GCM(clé PIN, DK,         AAD = "synco-ext-vault|v1|<origine>|<deviceId>")
wrapped    = IV ‖ AES-GCM(K2,      intérieur,  AAD = "synco-ext-vault|v1|<origine>|<deviceId>|k2")
```

- Les IV font 12 octets, aléatoires à chaque scellement.
- L'AAD lie l'enregistrement à son origine et à son appareil : copié sous une autre clé, il ne s'ouvre pas. Le suffixe
  `|k2` rend les deux couches non interchangeables.
- **K2** est le « second secret » : une `CryptoKey` AES-256-GCM **non extractable**, créée à l'installation, rangée
  dans l'IndexedDB de l'extension. Le JavaScript ne peut pas en lire les octets, seulement l'utiliser depuis l'origine
  de l'extension.

### Compteur d'essais

| Échec n° | Effet |
| --- | --- |
| 1 à 5 | aucune attente |
| 6 | 30 s |
| 7 | 2 min |
| 8 | 10 min |
| 9 | 1 h |
| 10 | **effacement** de l'enregistrement (`wiped`) |

Le barème est celui du coffre PIN de l'application.

- L'échec est **écrit avant l'essai**, puis remis à zéro si le PIN est bon. Un processus tué entre l'essai et
  l'écriture ne donne donc pas d'essai gratuit.
- Les essais sur un même enregistrement sont sérialisés, pour que deux essais simultanés ne lisent pas le même compteur.
- L'ouverture de la couche K2 a lieu avant le comptage : elle ne dépend pas du PIN. Si elle échoue (enregistrement
  déplacé ou altéré, second secret perdu), la réponse est `unavailable`, jamais `wrong-pin`, et aucun essai n'est
  consommé.

### Ce qui n'est pas conservé

L'extension ne garde ni DK, ni le PIN, ni la clé PIN en mémoire entre deux opérations. Un worker endormi puis réveillé
relit tout depuis `storage.local`. Seuls l'invite en cours et le compteur de la limite par origine (`storage.session`)
ont un état.

## 16.6 Actifs, acteurs et frontières

**Actifs** :
- DK, et à travers elle la clé privée de l'appareil ;
- le PIN ;
- l'intégrité du compteur d'essais ;
- la disponibilité de l'enregistrement (le perdre oblige à relier l'appareil).

**Frontières de confiance** :
1. Le JavaScript de la page Synco (y compris un script injecté par XSS) et l'extension. Le content script vit dans un
   monde isolé que la page ne peut ni lire ni modifier.
2. Le content script et le worker. Le navigateur authentifie l'expéditeur (`sender`).
3. L'origine de l'extension et le disque. `storage.local` et IndexedDB sont des fichiers du profil, en clair pour qui
   lit le disque.

**Acteurs considérés** :
- A1, un script hostile exécuté dans la page Synco (XSS, dépendance compromise côté application) ;
- A2, un autre site web, éventuellement dans une iframe d'une page Synco ;
- A3, une autre extension installée dans le même navigateur ;
- A4, un attaquant qui obtient une copie du profil du navigateur (vol de disque, sauvegarde, logiciel malveillant
  sans privilèges de débogage) ;
- A5, un logiciel malveillant qui contrôle la session de l'utilisateur sur la machine ;
- A6, une compromission de la chaîne de publication de l'extension.

## 16.7 Menaces et réponses

| # | Menace | Réponse | Reste |
| --- | --- | --- | --- |
| M1 | A1 lit le coffre directement (comme l'IndexedDB du coffre PIN de la page) | Les données sont dans l'origine de l'extension, hors de portée du JavaScript de la page. L'enregistrement ne peut pas être exfiltré pour un essai hors ligne. | — |
| M2 | A1 appelle `load` en silence | Chaque `load` ouvre une fenêtre de l'extension qui exige le PIN ; une invite à la fois ; 3 par minute ; 2 minutes au plus. | Si l'utilisateur tape son PIN dans une invite déclenchée par A1, A1 reçoit DK. L'invite ne distingue pas l'application d'un script injecté dans l'application : A1 *est* sur la bonne origine, donc afficher l'origine n'aiderait pas. |
| M3 | A1 devine le PIN par l'interface | Chaque essai passe par la fenêtre de l'extension (geste de l'utilisateur), avec le compteur 16.5 et l'effacement au 10ᵉ échec. | — |
| M4 | A1 efface l'enregistrement (`remove`) ou le remplace (`create`) | `remove` sans PIN est un choix (on peut toujours se déconnecter) ; `create` passe par l'invite, qui signale le remplacement. | Déni de service : l'appareil doit être relié de nouveau. Aucune fuite de clé. |
| M5 | A1 sonde l'existence d'enregistrements | `status` et `has` ne parlent que de l'origine appelante. | A1 apprend les `deviceId` de cette origine, que l'application connaît déjà. |
| M6 | A2 parle au coffre depuis une autre origine ou une iframe | Content script injecté seulement sur les origines de la liste blanche, cadre principal, sans `all_frames`. Le content script vérifie l'origine exacte, port compris ; le worker revérifie `sender` (`frameId === 0`, origine exacte), jamais un champ du message. Pas d'`externally_connectable`, pas de `web_accessible_resources`. | — |
| M7 | A1 ou A3 se fait passer pour l'extension (faux `ready`, faux port) | Aucune : l'extension **authentifie la page, pas l'inverse**. Un script de la page ou une autre extension peut imiter ses messages. | Un faux coffre peut fournir à l'application une DK qu'il connaît. Il faut déjà exécuter du code dans la page (A1), qui voit de toute façon DK une fois déverrouillée. L'application ne doit pas présenter la détection de l'extension comme une preuve d'identité. |
| M8 | A3 avec accès à tous les sites injecte du code dans la page Synco | Équivaut à A1. A3 ne peut pas envoyer de message au worker en se faisant passer pour le content script : le worker vérifie `sender.id`. | Comme M2 et M7. |
| M9 | A3 ou un site affiche une fausse fenêtre de PIN pour hameçonner le PIN | La vraie invite est une fenêtre de l'extension, ouverte uniquement après une action de l'application. | Une imitation visuelle reste possible ; le PIN seul ne suffit pas sans l'enregistrement (M10). |
| M10 | A4 copie le profil | La copie donne `storage.local` **et** l'IndexedDB contenant K2 : K2 n'est pas du matériel et ne lie pas l'enregistrement à la machine. Restent PBKDF2 à 600 000 itérations et le PIN. | **Un PIN de 4 chiffres ne protège pas contre A4** : 10 000 essais hors ligne sont à la portée d'un ordinateur ordinaire. Un PIN plus long augmente le coût. Contre ce risque, une passkey PRF matérielle est le bon coffre. |
| M11 | A4 ou A5 modifie l'enregistrement pour remettre le compteur à zéro | Le compteur est une donnée du profil, pas un secret : un attaquant qui écrit sur le disque peut le remettre à zéro. | Le compteur protège contre A1, pas contre A4 ou A5, qui ont de toute façon l'essai hors ligne (M10). |
| M12 | A5 lit la mémoire du navigateur ou enregistre le clavier | Hors de portée d'une extension. | Aucune protection. |
| M13 | Un enregistrement est copié vers une autre origine ou un autre `deviceId` | AAD liée à l'origine et à l'appareil sur les deux couches ; la clé de stockage porte l'origine. | — |
| M14 | Fuite de DK ou du PIN par les journaux, le réseau ou des diagnostics | Aucun `console.*`, aucun appel réseau dans le worker, le content script et le coffre (tests statiques). Le diagnostic du build de développement n'écrit que des étiquettes fixes, et la construction de production échoue s'il est présent. | Les chaînes (PIN saisi, DK en base64) ne s'effacent pas (16.8). |
| M15 | Contenu de la page injecté dans l'interface de l'extension (raison, titres) | Texte inséré par `textContent` uniquement, plafonné, caractères de contrôle et bidi neutralisés. CSP `script-src 'self'; object-src 'none'`, sans script en ligne ni `eval`. | — |
| M16 | Les actions de page (tous sites) servent de passerelle vers le coffre | Le module n'importe rien du coffre (test d'imports transitifs) et n'écrit que son brouillon dans `storage.session`. L'accès à tous les sites est une permission optionnelle, demandée sur geste. | — |
| M17 | Une origine de développement se retrouve en production | Les origines locales n'existent que dans le build `--dev`. Le build de production, les contrôles de paquet et les tests refusent toute origine locale. | — |
| M18 | A6 compromet une dépendance ou le paquet publié | Aucune dépendance d'exécution ; outils de build en versions exactes, publiées depuis au moins 7 jours ; build reproductible vérifiable depuis l'archive source ([build-reproductible.md](build-reproductible.md)) ; contrôle de secrets sur chaque commit et sur l'archive source. | Les comptes des stores et la signature restent des points de confiance. |
| M19 | Le worker est tué pendant une invite (Chrome endormit les service workers) | La page d'invite envoie un signe de vie toutes les 10 s. Si le worker meurt quand même, l'invite expire et la demande échoue en `unavailable`. Aucune clé n'est restée en mémoire. | L'utilisateur recommence. |

## 16.8 Limites assumées

- **L'extension n'est pas un coffre matériel.** Son gain est l'isolation par rapport à l'origine de la page et le
  passage obligé par une fenêtre de l'extension, pas la résistance au vol de profil (M10, M11).
- **Les chaînes ne s'effacent pas.** Les octets de clés (`Uint8Array`) sont effacés avec `fill(0)`. Restent en
  mémoire jusqu'au ramasse-miettes :
  - le PIN saisi (chaîne) ;
  - DK en base64, le temps d'un aller entre le worker et le content script ;
  - les messages JSON.

  Leur nombre et leur durée de vie sont réduits au minimum.
- **Désinstaller l'extension efface ses données**, donc DK : l'appareil doit être relié de nouveau. Le stockage de
  l'extension n'est pas synchronisé entre navigateurs.
- **Permissions retirables.** L'utilisateur peut retirer l'accès au site Synco (Firefox : `about:addons` →
  Autorisations). L'extension le détecte (`permissions.contains`) et l'indique dans sa page d'options ; la page ne
  reçoit alors aucune réponse et conclut « extension absente ».
- **Fenêtres.** Les navigateurs sans `windows.create`, comme Firefox pour Android, ne peuvent pas afficher l'invite.
  L'extension n'est pas destinée à ces navigateurs.

## 16.9 Choix du coffre dans l'application (pour l'intégration)

Ordre proposé par défaut ; l'utilisateur peut choisir un autre coffre :

1. passkey avec PRF, si un authentificateur de plateforme est disponible ;
2. sinon le coffre `extension`, si le handshake répond ;
3. sinon le PIN local.

Le changement de coffre relève de l'application. Côté extension, adopter ce coffre passe par `create`, le quitter par
`remove`.

## 16.10 Vérification

- Tests automatisés (`bun test`), dont un test par chemin de sécurité :
  - validation de l'origine sur `sender`, iframe, champ falsifié, message surdimensionné, opération inconnue ;
  - compteur écrit avant l'essai, effacement au 10ᵉ échec, copie vers une autre origine, version inconnue ;
  - une invite à la fois, limite par origine, isolation des actions de page.

  Chaque protection a été retirée une fois pour vérifier qu'un test échoue.
- Recette dans un vrai navigateur : [recette-manuelle.md](recette-manuelle.md). Ce que seul un navigateur confirme :
  injection réelle, mise en veille du worker, permissions retirées, fenêtres.
- Signalement de vulnérabilité : [SECURITY.md](../SECURITY.md).
