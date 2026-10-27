# Grand Réseau

Jeu de gestion du trafic urbain en 3D, dans le navigateur. Chaque voiture suit sa voie, freine, fait la queue et respecte les règles : feux tricolores, stops, priorité à droite, ronds-points. À vous de fluidifier la ville avec des sens uniques, des zones 30, des avenues et une rocade surélevée avec ses échangeurs.

**Jouer :** https://thibut34.github.io/grand-reseau/

- `index.html` : la ville (version principale)
- `region.html` : mode région, relier plusieurs villes
- `classique.html` : mode région en 2D

## Commandes

| Action | Commande |
| --- | --- |
| Tracer une rue, une avenue, une rocade | Glisser avec l'outil 1, 2 ou 3 |
| Échangeur (sur une rocade, à côté d'une rue) | 4 puis clic |
| Sens unique · zone 30 | 5 · 6 puis glisser |
| Feux · stop · rond-point · priorité à droite | 7 · 8 · 9 · 0 puis clic sur un carrefour |
| Régler un feu (cycle, partage du vert, onde verte) | Outil Inspecter (I) puis clic sur le carrefour |
| Démolir | B puis glisser |
| Déplacer · tourner · zoom | Clic droit · clic molette · molette (ou ZQSD, A/E) |
| Bouchons | H |
| Pause | Espace |

## Technique

- Three.js 0.160 en modules ES : tonemapping ACES, ombres douces, ciel physique, reflets d'environnement, halo lumineux la nuit.
- Simulation microscopique : modèle de conduite IDM, règles de passage par carrefour, itinéraires A* qui évitent les bouchons.
- Code découpé en modules : `js/state.js` (état), `js/gen.js` (ville), `js/sim.js` (trafic), `js/render.js` (3D), `js/ui.js` (interface), `js/main.js` (boucle et sauvegarde).

La partie est sauvegardée automatiquement chaque nuit dans le navigateur.
