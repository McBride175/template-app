'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import useNavigationSession from './useNavigationSession'
import Button from './ui/Button'
import Logo from './ui/Logo'

export default function Nav() {
  const pathname = usePathname()
  const { loading, user, signingOut, signOutError, signOut } = useNavigationSession()

  if (pathname === '/start' || pathname.startsWith('/start/')) {
    return (
      <header className="border-b border-gray-200 bg-white/95">
        <div className="mx-auto flex max-w-4xl items-center px-6 py-4">
          <Link href="/" aria-label="Yuohme home" className="inline-flex rounded-control focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"><Logo decorative /></Link>
        </div>
      </header>
    )
  }

  if (loading) return null // prevents flicker

  return (
    <nav className="sticky top-0 z-50 border-b border-gray-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-4xl flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        {/* Left side */}
        <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 sm:w-auto sm:gap-x-6">
          <Link href="/" aria-label="Yuohme home" className="inline-flex shrink-0 rounded-control focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
            <Logo variant="micro" decorative className="lg:hidden" />
            <Logo decorative className="hidden lg:inline-flex" />
          </Link>
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
            <Link href="/account" className="text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors">
              Account
            </Link>
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
              <Link href="/start" className="text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors">
                Try Yuohme
              </Link>
            </>
          )}
        </div>

        {/* Right side */}
        <div className="flex w-full items-center justify-end gap-4 sm:w-auto">
          {user ? (
            <>
              <span className="hidden text-sm text-gray-600 sm:inline">{user.email}</span>
              <Button onClick={() => void signOut()} variant="secondary" size="sm" disabled={signingOut} className="shrink-0 whitespace-nowrap">
                {signingOut ? 'Signing out…' : 'Sign out'}
              </Button>
              {signOutError && (
                <span className="max-w-48 text-xs text-red-700" role="alert">
                  {signOutError}
                </span>
              )}
            </>
          ) : (
            <span className="text-sm text-gray-500">Signed out</span>
          )}
        </div>
      </div>
    </nav>
  )
}
