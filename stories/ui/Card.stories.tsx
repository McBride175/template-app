import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import Card from '@/app/components/ui/Card'

const meta = {
  title: 'Yuohme/Card',
  component: Card,
  args: {
    variant: 'default',
    children: <>
      <h2 className="text-lg">Example summary</h2>
      <p className="mt-2 text-sm">Deterministic sample content for inspecting surface, spacing and typography.</p>
    </>,
  },
  argTypes: { variant: { control: 'select', options: ['default', 'subtle'] }, children: { control: false } },
} satisfies Meta<typeof Card>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Subtle: Story = { args: { variant: 'subtle' } }
export const MobileLongContent: Story = {
  globals: { viewport: { value: 'mobile', isRotated: false } },
  render: (args) => <Card {...args}>
    <h2 className="text-lg">A longer example heading to inspect wrapping on small screens</h2>
    <p className="mt-2 text-sm">This fictional summary uses several lines of content to make mobile spacing and natural text wrapping easy to inspect. It does not represent a customer or load any application data.</p>
  </Card>,
}
