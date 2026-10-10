import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { fn } from 'storybook/test'
import ProductShell from '@/app/components/shell/ProductShell'
import AccountingRefreshStatus from '@/app/components/AccountingRefreshStatus'
import DisputesFilters, { type DisputesFiltersProps } from '@/app/disputes/DisputesFilters'
import { accountingFixture } from './accountingFixture'

function Preview(props: DisputesFiltersProps) {
  return <ProductShell pathname="/disputes" accountLabel="Synthetic example" onSignOut={fn()} pageHasMain>
    <AccountingRefreshStatus status={accountingFixture} busy={false} error={null} onRefresh={fn()} onCheck={fn()} returnTo="/disputes" />
    <main className="mx-auto max-w-5xl space-y-3 px-0 py-0 sm:space-y-5 sm:px-6 sm:py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-semibold text-gray-900">Disputes</h1>
          <p className="mt-1 hidden text-sm text-gray-600 sm:block">Review disputed invoices and the debt that remains to chase.</p></div>
        <button type="button" className="min-h-11 rounded-md border px-4 text-sm">Refresh disputes</button>
      </div>
      <DisputesFilters {...props} />
      <p className="text-sm text-text-secondary">2 matching disputes. Amount sorting uses GBP equivalents; unavailable valuations follow comparable amounts.</p>
      <section aria-label="Synthetic disputes worklist" className="space-y-4">
        {['Northbridge Supplies', 'Cedar & Finch Studio'].map(name => <article key={name} className="rounded-lg border border-border-default bg-surface p-4">
          <h2 className="font-semibold">{name}</h2><p className="mt-2 text-sm text-text-secondary">Synthetic worklist reference. Invoice actions are outside this fixture.</p>
        </article>)}
      </section>
    </main>
  </ProductShell>
}
const meta = { title: 'Yuohme/DisputesFilters', component: Preview,
  parameters: { layout: 'fullscreen', nextjs: { navigation: { pathname: '/disputes' } } },
  args: { query: { status: 'active', customer: '', q: '', sort: 'amount_desc', page: 1, pageSize: 25 },
    tenantId: 'synthetic', customers: [{ sourceId: 'synthetic-1', name: 'Northbridge Supplies' },
      { sourceId: 'synthetic-2', name: 'Cedar & Finch Studio' }], blocked: false },
} satisfies Meta<typeof Preview>
export default meta
type Story = StoryObj<typeof meta>
export const Collapsed: Story = {}
export const Expanded: Story = { args: { initialExpanded: true } }
export const ActiveFilters: Story = { args: { query: { status: 'needs_review', customer: 'synthetic-2', q: 'INV', sort: 'oldest', page: 3, pageSize: 50 } } }
export const Disabled: Story = { args: { blocked: true } }
