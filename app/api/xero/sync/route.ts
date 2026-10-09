import { accountingRefreshPost } from '@/lib/accounting/product-refresh-http'
/** Compatibility URL. Provider execution belongs only to the durable worker. */
export function POST(request: Request) { return accountingRefreshPost(request, 'manual') }
