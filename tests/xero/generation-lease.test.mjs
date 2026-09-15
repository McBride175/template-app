import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'

const LEASE_PATH = new URL('../../lib/xero/generation-lease.ts', import.meta.url)

function createTimers() {
  const scheduled = []
  const cancelled = []
  return {
    scheduled,
    cancelled,
    timers: {
      schedule(callback, milliseconds) {
        const handle = { callback, milliseconds }
        scheduled.push(handle)
        return handle
      },
      cancel(handle) {
        cancelled.push(handle)
      },
    },
  }
}

test('lease controller renews below the TTL and does not overlap heartbeat calls', async () => {
  const { XeroGenerationLeaseController } = loadTypeScriptModule(LEASE_PATH)
  const clock = createTimers()
  let resolveHeartbeat
  let calls = 0
  const controller = new XeroGenerationLeaseController({
    heartbeatIntervalMs: 10_000,
    timers: clock.timers,
    heartbeat: async () => {
      calls += 1
      return new Promise((resolve) => {
        resolveHeartbeat = resolve
      })
    },
  })

  controller.start()
  assert.equal(clock.scheduled.length, 1)
  assert.equal(clock.scheduled[0].milliseconds, 10_000)
  clock.scheduled[0].callback()
  clock.scheduled[0].callback()
  await Promise.resolve()
  assert.equal(calls, 1)

  resolveHeartbeat({ renewed: true, resultCode: 'renewed', leaseExpiresAt: 'later' })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(clock.scheduled.length, 2)
  await controller.stop()
  assert.equal(clock.cancelled.length, 1)
})

test('failed heartbeat aborts work and surfaces lease loss', async () => {
  const { XeroGenerationLeaseController, XeroGenerationLeaseLostError } =
    loadTypeScriptModule(LEASE_PATH)
  const clock = createTimers()
  const controller = new XeroGenerationLeaseController({
    heartbeatIntervalMs: 10_000,
    timers: clock.timers,
    heartbeat: async () => ({
      renewed: false,
      resultCode: 'superseded',
      leaseExpiresAt: null,
    }),
  })

  controller.start()
  clock.scheduled[0].callback()
  await Promise.resolve()
  await Promise.resolve()

  assert.equal(controller.signal.aborted, true)
  assert.throws(
    () => controller.assertOwned(),
    (error) => error instanceof XeroGenerationLeaseLostError && error.resultCode === 'superseded'
  )
  await controller.stop()
})

test('renewNow uses one heartbeat and cleanup removes the scheduled callback', async () => {
  const { XeroGenerationLeaseController } = loadTypeScriptModule(LEASE_PATH)
  const clock = createTimers()
  let calls = 0
  const controller = new XeroGenerationLeaseController({
    heartbeatIntervalMs: 10_000,
    timers: clock.timers,
    heartbeat: async () => {
      calls += 1
      return { renewed: true, resultCode: 'renewed', leaseExpiresAt: 'later' }
    },
  })

  controller.start()
  await controller.renewNow()

  assert.equal(calls, 1)
  assert.equal(clock.cancelled.length, 1)
  assert.equal(clock.scheduled.length, 2)
  await controller.stop()
  assert.equal(clock.cancelled.length, 2)
})
