import { accountingWorkActive, type ProductAccountingStatus, type ProductRefreshResponse } from './product-refresh'
export function accountingStatusPresentation(status: ProductAccountingStatus, outcome?: ProductRefreshResponse | null) {
 const provider=status.connection.displayName
 const health=status.connection.health
 const reconnect=outcome?.outcome==='reconnect_required'||health==='reconnect_required'||health==='disconnected'||status.work.phase==='reconnect_required'
 const attention=outcome?.outcome==='attention_required'||status.accounting.state==='unavailable'||health==='attention_required'||status.work.phase==='attention_required'
 const age=status.accounting.ageSeconds
 const ago=age===null?'not yet available':age<60?'just now':age<3600?`${Math.floor(age/60)} min ago`:age<86400?`${Math.floor(age/3600)} hours ago`:`${Math.floor(age/86400)} days ago`
 const observed=status.accounting.accountingObservedAt
 const stale=['materially_stale','very_stale','extended_stale'].includes(status.accounting.freshness)
 let label=`Updated ${ago}`,message:string|null=null
 if(reconnect){label=`Reconnect ${provider}`;message=`Accounting refresh is paused. Reconnect ${provider} to receive recent payments and balances.`}
 else if(attention){label='Accounting refresh needs attention';message='Your saved accounting is retained. Contact support if checking again does not resolve this.'}
 else if(status.work.phase==='retry_wait'){label='Refresh temporarily unavailable';message='We’ll retry automatically.'}
 else if(accountingWorkActive(status)){label=status.work.stage==='derivatives'?'Accounting updated — preparing priorities…':status.work.phase==='queued'?'Refresh queued…':'Refreshing accounting…'}
 else if(status.accounting.state!=='valid'){label='Accounting is being prepared';message='Your priorities will be ready after accounting preparation completes.'}
 else if(outcome?.outcome==='cooldown'){label='Updated recently';message=outcome.nextEligibleAt?'You can refresh again at '+new Date(outcome.nextEligibleAt).toLocaleTimeString():null}
 if(stale){const warning=`Accounting was observed ${ago}${observed?' ('+new Date(observed).toLocaleString()+')':''}. Payments made since then may not yet be reflected.`
  message=[message,warning,status.accounting.freshness==='very_stale'||status.accounting.freshness==='extended_stale'?'Verify recent payment activity before contacting customers.':null].filter(Boolean).join(' ')}
 return {label,message,reconnect,warning:reconnect||attention||stale,retryAt:status.failure?.nextRetryAt??null}
}
