'use client'

import { FormEvent, useState } from 'react'
import Button from '@/app/components/ui/Button'
import Input from '@/app/components/ui/Input'
import Card from '@/app/components/ui/Card'
import Textarea from '@/app/components/ui/Textarea'
import Field from '@/app/components/ui/Field'

type ContactFormProps = {
  initialEmail?: string
}

export default function ContactForm({ initialEmail = '' }: ContactFormProps) {
  const [email, setEmail] = useState(initialEmail)
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [company, setCompany] = useState('')
  const [loading, setLoading] = useState(false)
  const [successMessage, setSuccessMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLoading(true)
    setSuccessMessage('')
    setErrorMessage('')

    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          subject,
          message,
          company,
        }),
      })

      const data = await response.json().catch(() => null)

      if (!response.ok || data?.ok !== true) {
        setErrorMessage(data?.error || 'Server error')
        return
      }

      if (data.emailSent === false) {
        setSuccessMessage(
          'Message received. Email delivery pending — we’ll still respond.'
        )
      } else {
        setSuccessMessage('Message received — we’ll reply by email.')
      }
      setEmail(initialEmail)
      setSubject('')
      setMessage('')
      setCompany('')
    } catch {
      setErrorMessage('Server error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Card>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-800 mb-1">
              Email
            </label>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              placeholder="you@company.com"
            />
          </div>

          <div>
            <label htmlFor="subject" className="block text-sm font-medium text-gray-800 mb-1">
              Subject
            </label>
            <Input
              id="subject"
              type="text"
              required
              maxLength={120}
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="How can we help?"
            />
          </div>

          <Field id="message" label="Message" required>
            {(controlProps) => <Textarea
              {...controlProps}
              maxLength={4000}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={8}
              placeholder="Tell us what you need."
            />}
          </Field>

          <div className="absolute left-[-9999px] top-auto w-px h-px overflow-hidden" aria-hidden="true">
            <label htmlFor="company">Company</label>
            <input
              id="company"
              name="company"
              type="text"
              value={company}
              onChange={(event) => setCompany(event.target.value)}
              tabIndex={-1}
              autoComplete="off"
            />
          </div>

          {successMessage ? <p className="text-sm text-green-700">{successMessage}</p> : null}
          {errorMessage ? <p className="text-sm text-red-700">{errorMessage}</p> : null}

          <Button type="submit" variant="primary" disabled={loading}>
            {loading ? 'Sending...' : 'Send message'}
          </Button>
        </form>
      </Card>
    </div>
  )
}
