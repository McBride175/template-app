import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import ProductShell from '@/app/components/shell/ProductShell'

const meta = {
  title: 'Yuohme/ProductShell',
  component: ProductShell,
  parameters: { layout: 'fullscreen', nextjs: { navigation: { pathname: '/dashboard' } } },
  args: {
    pathname: '/dashboard', accountLabel: 'Example account — simulated', onSignOut: fn(),
    children: <>
      <h1 className="text-2xl font-semibold">Priorities</h1>
      <p className="mt-2 text-sm text-text-secondary">Shell simulation only. No authentication, customer data or live APIs.</p>
      <section aria-label="Example working area" className="mt-8 border-y border-border-default">
        {['Existing page content', 'Operational content uses the available width', 'Feature workflows remain unchanged'].map(label => <p key={label} className="border-b border-border-default px-1 py-6 text-sm text-text-secondary last:border-0">{label}</p>)}
      </section>
    </>,
  },
  argTypes: { children: { control: false }, onSignOut: { control: false } },
} satisfies Meta<typeof ProductShell>
export default meta
type Story = StoryObj<typeof meta>

export const DesktopPriorities: Story = {}
export const CustomersActive: Story = { args: { pathname: '/customers', children: <>
  <h1 className="text-2xl font-semibold">Customers</h1>
  <p className="mt-2 text-sm text-text-secondary">Simulated active section. Existing customer content is not redesigned.</p>
</> } }
export const LoadingAccount: Story = { args: { sessionLoading: true } }
export const SignOutFailure: Story = { args: { signOutError: 'We could not sign you out. Try again.' } }
export const MobileClosed: Story = { globals: { viewport: { value: 'mobile', isRotated: false } } }
export const NarrowMobile: Story = { globals: { viewport: { value: 'narrow', isRotated: false } } }
export const Tablet: Story = { globals: { viewport: { value: 'tablet', isRotated: false } } }
export const MobileOpen: Story = {
  globals: { viewport: { value: 'mobile', isRotated: false } },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Open navigation' }))
    await expect(within(canvasElement).getByRole('dialog', { name: 'Navigation' })).toBeVisible()
    await expect(within(canvasElement).getByRole('button', { name: 'Close navigation' })).toHaveFocus()
  },
}
