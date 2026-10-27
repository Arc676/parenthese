// Identifiant des couples « séparés » créés par le placement (deux parents sans union enregistrée)
export const SEPARATED_PAIR_PREFIX = 'pair:'

// --- Constantes visuelles ---
export const PERSON_W = 120
export const PERSON_H = 120
export const PERSON_R = 28
export const UNION_W = 24
export const UNION_H = PERSON_H
export const UNKNOWN_W = 60
export const UNKNOWN_H = PERSON_H
export const UNKNOWN_R = 18
// Conjoint isolé (marié, sans parent ni enfant dans l'arbre) : petit portrait collé à son partenaire.
// Il ne prend pas un emplacement de nœud : union de largeur nulle, écart négatif vers le partenaire.
export const COMPACT_SCALE = 0.6
export const COMPACT_R = PERSON_R * COMPACT_SCALE
// Ligne directe vers la personne commune, dans l'onglet d'une autre famille : en retrait
export const LINE_SCALE = 0.82
export const LINE_ALPHA = 0.55
export const COMPACT_W = 40
export const COMPACT_JOIN_GAP = -18
export const MAX_ORBIT_MEDIAS = 3
export const ORBIT_RADIUS = 55
export const ORBIT_MEDIA_SIZE = 22

// --- Niveau de détail selon le zoom (scale du transform) ---
// En dessous de LOD_SHADOW_MIN_SCALE : pas d'ombre portée (invisible et coûteuse).
// En dessous de LOD_DETAIL_MIN_SCALE : pas de halo, d'orbite de médias ni d'années.
// Le prénom s'estompe entre LOD_LABEL_FADE_OUT et LOD_LABEL_FADE_IN.
export const LOD_SHADOW_MIN_SCALE = 0.6
export const LOD_DETAIL_MIN_SCALE = 0.35
export const LOD_LABEL_FADE_IN = 0.45
export const LOD_LABEL_FADE_OUT = 0.28
// Marge (unités monde) autour de l'écran pour le culling : rayon + orbite + libellé
export const CULL_MARGIN = 140

// --- Constantes animation ---
export const JITTER_RADIUS = 8
// Flottement permanent désactivé : il force un redraw à 60 fps même immobile.
// Remettre > 0 pour le réactiver (ex. 1.2).
export const FLOAT_AMPLITUDE = 0
export const FLOAT_SPEED = 0.0004
export const REPULSION_RADIUS = 90
export const REPULSION_STRENGTH = 2
export const ANGLE_VARIATION = Math.PI / 6

// --- Constantes animation d'entrée ---
// À la première ouverture d'un arbre, la caméra part serrée sur la personne de départ (au moins
// ENTRANCE_CAMERA_FROM_SCALE) et recule en ENTRANCE_CAMERA_DURATION ; chaque personne apparaît en
// ENTRANCE_NODE_DURATION quand elle entre dans le champ. Mouvements réduits : fondu de ENTRANCE_REDUCED_DURATION.
export const ENTRANCE_CAMERA_DURATION = 1100
export const ENTRANCE_CAMERA_FROM_SCALE = 1.3
export const ENTRANCE_NODE_DURATION = 360
export const ENTRANCE_REDUCED_DURATION = 200
export const ENTRANCE_LINE_DELAY = 200
export const ENTRANCE_LINE_DURATION = 500
export const ENTRANCE_ORBIT_DELAY = 300
export const ENTRANCE_ORBIT_DURATION = 400
export const ENTRANCE_ORBIT_STAGGER = 100

export const COLORS = {
  nodeAlive: '#F2EFEA',
  nodeDead: '#EBE6DF',
  borderAlive: '#93402A',
  borderDead: '#6B645D',
  text: '#2A2622',
  textLight: '#6B645D',
  link: '#2A2622',
  linkUnknown: '#6B645D',
  placeholder: '#C0BEBB',
  placeholderBorder: '#A2A09D',
  placeholderFill: '#EBE6DF',
}
