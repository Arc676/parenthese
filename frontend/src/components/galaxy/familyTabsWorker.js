// Liste des onglets de familles calculée hors du fil principal : sur un arbre de quelques milliers de personnes,
// familyTabsOf place chaque onglet pour trouver ceux qu'il cache, plusieurs secondes pendant lesquelles la page
// ne répondrait plus. Le graphe arrive avec la demande (ce module n'a pas les données de l'arbre).
import { familyTabsOf } from './blockLayout'

self.onmessage = ({ data: { id, graph, referenceId } }) => {
  try {
    self.postMessage({ id, tabs: familyTabsOf(graph, referenceId) })
  } catch (error) {
    self.postMessage({ id, error: String(error?.message || error) })
  }
}
