import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useArgs } from 'storybook/preview-api'
import { expect, within } from 'storybook/test'
import Checkbox from '@/app/components/ui/Checkbox'
import Field from '@/app/components/ui/Field'

const meta = {
  title: 'Yuohme/Checkbox',
  component: Checkbox,
  args: { checked: false, disabled: false, 'aria-invalid': false },
  argTypes: { checked: { control: 'boolean' }, 'aria-invalid': { control: 'boolean' } },
  render: function Render(args) {
    const [, updateArgs] = useArgs()
    return (
      <Field id="example-confirmation" label="Confirm example selection"
        error={args['aria-invalid'] ? 'Confirm this selection to continue.' : undefined}>
        {(field) => <Checkbox {...args} {...field} onChange={(event) => updateArgs({ checked: event.currentTarget.checked })} />}
      </Field>
    )
  },
} satisfies Meta<typeof Checkbox>

export default meta
type Story = StoryObj<typeof meta>

export const Unchecked: Story = {}
export const Checked: Story = { args: { checked: true } }
export const Disabled: Story = { args: { disabled: true } }
export const DisabledChecked: Story = { args: { disabled: true, checked: true } }
export const ValidationError: Story = { args: { 'aria-invalid': true } }
export const KeyboardFocus: Story = {
  play: async ({ canvasElement }) => {
    // Keyboard activation is checked interactively; avoid changing args during play.
    const checkbox = within(canvasElement).getByRole('checkbox')
    checkbox.focus()
    await expect(checkbox).toHaveFocus()
  },
}
