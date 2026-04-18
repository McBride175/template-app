import { createServerSupabaseClient } from '@/lib/supabase-server'
import ContactForm from './ContactForm'

export default async function ContactPage() {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return (
    <section className="space-y-6">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-semibold text-gray-900">Contact</h1>
        <p className="mt-2 text-sm text-gray-600">
          Send us a message and we&apos;ll get back to you by email. Signed-in users can
          also track their recent support tickets below.
        </p>
      </div>

      <ContactForm initialEmail={user?.email ?? ''} />
    </section>
  )
}
