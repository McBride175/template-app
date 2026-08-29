'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import Button from './Button'

export default function Nav() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<User | null>(null)

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null)
      setLoading(false)
    })

    // Listen for auth changes
    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null)
      }
    )

    return () => {
      listener.subscription.unsubscribe()
    }
  }, [])

  const signOut = async () => {
    await supabase.auth.signOut()
    router.replace('/login')
  }

  if (loading) return null // prevents flicker

  return (
    <nav className="sticky top-0 z-50 border-b border-gray-200 bg-white/95 backdrop-blur">
      <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
        {/* Left side */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <Link href="/" className="text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors">
            Home
          </Link>

          <Link href="/pricing" className="text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors">
            Pricing
          </Link>

          {user && (
            <Link href="/dashboard" className="text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors">
              Dashboard
            </Link>
          )}

          {user && (
            <Link
              href="/customers"
              className="text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors"
            >
              Customers
            </Link>
          )}

          {user && (
            <Link href="/disputes" className="text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors">
              Disputes
            </Link>
          )}

          {user && (
            <>
              <Link href="/account" className="text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors">
                Account
              </Link>
              <Link href="/admin" className="text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors">
                Admin
              </Link>
            </>
          )}

          <Link href="/blog" className="text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors">
            Guides
          </Link>

          <Link href="/contact" className="text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors">
            Contact
          </Link>

          {!user && (
            <>
              <Link href="/login" className="text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors">
                Log in
              </Link>
              <Link href="/signup" className="text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors">
                Sign up
              </Link>
            </>
          )}
        </div>

        {/* Right side */}
        <div className="flex items-center gap-4">
          {user ? (
            <>
              <span className="hidden text-sm text-gray-600 sm:inline">{user.email}</span>
              <Button onClick={signOut} variant="secondary" size="sm">
                Sign out
              </Button>
            </>
          ) : (
            <span className="text-sm text-gray-500">Signed out</span>
          )}
        </div>
      </div>
    </nav>
  )
}
