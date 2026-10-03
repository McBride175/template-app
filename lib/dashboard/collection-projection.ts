/** The Dashboard's existing interactive card window is bounded at 200. Its
 * cards use these values; table-only financial breakdowns/explanations are
 * deliberately absent. Projection/ranking remains exclusively server-owned. */
export const DASHBOARD_QUEUE_LIMIT = 200
export const DASHBOARD_CARD_FIELDS = [
  'customer_source_id', 'customer_name', 'customer_email',
  'overdue_outstanding_base', 'customer_to_chase_overdue_base',
  'customer_credit_applied_base', 'effective_disputed_overdue_base_decimal',
  'active_promised_overdue_base_decimal', 'has_actionable_overdue_balance',
  'weighted_avg_overdue_days', 'last_payment_date', 'override_level',
  'recommended_action', 'priority_score', 'queue_eligibility_reason', 'collectible_native_currency_breakdown',
  'recent_activity', 'last_action_type', 'last_action_outcome', 'last_action_timestamp',
] as const

export function compactDashboardCollection<T extends { rows?: readonly object[] }>(value: T) {
  // The caller supplies a projection, never raw accounting or browser guesses.
  const { rows = [], ...metadata } = value
  return { ...metadata, rows: rows.map(row => Object.fromEntries(
    DASHBOARD_CARD_FIELDS.filter(key => key in row).map(key => [key, Reflect.get(row, key)])
  )) }
}
