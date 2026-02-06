export default function PrivacyPage() {
  return (
    <div className="max-w-3xl space-y-6">
      <header className="space-y-2">
        <h1>Privacy Policy</h1>
        <p className="text-sm text-gray-500">Last updated: February 6, 2026</p>
      </header>

      <section className="space-y-2">
        <h2>1. Information We Collect</h2>
        <p className="text-sm text-gray-700">
          We collect account information (such as email), application content you create, and billing-related
          identifiers needed to provide subscriptions.
        </p>
      </section>

      <section className="space-y-2">
        <h2>2. How We Use Information</h2>
        <p className="text-sm text-gray-700">
          We use data to authenticate users, store app data, operate paid subscriptions, and maintain account
          security.
        </p>
      </section>

      <section className="space-y-2">
        <h2>3. Processors</h2>
        <p className="text-sm text-gray-700">
          Supabase is used for authentication and database services. Stripe is used for payment processing and
          subscription management.
        </p>
      </section>

      <section className="space-y-2">
        <h2>4. Retention and Deletion</h2>
        <p className="text-sm text-gray-700">
          We retain data for as long as required to operate the service. You can request or initiate account
          deletion, which removes owned app records and account access.
        </p>
      </section>

      <section className="space-y-2">
        <h2>5. Contact</h2>
        <p className="text-sm text-gray-700">For privacy requests, contact the service operator.</p>
      </section>
    </div>
  )
}
