# layout-bench

Banc du placement de l'arbre, sur le code de production (`computeBlockLayout`), sans écran. Plus une sonde de performance, un scénario de bout en bout du parcours compte et un audit de la landing.

## Installation

`npm i`

## Ce qu'on mesure, et dans quel ordre

La beauté d'un arbre ne se score pas, ses défauts se comptent. Quatre étages, lus dans l'ordre, jamais additionnés.

1. **Invariants** (`invariants.mjs`), doivent valoir zéro sinon le placement est faux. Chevauchement, couple non adjacent ou sur deux rangées, fratrie coupée par un étranger ou hors de l'ordre choisi, rangée différente de la génération de parenté (recalculée ici depuis la personne de référence : conjoint 0, parent −1, enfant +1), médianes des années de naissance qui redescendent d'une rangée à l'autre. Les conflits de parenté (cousins de degrés différents, oncle et nièce) sont une propriété des données, pas un défaut du placement.
2. **Défauts sur le tracé réel** (`defects.mjs`), comptés sur la géométrie de `traceSibship` (descente de l'union, ligne de fratrie, descente sur l'enfant), pas sur des segments droits. Dans l'ordre : renvois (filiations en pastilles, et le degré de parenté à la référence du plus proche), lignes de fratrie au-dessus d'un portrait étranger, croisements, lignes plus larges qu'un écran, foyers plus larges qu'un écran, proches à deux degrés de la référence visibles dans un écran. Le rapport liste les foyers les plus étendus, jamais une moyenne.
3. **Archétypes** (`archetypes.mjs`, `ascii.mjs`), une douzaine de petits arbres, un par situation (ordre d'une fratrie, issue #67, branche courte, Marc et Nadia, petit conjoint, fratrie de douze, remariage, cousins, oncle et nièce, parent seul, adoption, deux familles, belle-famille, trois familles enchaînées). Chacun a un rendu texte validé une fois à l'œil, dans `frontend/src/components/galaxy/__snapshots__/archetypes/`, qui sert de témoin en CI (`archetypes.test.js`). Un placement qui change un témoin doit être relu, puis `vitest -u`.
4. **Stabilité** (`perturb.mjs`), retirer une feuille ne devrait déplacer que son foyer. On compte les nœuds qui bougent de plus de 40 px.

La largeur totale ne départage qu'une égalité parfaite. Pas de score composite, pas de capture pendant le travail : l'app une fois, à la recette.

## Lancer

- `npm run bench` : tous les archétypes, `desc-3` et `asc-23` (arbres fictifs générés, `gen-fr.mjs`), et chaque `fixtures/*.json`. `npm run bench -- issue-67 desc-3` pour choisir.
- `ASCII=1` imprime le rendu texte des archétypes. `PERTURB=0` saute la stabilité (lente sur les gros arbres).
- `SRC=<dossier frontend/src> TAG=<nom>` mesure une autre version du code (un autre worktree) et nomme le rapport. `npm run diff -- <tag A> <tag B>` compare deux rapports, arbre par arbre.
- Sorties dans `out/` : `rapport-<tag>.json`, `<archétype>.txt`, `<arbre>.svg` pour les gros arbres.

## Arbres

- Archétypes : dans le dépôt, personnes fictives.
- Fictifs : `node gen-fr.mjs <asc|desc> <sortie.json> [graine]`, ou directement `asc-<graine>` et `desc-<graine>` dans le banc. `asc` imite ce qu'importe un généalogiste (12 générations, fratries d'ancêtres, mariages entre cousins réglables par `IMPLEX`), `desc` ce qu'une famille saisit à la main (un couple fondateur, sa descendance, une belle-famille sur trois).
- Réels : `TREE_PASSWORD='...' npm run fixture -- <slug> [nom]` récupère un arbre par le chemin visiteur dans `fixtures/<nom>-graph.json`. Le dossier `fixtures/` est ignoré par git : ce sont les données d'une famille, elles ne quittent pas votre machine.

## Performance, parcours compte, landing

- `TREE_PASSWORD='...' node perf-probe.mjs <url d'un arbre>` : temps main thread par frame au repos, en drag et en zoom, appels canvas par frame, profil CPU. Brave ou Chrome headless piloté en CDP.
- `node e2e-account.mjs <front> <api>` : scénario complet sur un backend local (lien partagé, compte créé, rattachement, contributions). `CLEANUP=1` supprime l'arbre de test.
- `node landing-check.mjs <url>` : titres, liens, formulaires et erreurs JS d'une page, avec capture.
