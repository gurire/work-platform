/**
 * Money is always an integer number of minor units (e.g. cents) plus a currency.
 * Floats never touch money: rounding happens once, explicitly, with half-even
 * (banker's) rounding so totals don't drift when many line items are summed.
 * See docs/adr/0004-money-and-time.md.
 */
export interface Money {
  readonly amountMinor: number
  readonly currency: string
}

function assertSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be a safe integer, got ${value}`)
  }
}

export function money(amountMinor: number, currency: string): Money {
  assertSafeInteger(amountMinor, 'amountMinor')
  if (!/^[A-Z]{3}$/.test(currency)) throw new RangeError(`Invalid ISO 4217 currency: ${currency}`)
  return { amountMinor, currency }
}

export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) {
    throw new TypeError(`Cannot add ${a.currency} to ${b.currency}`)
  }
  return money(a.amountMinor + b.amountMinor, a.currency)
}

/** Divide two integers and round half to even. Denominator must be positive. */
export function divideRoundHalfEven(numerator: number, denominator: number): number {
  assertSafeInteger(numerator, 'numerator')
  assertSafeInteger(denominator, 'denominator')
  if (denominator <= 0) throw new RangeError('denominator must be positive')
  const quotient = Math.floor(numerator / denominator)
  const remainder = numerator - quotient * denominator
  const twice = remainder * 2
  if (twice < denominator) return quotient
  if (twice > denominator) return quotient + 1
  return quotient % 2 === 0 ? quotient : quotient + 1
}

/**
 * Billable amount for logged time: minutes × hourly rate (in minor units per hour),
 * rounded once at the end.
 */
export function billableAmount(minutes: number, hourlyRate: Money): Money {
  assertSafeInteger(minutes, 'minutes')
  if (minutes < 0) throw new RangeError('minutes must not be negative')
  return money(divideRoundHalfEven(minutes * hourlyRate.amountMinor, 60), hourlyRate.currency)
}
