import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, within } from 'storybook/test'
import Input from '@/app/components/ui/Input'
import Field from '@/app/components/ui/Field'

const meta = {
  title: 'Yuohme/Input',
  component: Input,
  args: { placeholder: 'name@example.com', type: 'email', disabled: false, 'aria-invalid': false },
  argTypes: {
    type: { control: 'select', options: ['text', 'email', 'password', 'number'] },
    'aria-invalid': { control: 'boolean' },
  },
  render: (args) => (
    <Field id="example-email" label="Email address" hint="Use an example address."
      error={args['aria-invalid'] ? 'Enter a valid email address.' : undefined}>
      {(field) => <Input {...args} {...field} />}
    </Field>
  ),
} satisfies Meta<typeof Input>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Filled: Story = { args: { defaultValue: 'alex@example.com' } }
export const Disabled: Story = { args: { disabled: true, defaultValue: 'alex@example.com' } }
export const ValidationError: Story = { args: { 'aria-invalid': true, defaultValue: 'invalid' } }
export const EditAndFocus: Story = {
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByRole('textbox', { name: 'Email address' })
    await userEvent.tab()
    await userEvent.type(input, 'alex@example.com')
    await expect(input).toHaveValue('alex@example.com')
    await expect(input).toHaveFocus()
  },
}
