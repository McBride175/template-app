export const RELATIVE_LATENESS_NOISE_FLOOR_DAYS = 3
export const MINIMUM_MATERIAL_RELATIVE_LATENESS_PORTFOLIO_SIZE = 5
export const RELATIVE_LATENESS_ABSOLUTE_MAXIMUM_REFERENCE_DAYS = 30
export const RELATIVE_LATENESS_MIDPOINT_ABSOLUTE_FLOOR_DAYS = 16.5
export const RELATIVE_LATENESS_MINIMUM_UPPER_SPAN_DAYS = 13.5

const RELATIVE_LATENESS_MIDPOINT_PERCENTILE = 0.5
const RELATIVE_LATENESS_HIGH_PERCENTILE = 0.9
const MINIMUM_COMPONENT_SCORE = 0
const MAXIMUM_COMPONENT_SCORE = 100
const MIDPOINT_COMPONENT_SCORE = 50

export interface RelativeLatenessCustomerEvidence {
  overdueOutstandingBase: number
  relativeLatenessDays: number | null
}

export type RelativeLatenessNormalizationMode =
  | 'absolute-fallback'
  | 'portfolio-relative'

export interface RelativeLatenessContext {
  mode: RelativeLatenessNormalizationMode
  materialObservationCount: number
  midpointAnchorDays: number
  highAnchorDays: number
  materialP50Days: number | null
  materialP90Days: number | null
}

function buildAbsoluteFallbackContext(
  materialObservationCount: number
): RelativeLatenessContext {
  return {
    mode: 'absolute-fallback',
    materialObservationCount,
    midpointAnchorDays: RELATIVE_LATENESS_MIDPOINT_ABSOLUTE_FLOOR_DAYS,
    highAnchorDays: RELATIVE_LATENESS_ABSOLUTE_MAXIMUM_REFERENCE_DAYS,
    materialP50Days: null,
    materialP90Days: null,
  }
}

function clampComponentScore(value: number) {
  if (!Number.isFinite(value)) return MINIMUM_COMPONENT_SCORE
  return Math.max(MINIMUM_COMPONENT_SCORE, Math.min(MAXIMUM_COMPONENT_SCORE, value))
}

function isMaterialRelativeLateness(value: number | null): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value > RELATIVE_LATENESS_NOISE_FLOOR_DAYS
  )
}

export function calculateLinearInterpolatedPercentile(
  sortedObservations: readonly number[],
  percentile: number
): number | null {
  if (
    sortedObservations.length === 0 ||
    !Number.isFinite(percentile) ||
    percentile < 0 ||
    percentile > 1 ||
    sortedObservations.some((value) => !Number.isFinite(value))
  ) {
    return null
  }

  const index = (sortedObservations.length - 1) * percentile
  const lowerIndex = Math.floor(index)
  const upperIndex = Math.ceil(index)
  const lowerValue = sortedObservations[lowerIndex]

  if (lowerIndex === upperIndex) return lowerValue

  const upperValue = sortedObservations[upperIndex]
  const interpolationWeight = index - lowerIndex
  return lowerValue + (upperValue - lowerValue) * interpolationWeight
}

export function buildRelativeLatenessContext(
  customers: readonly RelativeLatenessCustomerEvidence[]
): RelativeLatenessContext {
  const materialObservations = customers
    .flatMap((customer) => {
      const relativeLatenessDays = customer.relativeLatenessDays
      return Number.isFinite(customer.overdueOutstandingBase) &&
        customer.overdueOutstandingBase > 0 &&
        isMaterialRelativeLateness(relativeLatenessDays)
        ? [relativeLatenessDays]
        : []
    })
    .sort((left, right) => left - right)

  const materialObservationCount = materialObservations.length

  if (materialObservationCount < MINIMUM_MATERIAL_RELATIVE_LATENESS_PORTFOLIO_SIZE) {
    return buildAbsoluteFallbackContext(materialObservationCount)
  }

  const materialP50Days = calculateLinearInterpolatedPercentile(
    materialObservations,
    RELATIVE_LATENESS_MIDPOINT_PERCENTILE
  )
  const materialP90Days = calculateLinearInterpolatedPercentile(
    materialObservations,
    RELATIVE_LATENESS_HIGH_PERCENTILE
  )

  if (materialP50Days === null || materialP90Days === null) {
    return buildAbsoluteFallbackContext(materialObservationCount)
  }
  const midpointAnchorDays = Math.max(
    materialP50Days,
    RELATIVE_LATENESS_MIDPOINT_ABSOLUTE_FLOOR_DAYS
  )
  const highAnchorDays = Math.max(
    materialP90Days,
    RELATIVE_LATENESS_ABSOLUTE_MAXIMUM_REFERENCE_DAYS,
    midpointAnchorDays + RELATIVE_LATENESS_MINIMUM_UPPER_SPAN_DAYS
  )

  return {
    mode: 'portfolio-relative',
    materialObservationCount,
    midpointAnchorDays,
    highAnchorDays,
    materialP50Days,
    materialP90Days,
  }
}

export function computeRelativeLatenessScore(
  customer: RelativeLatenessCustomerEvidence,
  context: RelativeLatenessContext
) {
  const relativeLatenessDays = customer.relativeLatenessDays

  if (
    !Number.isFinite(customer.overdueOutstandingBase) ||
    customer.overdueOutstandingBase <= 0 ||
    !isMaterialRelativeLateness(relativeLatenessDays)
  ) {
    return MINIMUM_COMPONENT_SCORE
  }

  if (relativeLatenessDays <= context.midpointAnchorDays) {
    return clampComponentScore(
      MIDPOINT_COMPONENT_SCORE *
        ((relativeLatenessDays - RELATIVE_LATENESS_NOISE_FLOOR_DAYS) /
          (context.midpointAnchorDays - RELATIVE_LATENESS_NOISE_FLOOR_DAYS))
    )
  }

  return clampComponentScore(
    MIDPOINT_COMPONENT_SCORE +
      MIDPOINT_COMPONENT_SCORE *
        ((relativeLatenessDays - context.midpointAnchorDays) /
          (context.highAnchorDays - context.midpointAnchorDays))
  )
}
