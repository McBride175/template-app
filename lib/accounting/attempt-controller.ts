import 'server-only'

/** One serialized heartbeat for attempt/epoch followed by provider authority.
 * Provider renewal is attached after its own independently fenced acquisition. */
export class AccountingAttemptController {
  readonly signal: AbortSignal
  private readonly abort = new AbortController()
  private timer: ReturnType<typeof setTimeout> | null = null
  private pending: Promise<void> | null = null
  private stopped = false
  private lost = false
  private providerRenewal: (() => Promise<void>) | null = null
  constructor(private readonly renewAttempt: () => Promise<void>, private readonly intervalMs = 30_000) {
    this.signal = this.abort.signal
  }
  attachProvider(renew: () => Promise<void>) { this.assertOwned(); this.providerRenewal = renew }
  start() { this.schedule() }
  private schedule() {
    if (this.stopped || this.lost || this.timer) return
    this.timer = setTimeout(() => { this.timer = null; void this.renewNow().catch(() => undefined) }, this.intervalMs)
  }
  async renewNow() {
    this.assertOwned()
    if (!this.pending) {
      if (this.timer) { clearTimeout(this.timer); this.timer = null }
      this.pending = (async () => {
        try { await this.renewAttempt(); await this.providerRenewal?.() }
        catch { this.cancel(); throw new Error('accounting_authority_lost') }
      })().finally(() => { this.pending = null; this.schedule() })
    }
    await this.pending
    this.assertOwned()
  }
  assertOwned() { if (this.lost || this.signal.aborted) throw new Error('accounting_authority_lost') }
  cancel() { this.lost = true; this.abort.abort() }
  async stop() { this.stopped = true; if (this.timer) clearTimeout(this.timer); if (this.pending) await this.pending.catch(() => undefined) }
}
