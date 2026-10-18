import { PAREN_LEFT, PAREN_RIGHT } from './pzMarkPaths.js'
import { LOGO_NOM } from './logoNomPaths.js'

// Logo de l'en-tête en SVG en ligne, pour animer son arrivée : les parenthèses s'ouvrent,
// le rond se pose, le nom suit. Une fois par visite, décidé dans index.html (classe
// logo-intro sur <html>), animation dans index.css. Même dessin que /logo.svg, rapport 7,541.
// Symbole seul (parenthèses et rond, sans le nom) : emprise mesurée sur le dessin, pour le téléphone
export default function LogoLockup({ height = 22, mark = false, decorative = false, className = 'lg lk' }) {
  const viewBox = mark ? '-940 -1585 1880 1680' : '-951.9 -1596.5 12857.7 1704.9'
  const width = mark ? Math.round(height * 1880 / 1680) : Math.round(height * 7.541)
  return (
    <svg
      className={className}
      viewBox={viewBox}
      width={width}
      height={height}
      style={{ height }}
      {...(decorative ? { 'aria-hidden': 'true', focusable: 'false' } : { role: 'img', 'aria-label': 'Parenthèse' })}
    >
      <g className="lk-pl"><path transform="scale(1,-1)" d={PAREN_LEFT} /></g>
      <g className="lk-pr"><path transform="scale(1,-1)" d={PAREN_RIGHT} /></g>
      <circle className="lk-dot" cx="0" cy="-744" r="424.3" />
      {!mark && (
        <g className="lk-nom">
          <g transform="scale(1,-1)">
            {LOGO_NOM.map((d, i) => <path key={i} d={d} />)}
          </g>
        </g>
      )}
    </svg>
  )
}
