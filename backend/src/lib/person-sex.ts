import { z } from 'zod'

// Sexe d'une personne : 'male', 'female', 'other' (autre), ou null (non précisé). L'import GEDCOM écrit
// 'male'/'female'/'other' (SEX X de GEDCOM 7), d'anciens clients de l'API ont pu écrire 'M'/'F' : tout est
// ramené à ces valeurs, à l'écriture comme à la lecture, sans migration des lignes existantes.
export type PersonSex = 'male' | 'female' | 'other'

const MALE = new Set(['male', 'm', 'homme', 'h'])
const FEMALE = new Set(['female', 'f', 'femme'])
const OTHER = new Set(['other', 'x', 'autre'])
const UNSPECIFIED = new Set(['', 'u', 'unknown', 'unspecified'])

// undefined : valeur que l'on ne sait pas lire (refusée à l'écriture)
export function parseSex(value: string | null): PersonSex | null | undefined {
  if (value === null) return null
  const key = value.trim().toLowerCase()
  if (MALE.has(key)) return 'male'
  if (FEMALE.has(key)) return 'female'
  if (OTHER.has(key)) return 'other'
  if (UNSPECIFIED.has(key)) return null
  return undefined
}

// Lecture d'une valeur déjà en base : ce qu'on ne sait pas lire vaut « non précisé »
export function sexOrNull(value: string | null | undefined): PersonSex | null {
  return parseSex(value ?? null) ?? null
}

// Champ « sex » des schémas d'écriture : facultatif, null pour « non précisé », valeur ramenée à male/female/other
export const sexSchema = z
  .string()
  .max(20)
  .nullable()
  .refine((value) => parseSex(value) !== undefined, { message: 'invalid_sex' })
  .transform((value) => parseSex(value) ?? null)
  .optional()
