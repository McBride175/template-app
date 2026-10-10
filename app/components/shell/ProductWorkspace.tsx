'use client'

import type { ReactNode } from 'react'
import useNavigationSession from '../useNavigationSession'
import ProductShell from './ProductShell'
import { pageProvidesMain } from './navigation'

export default function ProductWorkspace({ children, pathname }: { children: ReactNode; pathname: string }) {
  const { loading, user, signingOut, signOutError, signOut } = useNavigationSession()
  return <ProductShell pathname={pathname} accountLabel={user?.email} sessionLoading={loading}
    signingOut={signingOut} signOutError={signOutError}
    onSignOut={user ? () => { void signOut() } : undefined} pageHasMain={pageProvidesMain(pathname)}
    contentWidth={pathname === '/account' || pathname.startsWith('/settings/') ? 'reading' : 'wide'}>
    {children}
  </ProductShell>
}
