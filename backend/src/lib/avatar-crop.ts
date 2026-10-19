import { z } from 'zod'

// Cadrage d'un portrait : centre (proportions de l'image), zoom, et forme du cadre si on l'a choisie.
// Zoom 1 = l'image entière recouvre le cadre. Les bornes qui empêchent le vide sont appliquées à
// l'affichage (frontend, portraitCrop.js), le serveur vérifie seulement la forme et les plages.
export const FRAME_SHAPES = ['round', 'square', 'polaroid', 'portrait', 'landscape'] as const
export type AvatarCrop = { x: number; y: number; zoom: number; shape?: (typeof FRAME_SHAPES)[number] }

export const AVATAR_CROP_MAX_ZOOM = 4

export const avatarCropInputSchema = z.object({
  crop: z
    .object({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      zoom: z.number().min(1).max(AVATAR_CROP_MAX_ZOOM),
      shape: z.enum(FRAME_SHAPES).optional(),
    })
    .nullable(),
})

const round4 = (value: number) => Math.round(value * 10000) / 10000

// Forme à écrire en base. Le cadrage par défaut, sans forme choisie, se stocke comme absence de cadrage (null).
export function toStoredAvatarCrop(crop: AvatarCrop | null): AvatarCrop | null {
  if (!crop) return null
  const normalized = { x: round4(crop.x), y: round4(crop.y), zoom: round4(crop.zoom) }
  if (crop.shape) return { ...normalized, shape: crop.shape }
  if (normalized.x === 0.5 && normalized.y === 0.5 && normalized.zoom === 1) return null
  return normalized
}

// Lecture de la colonne JSON : tout ce qui ne respecte pas la forme est ignoré (portrait affiché tel quel).
export function readAvatarCrop(value: unknown): AvatarCrop | null {
  const parsed = avatarCropInputSchema.shape.crop.safeParse(value)
  return parsed.success ? parsed.data : null
}
