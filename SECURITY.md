# Sécurité

## Signaler une vulnérabilité

Merci de **ne pas ouvrir de ticket public**. Utilisez le signalement privé de GitHub : onglet *Security* → *Report a vulnerability* de ce dépôt.

Précisez la version de l'extension, le navigateur, et les étapes pour reproduire. N'envoyez jamais de clé, de PIN ou de données réelles de Synco.

## Ce que l'extension protège, en bref

- Le coffre ne répond qu'aux origines de la liste blanche (correspondance exacte, cadre principal uniquement). L'origine est lue sur les informations fournies par le navigateur, jamais sur le contenu d'un message.
- Le PIN est saisi dans une fenêtre de l'extension, jamais dans la page : un script injecté dans la page Synco (XSS) ne peut ni le lire, ni déverrouiller le coffre sans que l'utilisateur le voie.
- Les clés ne sont ni journalisées, ni envoyées à un serveur. Aucune télémétrie.

## Limites connues (à lire)

- L'extension **authentifie la page, pas l'inverse** : une page ou une autre extension peut imiter ses messages. La confiance repose sur l'invite affichée par l'extension, qui indique l'origine demandeuse.
- Le second secret de l'extension (clé non extractable dans IndexedDB) n'est **pas du matériel** : copier tout le profil du navigateur donne les deux éléments. Le gain est l'isolation par rapport à l'origine de la page, pas la résistance au vol de profil.
- Les chaînes JavaScript (messages JSON, base64) ne peuvent pas être effacées de la mémoire ; seuls les octets de clés (`Uint8Array`) le sont.

Modèle de menace complet (actifs, acteurs, menaces et risque restant) : [doc/16-coffre-extension.md](doc/16-coffre-extension.md).
