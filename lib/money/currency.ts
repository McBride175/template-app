const ISO_CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/
const DECIMAL_PATTERN = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/
const MAX_DECIMAL_DIGITS = 100
const MAX_ABSOLUTE_EXPONENT = 100
const BIGINT_ZERO = BigInt(0)
const BIGINT_ONE = BigInt(1)
const BIGINT_TWO = BigInt(2)
const BIGINT_TEN = BigInt(10)

export const BASE_AMOUNT_DECIMAL_SCALE = 8
export const BASE_AMOUNT_ROUNDING_MODE = 'half_away_from_zero' as const

export type CurrencyConversionStatus = 'identity' | 'converted' | 'incomplete'

export type CurrencyConversionFailureReason =
  | 'missing_transaction_currency'
  | 'invalid_transaction_currency'
  | 'missing_base_currency'
  | 'invalid_base_currency'
  | 'missing_rate'
  | 'invalid_rate'

export type DecimalInput = string | number | null | undefined

interface ParsedDecimal {
  coefficient: bigint
  scale: number
}

export interface CurrencyAmountPair {
  native: string | null
  base: string | null
}

export interface CurrencyAmountsConversion<TAmounts extends Record<string, unknown>> {
  transactionCurrencyCode: string | null
  organisationBaseCurrencyCode: string | null
  xeroCurrencyRate: string | null
  status: CurrencyConversionStatus
  failureReason: CurrencyConversionFailureReason | null
  amounts: { [TKey in keyof TAmounts]: CurrencyAmountPair }
}

function isMissingString(value: unknown) {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '')
}

export function normalizeCurrencyCode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toUpperCase()
  return ISO_CURRENCY_CODE_PATTERN.test(normalized) ? normalized : null
}

function parseDecimal(value: DecimalInput): ParsedDecimal | null {
  let source: string

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    source = value.toString()
  } else if (typeof value === 'string') {
    source = value.trim()
    if (!source) return null
  } else {
    return null
  }

  const match = DECIMAL_PATTERN.exec(source)
  if (!match) return null

  const integerPart = match[2] ?? '0'
  const fractionalPart = match[3] ?? match[4] ?? ''
  const exponent = Number.parseInt(match[5] ?? '0', 10)
  if (!Number.isFinite(exponent) || Math.abs(exponent) > MAX_ABSOLUTE_EXPONENT) return null

  let digits = `${integerPart}${fractionalPart}`.replace(/^0+(?=\d)/, '')
  if (!digits) digits = '0'
  if (digits.length > MAX_DECIMAL_DIGITS) return null

  let scale = fractionalPart.length - exponent
  if (scale < 0) {
    const appendedZeros = -scale
    if (digits.length + appendedZeros > MAX_DECIMAL_DIGITS) return null
    digits += '0'.repeat(appendedZeros)
    scale = 0
  }
  if (scale > MAX_DECIMAL_DIGITS) return null

  const sign = match[1] === '-' ? -BIGINT_ONE : BIGINT_ONE
  const coefficient = BigInt(digits) * sign
  return {
    coefficient: coefficient === BIGINT_ZERO ? BIGINT_ZERO : coefficient,
    scale,
  }
}

function formatDecimal(value: ParsedDecimal, fixedScale: number | null = null) {
  const scale = fixedScale ?? value.scale
  const negative = value.coefficient < BIGINT_ZERO
  const absoluteDigits = (negative ? -value.coefficient : value.coefficient).toString()
  const paddedDigits = absoluteDigits.padStart(scale + 1, '0')
  const integerPart = scale === 0 ? paddedDigits : paddedDigits.slice(0, -scale)
  const fractionalPart = scale === 0 ? '' : paddedDigits.slice(-scale)

  if (fixedScale !== null) {
    return `${negative ? '-' : ''}${integerPart}${scale === 0 ? '' : `.${fractionalPart}`}`
  }

  const trimmedFractionalPart = fractionalPart.replace(/0+$/, '')
  return `${negative ? '-' : ''}${integerPart}${
    trimmedFractionalPart ? `.${trimmedFractionalPart}` : ''
  }`
}

export function normalizeDecimalValue(value: DecimalInput): string | null {
  const parsed = parseDecimal(value)
  return parsed ? formatDecimal(parsed) : null
}

function coefficientAtScale(value: ParsedDecimal, scale: number) {
  return value.coefficient * BIGINT_TEN ** BigInt(scale - value.scale)
}

/**
 * Adds decimal values without converting PostgreSQL numeric strings to binary
 * floating point. A null result means at least one input was not a valid
 * decimal; an empty list has the exact sum zero.
 */
export function sumDecimalValues(values: readonly DecimalInput[]): string | null {
  const parsedValues = values.map(parseDecimal)
  if (parsedValues.some((value) => value === null)) return null
  if (parsedValues.length === 0) return '0'

  const decimals = parsedValues as ParsedDecimal[]
  const scale = decimals.reduce((maximum, value) => Math.max(maximum, value.scale), 0)
  const coefficient = decimals.reduce(
    (sum, value) => sum + coefficientAtScale(value, scale),
    BIGINT_ZERO
  )

  return formatDecimal({ coefficient, scale })
}

