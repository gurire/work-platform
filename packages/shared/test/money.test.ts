import { describe, expect, it } from 'vitest'
import { addMoney, billableAmount, divideRoundHalfEven, money } from '../src/money.js'

describe('divideRoundHalfEven', () => {
  it('rounds halves to the nearest even integer', () => {
    expect(divideRoundHalfEven(5, 2)).toBe(2)
    expect(divideRoundHalfEven(7, 2)).toBe(4)
    expect(divideRoundHalfEven(-5, 2)).toBe(-2)
  })

  it('rounds non-halves normally', () => {
    expect(divideRoundHalfEven(10, 3)).toBe(3)
    expect(divideRoundHalfEven(11, 3)).toBe(4)
  })
})

describe('billableAmount', () => {
  it('bills 90 minutes at 150.00/h as 225.00', () => {
    expect(billableAmount(90, money(15000, 'USD'))).toEqual(money(22500, 'USD'))
  })

  it('rounds once at the end, not per minute', () => {
    // 7 minutes at 100.01/h = 70007/60 = 1166.78 minor units, rounds to 1167
    expect(billableAmount(7, money(10001, 'EUR')).amountMinor).toBe(1167)
  })
})

describe('money', () => {
  it('rejects fractional minor units and bad currencies', () => {
    expect(() => money(1.5, 'USD')).toThrow(RangeError)
    expect(() => money(100, 'usd')).toThrow(RangeError)
  })

  it('refuses to add different currencies', () => {
    expect(() => addMoney(money(1, 'USD'), money(1, 'EUR'))).toThrow(TypeError)
  })
})
