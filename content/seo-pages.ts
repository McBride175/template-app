export type CustomerRisk = 'low' | 'medium' | 'high'

export type PrioritisationSignal = {
  key: 'value-outstanding' | 'average-days-late' | 'days-since-last-payment' | 'founder-risk'
  label: string
  explanation: string
}

export type WorkedExampleCustomer = {
  name: string
  valueOutstanding: number
  averageDaysLate: number
  daysSinceLastPayment: number
  founderRisk: CustomerRisk
  founderRiskReason?: string
  rank: number
  rankReason: string
}

export type WorkedExample = {
  introduction: string
  customers: WorkedExampleCustomer[]
  conclusion: string
}

export type GuideSectionHeadings = {
  whyItMatters?: string
  signals?: string
  workedExample?: string
  recommendedActions?: string
  productBridge?: string
  relatedGuides?: string
}

export type SeoProblemPage = {
  slug: string
  pageType: 'problem-outcome'
  primaryKeyword: string
  secondaryKeywords: string[]
  searchIntent: 'informational' | 'commercial' | 'mixed'
  queryCluster: string
  readerJob: string
  uniqueAngle: string
  metaTitle: string
  metaDescription: string
  h1: string
  directAnswer: string
  whyItMatters: string
  sectionHeadings?: GuideSectionHeadings
  signalIntroduction: string
  signals: readonly PrioritisationSignal[]
  decisionRules: string[]
  workedExample: WorkedExample
  recommendedActions: string[]
  productBridge: string
  ctaLabel: string
  ctaHref: string
  relatedSlugs: string[]
  indexable: boolean
}

export const customerPrioritisationSignals = [
  {
    key: 'value-outstanding',
    label: 'Value outstanding',
    explanation: 'Shows the potential cash impact of a successful chase.',
  },
  {
    key: 'average-days-late',
    label: 'Average days late',
    explanation: 'Shows habitual payment behaviour, not one unusually late invoice.',
  },
  {
    key: 'days-since-last-payment',
    label: 'Days since last payment',
    explanation: 'Shows whether recent payment behaviour is improving or deteriorating.',
  },
  {
    key: 'founder-risk',
    label: 'Founder risk',
    explanation: 'Adds context Xero cannot know, such as disputes or broken promises.',
  },
] satisfies PrioritisationSignal[]

