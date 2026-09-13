export const PASSWORD_MIN_LENGTH = 10

export function getPasswordStrength(value: string) {
  const hasLower = /[a-z]/.test(value)
  const hasUpper = /[A-Z]/.test(value)
  const hasNumber = /[0-9]/.test(value)
  const hasSymbol = /[^A-Za-z0-9]/.test(value)
  const categoryCount = [hasLower, hasUpper, hasNumber, hasSymbol].filter(Boolean).length

  return {
    hasLower,
    hasUpper,
    hasNumber,
    hasSymbol,
    categoryCount,
    hasMinLength: value.length >= PASSWORD_MIN_LENGTH,
  }
}

export function validatePassword(value: string) {
  const strength = getPasswordStrength(value)
  if (!strength.hasMinLength) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`
  }
  if (strength.categoryCount < 2) {
    return 'Password must include at least 2 of: lowercase, uppercase, number, symbol.'
  }
  return null
}

export function getPasswordRequirements(value: string) {
  if (!value) return 'Use at least 10 characters and at least two character types.'

  const strength = getPasswordStrength(value)
  if (!strength.hasMinLength) {
    const remaining = PASSWORD_MIN_LENGTH - value.length
    return `${remaining} more character${remaining === 1 ? '' : 's'} needed.`
  }
  if (strength.categoryCount < 2) {
    return 'Add an uppercase letter, number, or symbol.'
  }
  return 'Your password meets the requirements.'
}
