const DEFAULT_CONTROLLER_NAME = 'Template App Operator'
const DEFAULT_CONTROLLER_EMAIL = 'privacy@yourdomain.com'
const DEFAULT_EU_REP_CONTACT = 'Not appointed'
const DEFAULT_DPO_CONTACT = 'Not appointed'

function getPositiveInteger(value: string | undefined, fallback: number) {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return parsed
}

export default function PrivacyPage() {
  const controllerName = process.env.DATA_CONTROLLER_NAME ?? DEFAULT_CONTROLLER_NAME
  const controllerEmail = process.env.DATA_CONTROLLER_EMAIL ?? DEFAULT_CONTROLLER_EMAIL
  const dpoContact = process.env.DATA_PROTECTION_OFFICER_CONTACT ?? DEFAULT_DPO_CONTACT
  const euRepContact = process.env.EU_REPRESENTATIVE_CONTACT ?? DEFAULT_EU_REP_CONTACT
  const supportTicketRetentionDays = getPositiveInteger(
    process.env.SUPPORT_TICKET_RETENTION_DAYS,
    365
  )

  return (
    <div className="max-w-3xl space-y-6">
      <header className="space-y-2">
        <h1>Privacy Policy</h1>
        <p className="text-sm text-gray-500">Last updated: February 6, 2026</p>
      </header>

      <section className="space-y-2">
        <h2>1. Controller and Contacts</h2>
        <p className="text-sm text-gray-700">Data controller: {controllerName}</p>
        <p className="text-sm text-gray-700">Privacy contact: {controllerEmail}</p>
        <p className="text-sm text-gray-700">DPO contact (if appointed): {dpoContact}</p>
        <p className="text-sm text-gray-700">EU representative (if required): {euRepContact}</p>
      </section>

      <section className="space-y-2">
        <h2>2. Categories of Personal Data</h2>
        <p className="text-sm text-gray-700">
          We process account identifiers (such as email), authentication/session metadata, content you store in the
          app, support communications, and billing identifiers needed to operate subscriptions.
        </p>
      </section>

      <section className="space-y-2">
        <h2>3. Purposes and Lawful Bases</h2>
        <ul className="list-disc pl-5 space-y-1 text-sm text-gray-700">
          <li>Account creation, authentication, and session security: contract and legitimate interests.</li>
          <li>Core product functionality and data storage: contract.</li>
          <li>Billing, subscription operations, and fraud prevention: contract, legal obligation, and legitimate interests.</li>
          <li>Support handling and service communications: contract and legitimate interests.</li>
          <li>Marketing communications (if enabled): consent, which can be withdrawn at any time.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2>4. Recipients and Processors</h2>
        <p className="text-sm text-gray-700">
          Infrastructure and data services are provided by Supabase. Payment processing and subscription lifecycle
          management are provided by Stripe. Support notification delivery is provided by Resend.
        </p>
      </section>

      <section className="space-y-2">
        <h2>5. International Transfers</h2>
        <p className="text-sm text-gray-700">
          Personal data may be processed outside your country. Where GDPR applies and transfers occur outside the EEA,
          transfers must rely on an approved mechanism (such as adequacy decisions or Standard Contractual Clauses)
          and supplementary safeguards where required.
        </p>
      </section>

      <section className="space-y-2">
        <h2>6. Retention Schedule</h2>
        <ul className="list-disc pl-5 space-y-1 text-sm text-gray-700">
          <li>Account profile and app content: retained until account deletion by user or operator action.</li>
          <li>Subscription records cached in app database: retained while account is active, removed on account deletion.</li>
          <li>
            Support tickets: automatically deleted after {supportTicketRetentionDays} days by the server retention job.
          </li>
          <li>
            Operational logs: retained per platform defaults and should be configured to the minimum period needed for
            security and incident response.
          </li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2>7. Your Rights</h2>
        <p className="text-sm text-gray-700">
          Depending on applicable law, you may request access, rectification, erasure, restriction, objection,
          portability, and withdrawal of consent (where consent is used). You may also lodge a complaint with your
          supervisory authority.
        </p>
        <p className="text-sm text-gray-700">
          Requests can be submitted to {controllerEmail}. We target response within one month, subject to lawful
          extensions for complex requests.
        </p>
      </section>

      <section className="space-y-2">
        <h2>8. Security Measures</h2>
        <p className="text-sm text-gray-700">
          We apply technical and organisational safeguards including access controls, row-level security policies,
          transport encryption, and restricted server-side key usage for privileged operations.
        </p>
      </section>
    </div>
  )
}
