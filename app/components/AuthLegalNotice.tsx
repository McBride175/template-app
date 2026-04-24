import Link from 'next/link'

interface AuthLegalNoticeProps {
  mode: 'signin' | 'signup'
}

export default function AuthLegalNotice({ mode }: AuthLegalNoticeProps) {
  const actionText = mode === 'signin' ? 'in' : 'up'

  return (
    <>
      By signing {actionText}, you agree to our{' '}
      <Link href="/legal/terms" className="font-medium text-gray-900 underline underline-offset-4">
        Terms
      </Link>{' '}
      and{' '}
      <Link href="/legal/privacy" className="font-medium text-gray-900 underline underline-offset-4">
        Privacy Policy
      </Link>
      .
    </>
  )
}
