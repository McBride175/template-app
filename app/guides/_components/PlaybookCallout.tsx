import Link from 'next/link'

const PLAYBOOK_PATH = '/guides/credit-control-prioritisation-playbook'

const calloutCopyBySlug: Record<string, { heading: string; body: string; label: string }> = {
  'how-to-prioritise-overdue-invoices': {
    heading: 'Put the four signals into practice',
    body: 'Work through six fictional customers and see the order change when accounting evidence is combined with your own customer judgement.',
    label: 'Try the interactive prioritisation playbook',
  },
  'which-customer-should-i-chase-first-for-payment': {
    heading: 'Practise choosing the next customer',
    body: 'Compare a live shortlist where the largest and oldest balances do not automatically deserve the first call.',
    label: 'Try the worked debtor-book example',
  },
  'how-to-prioritise-multiple-overdue-customers': {
    heading: 'See a relative ranking change live',
    body: 'Adjust what is known about each customer and watch all six positions update, rather than judging each debt in isolation.',
    label: 'Open the interactive playbook',
  },
  'should-i-chase-the-largest-invoice-first': {
    heading: 'See why the largest balance may not be first',
    body: 'The worked example starts with £22,000 at stake, yet another customer has the stronger combined case for action.',
    label: 'See the ranking and its reasons',
  },
  'should-i-chase-the-oldest-invoice-first': {
    heading: 'See why the oldest debt may not be first',
    body: 'Compare raw age with normal payment behaviour, recent payments and customer context in one live priority order.',
    label: 'Test the oldest-first assumption',
  },
  'how-to-prioritise-debtors-by-risk': {
    heading: 'Add the risk evidence only you know',
    body: 'See how founder concern can materially change a customer’s position without overriding exposure and payment evidence altogether.',
    label: 'Try the founder-knowledge interaction',
  },
  'how-to-prioritise-invoice-chasing-when-you-only-have-an-hour': {
    heading: 'Allocate one limited hour',
    body: 'Use a six-customer scenario to practise turning competing signals into a clear order of attention.',
    label: 'Work through the prioritisation playbook',
  },
  'how-to-prioritise-overdue-invoices-in-xero': {
    heading: 'See what changes when judgement is added to Xero evidence',
    body: 'The interactive example combines customer-level accounting signals with information the founder knows but the ledger cannot.',
    label: 'Try the Xero-to-priority worked example',
  },
}

interface PlaybookCalloutProps {
  slug: string
}

export default function PlaybookCallout({ slug }: PlaybookCalloutProps) {
  const copy = calloutCopyBySlug[slug]

  if (!copy) return null

  return (
    <aside className="rounded-2xl border border-sky-200 bg-sky-50 p-5 sm:p-6" aria-label="Interactive playbook">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-sky-800">
        Interactive worked example
      </p>
      <h2 className="mt-2 text-xl">{copy.heading}</h2>
      <p className="mt-2 text-sm leading-6 text-gray-700">{copy.body}</p>
      <Link
        href={PLAYBOOK_PATH}
        className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-sky-800 underline decoration-sky-300 underline-offset-4 hover:text-sky-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-700 focus-visible:ring-offset-2"
      >
        {copy.label} →
      </Link>
    </aside>
  )
}
