import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { AccountingControlError, accountingControlRpc, accountingScope, parseAccountingJob, type AccountingControlClient } from './control-server'
import { resolveAccountingConnection } from '@/lib/accounting/connection-server'
import { dispatchAccountingRefresh, accountingTransportEvent } from '@/lib/accounting/dispatch-server'
import { readAccountingRefreshStatus } from '@/lib/accounting/refresh-server'
import { productAccountingStatus, type ProductRefreshResponse, type ProductRefreshTrigger } from './product-refresh'

export interface ProductConnectionSelection { provider?: string; providerOrganisationId?: string }
export function productRefreshTrigger(value: unknown): ProductRefreshTrigger {
 if (!['opportunistic','manual','onboarding','reconnect'].includes(String(value))) throw new AccountingControlError('invalid_input')
 return value as ProductRefreshTrigger
}
export async function resolveProductAccountingSelection(admin: AccountingControlClient, owner: string, selection: ProductConnectionSelection) {
 const provider = selection.provider ?? 'xero'
 if (provider !== 'xero') throw new AccountingControlError('unsupported_provider')
 if (selection.providerOrganisationId !== undefined) {
  if (!selection.providerOrganisationId.trim() || selection.providerOrganisationId !== selection.providerOrganisationId.trim() || selection.providerOrganisationId.length>500) throw new AccountingControlError('invalid_input')
  return { provider, providerOrganisationId: selection.providerOrganisationId }
 }
 const { data, error } = await admin.from('xero_connections_public').select('tenant_id').eq('user_id', owner).limit(2)
 if (error) throw new AccountingControlError('unavailable')
 if (!data?.length) throw new AccountingControlError('not_found')
 // Never silently reinterpret an ambiguous accounting scope.
 if (data.length !== 1) throw new AccountingControlError('conflict')
 return { provider, providerOrganisationId: data[0].tenant_id as string }
}
/** Server-only callback/selection seam. Owner comes from verified getUser(),
 * never from browser payload. No billing, provider or materialization work. */
export async function signalOwnedProductAccountingRefresh(params: {
 admin: AccountingControlClient; authenticatedOwnerId: string; selection: ProductConnectionSelection;
 trigger: ProductRefreshTrigger; idempotencyKey?: string; surface?: string
}): Promise<ProductRefreshResponse> {
 const started = performance.now(), trigger = productRefreshTrigger(params.trigger)
 if (params.idempotencyKey !== undefined && (!params.idempotencyKey.trim() || params.idempotencyKey.length>128 || params.idempotencyKey!==params.idempotencyKey.trim())) throw new AccountingControlError('invalid_input')
 const selection = await resolveProductAccountingSelection(params.admin, params.authenticatedOwnerId, params.selection)
 const resolved = await resolveAccountingConnection({admin:params.admin, authenticatedOwnerId:params.authenticatedOwnerId,...selection})
 if (resolved.health !== 'healthy') return {outcome:resolved.health==='attention_required'?'attention_required':'reconnect_required',jobId:null,phase:'idle',nextEligibleAt:null}
 const result = await accountingControlRpc<{outcome: ProductRefreshResponse['outcome'];job:unknown;nextEligibleAt:string|null}>(params.admin,'accept_product_accounting_refresh',{
  ...accountingScope(resolved.connection),p_connection_id:resolved.connection.connectionId,p_trigger:trigger,p_idempotency_key:params.idempotencyKey??null,
 })
 const job = result.job ? parseAccountingJob(result.job) : null
 if (job && (job.connection.connectionId!==resolved.connection.connectionId || job.connection.ownerId!==params.authenticatedOwnerId)) throw new AccountingControlError('unavailable')
 // Commit is already durable. A missing/failed signal cannot lose work.
 if (job && ['queued','running','preparing'].includes(job.phase)) {
  try { await dispatchAccountingRefresh(params.admin,'immediate') }
  catch { accountingTransportEvent('product_signal_deferred',{jobId:job.id}) }
 }
 accountingTransportEvent('product_acceptance',{trigger,surface:params.surface??null,outcome:result.outcome,jobId:job?.id??null,durationMs:Math.round(performance.now()-started)})
 return {outcome:result.outcome,jobId:job?.id??null,phase:job?.phase??'idle',nextEligibleAt:result.nextEligibleAt}
}
export async function requestProductAccountingRefresh(selection: ProductConnectionSelection, trigger: ProductRefreshTrigger, idempotencyKey?: string, surface?: string) {
 const session = await createServerSupabaseClient(), {data,error}=await session.auth.getUser()
 if (error || !data.user) throw new AccountingControlError('unauthorized')
 return signalOwnedProductAccountingRefresh({admin:createSupabaseAdminClient(),authenticatedOwnerId:data.user.id,selection,trigger,idempotencyKey,surface})
}
export async function readProductAccountingStatus(selection: ProductConnectionSelection) {
 const session=await createServerSupabaseClient(),{data,error}=await session.auth.getUser()
 if(error || !data.user) throw new AccountingControlError('unauthorized')
 const admin=createSupabaseAdminClient(), scope=await resolveProductAccountingSelection(admin,data.user.id,selection)
 return productAccountingStatus(await readAccountingRefreshStatus(scope,{session,admin}))
}
