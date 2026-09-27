import windowsZones from 'cldr-core/supplemental/windowsZones.json'
import territoryInfo from 'cldr-core/supplemental/territoryInfo.json'

/** Pinned Unicode CLDR Windows mapping; Xero enums omit spaces/punctuation. */
export const XERO_TIMEZONE_MAPPING_VERSION = 'cldr-48.2.0'
const key = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, '')

export function normalizeXeroOrganisationTimezone(value: unknown, country: unknown): string | null {
  if (typeof value !== 'string' || typeof country !== 'string') return null
  const territory = country.trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(territory) || !(territory in territoryInfo.supplemental.territoryInfo)) return null
  const matches = windowsZones.supplemental.windowsZones.mapTimezones
    .map(entry => entry.mapZone).filter(zone => key(zone._other) === key(value.trim()))
  const zone = matches.find(zone => zone._territory === territory)
    ?? (new Set(matches.map(zone => zone._type)).size === 1 ? matches[0] : null)
  const iana = zone?._type.split(' ')[0]
  if (!iana) return null
  try {
    return new Intl.DateTimeFormat('en', { timeZone: iana }).resolvedOptions().timeZone
  } catch { return null }
}
