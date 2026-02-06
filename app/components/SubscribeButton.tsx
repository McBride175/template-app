/**
 * SubscribeButton Component
 * 
 * TEMPLATE CODE: Dashboard CTA that routes users to pricing first.
 */
'use client'

import { useRouter } from 'next/navigation'
import Button from './Button'

export default function SubscribeButton() {
  const router = useRouter()

  return (
    <Button onClick={() => router.push('/pricing')} variant="primary">
      Choose a plan
    </Button>
  )
}
