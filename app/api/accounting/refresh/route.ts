import { accountingRefreshPost } from '@/lib/accounting/product-refresh-http'
export function POST(request: Request) { return accountingRefreshPost(request) }
