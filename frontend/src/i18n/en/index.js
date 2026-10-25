// Dictionnaire anglais, découpé par zone de l'interface.
import app from './app.js'
import arbre from './arbre.js'
import fiche from './fiche.js'
import contribution from './contribution.js'
import compte from './compte.js'
import photos from './photos.js'
import souvenir from './souvenir.js'
import gestion from './gestion.js'

export default {
  ...app,
  ...arbre,
  ...fiche,
  ...contribution,
  ...compte,
  ...photos,
  ...souvenir,
  ...gestion,
}