/** Multiplies a decimal monetary amount by an exact whole-number day count. */
export function multiplyDecimalByInteger(
  value: DecimalInput,
  multiplier: number
): string | null {
  const parsed = parseDecimal(value)
  if (!parsed || !Number.isSafeInteger(multiplier)) return null

  return formatDecimal({
    coefficient: parsed.coefficient * BigInt(multiplier),
    scale: parsed.scale,
  })
}

export function compareDecimalValues(
  left: DecimalInput,
  right: DecimalInput
): number | null {
  const parsedLeft = parseDecimal(left)
  const parsedRight = parseDecimal(right)
  if (!parsedLeft || !parsedRight) return null

  const scale = Math.max(parsedLeft.scale, parsedRight.scale)
  const leftCoefficient = coefficientAtScale(parsedLeft, scale)
  const rightCoefficient = coefficientAtScale(parsedRight, scale)
  if (leftCoefficient < rightCoefficient) return -1
  if (leftCoefficient > rightCoefficient) return 1
  return 0
}

/**
 * Converts a validated decimal to a finite JavaScript number at a calculation
 * boundary. Money is aggregated before this is used; scoring itself remains
 * dimensionless number arithmetic.
 */
export function decimalValueToFiniteNumber(value: DecimalInput): number | null {
  const normalized = normalizeDecimalValue(value)
  if (normalized === null) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function divideDecimalToBase(nativeAmount: ParsedDecimal, rate: ParsedDecimal) {
  const nativeIsNegative = nativeAmount.coefficient < BIGINT_ZERO
  const nativeCoefficient = nativeIsNegative ? -nativeAmount.coefficient : nativeAmount.coefficient
  const rateCoefficient =
    rate.coefficient < BIGINT_ZERO ? -rate.coefficient : rate.coefficient
  const numerator =
    nativeCoefficient * BIGINT_TEN ** BigInt(rate.scale + BASE_AMOUNT_DECIMAL_SCALE)
  const denominator = rateCoefficient * BIGINT_TEN ** BigInt(nativeAmount.scale)

  let roundedCoefficient = numerator / denominator
  const remainder = numerator % denominator
  if (remainder * BIGINT_TWO >= denominator) {
    roundedCoefficient += BIGINT_ONE
  }
  if (nativeIsNegative) roundedCoefficient = -roundedCoefficient

  return formatDecimal(
    { coefficient: roundedCoefficient, scale: BASE_AMOUNT_DECIMAL_SCALE },
    BASE_AMOUNT_DECIMAL_SCALE
  )
}

/**
 * Converts native transaction amounts into organisation base currency using
 * Xero's rate direction: transaction-currency units per one base-currency unit.
 * Foreign base amounts are therefore native / rate. Derived amounts are rounded
 * to BASE_AMOUNT_DECIMAL_SCALE with half-away-from-zero rounding.
 */
export function convertCurrencyAmounts<TAmounts extends Record<string, unknown>>(params: {
  transactionCurrency: unknown
  organisationBaseCurrency: unknown
  xeroCurrencyRate: DecimalInput
  amounts: TAmounts
}): CurrencyAmountsConversion<TAmounts> {
  const transactionCurrencyCode = normalizeCurrencyCode(params.transactionCurrency)
  const organisationBaseCurrencyCode = normalizeCurrencyCode(params.organisationBaseCurrency)
  const parsedRate = parseDecimal(params.xeroCurrencyRate)
  const positiveRate =
    parsedRate && parsedRate.coefficient > BIGINT_ZERO ? parsedRate : null
  const xeroCurrencyRate = positiveRate ? formatDecimal(positiveRate) : null

  let status: CurrencyConversionStatus
  let failureReason: CurrencyConversionFailureReason | null = null

  if (!transactionCurrencyCode) {
    status = 'incomplete'
    failureReason = isMissingString(params.transactionCurrency)
      ? 'missing_transaction_currency'
      : 'invalid_transaction_currency'
  } else if (!organisationBaseCurrencyCode) {
    status = 'incomplete'
    failureReason = isMissingString(params.organisationBaseCurrency)
      ? 'missing_base_currency'
      : 'invalid_base_currency'
  } else if (transactionCurrencyCode === organisationBaseCurrencyCode) {
    status = 'identity'
  } else if (isMissingString(params.xeroCurrencyRate)) {
    status = 'incomplete'
    failureReason = 'missing_rate'
  } else if (!positiveRate) {
    status = 'incomplete'
    failureReason = 'invalid_rate'
  } else {
    status = 'converted'
  }

  const amountEntries = Object.entries(params.amounts).map(([key, input]) => {
    const parsedNativeAmount = parseDecimal(input as DecimalInput)
    const native = parsedNativeAmount ? formatDecimal(parsedNativeAmount) : null
    let base: string | null = null

    if (parsedNativeAmount && status === 'identity') {
      base = native
    } else if (parsedNativeAmount && status === 'converted' && positiveRate) {
      base = divideDecimalToBase(parsedNativeAmount, positiveRate)
    }

    return [key, { native, base }] as const
  })

  return {
    transactionCurrencyCode,
    organisationBaseCurrencyCode,
    xeroCurrencyRate,
    status,
    failureReason,
    amounts: Object.fromEntries(amountEntries) as {
      [TKey in keyof TAmounts]: CurrencyAmountPair
    },
  }
}
