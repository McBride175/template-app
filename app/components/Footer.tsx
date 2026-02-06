'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

export default function Footer() {
  const [user, setUser] = useState<User | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })

    return () => {
      listener.subscription.unsubscribe()
    }
  }, [])

  return (
    <footer className="border-t border-gray-200 bg-white/80">
      <div className="max-w-4xl mx-auto px-6 py-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-500">
        <Link href="/" className="hover:text-gray-700">
          Home
        </Link>
        <Link href="/pricing" className="hover:text-gray-700">
          Pricing
        </Link>
        <Link href="/blog" className="hover:text-gray-700">
          Blog
        </Link>
        <Link href="/contact" className="hover:text-gray-700">
          Contact
        </Link>
        <Link href="/legal/terms" className="hover:text-gray-700">
          Terms
        </Link>
        <Link href="/legal/privacy" className="hover:text-gray-700">
          Privacy
        </Link>
        <Link href="/legal/cookies" className="hover:text-gray-700">
          Cookies
        </Link>
        <Link href="/sitemap" className="hover:text-gray-700">
          Sitemap
        </Link>
        {user && (
          <Link href="/account" className="hover:text-gray-700">
            Account
          </Link>
        )}
      </div>
    </footer>
  )
}
