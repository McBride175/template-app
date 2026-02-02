'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import Button from './Button'

export default function Nav() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<any>(null)

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
    <nav className="border-b border-gray-200 bg-white">
      <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
        {/* Left side */}
        <div className="flex gap-6">
          <Link href="/" className="text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors">
            Home
          </Link>

          <Link href="/pricing" className="text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors">
            Pricing
          </Link>

          {!user && (
            <Link href="/login" className="text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors">
              Login
            </Link>
          )}

          {user && (
            <Link href="/dashboard" className="text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors">
              Dashboard
            </Link>
          )}

          {user && (
            <Link href="/account" className="text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors">
              Account
            </Link>
          )}
        </div>

        {/* Right side */}
        <div className="flex items-center gap-4">
          {user ? (
            <>
              <span className="text-sm text-gray-600">{user.email}</span>
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
