/**
 * PROTECTED TEST. specs/comments.md, rules 2.5, 3.1 and 3.3: mentions name exactly one person
 * and comments are plain text. Human-owned once the spec is merged.
 */
import { describe, expect, it } from 'vitest'
import { commentSegments, mentionToken, parseMentions } from '../../src/index.js'

describe('mentions (specs/comments.md, section 3)', () => {
  it('a mention names one person by id, each person once', () => {
    const body = `${mentionToken('Grace Lim', 'user-7')} and ${mentionToken('Hugo', 'user-8')}, ${mentionToken('Grace Lim', 'user-7')}`
    expect(parseMentions(body)).toEqual(['user-7', 'user-8'])
  })

  it('a plain @name is just text: only picked mentions count', () => {
    expect(parseMentions('@Grace can you check?')).toEqual([])
    expect(parseMentions('@[Grace](bad id!)')).toEqual([])
  })

  it('two people with the same name stay distinct', () => {
    const body = `${mentionToken('Sam', 'user-20')} ${mentionToken('Sam', 'user-21')}`
    expect(parseMentions(body)).toEqual(['user-20', 'user-21'])
  })

  it('names cannot break out of the token', () => {
    expect(mentionToken('Evil](user-1) [x', 'user-9')).toBe('@[Evil(user-1) x](user-9)')
    expect(parseMentions(mentionToken('Evil](user-1) [x', 'user-9'))).toEqual(['user-9'])
  })
})

describe('plain text (rule 2.5)', () => {
  it('splits into text and mentions, keeping everything else as written', () => {
    const body = `<b>hi</b> ${mentionToken('Grace Lim', 'user-7')}\nthanks`
    expect(commentSegments(body)).toEqual([
      { kind: 'text', text: '<b>hi</b> ' },
      { kind: 'mention', name: 'Grace Lim', userId: 'user-7' },
      { kind: 'text', text: '\nthanks' },
    ])
    expect(commentSegments('')).toEqual([])
  })
})
