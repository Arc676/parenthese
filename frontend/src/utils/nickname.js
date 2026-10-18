// Surnom affiché sous le nom dans l'arbre : coupé avec … au-delà de maxW (px du canevas).
// Le texte complet reste visible dans la fiche de la personne.
export function fitNickname(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text
  let out = text
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxW) out = out.slice(0, -1)
  return `${out.trimEnd()}…`
}
