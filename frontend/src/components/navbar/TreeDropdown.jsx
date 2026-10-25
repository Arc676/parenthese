import { Trees } from 'lucide-react'
import { t } from '../../i18n/index.js'
import './TreeDropdown.css'

/**
 * Dropdown de sélection d'arbres
 * Affiche la liste des arbres accessibles + option création
 *
 * @param {Object} props
 * @param {Array} props.trees - Liste des arbres [{id, name, role, thumb}]
 * @param {string} props.activeTreeId - ID de l'arbre actif
 * @param {Function} props.onSelect - Handler sélection arbre (treeId)
 * @param {Function} props.onCreate - Handler création nouvel arbre
 */
function TreeDropdown({ trees = [], activeTreeId, onSelect, onCreate }) {
  // Séparer arbres par type
  const myTrees = trees.filter((tree) => tree.role === 'owner' || tree.role === 'admin')
  const sharedTrees = trees.filter((tree) => tree.role !== 'owner' && tree.role !== 'admin')
  const mockTree = trees.find((tree) => tree.isMockTree)

  return (
    <div className="tree-dropdown">
      {/* Mes arbres */}
      {myTrees.length > 0 && (
        <div className="tree-dropdown-section">
          <div className="tree-dropdown-section-title">{t('Mes arbres')}</div>
          {myTrees.map(tree => (
            <button
              key={tree.id}
              type="button"
              className={`tree-dropdown-item ${tree.id === activeTreeId ? 'active' : ''}`}
              onClick={() => onSelect(tree.id)}
            >
              <div className="tree-dropdown-item-thumb">
                {tree.thumb ? (
                  <img src={tree.thumb} alt="" />
                ) : (
                  <span className="tree-dropdown-item-icon"><Trees size={18} strokeWidth={2} /></span>
                )}
              </div>
              <div className="tree-dropdown-item-info">
                <div className="tree-dropdown-item-name">{tree.name}</div>
                <div className="tree-dropdown-item-role">
                  {tree.role === 'owner' ? t('Propriétaire') : t('Co-gestionnaire')}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Arbres partagés */}
      {sharedTrees.length > 0 && (
        <div className="tree-dropdown-section">
          <div className="tree-dropdown-section-title">{t('Arbres partagés')}</div>
          {sharedTrees.map(tree => (
            <button
              key={tree.id}
              type="button"
              className={`tree-dropdown-item ${tree.id === activeTreeId ? 'active' : ''}`}
              onClick={() => onSelect(tree.id)}
            >
              <div className="tree-dropdown-item-thumb">
                {tree.thumb ? (
                  <img src={tree.thumb} alt="" />
                ) : (
                  <span className="tree-dropdown-item-icon"><Trees size={18} strokeWidth={2} /></span>
                )}
              </div>
              <div className="tree-dropdown-item-info">
                <div className="tree-dropdown-item-name">{tree.name}</div>
                <div className="tree-dropdown-item-role">
                  {tree.role === 'contributor' ? t('Contributeur') : t('Visiteur')}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Arbre mock */}
      {mockTree && (
        <div className="tree-dropdown-section">
          <div className="tree-dropdown-section-title">{t('Exemple')}</div>
          <button
            type="button"
            className={`tree-dropdown-item ${mockTree.id === activeTreeId ? 'active' : ''}`}
            onClick={() => onSelect(mockTree.id)}
          >
            <div className="tree-dropdown-item-thumb">
              <span className="tree-dropdown-item-icon">✨</span>
            </div>
            <div className="tree-dropdown-item-info">
              <div className="tree-dropdown-item-name">{mockTree.name}</div>
              <div className="tree-dropdown-item-role">{t('Arbre exemple')}</div>
            </div>
          </button>
        </div>
      )}

      {/* Actions */}
      <div className="tree-dropdown-actions">
        <button
          type="button"
          className="tree-dropdown-create"
          onClick={onCreate}
        >
          <span className="tree-dropdown-create-icon">+</span>
          <span>{t('Créer un nouvel arbre')}</span>
        </button>
      </div>
    </div>
  )
}

export default TreeDropdown
