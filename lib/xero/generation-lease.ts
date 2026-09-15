import 'server-only'

export interface XeroGenerationLeaseHeartbeatResult {
  renewed: boolean
  resultCode: string
  leaseExpiresAt: string | null
}

export interface XeroGenerationLeaseTimerDependencies {
  schedule: (callback: () => void, milliseconds: number) => ReturnType<typeof setTimeout>
  cancel: (handle: ReturnType<typeof setTimeout>) => void
}

const DEFAULT_TIMERS: XeroGenerationLeaseTimerDependencies = {
  schedule: (callback, milliseconds) => setTimeout(callback, milliseconds),
  cancel: (handle) => clearTimeout(handle),
}

export class XeroGenerationLeaseLostError extends Error {
  readonly resultCode: string

  constructor(resultCode: string) {
    super(`Xero generation lease was lost: ${resultCode}`)
    this.name = 'XeroGenerationLeaseLostError'
    this.resultCode = resultCode
  }
}

export class XeroGenerationLeaseController {
  readonly signal: AbortSignal

  private readonly heartbeat: () => Promise<XeroGenerationLeaseHeartbeatResult>
  private readonly heartbeatIntervalMs: number
  private readonly timers: XeroGenerationLeaseTimerDependencies
  private readonly abortController: AbortController
  private timer: ReturnType<typeof setTimeout> | null = null
  private inFlight: Promise<void> | null = null
  private stopped = false
  private lostError: XeroGenerationLeaseLostError | null = null

  constructor(params: {
    heartbeat: () => Promise<XeroGenerationLeaseHeartbeatResult>
    heartbeatIntervalMs: number
    abortController?: AbortController
    timers?: Partial<XeroGenerationLeaseTimerDependencies>
  }) {
    if (!Number.isSafeInteger(params.heartbeatIntervalMs) || params.heartbeatIntervalMs <= 0) {
      throw new TypeError('heartbeatIntervalMs must be a positive safe integer')
    }
    this.heartbeat = params.heartbeat
    this.heartbeatIntervalMs = params.heartbeatIntervalMs
    this.timers = { ...DEFAULT_TIMERS, ...params.timers }
    this.abortController = params.abortController ?? new AbortController()
    this.signal = this.abortController.signal
  }

  start() {
    if (this.stopped || this.timer) return
    this.scheduleNext()
  }

  private scheduleNext() {
    if (this.stopped || this.lostError) return
    this.timer = this.timers.schedule(() => {
      this.timer = null
      void this.runHeartbeat()
    }, this.heartbeatIntervalMs)
  }

  private async runHeartbeat() {
    if (this.stopped || this.lostError || this.inFlight) return
    this.inFlight = (async () => {
      try {
        const result = await this.heartbeat()
        if (!result.renewed) this.lose(result.resultCode)
      } catch {
        this.lose('heartbeat_failed')
      }
    })()

    try {
      await this.inFlight
    } finally {
      this.inFlight = null
      this.scheduleNext()
    }
  }

  private lose(resultCode: string) {
    if (this.lostError) return
    this.lostError = new XeroGenerationLeaseLostError(resultCode)
    this.abortController.abort()
  }

  async renewNow() {
    this.assertOwned()
    if (this.inFlight) {
      await this.inFlight
    } else {
      if (this.timer) {
        this.timers.cancel(this.timer)
        this.timer = null
      }
      await this.runHeartbeat()
    }
    this.assertOwned()
  }

  assertOwned() {
    if (this.lostError) throw this.lostError
  }

  async stop() {
    this.stopped = true
    if (this.timer) {
      this.timers.cancel(this.timer)
      this.timer = null
    }
    if (this.inFlight) await this.inFlight
  }
}
