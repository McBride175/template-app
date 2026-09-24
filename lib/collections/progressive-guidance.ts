export interface CollectionExperienceState {
  hasPriorCollectionActivity: boolean
}

export interface FreeUsageGuidanceInput {
  isPaid: boolean
  hasActionsAccess: boolean
  usageDaysRemaining: number | null
  freeUsageDaysLimit: number
}

export interface FreeUsageGuidance {
  message: string
  actionLabel: 'View plans'
}

export function shouldShowFirstActionGuidance(
  experience: CollectionExperienceState | null
) {
  return experience?.hasPriorCollectionActivity === false
}

export function resolveFreeUsageGuidance(
  entitlement: FreeUsageGuidanceInput | null
): FreeUsageGuidance | null {
  if (
    !entitlement ||
    entitlement.isPaid ||
    !entitlement.hasActionsAccess ||
    entitlement.usageDaysRemaining === null ||
    entitlement.usageDaysRemaining > 1
  ) {
    return null
  }

  if (entitlement.usageDaysRemaining === 1) {
    return {
      message: 'One free collection day remains after today.',
      actionLabel: 'View plans',
    }
  }

  const allowanceLabel = `${entitlement.freeUsageDaysLimit} free collection ${
    entitlement.freeUsageDaysLimit === 1 ? 'day is' : 'days are'
  } now used`

  return {
    message: `Today remains available; your ${allowanceLabel}. Choose a plan before your next collection day.`,
    actionLabel: 'View plans',
  }
}
