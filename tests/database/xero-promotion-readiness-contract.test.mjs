import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const migrationUrl = new URL(
  '../../supabase/migrations/20260916113552_xero_promotion_readiness_contract.sql',
  import.meta.url
)

test('readiness migration versions immutable evidence and keeps browser roles out', async () => {
  const sql = await readFile(migrationUrl, 'utf8')
  assert.match(sql, /create table public\.xero_sync_run_validations/i)
  assert.match(sql, /contract_version = 'collections_readiness_v2'/i)
  assert.match(sql, /unique \(sync_run_id, contract_version, fencing_token\)/i)
  assert.match(sql, /incomplete_fx_invoice_count = 0/i)
  assert.match(sql, /alter table public\.xero_sync_run_validations enable row level security/i)
  assert.match(sql, /revoke all on table public\.xero_sync_run_validations\s+from public, anon, authenticated, service_role/i)
  assert.match(sql, /grant select on table public\.xero_sync_run_validations to service_role/i)
  for (const functionName of [
    'inspect_xero_sync_run_readiness',
    'reacquire_xero_sync_run_for_promotion',
    'record_xero_sync_run_readiness',
    'promote_xero_sync_run',
  ]) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${functionName}`,'i'))
    assert.match(sql, new RegExp(`grant execute on function public\\.${functionName}`,'i'))
  }
  assert.doesNotMatch(sql, /grant execute[\s\S]*to (anon|authenticated)/i)
})

test('one evaluator governs inspection, reacquisition, evidence, and promotion', async () => {
  const sql = await readFile(migrationUrl, 'utf8')
  const calls = sql.match(/evaluate_xero_sync_run_readiness_v2\(/g) ?? []
  assert.ok(calls.length >= 4)
  assert.match(sql, /create function public\.reacquire_xero_sync_run_for_promotion/i)
  assert.match(sql, /v_new_fencing_token := v_state\.current_fencing_token \+ 1/i)
  assert.match(sql, /v_state\.active_sync_run_id is distinct from v_run\.previous_active_sync_run_id/i)
  assert.match(sql, /validation\.fencing_token = p_fencing_token/i)
  assert.match(sql, /current_validation_required/i)
  assert.doesNotMatch(sql, /update public\.xero_sync_tenant_state[\s\S]*active_sync_run_id[\s\S]*reacquired/i)
})

test('FX evaluator rejects incomplete, non-positive, malformed, and inconsistent conversion state', async () => {
  const sql = await readFile(migrationUrl, 'utf8')
  assert.match(sql, /currency_conversion_status = 'incomplete'/i)
  assert.match(sql, /invoice_fx\.raw_rate > 0/i)
  assert.match(sql, /invoice_fx\.xero_currency_rate > 0/i)
  assert.match(sql, /invoice_fx\.xero_currency_rate = invoice_fx\.raw_rate/i)
  assert.match(sql, /invoice_fx\.total_base = round\(invoice_fx\.total_native \/ invoice_fx\.xero_currency_rate, 8\)/i)
  assert.match(sql, /v_result_code := 'fx_incomplete'/i)
})
