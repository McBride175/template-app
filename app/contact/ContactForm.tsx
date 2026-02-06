'use client'

import { FormEvent, useState } from 'react'
import Button from '@/app/components/Button'
import Input from '@/app/components/Input'
import Card from '@/app/components/Card'

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

      const data = await response.json()

      if (!response.ok) {
        setErrorMessage(data?.error || 'Server error')
        return
      }

      setSuccessMessage('Message sent — we’ll reply by email.')
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
    <Card className="max-w-2xl mx-auto">
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

        <div>
          <label htmlFor="message" className="block text-sm font-medium text-gray-800 mb-1">
            Message
          </label>
          <textarea
            id="message"
            required
            maxLength={4000}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            rows={8}
            className="w-full px-3 py-2 text-sm bg-white border border-gray-300 rounded-md placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            placeholder="Tell us what you need."
          />
        </div>

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
  )
}
