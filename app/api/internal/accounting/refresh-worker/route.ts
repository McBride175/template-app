import { handleAccountingRefreshWorker } from '@/lib/accounting/worker-server'
export const runtime = 'nodejs'
export const maxDuration = 300
export function POST(request: Request) { return handleAccountingRefreshWorker(request) }
export function GET(request: Request) { return handleAccountingRefreshWorker(request) }
