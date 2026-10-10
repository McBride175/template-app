import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useArgs } from 'storybook/preview-api'
import { expect, within } from 'storybook/test'
import Select from '@/app/components/ui/Select'
import Field from '@/app/components/ui/Field'

const meta = {
  title: 'Yuohme/Select',
  component: Select,
  args: { value: '', disabled: false, 'aria-invalid': false },
  argTypes: {
    value: { control: 'select', options: ['', 'high', 'normal', 'low'] },
    'aria-invalid': { control: 'boolean' },
  },
  render: function Render(args) {
    const [, updateArgs] = useArgs()
    return (
      <Field id="example-priority" label="Example priority"
        error={args['aria-invalid'] ? 'Choose a priority.' : undefined}>
        {(field) => <Select {...args} {...field} onChange={(event) => updateArgs({ value: event.currentTarget.value })}>
          <option value="">Choose a priority</option>
          <option value="high">High</option>
          <option value="normal">Normal</option>
          <option value="low">Low</option>
        </Select>}
      </Field>
    )
  },
} satisfies Meta<typeof Select>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Selected: Story = { args: { value: 'normal' } }
export const Disabled: Story = { args: { disabled: true, value: 'normal' } }
export const ValidationError: Story = { args: { 'aria-invalid': true } }
export const KeyboardFocus: Story = {
  play: async ({ canvasElement }) => {
    const select = within(canvasElement).getByRole('combobox')
    select.focus()
    await expect(select).toHaveFocus()
  },
}
