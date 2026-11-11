import { normalizeSex } from './index.js'

// Mot genré quand le sexe de la personne nommée est connu, forme double sinon
const g = (sex, male, female, other) => (sex === 'male' ? male : sex === 'female' ? female : other)

export const
  FATHER = 'f',
  MOTHER = 'm',
  PARENT = 'A',

  HUSBAND = 'h',
  WIFE = 'w',
  PARTNER = 'P',

  OLDER_BROTHER = 'g',
  YOUNGER_BROTHER = 'd',
  OLDER_SISTER = 'j',
  YOUNGER_SISTER = 'k',
  OLDER_SIBLING = 'S',
  YOUNGER_SIBLING = 'T',
  BROTHER = 'X',
  SISTER = 'J',
  SIBLING = 'Z',

  SON = 'e',
  DAUGHTER = 'n',
  CHILD = 'C'

const links = {
  // Great-granchildren and below
  'eee': '曾孙子',
  'een': '曾孙女',

  // Grandchildren
  'ee': '孙子',
  'en': '孙女',
  'ne': '外孙',
  'nn': '外孙女',

  'eew': '孙媳',
  'enh': '孙婿',
  'new': '外孙妇',
  'nnh': '外孙婿',

  // Children
  'e': '儿子',
  'n': '女儿',

  // Nephews
  'ge': '侄子',
  'gn': '侄女',
  'je': '外甥',
  'jn': '外甥女',

  'gee': '侄孙',
  'gen': '侄孙女',
  'jee': '甥孙',
  'jen': '甥孙女',

  'gew': '侄妇',
  'gnh': '侄婿',
  'jew': '甥妇',
  'jnh': '甥婿',

  // Siblings
  'g': '哥哥',
  'd': '弟弟',
  'j': '姊姊',
  'k': '妹妹',

  // Parents, aunts, and uncles
  'f': '父亲',
  'm': '母亲',
  'fg': '伯父',
  'fd': '叔父',
  'fj': '姑母',
  'mg': '舅父',
  'mj': '姨母',

  // Spouses (assumes marriage)
  'h': '丈夫',
  'w': '妻子',

  // In-laws
  'ew': '媳妇',
  'nh': '女婿',
  'gw': '嫂嫂',
  'dw': '弟妇',
  'jh': '姊夫',
  'kh': '妹夫',
  'hf': '公公',
  'hm': '婆婆',
  'wf': '岳父',
  'wm': '岳母',
  'hg': '大伯',
  'hd': '小叔',
  'hj': '大姑',
  'hk': '小姑',
  'wg': '大舅',
  'wj': '大姨',
  'wd': '小舅',
  'wk': '小姨',

  'fgw': '伯母',
  'fdw': '叔母',
  'fjh': '姑父',
  'mgw': '舅母',
  'mjh': '姨父',

  // Grandparents and above
  'ff': '爷爷',
  'fm': '奶奶',

  'ffg': '伯祖父',
  'ffd': '叔祖父',
  'ffj': '姑祖母',

  'mf': '外公',
  'mm': '外婆',

  'fff': '曾祖父',
  'ffm': '曾祖母',

  'ffff': '高祖父',
  'fffm': '高祖母',
}

function disambiguate(moveCode) {
  switch (moveCode) {
    case PARENT:
      return [FATHER, MOTHER]

    case CHILD:
      return [SON, DAUGHTER]

    case PARTNER:
      return [HUSBAND, WIFE]

    case OLDER_SIBLING:
      return [OLDER_BROTHER, OLDER_SISTER]

    case YOUNGER_SIBLING:
      return [YOUNGER_BROTHER, YOUNGER_SISTER]

    case BROTHER:
      return [OLDER_BROTHER, YOUNGER_BROTHER]

    case SISTER:
      return [OLDER_SISTER, YOUNGER_SISTER]

    default:
      return [undefined, undefined]
  }
}

function getCousin(pathCode, isOlder) {
  let prefix = pathCode.match(/^f[gd]/) ? '堂' : '表'

  let pseudoSibling = pathCode.charAt(2) === SON ?
    (isOlder ? OLDER_BROTHER : YOUNGER_BROTHER) :
    (isOlder ? OLDER_SISTER : YOUNGER_SISTER)
  let newPath = `${pseudoSibling}${pathCode.substr(3)}`

  if (newPath in links) {
    return `${prefix}${links[newPath].replace(/([\p{Script=Han}])\1/u, "$1")}`
  }

  return undefined
}

