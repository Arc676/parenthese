import { describe, it, expect } from 'vitest'
import { encodePath, getName } from './zh.js'
import nameZh from './zh.js'
import * as zh from './zh.js'

const path = (steps) => ({
  from: { birthYear: 0 },
  steps: steps
})

const getCousin = (isOlder, ...steps) => (getName([...steps].join(''), true, isOlder))
const getRelative = (...steps) => (getName([...steps].join(''), false, false))

describe('nommage chinois', () => {
  it('name for a given path', () => {
    expect(getRelative(zh.FATHER)).toEqual('父亲')
    expect(getRelative(zh.FATHER, zh.FATHER, zh.FATHER)).toEqual('曾祖父')
    expect(getRelative(zh.SON, zh.SON)).toEqual('孙子')
    expect(getCousin(true, zh.FATHER, zh.YOUNGER_BROTHER, zh.SON)).toEqual('堂哥')
    expect(getCousin(true, zh.FATHER, zh.OLDER_BROTHER, zh.SON, zh.WIFE)).toEqual('堂嫂')
    expect(getCousin(true, zh.FATHER, zh.OLDER_SISTER, zh.DAUGHTER)).toEqual('表姊')
    expect(getCousin(false, zh.MOTHER, zh.OLDER_SISTER, zh.DAUGHTER)).toEqual('表妹')
    expect(getCousin(false, zh.MOTHER, zh.YOUNGER_SISTER, zh.DAUGHTER, zh.HUSBAND)).toEqual('表妹夫')
    expect(getCousin(false, zh.FATHER, zh.YOUNGER_BROTHER, zh.SON, zh.WIFE)).toEqual('堂弟妇')
    //expect(both(['up', 'up', 'sibling'])).toEqual(['Great-uncle', 'Great-aunt', 'Great-uncle/aunt'])
    //expect(both(['sibling', 'down', 'down'])).toEqual(['Grandnephew', 'Grandniece'])
  })

  it('maternal grandparents and daughter-linked descendants', () => {
    expect(getRelative(zh.MOTHER, zh.FATHER)).toEqual('外公')
    expect(getRelative(zh.FATHER, zh.MOTHER, zh.FATHER)).toEqual('外曾祖父')
    expect(getRelative(zh.MOTHER, zh.MOTHER, zh.FATHER)).toEqual('外曾祖父')
    expect(getRelative(zh.MOTHER, zh.MOTHER, zh.MOTHER, zh.FATHER)).toEqual('外高祖父')
    expect(getRelative(zh.FATHER, zh.MOTHER, zh.MOTHER, zh.MOTHER)).toEqual('外高祖母')
    expect(getRelative(zh.MOTHER, zh.FATHER, zh.MOTHER, zh.FATHER)).toEqual('外高祖父')
    expect(getRelative(zh.MOTHER, zh.FATHER, zh.MOTHER, zh.MOTHER)).toEqual('外高祖母')

    expect(getRelative(zh.DAUGHTER, zh.DAUGHTER)).toEqual('外孙女')
    expect(getRelative(zh.DAUGHTER, zh.DAUGHTER, zh.DAUGHTER)).toEqual('外曾孙女')
    expect(getRelative(zh.DAUGHTER, zh.SON, zh.DAUGHTER)).toEqual('外曾孙女')
    expect(getRelative(zh.DAUGHTER, zh.SON, zh.SON)).toEqual('外曾孙子')
  })

  it('promote when dedicated term is missing', () => {
    expect(getRelative(zh.YOUNGER_BROTHER, zh.SON)).toEqual('侄子')
    expect(getRelative(zh.MOTHER, zh.YOUNGER_SISTER)).toEqual('姨母')
    expect(getRelative(zh.FATHER, zh.YOUNGER_SISTER)).toEqual('姑母')
    expect(getRelative(zh.MOTHER, zh.YOUNGER_BROTHER)).toEqual('舅父')
    expect(getRelative(zh.MOTHER, zh.YOUNGER_SISTER, zh.HUSBAND)).toEqual('姨父')
  })

  it('disambiguate when two options are available', () => {
    expect(getRelative(zh.PARENT)).toEqual('父亲/母亲')
    expect(getRelative(zh.FATHER, zh.BROTHER)).toEqual('伯父/叔父')
    expect(getRelative(zh.MOTHER, zh.OLDER_SIBLING)).toEqual('舅父/姨母')
    expect(getRelative(zh.BROTHER, zh.WIFE)).toEqual('嫂嫂/弟妇')
  })

  it('fallback when unknown', () => {
    expect(getRelative(zh.PARENT, zh.PARENT)).toEqual(undefined)
    expect(nameZh(path([
      { move: 'up', person: {} },
      { move: 'up', person: {} }
    ]))).toEqual('二亲')
    expect(nameZh(path([
      { move: 'up', person: {} },
      { move: 'up', person: {} },
      { move: 'sibling', person: {} }
    ]))).toEqual('三亲')
    expect(nameZh(path([
      { move: 'up', person: {} },
      { move: 'up', person: {} },
      { move: 'sibling', person: {} },
      { move: 'down', person: {} }
    ]))).toEqual('二亲')
  })

  it('path encoding', () => {
    expect(encodePath(path([
      { move: 'up', person: { birthYear: -30, sex: 'male' } }
    ]))).toEqual({
      generationDistance: 1,
      isOlder: true,
      pathCode: 'f'
    })
    expect(encodePath(path([
      { move: 'up', person: { birthYear: -30, sex: 'male' } },
      { move: 'sibling', person: { birthYear: -31, sex: 'male' } }
    ]))).toEqual({
      generationDistance: 1,
      isOlder: true,
      pathCode: 'fg'
    })
    expect(encodePath(path([
      { move: 'up', person: { birthYear: -30, sex: 'male' } },
      { move: 'sibling', person: { birthYear: -29, sex: 'male' } }
    ]))).toEqual({
      generationDistance: 1,
      isOlder: true,
      pathCode: 'fd'
    })
    expect(encodePath(path([
      { move: 'up', person: { birthYear: -30, sex: 'male' } },
      { move: 'sibling', person: { birthYear: -29, sex: 'male' } },
      { move: 'down', person: { birthYear: 1, sex: 'male' } },
      { move: 'spouse', person: { birthYear: 1, sex: 'female' } }
    ]))).toEqual({
      generationDistance: 0,
      isOlder: false,
      pathCode: 'fdew'
    })
  })
})

