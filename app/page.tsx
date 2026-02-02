import { redirect } from 'next/navigation'
import HomePageClient from '@/app/components/HomePageClient'

type SearchParams = Record<string, string | string[] | undefined>

export default function Home({
  searchParams,
}: {
  searchParams?: SearchParams
}) {
  if (searchParams?.code) {
    const params = new URLSearchParams()
    Object.entries(searchParams).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        value.forEach((v) => params.append(key, v))
      } else if (value) {
        params.append(key, value)
      }
    })
    const query = params.toString()
    const target = query
      ? `/auth/callback?next=/reset-password&${query}`
      : `/auth/callback?next=/reset-password`
    redirect(target)
  }

  return <HomePageClient />
}