function getPromoted(pathCode) {
  pathCode = pathCode
    .replaceAll(YOUNGER_BROTHER, OLDER_BROTHER)
    .replaceAll(YOUNGER_SISTER, OLDER_SISTER)

  if (pathCode in links) {
    return links[pathCode]
  }

  if (pathCode.match(/^([fm]|[en])+.$/)) {
    let middle, end

    if (pathCode.match(/[hw]$/)) {
      middle = pathCode.substring(0, pathCode.length - 2)
      end = pathCode.substr(pathCode.length - 2)
    } else {
      middle = pathCode.substring(0, pathCode.length - 1)
      end = pathCode.charAt(pathCode.length - 1)
    }
    let newPath = `${middle.replaceAll(MOTHER, FATHER).replaceAll(DAUGHTER, SON)}${end}`
    if (newPath in links) {
      return `外${links[newPath]}`
    }
  }

  let end = pathCode.charAt(pathCode.length - 1)
  pathCode = pathCode.substring(0, pathCode.length - 1)
    .replaceAll(DAUGHTER, SON)
  pathCode = `${pathCode}${end}`

  if (pathCode in links) {
    return links[pathCode]
  }

  return undefined
}

export function getName(pathCode, isCousin, isOlder) {
  if (pathCode in links) {
    return links[pathCode]
  } else {
    let promoted = getPromoted(pathCode)
    if (promoted !== undefined) return promoted
  }

  if (pathCode.match(/(.*[A-Z].*){2,}/)) {
    return undefined
  }

  let singleUnknown = pathCode.match(/^(?<known1>[a-z]*)(?<unknown>[A-Z])(?<known2>[a-z]*)$/)
  if (singleUnknown) {
    let k1 = singleUnknown.groups.known1
    let k2 = singleUnknown.groups.known2

    let [a, b] = disambiguate(singleUnknown.groups.unknown)
    if (a === undefined) {
      return undefined
    }

    a = getName(`${k1}${a}${k2}`)
    b = getName(`${k1}${b}${k2}`)

    if (a === b) return a

    return `${a}/${b}`
  }

  if (isCousin) {
    return getCousin(pathCode, isOlder)
  }

  return undefined
}

export function encodePath(path) {
  let pathCode = ""
  let myBirth = path.from.birthYear ?? path.from.birthDate
  let lastBirth = myBirth
  let lastFamilialBirth = myBirth
  let generationDistance = 0

  for (const { move, person } of path.steps) {
    let s = normalizeSex(person.sex)
    let personBirth = person.birthYear ?? person.birthDate
    let next

    if (move === 'up') {
      next = g(s, FATHER, MOTHER, PARENT)
      generationDistance++
    } else if (move === 'down') {
      next = g(s, SON, DAUGHTER, CHILD)
      generationDistance--
    } else if (move === 'sibling') {
      if (!Number.isFinite(lastBirth) || !Number.isFinite(personBirth)) {
        next = g(s, BROTHER, SISTER, SIBLING)
      } else {
        if (personBirth < lastBirth) {
          next = g(s, OLDER_BROTHER, OLDER_SISTER, OLDER_SIBLING)
        } else {
          next = g(s, YOUNGER_BROTHER, YOUNGER_SISTER, YOUNGER_SIBLING)
        }
      }
    }
    else if (move === 'spouse') next = g(s, HUSBAND, WIFE, PARTNER)

    pathCode += next

    lastBirth = personBirth
    if (move !== 'spouse') {
      lastFamilialBirth = personBirth
    }
  }

  return { pathCode, generationDistance, isOlder: lastFamilialBirth < myBirth }
}

export default function nameZh(path) {
  let { pathCode, generationDistance, isOlder } = encodePath(path)

  let label = getName(pathCode, generationDistance === 0 && !pathCode.match(/^[hw]/), isOlder)
  if (label === undefined) {
    let vertical = 0, sideways = 0
    for (const { move } of path.steps) {
      if (move === 'up') vertical++
      else if (move === 'down') vertical--
      else if (move === 'sibling') sideways++
    }

    let distance = Math.abs(vertical) + sideways
    let ordinal = distance > 10 ? `${distance}` :
      ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'][distance - 1]

    return `${ordinal}亲`
  }

  return label
}
