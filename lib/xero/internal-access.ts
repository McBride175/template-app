function parseEmailSet(value: string | undefined | null) {
  return new Set(
    (value ?? '')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0)
  )
}

function resolveInternalEmailList() {
  return process.env.XERO_INTERNAL_ADMIN_EMAILS ?? process.env.PRIVACY_ADMIN_EMAILS ?? ''
}

export function canAccessInternalXeroTools(email: string | undefined | null) {
  const allowedEmails = parseEmailSet(resolveInternalEmailList())
  if (allowedEmails.size === 0) {
    return false
  }

  const normalizedEmail = email?.trim().toLowerCase()
  if (!normalizedEmail) {
    return false
  }

  return allowedEmails.has(normalizedEmail)
}
