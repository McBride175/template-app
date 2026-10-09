import { accountingRefreshPost } from '@/lib/accounting/product-refresh-http'
/** Compatibility URL. Entry activity signals work; it never runs Xero here. */
export function POST(request: Request) { return accountingRefreshPost(request, 'opportunistic') }
