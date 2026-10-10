import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import Button from '@/app/components/ui/Button'
import Spinner from '@/app/components/ui/Spinner'

const meta = {
  title: 'Yuohme/Button',
  component: Button,
  args: { children: 'Save changes', variant: 'primary', size: 'md', onClick: fn() },
  argTypes: {
    variant: { control: 'select', options: ['primary', 'secondary', 'ghost', 'destructive'] },
    size: { control: 'select', options: ['sm', 'md', 'lg', 'cta'] },
    children: { control: 'text' },
    disabled: { control: 'boolean' },
  },
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

export const Primary: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Save changes' }))
    await expect(args.onClick).toHaveBeenCalledOnce()
  },
}
export const Secondary: Story = { args: { variant: 'secondary' } }
export const Ghost: Story = { args: { variant: 'ghost' } }
export const Destructive: Story = { args: { variant: 'destructive', children: 'Delete example' } }
export const Disabled: Story = { args: { disabled: true } }
export const Small: Story = { args: { size: 'sm' } }
export const Large: Story = { args: { size: 'lg' } }
export const CallToAction: Story = { args: { size: 'cta', children: 'Get started' } }
// Composition of existing primitives/native props, not a new Button variant.
export const Loading: Story = {
  args: { disabled: true, 'aria-busy': true },
  render: (args) => <Button {...args}><Spinner label={null} />Saving changes…</Button>,
  argTypes: { children: { control: false } },
}
export const KeyboardFocus: Story = {
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button')
    button.blur()
    await userEvent.tab()
    await expect(button).toHaveFocus()
  },
}
