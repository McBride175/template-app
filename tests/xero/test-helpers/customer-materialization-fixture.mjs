// Independent partition oracle: retains original source ordering and every row.
export function partitionFeatureInput(input) {
  const buckets = new Map()
  const counts = { overpayment: 0, prepayment: 0, credit_note: 0 }
  for (const row of input.customerCredit.rows) counts[row.source_kind]++
  function bucket(id) {
    const key = id?.trim() ?? ''
    if (!buckets.has(key)) buckets.set(key, { customerId: key, order: 2e12, payload: {
      organisations: input.organisations, customers: [], invoices: [], payments: [], creditRows: [], creditCounts: counts, invoiceOrdinals: [],
    } })
    return buckets.get(key)
  }
  bucket('')
  input.customers.forEach((customer, index) => {
    const b = bucket(customer.source_id); b.payload.customers.push(customer); b.order = Math.min(b.order, 1e12 + index)
  })
  const invoiceCustomer = new Map()
  input.invoices.forEach((invoice, index) => {
    const b = bucket(invoice.customer_source_id); b.payload.invoices.push(invoice); b.payload.invoiceOrdinals.push(index)
    if (invoice.type?.trim().toUpperCase() === 'ACCREC') {
      invoiceCustomer.set(invoice.source_id.trim(), invoice.customer_source_id?.trim() ?? '')
      if (invoice.status?.trim().toUpperCase() === 'AUTHORISED') b.order = Math.min(b.order, index)
    }
  })
  for (const payment of input.payments) bucket(payment.customer_source_id?.trim() || invoiceCustomer.get(payment.invoice_source_id?.trim()) || '')
    .payload.payments.push(payment)
  for (const credit of input.customerCredit.rows) bucket(credit.customer_source_id).payload.creditRows.push(credit)
  return [...buckets.values()]
}
