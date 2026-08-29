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

export const SEO_INTENT_FAMILIES = [
  'prioritisation',
  'cash-outcome',
  'customer-risk',
  'credit-control-process',
  'xero',
] as const

export type SeoIntentFamily = (typeof SEO_INTENT_FAMILIES)[number]

export const SEO_FUNNEL_STAGES = [
  'problem-aware',
  'solution-aware',
  'product-aware',
] as const

export type SeoFunnelStage = (typeof SEO_FUNNEL_STAGES)[number]

export type SeoGuideCategory = {
  intentFamily: SeoIntentFamily
  slug:
    | 'prioritising-overdue-invoices'
    | 'get-paid-faster'
    | 'late-paying-customers-and-risk'
    | 'credit-control-process'
    | 'xero-credit-control'
  title: string
  shortDescription: string
  description: string
  topics: readonly string[]
}

export type SeoProblemPage = {
  slug: string
  pageType: 'problem-outcome'
  intentFamily: SeoIntentFamily
  funnelStage: SeoFunnelStage
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

export const seoGuideCategories = [
  {
    intentFamily: 'prioritisation',
    slug: 'prioritising-overdue-invoices',
    title: 'Prioritising overdue invoices',
    shortDescription: 'Decide which customers deserve your attention first.',
    description:
      'Turn a long overdue list into a defensible order of action using cash value, payment behaviour and the risks only your business can see.',
    topics: [
      'Ranking customers instead of isolated invoices',
      'Combining value, lateness and recent-payment signals',
      'Refreshing priorities when the facts change',
    ],
  },
  {
    intentFamily: 'cash-outcome',
    slug: 'get-paid-faster',
    title: 'Get paid faster',
    shortDescription: 'Use limited credit-control time where it can release cash sooner.',
    description:
      'Build focused daily actions, clearer follow-ups and a repeatable rhythm that moves overdue balances towards payment without chasing everyone at once.',
    topics: [
      'Building a short daily chase queue',
      'Choosing the next useful collection action',
      'Learning from payments, promises and responses',
    ],
  },
  {
    intentFamily: 'customer-risk',
    slug: 'late-paying-customers-and-risk',
    title: 'Late-paying customers and risk',
    shortDescription: 'Spot worsening payment behaviour before it becomes a bigger problem.',
    description:
      'Separate a one-off delay from a pattern of risk, then use missed promises, disputes and loss of contact to choose a proportionate response.',
    topics: [
      'Recognising habitual and worsening lateness',
      'Using missed promises and disputes as risk signals',
      'Escalating without damaging good customer relationships',
    ],
  },
  {
    intentFamily: 'credit-control-process',
    slug: 'credit-control-process',
    title: 'Credit control process',
    shortDescription: 'Create a consistent process from invoice to follow-up and escalation.',
    description:
      'Give each overdue account a clear owner, next action and outcome so credit control becomes a manageable operating process rather than an occasional scramble.',
    topics: [
      'Setting ownership, cadences and escalation points',
      'Recording contact outcomes and payment promises',
      'Reviewing the measures that improve the process',
    ],
  },
  {
    intentFamily: 'xero',
    slug: 'xero-credit-control',
    title: 'Xero credit control',
    shortDescription: 'Turn Xero invoice and payment data into a useful chase plan.',
    description:
      'Move beyond an aged receivables report by grouping debt at customer level and combining Xero data with the business context that accounting software cannot know.',
    topics: [
      'Creating a customer-level overdue view',
      'Reading payment behaviour from Xero data',
      'Keeping a priority queue current as payments arrive',
    ],
  },
] satisfies readonly SeoGuideCategory[]

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
    intentFamily: 'prioritisation',
    funnelStage: 'solution-aware',
    primaryKeyword: 'how to prioritise overdue invoices',
    secondaryKeywords: [
      'overdue invoice prioritisation',
      'invoice chasing order',
      'collections priority list',
    ],
    searchIntent: 'informational',
    queryCluster: 'overdue-ledger-prioritisation-method',
    readerJob:
      'Learn the overall method for prioritising a messy overdue ledger.',
    uniqueAngle:
      'A reusable four-signal prioritisation framework across multiple overdue customers.',
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
        'Suppose these customers sit on the same overdue ledger. The largest balance looks like the obvious top priority, but the four-signal method produces a more useful overall order.',
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
        "The method ranks Oakfield first because several meaningful signals point in the same direction, followed by Harbour and then Northstar. Harbour's high risk lifts it above Northstar, but risk alone does not determine the list. Northstar still matters; its recent payment lowers its place until the next review.",
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
    relatedSlugs: [
      'which-customer-should-i-chase-first-for-payment',
      'how-to-get-cash-in-faster-from-overdue-customers',
    ],
    indexable: true,
  },
  {
    slug: 'which-customer-should-i-chase-first-for-payment',
    pageType: 'problem-outcome',
    intentFamily: 'prioritisation',
    funnelStage: 'problem-aware',
    primaryKeyword: 'which customer should I chase first for payment',
    secondaryKeywords: [
      'who to chase for payment first',
      'next customer to chase',
      'next best collection action',
      'who should I call about an overdue payment',
    ],
    searchIntent: 'informational',
    queryCluster: 'next-customer-payment-chase-decision',
    readerJob:
      'Make the immediate decision about which specific customer to contact next.',
    uniqueAngle:
      'A customer-level next-best-action decision focused on choosing the very next chase rather than teaching the full prioritisation methodology.',
    metaTitle: 'Which Customer Should I Chase First for Payment?',
    metaDescription:
      'Choose the next customer to contact using a rapid check of cash value, payment behaviour and the risks only you know.',
    h1: 'Which customer should I chase first for payment?',
    directAnswer:
      'Choose from the few customers most likely to need a useful action today. Contact the customer where material cash, worsening payment behaviour and current business risk reinforce each other. Lower the priority when a recent payment or credible update shows progress. This is a next-action decision, not a complete reranking of your ledger.',
    whyItMatters:
      'When you have time for one call or email, rebuilding the whole priority list delays the action. The useful question is narrower: which customer has the strongest reason for contact now? A quick comparison of the top candidates helps you act without treating the largest balance, oldest invoice or highest risk label as an automatic winner.',
    sectionHeadings: {
      whyItMatters: 'Why the next chase is a separate decision',
      signals: 'Use the four signals as a rapid tie-break',
      workedExample: 'Worked example: choose one call now',
      recommendedActions: 'Choose the next customer in five minutes',
      productBridge: 'Turn a ranked queue into one next action',
      relatedGuides: 'Learn the full prioritisation method',
    },
    signalIntroduction:
      'Start with the two or three customers already closest to the top of your list. Use these signals to compare that shortlist, not to rebuild the entire ledger before every call.',
    signals: customerPrioritisationSignals,
    decisionRules: [
      'Look for reinforcing evidence: meaningful cash exposure, established lateness and a current trigger such as a missed promise.',
      'Lower today’s priority when the latest evidence makes another chase less useful, such as a recent payment or credible payment date.',
      'If the signals split, choose the customer where one contact can produce the clearest useful outcome now, then reassess after recording it.',
    ],
    workedExample: {
      introduction:
        'You have ten minutes for one call and these are the top three customers on the current queue. The decision is who deserves that single action now—not how to rank every overdue customer.',
      customers: [
        {
          name: 'Stonebridge Supplies',
          valueOutstanding: 11800,
          averageDaysLate: 46,
          daysSinceLastPayment: 73,
          founderRisk: 'medium',
          founderRiskReason: 'A promised payment date was missed yesterday.',
          rank: 1,
          rankReason: 'Material cash, chronic lateness and a fresh missed promise support a useful call now.',
        },
        {
          name: 'Westgate Catering',
          valueOutstanding: 7100,
          averageDaysLate: 64,
          daysSinceLastPayment: 92,
          founderRisk: 'high',
          founderRiskReason: 'The finance contact has stopped responding.',
          rank: 2,
          rankReason: 'The risk is serious, but less cash is exposed and there is no newer trigger today.',
        },
        {
          name: 'Ashdown Projects',
          valueOutstanding: 22300,
          averageDaysLate: 13,
          daysSinceLastPayment: 2,
          founderRisk: 'low',
          founderRiskReason: 'A part-payment arrived and the remainder has a credible date.',
          rank: 3,
          rankReason: 'The largest balance does not need the next call because recent evidence shows progress.',
        },
      ],
      conclusion:
        'Call Stonebridge now. Westgate may remain high on the wider priority list, but Stonebridge combines meaningful value with a fresh missed promise. Do not call Ashdown today: the recent payment and credible update make another chase less useful. After the call, record the result and choose again from the refreshed queue.',
    },
    recommendedActions: [
      'Open the current shortlist rather than rescanning the whole aged receivables report.',
      'Check for a payment, promise, dispute or risk change since the list was last refreshed.',
      'Choose the customer where the combined evidence makes one action most useful today.',
      'Make the contact, record the outcome and refresh the shortlist before the next chase.',
    ],
    productBridge:
      'Connect Xero to keep balances, lateness and recent payments current, then add the customer risk only you can judge. The resulting queue puts one customer at the top. After you contact them or Xero records a payment, the next-best action can change without another manual ledger review.',
    ctaLabel: 'See plans and pricing',
    ctaHref: '/pricing',
    relatedSlugs: ['how-to-prioritise-overdue-invoices'],
    indexable: true,
  },
  {
    slug: 'how-to-get-cash-in-faster-from-overdue-customers',
    pageType: 'problem-outcome',
    intentFamily: 'cash-outcome',
    funnelStage: 'solution-aware',
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