export const seoProblemPages = [
  {
    slug: 'how-to-prioritise-overdue-invoices',
    pageType: 'problem-outcome',
    primaryKeyword: 'how to prioritise overdue invoices',
    secondaryKeywords: [
      'which customer should I chase first for payment',
      'overdue invoice prioritisation',
      'invoice chasing order',
      'collections priority list',
    ],
    searchIntent: 'informational',
    queryCluster: 'overdue-customer-prioritisation',
    readerJob:
      'Decide which overdue customer deserves the next collection action when time is limited.',
    uniqueAngle:
      'Teach a customer-level four-signal ranking method instead of sorting individual invoices by age or value.',
    metaTitle: 'How to Prioritise Overdue Invoices',
    metaDescription:
      'Rank overdue customers using cash value, payment behaviour and the risks only you know—not invoice age alone.',
    h1: 'How to prioritise overdue invoices',
    directAnswer:
      'Prioritise overdue customers rather than isolated invoices. Compare potential cash impact, habitual lateness, recent payment activity and the customer risk you can see but Xero cannot. The next chase should reflect the combined picture, not whichever invoice is oldest or largest.',
    whyItMatters:
      "Sorting by invoice age treats every late invoice as equally urgent; sorting by balance assumes the biggest amount is the best use of today's time. Neither reflects how a customer normally pays or what has changed recently. A customer-level view reduces daily guesswork and puts limited founder attention where it can release meaningful cash sooner.",
    sectionHeadings: {
      whyItMatters: 'Why invoice age and value are not enough',
      signals: 'The four signals to compare',
      workedExample: 'Worked example: rank three customers',
      recommendedActions: 'Build your first priority list',
      productBridge: 'From Xero data to a ranked chase queue',
      relatedGuides: 'Put the priority list into action',
    },
    signalIntroduction:
      'Use the signals together. One describes the cash opportunity, two describe payment behaviour and one adds the context that accounting records cannot capture.',
    signals: customerPrioritisationSignals,
    decisionRules: [
      'Start with customers where a successful action could release meaningful cash, but do not let value decide alone.',
      'Raise priority when habitual lateness and a long gap since payment reinforce each other.',
      'Use founder risk for evidence such as a dispute, missed promise or loss of contact, then review it when the facts change.',
    ],
    workedExample: {
      introduction:
        'Suppose you have time for one call. The largest balance looks obvious, but the combined signals produce a different order.',
      customers: [
        {
          name: 'Oakfield Retail',
          valueOutstanding: 10600,
          averageDaysLate: 42,
          daysSinceLastPayment: 69,
          founderRisk: 'medium',
          founderRiskReason: 'Two promised payment dates were missed.',
          rank: 1,
          rankReason: 'Material exposure, chronic lateness and missed promises reinforce each other.',
        },
        {
          name: 'Harbour Studio',
          valueOutstanding: 6900,
          averageDaysLate: 58,
          daysSinceLastPayment: 91,
          founderRisk: 'high',
          founderRiskReason: 'The finance contact has stopped replying.',
          rank: 2,
          rankReason: 'Payment behaviour is worsening, but less cash is currently exposed.',
        },
        {
          name: 'Northstar Interiors',
          valueOutstanding: 18400,
          averageDaysLate: 10,
          daysSinceLastPayment: 4,
          founderRisk: 'low',
          founderRiskReason: 'A part-payment arrived this week.',
          rank: 3,
          rankReason: 'The balance is large, but recent payment reduces immediate urgency.',
        },
      ],
      conclusion:
        "Chase Oakfield first because several meaningful signals point in the same direction. Harbour's high risk lifts it above Northstar, but risk alone does not automatically make it number one. Northstar still matters; its recent payment simply makes the other two more urgent today.",
    },
    recommendedActions: [
      'Group every overdue invoice under its customer before deciding the chase order.',
      'Compare all four signals and note where two or more point to increasing urgency.',
      'Call or email the highest-ranked customer and record what you learn.',
      'Reorder the list after a payment, missed promise or material risk change.',
    ],
    productBridge:
      'Connect Xero to supply each customer’s outstanding balance, average lateness and recent payment activity. Add the low, medium or high risk that only you can judge. Those inputs create a ranked chase queue, and new payments or risk changes can alter who deserves attention next without rebuilding the list by hand.',
    ctaLabel: 'See plans and pricing',
    ctaHref: '/pricing',
    relatedSlugs: ['how-to-get-cash-in-faster-from-overdue-customers'],
    indexable: true,
  },
  {
    slug: 'how-to-get-cash-in-faster-from-overdue-customers',
    pageType: 'problem-outcome',
    primaryKeyword: 'how to get cash in faster from overdue customers',
    secondaryKeywords: [
      'speed up overdue payments',
      'improve cash collections',
      'daily collections priority list',
    ],
    searchIntent: 'informational',
    queryCluster: 'faster-overdue-cash-collection',
    readerJob:
      'Turn a limited daily collections window into a focused queue that changes as customers pay or risk changes.',
    uniqueAngle:
      'Show that faster cash comes from executing and refreshing a short priority queue, not increasing indiscriminate chasing.',
    metaTitle: 'How to Get Cash In Faster From Overdue Customers',
    metaDescription:
      'Use a focused daily chase queue that updates with Xero payments, customer behaviour and your own risk knowledge.',
    h1: 'How to get cash in faster from overdue customers',
    directAnswer:
      'If limited founder time is slowing collections, create a short daily customer queue rather than chasing every overdue invoice. Rank it using cash value, habitual lateness, time since payment and your own risk view. Act on the top customers, record the result and refresh the order when the facts change.',
    whyItMatters:
      'Faster collection is not always about sending more reminders. When founder time is the constraint, the useful question is which two or three customers deserve action today. A short ranked queue concentrates effort, records what happened and changes as new payments or risk information arrive.',
    sectionHeadings: {
      whyItMatters: 'Why more chasing is not always faster',
      signals: "Use four signals to build today's queue",
      workedExample: 'Worked example: a queue that changes after payment',
      recommendedActions: 'Run a focused daily collections loop',
      productBridge: 'Keep the queue current with Xero',
      relatedGuides: 'Learn the ranking method',
    },
    signalIntroduction:
      'The queue should balance potential cash with established and recent payment behaviour. Your risk judgement adds information that the ledger alone cannot see.',
    signals: customerPrioritisationSignals,
    decisionRules: [
      'Build today’s queue from the combined signals, then choose only the actions that fit your collections window.',
      'Record payments, promises, disputes and lost contact as soon as they change the picture.',
      'Refresh the queue before the next session rather than treating the ranking as a permanent monthly list.',
    ],
    workedExample: {
      introduction:
        'This time the largest balance also has enough behavioural warning signs to rank first. High risk does not automatically win.',
      customers: [
        {
          name: 'Ridgeway Construction',
          valueOutstanding: 24000,
          averageDaysLate: 35,
          daysSinceLastPayment: 46,
          founderRisk: 'medium',
          founderRiskReason: 'Approval is slow, but there is no known dispute.',
          rank: 1,
          rankReason: 'The largest exposure also has established lateness and inactivity.',
        },
        {
          name: 'Moss & Finch',
          valueOutstanding: 9200,
          averageDaysLate: 61,
          daysSinceLastPayment: 88,
          founderRisk: 'high',
          founderRiskReason: 'A promised payment was missed.',
          rank: 2,
          rankReason: 'The warning signs are serious, but less cash is currently exposed.',
        },
        {
          name: 'Clearview Foods',
          valueOutstanding: 13500,
          averageDaysLate: 18,
          daysSinceLastPayment: 3,
          founderRisk: 'low',
          founderRiskReason: 'A £4,000 payment arrived this week.',
          rank: 3,
          rankReason: 'Recent payment indicates progress despite the remaining balance.',
        },
      ],
      conclusion:
        'Call Ridgeway first because value, lateness and payment inactivity all support action. If Ridgeway then pays £12,000, refresh the queue: Moss may move to first before the next collections window. The ranking is a live decision, not a monthly spreadsheet.',
    },
    recommendedActions: [
      'Reserve a short daily window and work from the top of the current customer queue.',
      'Contact the top one or two customers and record the outcome immediately.',
      'Change founder risk only when specific evidence makes the customer safer or more concerning.',
      'Refresh priorities after each payment or material update before choosing the next chase.',
    ],
    productBridge:
      'Connect Xero to bring in outstanding balances, average lateness and recent payment activity. Add the customer risk that only you can judge. The combined inputs create a ranked chase queue; when Xero records a payment or you change a risk level, the next priority can change without another round of spreadsheet sorting.',
    ctaLabel: 'See plans and pricing',
    ctaHref: '/pricing',
    relatedSlugs: ['how-to-prioritise-overdue-invoices'],
    indexable: true,
  },
] satisfies SeoProblemPage[]
