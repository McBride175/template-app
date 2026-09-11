import { hubDSeoPages } from './hub-d-pages'
import { hubESeoPages } from './hub-e-pages'

export type CustomerRisk = 'low' | 'medium' | 'high'

export const CUSTOMER_PRIORITISATION_SIGNAL_KEYS = [
  'value-outstanding',
  'average-days-late',
  'days-since-last-payment',
  'founder-risk',
] as const

export type CustomerPrioritisationSignalKey =
  (typeof CUSTOMER_PRIORITISATION_SIGNAL_KEYS)[number]

export type GuideDecisionSignal = {
  key: string
  label: string
  explanation: string
}

export type PrioritisationSignal = GuideDecisionSignal & {
  key: CustomerPrioritisationSignalKey
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

export type WorkedCustomerScenario = {
  customer: string
  baseline: string
  currentSituation: string
  riskContext?: string
  interpretation: string
  nextAction: string
}

export type WorkedGuideExample = WorkedExample | WorkedCustomerScenario

export type GuideSectionHeadings = {
  whyItMatters?: string
  signals?: string
  decisionRules?: string
  workedExample?: string
  recommendedActions?: string
  productBridge?: string
  relatedGuides?: string
}

export type CustomerRiskScenarioSectionHeadings = {
  whatItMightMean?: string
  riskAssessment?: string
  workedScenario?: string
  recommendedActions?: string
  productBridge?: string
  relatedGuides?: string
}

export type CustomerRiskScenarioExplanation = {
  possibility: string
  evidenceToCheck: string
}

export type CustomerRiskAssessmentFactor = {
  label: string
  evidence: string
  interpretation: string
}

export type OutcomeDriver = {
  key: string
  label: string
  explanation: string
}

export type OutcomeFocusArea = {
  area: string
  evidenceToCheck: string
  whenToPrioritise: string
}

export type WorkedOutcomeExample = {
  businessContext: string
  startingPosition: string
  primaryConstraint: string
  changesMade: string[]
  result: string
  lesson: string
}

export type OutcomeMeasurement = {
  metric: string
  guidance: string
}

export type OutcomeImprovementSectionHeadings = {
  drivers?: string
  focusFirst?: string
  improvementPlan?: string
  workedExample?: string
  measurements?: string
  productBridge?: string
  relatedGuides?: string
}

export type ProcessStage = {
  stage: string
  guidance: string
}

export type ProcessOperatingRhythmItem = {
  cadence: string
  activity: string
  purpose: string
}

export type ProcessWorkItem = {
  task: string
  guidance: string
}

export type WorkedProcessExample = {
  businessContext: string
  previousApproach: string
  processIntroduced: string[]
  operatingRhythm: string
  result: string
  lesson: string
}

export type ProcessFailurePoint = {
  failure: string
  consequence: string
  betterApproach: string
}

export type ProcessHowToSectionHeadings = {
  minimumProcess?: string
  operatingRhythm?: string
  automationAndJudgement?: string
  workedExample?: string
  failurePoints?: string
  productBridge?: string
  relatedGuides?: string
}

export type ExistingPlatformCapability = {
  capability: string
  guidance: string
  context?: string
}

export type AdditionalSoftwareTrigger = {
  trigger: string
  guidance: string
}

export type SoftwareSelectionCriterion = {
  criterion: string
  whyItMatters: string
}

export type SoftwareSolutionApproach = {
  approach: string
  bestFor: string
  limitation?: string
}

export type SoftwarePositioningInput = {
  source: string
  contribution: string
}

export type SoftwareFitItem = {
  situation: string
  guidance: string
}

export type SoftwareSolutionSectionHeadings = {
  existingPlatform?: string
  additionalSoftware?: string
  selectionCriteria?: string
  solutionApproaches?: string
  productDifferentiation?: string
  fit?: string
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

export const SEO_PAGE_TYPES = [
  'problem-outcome',
  'customer-risk-scenario',
  'outcome-improvement',
  'process-how-to',
  'software-solution',
] as const

export type SeoPageType = (typeof SEO_PAGE_TYPES)[number]

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

type SeoGuidePageBase<
  PageType extends SeoPageType,
  IntentFamily extends SeoIntentFamily = SeoIntentFamily,
> = {
  slug: string
  pageType: PageType
  intentFamily: IntentFamily
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
  productBridge: string
  ctaHeading: string
  ctaDescription: string
  ctaLabel: string
  ctaHref: string
  relatedSlugs: string[]
  indexable: boolean
}

export type SeoProblemOutcomePage = SeoGuidePageBase<'problem-outcome'> & {
  whyItMatters: string
  sectionHeadings?: GuideSectionHeadings
  signalIntroduction: string
  signals: readonly GuideDecisionSignal[]
  decisionRules: string[]
  workedExample: WorkedGuideExample
  recommendedActions: string[]
}

export type SeoCustomerRiskScenarioPage = SeoGuidePageBase<
  'customer-risk-scenario',
  'customer-risk'
> & {
  sectionHeadings?: CustomerRiskScenarioSectionHeadings
  diagnosis: {
    introduction: string
    explanations: CustomerRiskScenarioExplanation[]
  }
  riskAssessment: {
    introduction: string
    factors: CustomerRiskAssessmentFactor[]
    conclusion: string
  }
  workedScenario: WorkedCustomerScenario
  recommendedActions: string[]
}

export type SeoOutcomeImprovementPage = SeoGuidePageBase<
  'outcome-improvement',
  'cash-outcome' | 'credit-control-process'
> & {
  sectionHeadings?: OutcomeImprovementSectionHeadings
  driverIntroduction: string
  drivers: OutcomeDriver[]
  focusIntroduction: string
  focusAreas: OutcomeFocusArea[]
  improvementPlan: string[]
  workedExample: WorkedOutcomeExample
  measurementIntroduction: string
  measurements: OutcomeMeasurement[]
}

export type SeoProcessHowToPage = SeoGuidePageBase<
  'process-how-to',
  'credit-control-process' | 'xero'
> & {
  sectionHeadings?: ProcessHowToSectionHeadings
  processIntroduction: string
  processStages: ProcessStage[]
  operatingIntroduction: string
  operatingRhythm: ProcessOperatingRhythmItem[]
  automationAndJudgement: {
    introduction: string
    routineWork: ProcessWorkItem[]
    judgementWork: ProcessWorkItem[]
  }
  workedExample: WorkedProcessExample
  failurePoints: ProcessFailurePoint[]
}

export type SeoSoftwareSolutionPage = SeoGuidePageBase<
  'software-solution',
  'xero'
> & {
  sectionHeadings?: SoftwareSolutionSectionHeadings
  existingPlatformIntroduction: string
  existingPlatformCapabilities: ExistingPlatformCapability[]
  additionalSoftwareIntroduction: string
  additionalSoftwareTriggers: AdditionalSoftwareTrigger[]
  selectionIntroduction: string
  selectionCriteria: SoftwareSelectionCriterion[]
  approachesIntroduction: string
  solutionApproaches: SoftwareSolutionApproach[]
  productDifferentiation: {
    introduction: string
    inputs: SoftwarePositioningInput[]
    outcome: string
  }
  fitIntroduction: string
  goodFit: SoftwareFitItem[]
  poorFit: SoftwareFitItem[]
  ctaHeading: string
  ctaDescription: string
}

export type SeoProblemPage =
  | SeoProblemOutcomePage
  | SeoCustomerRiskScenarioPage
  | SeoOutcomeImprovementPage
  | SeoProcessHowToPage
  | SeoSoftwareSolutionPage

export const seoGuideCategories = [
  {
    intentFamily: 'prioritisation',
    slug: 'prioritising-overdue-invoices',
    title: 'Prioritising overdue invoices',
    shortDescription: 'Choose the right customer, action and workload for the time you have.',
    description:
      'Decide whether value, age or customer risk should change the order; compare several overdue customers; and turn the result into one next contact, a daily list or a focused one-hour session.',
    topics: [
      'Choosing between largest-first, oldest-first and risk-adjusted priorities',
      'Ranking several customers without losing the trade-offs',
      'Turning the order into a realistic daily or one-hour workload',
    ],
  },
  {
    intentFamily: 'cash-outcome',
    slug: 'get-paid-faster',
    title: 'Get paid faster',
    shortDescription: 'Improve time to cash by fixing the constraint that is actually delaying payment.',
    description:
      'Recover overdue invoices, reduce recurring delays and turn receivables into usable cash by separating immediate recovery, operating-process and working-capital decisions.',
    topics: [
      'Recovering overdue invoices and shrinking the overdue backlog',
      'Reducing debtor days and recurring payment delays',
      'Improving a small-business AR system and releasing working capital',
    ],
  },
  {
    intentFamily: 'customer-risk',
    slug: 'late-paying-customers-and-risk',
    title: 'Late-paying customers & customer risk',
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
    title: 'Credit control for small businesses',
    shortDescription: 'Run a consistent credit-control process with limited SME capacity.',
    description:
      'Keep payment work visible, owned and prioritised so monitoring, chasing and escalation become a manageable operating discipline rather than an occasional scramble.',
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
    shortDescription: 'Turn Xero receivables into priorities, owned actions and a workable chasing process.',
    description:
      'Use Xero as the accounting record, then turn overdue information into a customer order, suitable treatments and an owned control rhythm. Decide where reminders are enough, where people should intervene and whether another software layer solves a real gap.',
    topics: [
      'Turning overdue Xero data into a customer-level priority order',
      'Separating routine reminders, tailored chasing and customer blockers',
      'Running the control process and deciding whether extra software is justified',
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

const overdueLedgerMethodSignals = [
  {
    key: 'value-outstanding',
    label: 'Total overdue value',
    explanation:
      'Add all overdue invoices for the customer. Consider both the pounds at stake and the customer’s share of your overdue ledger; neither makes the account automatically first.',
  },
  {
    key: 'average-days-late',
    label: 'Normal payment behaviour',
    explanation:
      'Compare the current delay with the customer’s own history. Treat a thin or new payment history as uncertainty, not proof that the customer is reliable or risky.',
  },
  {
    key: 'days-since-last-payment',
    label: 'Days since last payment',
    explanation:
      'Use recency to judge direction of travel. Interpret it against how often the customer normally buys and pays: 60 quiet days means something different for a weekly buyer and an annual one.',
  },
  {
    key: 'founder-risk',
    label: 'Current business evidence',
    explanation:
      'Record the fact behind your judgement, such as a disputed delivery, a missed promise or lost contact. Avoid labels that nobody can later explain or review.',
  },
] satisfies PrioritisationSignal[]

const nextCustomerDecisionSignals = [
  {
    key: 'value-outstanding',
    label: 'Cash affected by this contact',
    explanation:
      'Compare the customer’s total overdue balance with the other two or three candidates. The amount should be meaningful, but it does not have to be the largest.',
  },
  {
    key: 'average-days-late',
    label: 'Change from normal behaviour',
    explanation:
      'Ask whether today’s delay is routine for this customer or a genuine deterioration. A sudden change can matter more than a consistently late but responsive payer.',
  },
  {
    key: 'days-since-last-payment',
    label: 'Freshest payment evidence',
    explanation:
      'Check what has changed since the queue was produced. A payment received this morning, or a promise that fell due yesterday, can reverse yesterday’s order.',
  },
  {
    key: 'founder-risk',
    label: 'Reason contact is useful now',
    explanation:
      'Use live context as the tie-break. Prefer a contact that can confirm a payment, resolve a blockage or test a missed promise over one that merely repeats an unanswered reminder.',
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
      'overdue customer prioritisation framework',
      'four signal invoice prioritisation',
      'customer-level overdue ledger ranking',
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
      'Build the order at customer level in two passes. First set aside customers whose payment is already moving or whose contact is deliberately paused. Then compare the rest by total overdue value, normal payment behaviour, time since the last payment and current business risk. Move a customer up only when the combined evidence supports action now, record the reason and re-rank when the facts change.',
    whyItMatters:
      'An aged receivables report answers which invoices are late; it does not answer where one hour of attention will have most effect. Oldest-first ignores recent progress. Largest-first ignores whether waiting makes recovery riskier. Grouping by customer lets you judge the whole exposure, the direction of travel and whether a chase is likely to change anything now.',
    sectionHeadings: {
      whyItMatters: 'What the aged report cannot decide for you',
      signals: 'Build one customer-level evidence row',
      decisionRules: 'Use the evidence without inventing a magic score',
      workedExample: 'How the method ranks three customers',
      recommendedActions: 'The output: a queue with reasons and next actions',
      productBridge: 'Keep the ranking current without rebuilding it',
      relatedGuides: 'Put the priority list into action',
    },
    signalIntroduction:
      'Use the same four columns for every overdue customer. They are evidence for a decision, not a formula: the meaning of a number depends on the customer’s history and what has happened since your last review.',
    signals: overdueLedgerMethodSignals,
    decisionRules: [
      'First remove false urgency: a verified payment plan, payment received or agreed pause can make contact unnecessary today, even when the balance is large.',
      'Move an account towards the top when meaningful exposure, deterioration from normal behaviour and a current risk event reinforce one another.',
      'When signals conflict, ask what is likely to get worse before the next review and whether one contact now can protect or release meaningful cash.',
      'Give every top-ranked customer a reason, a next action and a review point. If you cannot explain the position in one sentence, compare it again.',
    ],
    workedExample: {
      introduction:
        'This is an illustrative comparison, not a universal scoring formula. The largest balance is not first because current evidence shows that it is already moving.',
      customers: [
        {
          name: 'Oakfield Retail',
          valueOutstanding: 17600,
          averageDaysLate: 42,
          daysSinceLastPayment: 69,
          founderRisk: 'medium',
          founderRiskReason: 'Two promised payment dates were missed.',
          rank: 1,
          rankReason: 'A meaningful balance, sustained lateness and two failed commitments create the clearest case for action now.',
        },
        {
          name: 'Harbour Studio',
          valueOutstanding: 3900,
          averageDaysLate: 58,
          daysSinceLastPayment: 91,
          founderRisk: 'high',
          founderRiskReason: 'The finance contact has stopped replying.',
          rank: 2,
          rankReason: 'Silence and prolonged inactivity are serious, but the smaller exposure places it behind Oakfield in this ledger; set a short escalation point rather than ignoring it.',
        },
        {
          name: 'Northstar Interiors',
          valueOutstanding: 18400,
          averageDaysLate: 10,
          daysSinceLastPayment: 4,
          founderRisk: 'low',
          founderRiskReason: 'A part-payment arrived this week.',
          rank: 3,
          rankReason: 'The balance matters, but the part-payment is verified and another contact before the agreed date is unlikely to improve the outcome.',
        },
      ],
      conclusion:
        'Contact Oakfield first. Give Harbour an escalation deadline because its risk is high, then monitor Northstar against the agreed date. If Harbour represents a strategically important exposure or its deadline passes, it can move above Oakfield. The ranking is a reasoned decision from the evidence available today, not a permanent judgement about any customer.',
    },
    recommendedActions: [
      'Group overdue invoices by customer and exclude balances that are not genuinely due or are deliberately on hold.',
      'Record total overdue value, normal lateness, last-payment recency and the specific fact behind any risk judgement.',
      'Order the customers, then write one next action and one reason beside the leading accounts.',
      'After each payment, promise, dispute update or loss of contact, update the evidence and let the order change.',
    ],
    productBridge:
      'You can keep these columns in a spreadsheet. The repetitive part is regrouping invoices and refreshing ageing, exposure and payment recency whenever Xero changes. The app does that comparison at customer level and lets your own priority judgement alter the queue when the ledger lacks important context.',
    ctaHeading: 'Keep the customer ranking current',
    ctaDescription:
      'See plans for turning Xero invoice and payment data into a ranked queue using the priority adjustment you choose.',
    ctaLabel: 'See plans and pricing',
    ctaHref: '/pricing',
    relatedSlugs: [
      'how-to-prioritise-multiple-overdue-customers',
      'which-customer-should-i-chase-first-for-payment',
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
      'Contact the customer with the strongest reason for a useful conversation now: a meaningful overdue balance, evidence that payment is slipping and a current event you can act on, such as a missed promise. Skip anyone who has just paid or whose agreed date has not arrived. Make the contact, record the result and then choose again.',
    whyItMatters:
      'The customer who is most concerning overall is not always the best next contact. One account may need a formal escalation because repeated calls have failed; another may have missed a payment yesterday and be reachable now. For this decision, timing and the likely result of one contact matter alongside the wider ranking.',
    sectionHeadings: {
      whyItMatters: 'Most concerning does not always mean call next',
      signals: 'Compare only the live candidates',
      decisionRules: 'A quick rule for the next contact',
      workedExample: 'One call: Stonebridge or Westgate?',
      recommendedActions: 'Make the decision and act',
      productBridge: 'Start from a current queue, not a fresh report',
      relatedGuides: 'Learn the full prioritisation method',
    },
    signalIntroduction:
      'Start with the two or three customers already near the top of the queue. You are looking for what makes one contact more useful now, not conducting a fresh review of every invoice.',
    signals: nextCustomerDecisionSignals,
    decisionRules: [
      'Remove anyone whose payment arrived, whose promise is not yet due or whose contact is intentionally paused.',
      'From the remaining shortlist, prefer the customer with both meaningful exposure and a fresh failure, change or blockage you can address.',
      'If a customer has stopped responding, decide whether the next step is still contact or escalation. Do not keep choosing an action that has already failed.',
      'Choose one customer, complete the action and use the result to make the next decision; do not pre-plan a long sequence from stale evidence.',
    ],
    workedExample: {
      introduction:
        'You have time for one call. Stonebridge and Westgate are both concerning, but only one has a fresh, reachable decision point. Ashdown is included to show how recent progress removes false urgency.',
      customers: [
        {
          name: 'Stonebridge Supplies',
          valueOutstanding: 11800,
          averageDaysLate: 46,
          daysSinceLastPayment: 73,
          founderRisk: 'medium',
          founderRiskReason: 'A promised date was missed yesterday, and the accounts-payable manager asked you to call if it did.',
          rank: 1,
          rankReason: 'The missed promise is fresh, the balance matters and a known contact can explain or release the payment now.',
        },
        {
          name: 'Westgate Catering',
          valueOutstanding: 7100,
          averageDaysLate: 64,
          daysSinceLastPayment: 92,
          founderRisk: 'high',
          founderRiskReason: 'Three calls and two emails to the normal finance contact have gone unanswered.',
          rank: 2,
          rankReason: 'The risk is serious, but repeating the same contact is unlikely to help. The useful next step is to use an alternative contact or review escalation.',
        },
        {
          name: 'Ashdown Projects',
          valueOutstanding: 22300,
          averageDaysLate: 13,
          daysSinceLastPayment: 2,
          founderRisk: 'low',
          founderRiskReason: 'A part-payment arrived and the remainder has a credible date.',
          rank: 3,
          rankReason: 'The part-payment and a future agreed date make another call today unnecessary unless that date is missed.',
        },
      ],
      conclusion:
        'Call Stonebridge. For Westgate, stop treating another routine call as the answer: find a senior commercial contact or review the escalation path. Leave Ashdown until its agreed date. After the Stonebridge call, record whether payment was confirmed, a blockage emerged or the promise was reset before selecting the next customer.',
    },
    recommendedActions: [
      'Open the current top two or three customers rather than rescanning the whole aged report.',
      'Check what changed most recently: payment, missed promise, dispute, new contact or agreed pause.',
      'Choose the reachable customer where one contact can produce the most useful cash or risk outcome now.',
      'Record the result as new evidence, then choose the next customer from the updated shortlist.',
    ],
    productBridge:
      'The decision is quicker when the balance, ageing and latest payment are already current. The app ranks customers from Xero data, shows why they are near the top and lets your own judgement adjust the order. You still decide whether today’s useful action is a call, an email, monitoring or escalation.',
    ctaHeading: 'Open with the next customer already identified',
    ctaDescription:
      'Compare plans for a Xero-connected queue that keeps the latest payment evidence and your customer judgement in the decision.',
    ctaLabel: 'See plans and pricing',
    ctaHref: '/pricing',
    relatedSlugs: [
      'how-to-prioritise-overdue-invoices',
      'how-to-prioritise-debtors-by-risk',
    ],
    indexable: true,
  },
  {
    slug: 'how-to-prioritise-multiple-overdue-customers',
    pageType: 'problem-outcome',
    intentFamily: 'prioritisation',
    funnelStage: 'solution-aware',
    primaryKeyword: 'how to prioritise multiple overdue customers',
    secondaryKeywords: [
      'rank multiple overdue customers',
      'order customers for payment chasing',
      'compare overdue customer priorities',
    ],
    searchIntent: 'informational',
    queryCluster: 'multiple-overdue-customer-prioritisation',
    readerJob:
      'Turn several competing overdue customer balances into an ordered chasing sequence.',
    uniqueAngle:
      'Relative prioritisation that compares several plausible chase targets against one another instead of assessing each account in isolation.',
    metaTitle: 'How to Prioritise Multiple Overdue Customers',
    metaDescription:
      'Compare overdue customers using value, payment behaviour and credible risk evidence, then turn the comparison into a clear chasing order.',
    h1: 'How to prioritise multiple overdue customers',
    directAnswer:
      'Put the overdue customers in one comparison, remove accounts that are already progressing, then order the rest by the strength of the case for action. A customer moves up when material exposure, worsening payment behaviour, no recent payment and credible risk reinforce one another. Where the evidence conflicts, rank the customer for whom waiting is more costly and contact can still change the outcome.',
    whyItMatters:
      'Viewed alone, every overdue customer can justify attention. The decision only becomes useful when Customer A has to be placed before or after Customer B. Relative ranking forces you to expose the trade-off: more cash at stake, a sharper deterioration, a narrower recovery window or clear evidence that no action is needed yet.',
    sectionHeadings: {
      whyItMatters: 'Urgent in isolation is not an order',
      signals: 'Make the comparison fair',
      decisionRules: 'Resolve the trade-offs between customers',
      workedExample: 'Four overdue customers, one defensible sequence',
      recommendedActions: 'Produce an ordered queue, not four risk notes',
      productBridge: 'Keep relative positions current',
      relatedGuides: 'Turn the ranking into daily action',
    },
    signalIntroduction:
      'Use one row per customer and one review time for the whole group. Comparing figures captured on different days, or single invoices against total customer balances, creates a false order.',
    signals: [
      {
        key: 'value-outstanding',
        label: 'Exposure relative to the group',
        explanation:
          'Total the overdue balance per customer, then compare it with both the other candidates and the whole overdue ledger. This shows the cash consequence of the position.',
      },
      {
        key: 'average-days-late',
        label: 'Behaviour on a common basis',
        explanation:
          'Compare each customer’s current and usual lateness using the same measure. Do not treat a single old invoice for one customer as equivalent to a weighted customer position for another.',
      },
      {
        key: 'days-since-last-payment',
        label: 'Direction of travel',
        explanation:
          'Use the last payment, part-payment or missed commitment to separate accounts that are moving from those that have stalled.',
      },
      {
        key: 'founder-risk',
        label: 'Evidence that changes the order',
        explanation:
          'Add a specific fact the numbers omit, then state what it changes. A refinancing warning may narrow the recovery window; an active dispute may change the next action instead.',
      },
    ],
    decisionRules: [
      'Apply a progress gate first: move customers with verified payments or credible future dates below customers requiring action now.',
      'Use dominance where it exists. If one customer has materially greater exposure and equally bad or worse evidence on the other signals, place it first.',
      'When signals split, compare the cost of waiting until the next review with what a call, dispute decision or escalation can realistically change today.',
      'Re-rank for material events, not every minor note. A payment, missed promise, lost contact or resolved dispute qualifies; a routine reminder sent does not.',
    ],
    workedExample: {
      introduction:
        'These four customers are reviewed at the same time and at customer level. Beacon ranks above the larger Alder balance because the disclosed financial problem makes the cost of waiting greater.',
      customers: [
        {
          name: 'Alder Manufacturing',
          valueOutstanding: 14800,
          averageDaysLate: 32,
          daysSinceLastPayment: 48,
          founderRisk: 'medium',
          founderRiskReason: 'An internal approval delay has already caused one missed date.',
          rank: 2,
          rankReason: 'The larger exposure and missed date justify prompt contact, but the approval issue is less time-sensitive than Beacon’s disclosed financial stress.',
        },
        {
          name: 'Beacon Distribution',
          valueOutstanding: 8600,
          averageDaysLate: 57,
          daysSinceLastPayment: 83,
          founderRisk: 'high',
          founderRiskReason: 'The customer has disclosed a short-term refinancing problem.',
          rank: 1,
          rankReason: 'Chronic lateness, a long payment gap and disclosed refinancing pressure make delay more consequential despite the smaller balance.',
        },
        {
          name: 'Daleside Events',
          valueOutstanding: 4200,
          averageDaysLate: 70,
          daysSinceLastPayment: 105,
          founderRisk: 'medium',
          founderRiskReason: 'Two reminder emails have gone unanswered.',
          rank: 3,
          rankReason: 'The silence needs a defined escalation point, but the much smaller exposure places it behind the two more consequential accounts.',
        },
        {
          name: 'Cedar Workspace',
          valueOutstanding: 25000,
          averageDaysLate: 9,
          daysSinceLastPayment: 3,
          founderRisk: 'low',
          founderRiskReason: 'A part-payment arrived with a credible date for the remainder.',
          rank: 4,
          rankReason: 'A verified part-payment and credible future date pass the progress gate, so the largest balance stays below accounts needing action now.',
        },
      ],
      conclusion:
        'The sequence is Beacon, Alder, Daleside, then Cedar. This is not a declaration that Beacon is the worst customer; it says the recovery window looks narrowest today. If Beacon pays, Alder becomes first. If Cedar misses its agreed date, it returns to the live comparison instead of remaining protected by its history.',
    },
    recommendedActions: [
      'Capture every candidate at customer level and at the same review time.',
      'Apply the progress gate, then compare each remaining customer with the one immediately above and below it.',
      'Record a one-sentence trade-off for the leading positions: why this customer comes before the next one.',
      'Attach a specific action and review point to each live account, then work from the top.',
      'Change the order only when new evidence changes the trade-off.',
    ],
    productBridge:
      'A spreadsheet can hold the comparison, but relative positions become stale as soon as invoices and payments change. The app recalculates the Xero-derived part of the ranking across customers and keeps your own priority adjustment beside it.',
    ctaHeading: 'Keep competing customer priorities in order',
    ctaDescription:
      'See plans for a customer-level queue that updates the comparison when Xero balances and payments change.',
    ctaLabel: 'See plans and pricing',
    ctaHref: '/pricing',
    relatedSlugs: [
      'how-to-create-a-daily-credit-control-priority-list',
      'should-i-chase-the-largest-invoice-first',
    ],
    indexable: true,
  },
  {
    slug: 'should-i-chase-the-largest-invoice-first',
    pageType: 'problem-outcome',
    intentFamily: 'prioritisation',
    funnelStage: 'problem-aware',
    primaryKeyword: 'should I chase the largest invoice first',
    secondaryKeywords: [
      'largest overdue balance first',
      'biggest invoice payment chase',
      'prioritise overdue invoices by value',
    ],
    searchIntent: 'informational',
    queryCluster: 'largest-overdue-invoice-chase-decision',
    readerJob:
      'Decide whether the biggest outstanding balance should automatically be chased first.',
    uniqueAngle:
      'Challenge value-only prioritisation by testing the largest balance against payment behaviour, recency and credible customer risk.',
    metaTitle: 'Should I Chase the Largest Invoice First?',
    metaDescription:
      'Learn when a large overdue balance should lead the chase queue—and when a smaller but riskier customer deserves attention first.',
    h1: 'Should I chase the largest invoice first?',
    directAnswer:
      'No, not automatically. Chase the largest balance first when it is materially overdue, not already progressing and a contact now could change the outcome. Put a smaller balance ahead when its payment behaviour is deteriorating or delay could narrow your recovery options. Compare total exposure by customer, not the face value of one invoice.',
    whyItMatters:
      'Largest-first is a useful shortcut only when the other evidence is roughly equal. It fails when a large customer is meeting a staged plan or a smaller customer has stopped paying and communicating. The right question is not simply “How much could we collect?” but “What does waiting until the next review put at risk?”',
    sectionHeadings: {
      whyItMatters: 'When largest-first is a sound shortcut',
      signals: 'Four checks before you call the biggest debtor',
      decisionRules: 'Let value lead only when the account is actionable',
      workedExample: 'Why the £32,000 balance ranks third',
      recommendedActions: 'Use a value-first check, not a value-only queue',
      productBridge: 'See the evidence behind the balance',
      relatedGuides: 'Use the complete prioritisation method',
    },
    signalIntroduction:
      'Start with the largest customer exposure, then test whether it deserves immediate action. One strong reason to wait can be more useful than three reasons why the balance is important.',
    signals: [
      {
        key: 'value-outstanding',
        label: 'Total customer exposure',
        explanation:
          'Combine all overdue invoices for the customer and compare the result with your whole overdue ledger. A £20,000 balance has different significance in a £40,000 ledger and a £400,000 ledger.',
      },
      {
        key: 'average-days-late',
        label: 'Late relative to normal',
        explanation:
          'Check whether the current delay is outside the customer’s normal range. A large but normally predictable account may need monitoring; a sudden change needs explanation.',
      },
      {
        key: 'days-since-last-payment',
        label: 'Evidence of current progress',
        explanation:
          'Verify any part-payment and the next promised date. Recent cash reduces the value of another immediate contact only when the remaining plan is credible.',
      },
      {
        key: 'founder-risk',
        label: 'Cost of waiting',
        explanation:
          'Look for facts that make delay costly: broken promises, lost contact, known financial pressure or further supply that will increase the exposure.',
      },
    ],
    decisionRules: [
      'Chase the largest customer first when the balance is material, payment is not already progressing and the next contact has a clear purpose.',
      'Keep the largest customer under review rather than chasing again when a verified payment or credible future date makes waiting the agreed action.',
      'Put a smaller customer first only when specific evidence makes delay more costly; general nervousness is not enough.',
      'If the large balance is disputed, prioritise resolving the dispute rather than sending another request for payment.',
    ],
    workedExample: {
      introduction:
        'This illustrative ledger shows why value is a starting point rather than the final order. Meridian owes the most, but there is no useful reason to call before its next agreed date.',
      customers: [
        {
          name: 'Fenland Components',
          valueOutstanding: 13800,
          averageDaysLate: 54,
          daysSinceLastPayment: 87,
          founderRisk: 'high',
          founderRiskReason: 'Two promises were broken and the finance contact is now difficult to reach.',
          rank: 1,
          rankReason: 'Two failed promises, prolonged inactivity and lost contact make waiting costly, even though this is the smallest of the three balances.',
        },
        {
          name: 'Union Printworks',
          valueOutstanding: 19500,
          averageDaysLate: 29,
          daysSinceLastPayment: 38,
          founderRisk: 'medium',
          founderRiskReason: 'Approval is delayed, but the customer remains responsive.',
          rank: 2,
          rankReason: 'The balance is material and has stalled. A call to identify the remaining approval step has a clear purpose.',
        },
        {
          name: 'Meridian Foods',
          valueOutstanding: 32000,
          averageDaysLate: 8,
          daysSinceLastPayment: 2,
          founderRisk: 'low',
          founderRiskReason: 'A substantial part-payment arrived with a confirmed date for the balance.',
          rank: 3,
          rankReason: 'The payment is verified and the remaining date is still in the future. Calling today would add pressure without adding information.',
        },
      ],
      conclusion:
        'Contact Fenland first and use a different route because the normal finance contact is failing. Call Union next to unblock approval. Monitor Meridian until the agreed date, then move it back into the live comparison if payment does not arrive. Largest-first would have used the first call on the one account already moving.',
    },
    recommendedActions: [
      'Sort by total overdue customer balance to identify the largest exposures.',
      'For each leading balance, check whether the delay is unusual and whether payment is already moving.',
      'Write down the purpose of contacting it now: confirm payment, remove a blockage, test a broken promise or limit further exposure.',
      'Compare the cost of waiting with the next smaller customer, then choose the first useful action.',
      'Keep any deferred large balance tied to a firm review date.',
    ],
    productBridge:
      'Xero can supply the balances, invoice dates and payment records; your business still knows whether an agreed plan is credible or a new risk has appeared. The app ranks the accounting evidence and lets your chosen priority adjustment reflect that wider context, so a large, progressing balance does not automatically consume the first chasing slot.',
    ctaHeading: 'See beyond the biggest balance',
    ctaDescription:
      'See plans for ranking Xero customers by exposure, ageing and payment evidence, with room for your own priority judgement.',
    ctaLabel: 'See plans and pricing',
    ctaHref: '/pricing',
    relatedSlugs: [
      'should-i-chase-the-oldest-invoice-first',
      'how-to-prioritise-debtors-by-risk',
    ],
    indexable: true,
  },
  {
    slug: 'should-i-chase-the-oldest-invoice-first',
    pageType: 'problem-outcome',
    intentFamily: 'prioritisation',
    funnelStage: 'problem-aware',
    primaryKeyword: 'should I chase the oldest invoice first',
    secondaryKeywords: [
      'oldest overdue invoice first',
      'age debt chasing order',
      'prioritise overdue invoices by age',
    ],
    searchIntent: 'informational',
    queryCluster: 'oldest-overdue-invoice-chase-decision',
    readerJob:
      'Decide whether invoice age should automatically determine the payment-chasing order.',
    uniqueAngle:
      'Challenge oldest-debt-first prioritisation by separating the age of one invoice from customer-level payment behaviour and recent progress.',
    metaTitle: 'Should I Chase the Oldest Invoice First?',
    metaDescription:
      'Learn why the oldest overdue invoice is not always the most urgent and how customer payment behaviour can change the chase order.',
    h1: 'Should I chase the oldest invoice first?',
    directAnswer:
      'No, not automatically. Chase the oldest invoice first when its age is reinforced by stalled payment, broken promises or rising recovery risk. If the old debt is moving under a credible plan, or needs a dispute resolved rather than another reminder, a newer but deteriorating customer can come first. Keep the old balance on a dated review rather than forgetting it.',
    whyItMatters:
      'Invoice age measures elapsed time, not the likely value of your next action. A 100-day item may be shrinking through staged payments; a 30-day item may be the first sign that a regular payer has stopped paying altogether. Old debt still needs ownership, but the oldest date is not enough to choose today’s first contact.',
    sectionHeadings: {
      whyItMatters: 'Age measures time, not the next useful action',
      signals: 'Read an old invoice in its customer context',
      decisionRules: 'When oldest-first works, and when it fails',
      workedExample: 'Why a 28-day balance comes before a 112-day invoice',
      recommendedActions: 'Keep old debt controlled without chasing by date alone',
      productBridge: 'Add movement and context to invoice age',
      relatedGuides: 'Compare age with the wider risk picture',
    },
    signalIntroduction:
      'Begin with the oldest item, then widen the view before choosing an action. Separate “old and stalled” from “old but progressing”, and compare both with customers whose newer debt is changing unusually fast.',
    signals: [
      {
        key: 'value-outstanding',
        label: 'Total exposure behind the old item',
        explanation:
          'Group all overdue invoices for the customer. One very old, low-value item should not hide a larger customer exposure elsewhere in the ledger.',
      },
      {
        key: 'average-days-late',
        label: 'One old invoice or a pattern?',
        explanation:
          'Compare the age of this item with the customer’s usual payment timing and the age of their other invoices. An isolated exception and chronic late payment call for different judgements.',
      },
      {
        key: 'days-since-last-payment',
        label: 'Is the old balance moving?',
        explanation:
          'Check the last payment amount and date, not just whether any payment exists. A token payment need not prove progress; a staged payment matching the plan often does.',
      },
      {
        key: 'founder-risk',
        label: 'Reason the invoice remains unpaid',
        explanation:
          'Identify whether the next job is payment chasing, dispute resolution, correcting paperwork or escalation. Repeating the wrong action will not make an old invoice move.',
      },
    ],
    decisionRules: [
      'Use oldest-first when comparable customers are otherwise similar, or when age is reinforced by no payment, failed commitments and no credible explanation.',
      'Defer another chase when an old balance is following a verified payment plan whose next date has not arrived; keep that date visible.',
      'If an old invoice is disputed or administratively blocked, prioritise resolving the blockage rather than sending another payment reminder.',
      'Move newer debt ahead when the change from normal behaviour, lack of payment and cost of waiting are materially worse.',
    ],
    workedExample: {
      introduction:
        'This illustrative comparison starts with invoice age: Kingsley has an item 112 days overdue, Fairview’s oldest is 61 days overdue and Moorland’s is 28 days overdue. The first useful action runs in the opposite direction.',
      customers: [
        {
          name: 'Moorland Services',
          valueOutstanding: 11200,
          averageDaysLate: 52,
          daysSinceLastPayment: 88,
          founderRisk: 'high',
          founderRiskReason: 'Oldest invoice: 28 days. Two promised dates were missed and a normally responsive contact has become irregular.',
          rank: 1,
          rankReason: 'The newest debt represents the sharpest deterioration and has no payment progress. Waiting risks allowing a new problem to become an old one.',
        },
        {
          name: 'Fairview Engineering',
          valueOutstanding: 20400,
          averageDaysLate: 31,
          daysSinceLastPayment: 47,
          founderRisk: 'medium',
          founderRiskReason: 'Oldest invoice: 61 days. The finance team is responsive but has not confirmed a payment date.',
          rank: 2,
          rankReason: 'The material balance has stalled and a call has a clear purpose: obtain or test a firm payment date.',
        },
        {
          name: 'Kingsley Legal',
          valueOutstanding: 16500,
          averageDaysLate: 7,
          daysSinceLastPayment: 4,
          founderRisk: 'low',
          founderRiskReason: 'Oldest invoice: 112 days. A staged payment arrived this week and the remaining dates are documented.',
          rank: 3,
          rankReason: 'The oldest item remains controlled by a plan that is currently being met. Review it on the next date rather than calling again today.',
        },
      ],
      conclusion:
        'Contact Moorland first, then Fairview. Do not remove Kingsley from control: leave it assigned to the next staged-payment date and move it up immediately if that date fails. This preserves discipline over old debt without allowing age alone to displace more time-sensitive work.',
    },
    recommendedActions: [
      'Use the aged report to find old debt, then group the items by customer before choosing the order.',
      'Mark each leading balance as stalled, progressing or blocked, with the evidence behind that status.',
      'Give progressing debt a dated review and blocked debt an action that addresses the blockage.',
      'Compare the stalled customers by exposure, change from normal behaviour and cost of waiting.',
      'Escalate old debt when its evidence changes; never let “not first today” become “not owned”.',
    ],
    productBridge:
      'Xero invoice and payment data can show age, exposure and recent movement. The app turns those records into a customer-level order and lets your own judgement account for plans, disputes and other context that changes whether the oldest item needs action today.',
    ctaHeading: 'Put payment movement beside invoice age',
    ctaDescription:
      'See plans for a Xero-connected queue that ranks customers without losing sight of old balances and their next review dates.',
    ctaLabel: 'See plans and pricing',
    ctaHref: '/pricing',
    relatedSlugs: [
      'how-to-prioritise-overdue-invoices',
      'how-to-prioritise-debtors-by-risk',
    ],
    indexable: true,
  },
  {
    slug: 'how-to-create-a-daily-credit-control-priority-list',
    pageType: 'problem-outcome',
    intentFamily: 'prioritisation',
    funnelStage: 'solution-aware',
    primaryKeyword: 'how to create a daily credit control priority list',
    secondaryKeywords: [
      'daily credit control list',
      'daily invoice chasing queue',
      'today’s credit control priorities',
    ],
    searchIntent: 'informational',
    queryCluster: 'daily-credit-control-priority-list',
    readerJob:
      'Turn the overdue ledger into a manageable set of customer-chasing actions for today.',
    uniqueAngle:
      'Translate a ranked customer ledger into a repeatable daily workload without mistaking the full ranking for today’s task list.',
    metaTitle: 'How to Create a Daily Credit-Control Priority List',
    metaDescription:
      'Turn a ranked overdue ledger into a realistic daily credit-control queue, then refresh it as payments and customer information change.',
    h1: 'How to create a daily credit-control priority list',
    directAnswer:
      'Start with the ranked customer ledger, decide how much credit-control time you actually have, and fill that capacity from the top with complete actions. Allow roughly for preparation, contact and recording rather than counting names. Include any promise or escalation due today, then defer the rest to a visible next review. The daily list should be finishable.',
    whyItMatters:
      'A full ledger is an inventory of debt, not a workable day. Copying every name into today’s list guarantees carry-over and encourages quick reminders instead of useful conversations. Capacity forces a real choice: which customer actions will be completed properly today, and exactly when will the rest be reconsidered?',
    sectionHeadings: {
      whyItMatters: 'The ledger is not a to-do list',
      signals: 'Refresh only what can change today’s selection',
      decisionRules: 'Fit complete actions into real capacity',
      workedExample: 'A 50-minute list from four ranked customers',
      recommendedActions: 'Build tomorrow’s list in one short routine',
      productBridge: 'Begin each session with a current order',
      relatedGuides: 'Adapt the queue to the time available',
    },
    signalIntroduction:
      'Do not score every customer again each morning. Refresh payments, commitments and business context that arrived since the last session, then use the resulting rank to choose today’s workload.',
    signals: [
      {
        key: 'value-outstanding',
        label: 'Cash impact of today’s action',
        explanation:
          'Keep meaningful balances near the front, but estimate the work needed. A £20,000 disputed balance may need a 25-minute owner call, not a two-minute reminder.',
      },
      {
        key: 'average-days-late',
        label: 'Persistent work that must stay visible',
        explanation:
          'Habitual late payers should not disappear because a newer problem feels more interesting. Their ledger rank keeps them competing for the next available slot.',
      },
      {
        key: 'days-since-last-payment',
        label: 'Overnight movement',
        explanation:
          'Check for payments before fixing the list. Cash received overnight can remove an action; a promised payment that failed can create one.',
      },
      {
        key: 'founder-risk',
        label: 'Actions due today',
        explanation:
          'Bring in commitments, dispute reviews or escalation points whose agreed date is today. A dated obligation is stronger than a vague intention to follow up soon.',
      },
    ],
    decisionRules: [
      'Set capacity in minutes and action types: for example, one 20-minute call and two 10-minute follow-ups, plus time to record outcomes.',
      'Add commitments due today, then fill the remaining capacity from the top of the refreshed customer ranking.',
      'Do not replace a high-value conversation with several easy reminders merely to complete more tasks.',
      'Give every deferred leading customer a next review date, and name the first substitute if a selected action disappears after payment.',
    ],
    workedExample: {
      introduction:
        'After a ten-minute refresh, this founder has 50 minutes for collection work: about 25 minutes for Cromwell, 20 for Ivybridge and five to record both outcomes. The other two customers remain controlled, but they are not pretending to be today’s tasks.',
      customers: [
        {
          name: 'Cromwell Kitchens',
          valueOutstanding: 12400,
          averageDaysLate: 49,
          daysSinceLastPayment: 71,
          founderRisk: 'high',
          founderRiskReason: 'Yesterday’s payment did not arrive. Allow 25 minutes to call, agree the next step and record it.',
          rank: 1,
          rankReason: 'A commitment is already due, and the time allowance is enough for a proper conversation rather than another reminder.',
        },
        {
          name: 'Ivybridge Care',
          valueOutstanding: 18900,
          averageDaysLate: 24,
          daysSinceLastPayment: 39,
          founderRisk: 'medium',
          founderRiskReason: 'Internal approval has stalled. Allow 20 minutes to identify the approver and obtain a dated next step.',
          rank: 2,
          rankReason: 'The cash impact and identifiable approval blockage justify the second complete action that fits today’s capacity.',
        },
        {
          name: 'Parkside Media',
          valueOutstanding: 5800,
          averageDaysLate: 60,
          daysSinceLastPayment: 95,
          founderRisk: 'medium',
          founderRiskReason: 'Reminders are unanswered. It is tomorrow’s first substitute if either selected account pays before contact.',
          rank: 3,
          rankReason: 'Poor behaviour keeps it visible, but the first two actions fill the available time. Deferral is explicit, not accidental.',
        },
        {
          name: 'Juniper Hotels',
          valueOutstanding: 27500,
          averageDaysLate: 8,
          daysSinceLastPayment: 2,
          founderRisk: 'low',
          founderRiskReason: 'A large part-payment arrived and the next balance date is confirmed for later this week.',
          rank: 4,
          rankReason: 'Monitor against the agreed date. Its size does not justify an extra contact while the plan is on track.',
        },
      ],
      conclusion:
        'Today’s list contains Cromwell and Ivybridge, with Parkside named as the substitute. Juniper stays tied to its agreed payment date. This is better than listing all four: the founder knows what “done” means today and no deferred customer has vanished from control.',
    },
    recommendedActions: [
      'Choose the day’s collection window and reserve time for recording outcomes.',
      'Refresh new payments, failed commitments and dated actions before selecting work.',
      'Estimate the time for each leading action and fill capacity from the top of the queue.',
      'Name a substitute and a review date for any priority customer that does not fit.',
      'At the end of the session, record outcomes so the next list starts from new evidence rather than memory.',
    ],
    productBridge:
      'The capacity decision remains yours. The app removes much of the morning sorting by refreshing the Xero-derived customer order and retaining your priority adjustment, so you can spend the available window selecting and completing actions.',
    ctaHeading: 'Start the day from a current customer order',
    ctaDescription:
      'See plans for a Xero-connected priority queue that gives you a reliable starting point for today’s finishable list.',
    ctaLabel: 'See plans and pricing',
    ctaHref: '/pricing',
    relatedSlugs: [
      'how-to-prioritise-invoice-chasing-when-you-only-have-an-hour',
      'how-to-prioritise-multiple-overdue-customers',
    ],
    indexable: true,
  },
  {
    slug: 'how-to-prioritise-debtors-by-risk',
    pageType: 'problem-outcome',
    intentFamily: 'prioritisation',
    funnelStage: 'solution-aware',
    primaryKeyword: 'how to prioritise debtors by risk',
    secondaryKeywords: [
      'rank debtors by risk',
      'customer risk credit control',
      'prioritise risky overdue customers',
    ],
    searchIntent: 'informational',
    queryCluster: 'debtor-risk-prioritisation',
    readerJob:
      'Use credible customer-risk information to decide which overdue debtors deserve earlier attention.',
    uniqueAngle:
      'Blend quantitative accounting signals with founder knowledge that explains disputes, broken promises, financial stress or relationship deterioration.',
    metaTitle: 'How to Prioritise Debtors by Risk',
    metaDescription:
      'Use credible customer-risk evidence alongside overdue value and payment behaviour to improve debtor prioritisation without relying on intuition alone.',
    h1: 'How to prioritise debtors by risk',
    directAnswer:
      'Start with overdue value and payment behaviour, then adjust the order only for specific risk evidence the ledger cannot show. Record the fact, what it could mean for recovery and the action it changes. Move a debtor up when waiting may materially worsen recovery or increase your exposure; lower the adjustment when payment, contact or dispute evidence improves.',
    whyItMatters:
      'A risk label without evidence is just anxiety in a spreadsheet. Equally, the ledger cannot tell you that a director disclosed refinancing pressure, a customer broke two promises or a relationship is blocking honest communication. A disciplined adjustment captures that knowledge without allowing reputation, size or personal preference to override the numbers indefinitely.',
    sectionHeadings: {
      whyItMatters: 'Turn judgement into evidence someone can review',
      signals: 'Test the risk judgement against the ledger',
      decisionRules: 'Fact, implication, changed action',
      workedExample: 'Nearly identical numbers, different recovery risk',
      recommendedActions: 'Record risk without creating a second shadow ledger',
      productBridge: 'Keep judgement attached to current evidence',
      relatedGuides: 'Apply risk to the next-customer decision',
    },
    signalIntroduction:
      'Treat the first three signals as the anchor and the fourth as a documented adjustment. Risk should explain why the same accounting position deserves a different response, not act as a free-standing score.',
    signals: [
      {
        key: 'value-outstanding',
        label: 'Exposure affected',
        explanation:
          'State the overdue cash at risk and whether further work or supply will increase it. Serious news on a trivial balance may call for a different response from moderate concern on a major exposure.',
      },
      {
        key: 'average-days-late',
        label: 'Behavioural baseline',
        explanation:
          'Compare the current position with how this customer normally pays. A change from ten days late to forty is stronger supporting evidence than a customer remaining within its established range.',
      },
      {
        key: 'days-since-last-payment',
        label: 'Evidence that confirms or contradicts risk',
        explanation:
          'A long payment gap or token payment after repeated promises can support concern. A verified substantial payment may justify lowering it. Record the amount as well as the date.',
      },
      {
        key: 'founder-risk',
        label: 'Fact outside the ledger',
        explanation:
          'Write a dated, neutral fact such as “customer disclosed refinancing delay on 4 September” rather than “feels risky”. Then state which collection decision changes because of it.',
      },
    ],
    decisionRules: [
      'Use the sequence fact → possible recovery implication → changed action. If any step is missing, do not let the label move the customer.',
      'Raise priority when waiting could narrow recovery options, allow exposure to grow or leave a material broken commitment untested.',
      'Treat a dispute as an action-routing fact, not automatic evidence of financial distress: resolve the issue that blocks payment.',
      'Set a review trigger for every adjustment and remove or reduce it when payment, contact or resolution contradicts the earlier concern.',
    ],
    workedExample: {
      introduction:
        'This illustrative comparison makes the adjustment visible. Atlas and Birch look almost identical in the accounting data; dated business evidence changes both the position and the action.',
      customers: [
        {
          name: 'Atlas Fabrication',
          valueOutstanding: 12000,
          averageDaysLate: 38,
          daysSinceLastPayment: 57,
          founderRisk: 'high',
          founderRiskReason: 'The finance director disclosed a refinancing delay on 2 September, then the customer missed the payment date agreed for 4 September.',
          rank: 1,
          rankReason: 'Fact: refinancing delay and missed date. Implication: waiting may narrow the recovery window. Action: direct senior contact and review further exposure.',
        },
        {
          name: 'Calder Scientific',
          valueOutstanding: 19500,
          averageDaysLate: 21,
          daysSinceLastPayment: 32,
          founderRisk: 'medium',
          founderRiskReason: 'A pricing dispute is unresolved, with named people on both sides due to review it tomorrow.',
          rank: 2,
          rankReason: 'The larger value matters, but the evidence points to resolving the dispute on its agreed timetable, not assuming financial distress.',
        },
        {
          name: 'Birch Property Group',
          valueOutstanding: 12600,
          averageDaysLate: 40,
          daysSinceLastPayment: 55,
          founderRisk: 'low',
          founderRiskReason: 'The customer supplied remittance confirmation for the full balance and the transfer is being traced.',
          rank: 3,
          rankReason: 'The numbers resemble Atlas, but evidence of a full transfer contradicts a high-risk interpretation. Monitor the trace rather than escalate today.',
        },
      ],
      conclusion:
        'Atlas moves first because the external evidence makes recovery more time-sensitive. Calder’s issue is material but has a named resolution step tomorrow. Birch stays under review without escalation because current evidence points to a payment-processing problem. The same balance and lateness can warrant different actions when the evidence is explicit.',
    },
    recommendedActions: [
      'Write a dated fact, avoiding speculation about motives or solvency.',
      'State what that fact could change: recovery timing, further exposure, contact route or the kind of action required.',
      'Compare it with overdue value, normal behaviour and the latest payment before changing the rank.',
      'Set the next evidence trigger and revise the adjustment when that trigger occurs.',
    ],
    productBridge:
      'The app builds the accounting side of the ranking from current Xero evidence and applies the priority adjustment you choose based on customer context. That keeps the human decision attached to a live ledger rather than maintained in a separate list that quickly goes stale.',
    ctaHeading: 'Use judgement without losing the ledger evidence',
    ctaDescription:
      'See plans for combining Xero-derived customer priorities with the risk context only your business can supply.',
    ctaLabel: 'See plans and pricing',
    ctaHref: '/pricing',
    relatedSlugs: [
      'which-customer-should-i-chase-first-for-payment',
      'how-to-prioritise-overdue-invoices',
    ],
    indexable: true,
  },
  {
    slug: 'how-to-prioritise-invoice-chasing-when-you-only-have-an-hour',
    pageType: 'problem-outcome',
    intentFamily: 'prioritisation',
    funnelStage: 'solution-aware',
    primaryKeyword: 'how to prioritise invoice chasing when you only have an hour',
    secondaryKeywords: [
      'one hour credit control',
      'limited time invoice chasing',
      'quick overdue payment priority list',
    ],
    searchIntent: 'informational',
    queryCluster: 'limited-time-invoice-chasing-prioritisation',
    readerJob:
      'Choose where to spend one limited hour of invoice-chasing time.',
    uniqueAngle:
      'Optimise a scarce founder credit-control window by selecting one or two high-impact customers and explicitly deferring the rest.',
    metaTitle: 'How to Prioritise Invoice Chasing in One Hour',
    metaDescription:
      'Use one hour of credit-control time on the customers with the strongest combined case for action instead of reviewing the whole overdue ledger.',
    h1: 'How to prioritise invoice chasing when you only have an hour',
    directAnswer:
      'Spend no more than ten minutes checking the top of your current queue, about forty minutes completing one or two high-impact customer actions, and the final ten minutes recording outcomes and deferrals. Choose customers where meaningful cash is at stake and a call or focused follow-up can change something now. Do not spend the hour reviewing the whole ledger or sending shallow reminders to everyone.',
    whyItMatters:
      'The hour has three competing uses: deciding, acting and preserving what you learn. Over-invest in sorting and no customer gets contacted; touch too many accounts and nothing difficult gets resolved; skip the notes and the next hour starts from memory. A hard timebox protects the part that can actually move cash.',
    sectionHeadings: {
      whyItMatters: 'Protect the hour from sorting and admin',
      signals: 'Confirm the shortlist in ten minutes',
      decisionRules: 'A practical 10–40–10 timebox',
      workedExample: 'Exactly how one hour is allocated',
      recommendedActions: 'Run the hour from a timer, not an open ledger',
      productBridge: 'Use software for the part that steals the hour',
      relatedGuides: 'Build the next limited-time queue',
    },
    signalIntroduction:
      'Open only the current leading candidates and check for evidence that would remove or replace one. The purpose of this review is to protect forty minutes for action, not perfect the whole ranking.',
    signals: [
      {
        key: 'value-outstanding',
        label: 'Enough cash to justify the slot',
        explanation:
          'Use customer-level overdue value to avoid spending a scarce 20-minute slot on a low-impact account when a more consequential action is ready.',
      },
      {
        key: 'average-days-late',
        label: 'A real change or persistent problem',
        explanation:
          'Confirm that the delay is outside normal behaviour or part of a persistent pattern. Do not use the hour to research every historic payment.',
      },
      {
        key: 'days-since-last-payment',
        label: 'No fresh reason to wait',
        explanation:
          'Remove a candidate if a verified payment or credible future commitment makes contact unnecessary. Replace it with the next ranked customer.',
      },
      {
        key: 'founder-risk',
        label: 'An action with a useful outcome',
        explanation:
          'Know what the 20 minutes should produce: a confirmed payment, a named dispute owner, a tested promise or a decision to escalate. “Send another reminder” is too vague.',
      },
    ],
    decisionRules: [
      'Minutes 0–10: verify payments, due promises and contact details for the top three or four customers only.',
      'Minutes 10–50: complete one difficult action or two focused 20-minute actions; do not add extra names because a contact finishes early.',
      'Minutes 50–60: record what happened, the next owner and date, and which deferred customer starts the next session.',
      'If the queue is not current, use this hour to make one sound action and fix the list later; do not sacrifice the whole session to analysis.',
    ],
    workedExample: {
      introduction:
        'This illustrative hour starts with four candidates. Ten minutes confirms the evidence, Elmbridge receives minutes 10–30, Norwood receives minutes 30–50, and the last ten minutes capture outcomes and the two deliberate deferrals.',
      customers: [
        {
          name: 'Elmbridge Packaging',
          valueOutstanding: 21000,
          averageDaysLate: 41,
          daysSinceLastPayment: 68,
          founderRisk: 'high',
          founderRiskReason: 'A promised transfer failed and the finance director requested another delay. Aim: test the reason and agree a credible dated payment step.',
          rank: 1,
          rankReason: 'The £21,000 exposure and fresh failed promise make a focused senior conversation the best use of minutes 10–30.',
        },
        {
          name: 'Norwood Leisure',
          valueOutstanding: 10400,
          averageDaysLate: 63,
          daysSinceLastPayment: 96,
          founderRisk: 'high',
          founderRiskReason: 'The normal finance contact has stopped responding. Aim: use the commercial sponsor to establish whether payment or escalation is next.',
          rank: 2,
          rankReason: 'Persistent lateness and lost contact justify the second slot despite the lower value. Repeating the unanswered email is not the planned action.',
        },
        {
          name: 'Willowbrook Design',
          valueOutstanding: 6900,
          averageDaysLate: 44,
          daysSinceLastPayment: 52,
          founderRisk: 'medium',
          founderRiskReason: 'The customer is late but remains responsive. Defer to the first slot in the next chasing window.',
          rank: 3,
          rankReason: 'The account still matters, but the smaller exposure and stable contact make a short, recorded deferral reasonable.',
        },
        {
          name: 'Redstone Logistics',
          valueOutstanding: 29800,
          averageDaysLate: 10,
          daysSinceLastPayment: 3,
          founderRisk: 'low',
          founderRiskReason: 'A part-payment arrived with an agreed timetable whose next date has not yet arrived.',
          rank: 4,
          rankReason: 'The largest balance is monitored rather than contacted because current progress removes it from this hour’s active work.',
        },
      ],
      conclusion:
        'At minute 50, stop adding customer work. Record Elmbridge’s and Norwood’s outcomes, put Willowbrook first in the next session and leave Redstone attached to its agreed date. If one contact takes all forty action minutes because a real issue is being resolved, that can still be a better use of the hour than four completed reminders.',
    },
    recommendedActions: [
      'Start a ten-minute timer and verify only the leading candidates.',
      'Write the intended outcome beside the one or two actions selected for the middle forty minutes.',
      'Use the strongest available route: direct call, focused email, dispute owner or senior contact.',
      'Stop customer work at minute 50 and record outcomes, owners and dates.',
      'Carry forward a named first customer, not an unfiltered remainder of the ledger.',
    ],
    productBridge:
      'The app is most useful here before the timer starts: it refreshes the customer-level order from Xero evidence and your priority adjustment. That leaves the hour for judgement, contact and recording rather than regrouping invoices and checking which payments arrived.',
    ctaHeading: 'Spend the hour chasing, not sorting',
    ctaDescription:
      'See plans for beginning each limited collection window with a current, Xero-connected customer queue.',
    ctaLabel: 'See plans and pricing',
    ctaHref: '/pricing',
    relatedSlugs: [
      'how-to-create-a-daily-credit-control-priority-list',
      'which-customer-should-i-chase-first-for-payment',
    ],
    indexable: true,
  },
  {
    slug: 'how-to-get-cash-in-faster-from-overdue-customers',
    pageType: 'problem-outcome',
    intentFamily: 'cash-outcome',
    funnelStage: 'solution-aware',
    primaryKeyword: 'how to get overdue invoices paid faster',
    secondaryKeywords: [
      'get overdue invoices paid quickly',
      'speed up overdue invoice recovery',
      'collect overdue customer payments faster',
    ],
    searchIntent: 'informational',
    queryCluster: 'get-overdue-invoices-paid-faster',
    readerJob:
      'Improve recovery speed for invoices that are already overdue.',
    uniqueAngle:
      'Prioritise the overdue customers where intervention is most likely to unlock cash rather than chasing every overdue invoice equally.',
    metaTitle: 'How to Get Overdue Invoices Paid Faster',
    metaDescription:
      'Get overdue invoices paid faster with prompt follow-up and targeted action based on value, payment behaviour and recent progress.',
    h1: 'How to get overdue invoices paid faster',
    directAnswer:
      'To get overdue invoices paid faster, separate accounts waiting for an agreed payment event from those that are stalled. For each stalled customer, choose the action that can move cash now: confirm a payment date, correct an invoice, resolve a dispute or escalate lost contact. Prioritise by recoverable value and usefulness of intervention, not invoice age alone.',
    whyItMatters:
      'Once an invoice is overdue, speed depends less on how many reminders leave the inbox and more on whether today’s action changes the next payment event. A reminder can correct an oversight. It cannot approve a disputed invoice, repair missing purchase-order information or test a missed promise. Repeating it creates activity while the real delay remains untouched.',
    sectionHeadings: {
      whyItMatters: 'Why blanket chasing slows overdue recovery',
      signals: 'Choose the overdue accounts where action can matter',
      decisionRules: 'Match the next action to the evidence',
      workedExample: 'Target the recovery actions most likely to move cash',
      recommendedActions: 'Accelerate recovery from the current overdue ledger',
      productBridge: 'Prioritise attention within overdue accounts',
      relatedGuides: 'Reduce the backlog and sharpen prioritisation',
    },
    signalIntroduction:
      'Review the whole customer position, including every overdue invoice and the latest contact. Four questions are enough to separate waiting from stalled cash.',
    signals: [
      {
        key: 'recoverable-value',
        label: 'What could actually be paid',
        explanation:
          'Confirm the accepted, undisputed amount. A £20,000 balance with £15,000 genuinely disputed is not the same near-term opportunity as £20,000 ready for payment.',
      },
      {
        key: 'payment-readiness',
        label: 'Whether payment is ready to move',
        explanation:
          'Check that the invoice reached the right person, was accepted and has everything needed for the customer’s payment process. Fix a preventable block before pressing for a date.',
      },
      {
        key: 'latest-evidence',
        label: 'The latest evidence of movement',
        explanation:
          'A cleared part-payment or verified future payment run can justify waiting. Silence, a missed date or a promise without an owner means the account is stalled.',
      },
      {
        key: 'next-decision-maker',
        label: 'Who can remove the blockage',
        explanation:
          'Identify the person who can release payment or resolve the issue. The useful next contact may be your project lead or the customer sponsor, not the inbox that ignored the last reminder.',
      },
    ],
    decisionRules: [
      'If an accepted invoice has no payment date, ask the person controlling payment for a specific date and record the answer.',
      'If the amount is disputed, stop generic chasing: name an internal resolver, set a decision date and request payment of any undisputed amount.',
      'If a credible payment date has not arrived, monitor it; if the date is missed, follow up on the missed commitment rather than restarting the reminder sequence.',
      'If a material customer is silent, change the contact, channel or seniority. Sending the same message again is not a new action.',
    ],
    workedExample: {
      introduction:
        'Three customers are overdue, but the fastest recovery sequence is not a blanket reminder or a simple largest-balance order.',
      customers: [
        {
          name: 'Fielding Interiors',
          valueOutstanding: 18600,
          averageDaysLate: 32,
          daysSinceLastPayment: 68,
          founderRisk: 'medium',
          founderRiskReason: 'The invoice is accepted, but an expected approval update did not arrive.',
          rank: 1,
          rankReason: 'Material value, no recent payment and a clear approval contact make a direct call the strongest near-term recovery action.',
        },
        {
          name: 'Dale Technical Services',
          valueOutstanding: 9400,
          averageDaysLate: 70,
          daysSinceLastPayment: 101,
          founderRisk: 'high',
          founderRiskReason: 'Payment is blocked by a delivery dispute that has no named internal owner.',
          rank: 2,
          rankReason: 'The next useful action is to assign and resolve the dispute, not send another payment reminder.',
        },
        {
          name: 'Ashton Retail Group',
          valueOutstanding: 31000,
          averageDaysLate: 12,
          daysSinceLastPayment: 4,
          founderRisk: 'low',
          founderRiskReason: 'A part-payment arrived with remittance and a dated schedule for the balance.',
          rank: 3,
          rankReason: 'The largest balance remains important, but recent progress makes another immediate chase less useful.',
        },
      ],
      conclusion:
        'Call Fielding first to obtain the missing approval decision, then give Dale’s dispute to a named resolver and ask whether the undisputed portion can be paid. Monitor Ashton against its agreed date. This is faster because each action changes a payment event; three identical reminders would not.',
    },
    recommendedActions: [
      'Group invoices by customer and separate accepted value from genuinely disputed value.',
      'Mark each account as waiting or stalled from the latest payment, promise and contact evidence.',
      'Choose one constraint-moving action and one accountable person for every stalled priority account.',
      'Record the promised date or next decision, then return on that date rather than chasing by habit.',
      'Judge the approach by cleared cash and removed blockages, not the number of reminders sent.',
    ],
    productBridge:
      'You can run this triage manually from Xero, contact notes and what you know about each account. The difficult part is repeating it whenever a payment lands or a promise fails. The product keeps the customer-level order current from Xero evidence and your chosen priority adjustment; it does not resolve disputes or make the commercial decision for you.',
    ctaHeading: 'Start each chase with a defensible first account',
    ctaDescription:
      'Compare plans for turning current Xero payment evidence into a focused overdue-customer queue.',
    ctaLabel: 'See plans and pricing',
    ctaHref: '/pricing',
    relatedSlugs: [
      'how-to-reduce-overdue-debt',
      'how-to-prioritise-overdue-invoices',
    ],
    indexable: true,
  },
  {
    slug: 'how-to-improve-cash-collection',
    pageType: 'outcome-improvement',
    intentFamily: 'cash-outcome',
    funnelStage: 'solution-aware',
    primaryKeyword: 'how to improve cash collection',
    secondaryKeywords: [
      'improve customer cash collection',
      'make collections more effective',
      'improve overdue cash recovery',
    ],
    searchIntent: 'informational',
    queryCluster: 'improve-cash-collection',
    readerJob:
      'Improve the overall effectiveness of collecting customer cash.',
    uniqueAngle:
      'Diagnose which part of the collection system is constraining cash inflow, then focus human attention on the highest-impact opportunities.',
    metaTitle: 'How to Improve Cash Collection',
    metaDescription:
      'Improve cash collection by finding the main bottleneck in invoicing, disputes or chasing and focusing effort where it can release cash.',
    h1: 'How to improve cash collection',
    directAnswer:
      'Improve cash collection by finding the constraint that prevents the most valid debt from becoming cash, then test one fix against it. Tackle invoice rejection if bills never enter approval, dispute ownership if balances are blocked, or chase prioritisation if effort is busy but unproductive. More reminders will not fix the wrong constraint.',
    sectionHeadings: {
      drivers: 'What drives effective cash collection',
      focusFirst: 'Find the biggest collection bottleneck',
      improvementPlan: 'Build a focused cash-collection plan',
      workedExample: 'Fix two constraints, not everything',
      measurements: 'Measure collection effectiveness',
      productBridge: 'Prioritise the human part of collection',
      relatedGuides: 'Improve timing and the wider receivables process',
    },
    driverIntroduction:
      'Follow unpaid value backwards from cash receipt to customer approval and invoice issue. The first recurring wait without an owner is the likely bottleneck.',
    drivers: [
      {
        key: 'invoice-quality',
        label: 'Invoice quality and timeliness',
        explanation:
          'Late or inaccurate invoices delay approval before collection starts. Count rejections and days to acceptance.',
      },
      {
        key: 'dispute-resolution',
        label: 'Dispute resolution',
        explanation:
          'A dispute without an owner, evidence request or decision date can hold material cash indefinitely.',
      },
      {
        key: 'customer-behaviour',
        label: 'Customer payment behaviour',
        explanation:
          'Stable lateness, sudden deterioration and broken promises require different interventions.',
      },
      {
        key: 'chasing-process',
        label: 'Chasing process',
        explanation:
          'A named owner, dated next action and recorded outcome keep stalled accounts visible.',
      },
      {
        key: 'human-prioritisation',
        label: 'Prioritisation of human effort',
        explanation:
          'Founder time belongs on material accounts where risk, relationships or commercial choices require judgement.',
      },
    ],
    focusIntroduction:
      'Write one constraint statement: “£X is waiting because Y, and Z owns the next decision.” Choose the most material one you can change.',
    focusAreas: [
      {
        area: 'Fix preventable invoice delays',
        evidenceToCheck:
          'Count late issue, missing information, rejection and incorrect recipients.',
        whenToPrioritise:
          'Material unpaid value has not reached an accepted, payable state.',
      },
      {
        area: 'Clear concentrated disputes',
        evidenceToCheck:
          'Review the value, age, owner and next decision for blocked balances.',
        whenToPrioritise:
          'A few issues hold material cash and have a practical resolution route.',
      },
      {
        area: 'Redirect chasing effort',
        evidenceToCheck:
          'Compare reminder time with cleared payments, kept commitments and removed blockages.',
        whenToPrioritise:
          'The team is busy but cash and priority accounts are not moving.',
      },
    ],
    improvementPlan: [
      'Map where value waits: before acceptance, in approval, in dispute or after a broken commitment.',
      'Choose one material, changeable constraint and quantify the cash affected.',
      'Run a 30-day test with an owner, process change and baseline.',
      'Keep routine follow-up running while human effort targets the chosen constraint.',
      'Compare cash movement and blockage age; keep, adjust or replace the intervention.',
    ],
    workedExample: {
      businessContext:
        'Illustrative case: a small engineering consultancy handles collections in a weekly founder-led session alongside project delivery.',
      startingPosition:
        'The business has £43,000 overdue and spends seven hours a week on broad reminders.',
      primaryConstraint:
        'Two high-value invoices are blocked by unowned scope disputes, while most chasing time is spread across responsive low-value accounts.',
      changesMade: [
        'Gave each material dispute a commercial owner and deadline.',
        'Separated routine reminders from founder conversations.',
        'Focused the weekly session on blocked balances and stalled customers.',
        'Changed the next week’s priorities when cash or evidence arrived.',
      ],
      result:
        'Within 30 days, one dispute was agreed, the other reached a decision and the same seven hours produced more cleared cash and dated outcomes.',
      lesson:
        'Collection improved because the business removed its biggest blockage and redirected scarce attention, not because it increased chasing everywhere.',
    },
    measurementIntroduction:
      'Use one cash outcome and enough diagnostic evidence to show whether the chosen constraint is easing. These are management measures, not product reports.',
    measurements: [
      {
        metric: 'Cash collected from overdue customers',
        guidance:
          'Compare cleared cash from the overdue ledger over consistent periods.',
      },
      {
        metric: 'Overdue balance',
        guidance:
          'Allow for newly overdue invoices when judging whether the stock is falling.',
      },
      {
        metric: 'Age of the chosen blockage',
        guidance:
          'Track days awaiting acceptance, dispute resolution or customer decision.',
      },
      {
        metric: 'Useful outcomes per collection session',
        guidance:
          'Count cleared payments, kept promises and removed blockages, not contacts alone.',
      },
    ],
    productBridge:
      'The diagnosis may point outside the product. When scarce chasing attention is the constraint, the product combines Xero evidence with founder-assigned priority to keep the highest-priority overdue customers visible.',
    ctaHeading: 'Test whether prioritisation is your collection constraint',
    ctaDescription:
      'See how the product focuses limited human time without pretending to replace the rest of the collection system.',
    ctaLabel: 'See plans and pricing',
    ctaHref: '/pricing',
    relatedSlugs: [
      'how-to-reduce-debtor-days',
      'how-to-improve-accounts-receivable-for-a-small-business',
    ],
    indexable: true,
  },
  {
    slug: 'how-to-reduce-debtor-days',
    pageType: 'outcome-improvement',
    intentFamily: 'cash-outcome',
    funnelStage: 'solution-aware',
    primaryKeyword: 'how to reduce debtor days',
    secondaryKeywords: [
      'lower debtor days',
      'improve time to collect receivables',
      'reduce average collection time',
    ],
    searchIntent: 'informational',
    queryCluster: 'reduce-debtor-days',
    readerJob:
      'Reduce the average time taken to collect receivables.',
    uniqueAngle:
      'Treat debtor days as an outcome metric driven by specific behaviours and bottlenecks, not something improved merely by sending more reminders.',
    metaTitle: 'How to Reduce Debtor Days',
    metaDescription:
      'Reduce debtor days by identifying the customers and process delays extending time to cash, then fixing the biggest causes first.',
    h1: 'How to reduce debtor days',
    directAnswer:
      'Reduce debtor days by tracing the figure to invoice delay, agreed terms, disputes and late-paying customers, then remove the largest avoidable source. Keep the calculation consistent and read it beside the ageing profile: sales timing or mix can move debtor days even when payment behaviour has not changed.',
    sectionHeadings: {
      drivers: 'What pushes debtor days up',
      focusFirst: 'Find what is extending time to cash',
      improvementPlan: 'A practical debtor-days improvement plan',
      workedExample: 'Trace the metric to its causes',
      measurements: 'Measure debtor days with supporting evidence',
      productBridge: 'Prioritise the customers extending collection time',
      relatedGuides: 'Improve collection and ongoing payment speed',
    },
    driverIntroduction:
      'Debtor days is an outcome metric, not a diagnosis. Confirm the calculation, compare like-for-like periods and separate contracted time from avoidable delay.',
    drivers: [
      {
        key: 'payment-terms',
        label: 'Payment terms',
        explanation:
          'Terms set the expected date. Longer negotiated terms may be commercially sensible rather than collection failure.',
      },
      {
        key: 'invoice-delay',
        label: 'Invoice issue delays and errors',
        explanation:
          'Time between completed work and invoice acceptance delays cash before chasing can help.',
      },
      {
        key: 'customer-lateness',
        label: 'Customer lateness',
        explanation:
          'A few large balances moving later than normal can shift a sales-weighted metric.',
      },
      {
        key: 'dispute-backlog',
        label: 'Unresolved disputes',
        explanation:
          'Disputed balances remain outstanding until evidence, correction or a commercial decision removes them.',
      },
      {
        key: 'chasing-priority',
        label: 'Chasing effectiveness and priority',
        explanation:
          'Unfocused intervention leaves the balances adding most avoidable days without a useful action.',
      },
    ],
    focusIntroduction:
      'Ignore generic targets at first. Explain movement in your own figure through terms, sales composition or a delay you can remove.',
    focusAreas: [
      {
        area: 'Customers outside their normal payment pattern',
        evidenceToCheck:
          'Compare payment timing by customer and balance value; flag material accounts moving later.',
        whenToPrioritise:
          'A few customers explain the increase without an agreed term, plan or dispute.',
      },
      {
        area: 'Delay before a valid invoice is payable',
        evidenceToCheck:
          'Measure days from delivery or milestone to invoice issue and acceptance.',
        whenToPrioritise:
          'Late entry into approval explains a material part of the increase.',
      },
      {
        area: 'A metric movement that is not a collection failure',
        evidenceToCheck:
          'Compare sales timing, large new invoices and customer-term mix across periods.',
        whenToPrioritise:
          'Debtor days rose while lateness and ageing stayed broadly stable.',
      },
    ],
    improvementPlan: [
      'Use one calculation method and record debtor days, ageing and lateness for comparable periods.',
      'Separate contracted time from delay before acceptance, in dispute and after due date.',
      'Check whether sales timing or large new invoices explain the headline movement.',
      'Give the largest avoidable source of days an owner and action.',
      'Keep the intervention only if the underlying delay and trend improve together.',
    ],
    workedExample: {
      businessContext:
        'Illustrative case: a maintenance company invoices projects and recurring contracts with a small finance team.',
      startingPosition:
        'Consistently calculated debtor days rose from 48 to 63 over three periods despite more reminders.',
      primaryConstraint:
        'Project invoices leave about ten days after milestones, while four reliable customers are paying progressively later.',
      changesMade: [
        'Moved invoice preparation into milestone close.',
        'Contacted the four worsening customers directly.',
        'Recorded disputes and approval failures separately.',
        'Reviewed debtor days with the ageing profile.',
      ],
      result:
        'Invoice acceptance moved earlier and debtor days fell to 52 over three comparable periods, with ageing moving in the same direction.',
      lesson:
        'The figure improved when the causes adding days changed; reminder volume had revealed neither cause.',
    },
    measurementIntroduction:
      'Keep debtor days as the outcome, but use supporting measures to explain where time enters the cycle.',
    measurements: [
      {
        metric: 'Debtor days',
        guidance:
          'Use one basis across genuinely comparable periods.',
      },
      {
        metric: 'Invoice-to-acceptance time',
        guidance:
          'Measure from the billable event to customer acceptance.',
      },
      {
        metric: 'Value-weighted days late',
        guidance:
          'Find the customers and balances adding the most avoidable time.',
      },
      {
        metric: 'Receivables age profile',
        guidance:
          'Confirm value is leaving older bands, not merely improving one average.',
      },
    ],
    productBridge:
      'You still own the calculation and changes to terms, invoicing or disputes. For customer delay, the product ranks current Xero exposure, overdue age and payment recency, then applies the priority adjustment you choose.',
    ctaHeading: 'Focus on the customers adding avoidable days',
    ctaDescription:
      'Compare plans for using Xero payment behaviour to direct the human part of your debtor-days plan.',
    ctaLabel: 'See plans and pricing',
    ctaHref: '/pricing',
    relatedSlugs: [
      'how-to-improve-cash-collection',
      'how-to-speed-up-customer-payments',
    ],
    indexable: true,
  },
  {
    slug: 'how-to-reduce-overdue-debt',
    pageType: 'problem-outcome',
    intentFamily: 'cash-outcome',
    funnelStage: 'solution-aware',
    primaryKeyword: 'how to reduce overdue debt',
    secondaryKeywords: [
      'reduce overdue receivables',
      'shrink overdue customer debt',
      'lower overdue invoice balance',
    ],
    searchIntent: 'informational',
    queryCluster: 'reduce-overdue-debt',
    readerJob:
      'Shrink the overdue portion of the receivables ledger.',
    uniqueAngle:
      'Attack the customers and balances driving the overdue backlog rather than treating all overdue debt as one homogeneous problem.',
    metaTitle: 'How to Reduce Overdue Debt',
    metaDescription:
      'Reduce overdue debt by identifying the customers driving the backlog, prioritising intervention and tracking whether the overdue balance falls.',
    h1: 'How to reduce overdue debt',
    directAnswer:
      'Reduce overdue debt on two tracks: stop valid new invoices rolling past due, and clear the existing backlog by customer concentration and actionability. The overdue total falls only when cash received and legitimate ledger corrections remove more value than newly overdue invoices add. Track those movements separately so a busy month of chasing is not mistaken for progress.',
    whyItMatters:
      'An overdue balance is a stock that changes every day. You can collect £12,000 and still finish the month worse off if £15,000 becomes newly overdue. Within the backlog, a few customers may create most exposure, while credits, genuine disputes and cash-recovery opportunities need different treatment. One total hides both the inflow problem and the work required to clear old balances.',
    sectionHeadings: {
      whyItMatters: 'Why the overdue backlog needs segmentation',
      signals: 'Find what is driving overdue debt',
      decisionRules: 'Concentrate effort without using value alone',
      workedExample: 'Two customers drive most overdue debt',
      recommendedActions: 'Shrink and monitor the overdue backlog',
      productBridge: 'Prioritise customers within the overdue stock',
      relatedGuides: 'Accelerate recovery and release receivables cash',
    },
    signalIntroduction:
      'Reconcile the opening balance to the closing balance, then group the remaining stock by customer. These four signals show whether to prevent new overdue debt or attack the existing backlog first.',
    signals: [
      {
        key: 'new-overdue-inflow',
        label: 'Value becoming newly overdue',
        explanation:
          'Measure invoices crossing the due date in the period. If this exceeds the value cleared from old debt, the backlog grows even when collections are active.',
      },
      {
        key: 'backlog-movement',
        label: 'How old debt leaves the ledger',
        explanation:
          'Separate cleared cash from agreed credits, corrections and write-offs. All may reduce the ledger, but only cash is collection recovery.',
      },
      {
        key: 'customer-concentration',
        label: 'Customer concentration and age',
        explanation:
          'Find which customers dominate the overdue stock and which balances keep ageing. A long tail needs a different work method from two major stalled accounts.',
      },
      {
        key: 'balance-status',
        label: 'What must happen next',
        explanation:
          'Classify each material balance as ready to collect, waiting on a credible date, blocked by an issue or needing a commercial escalation decision.',
      },
    ],
    decisionRules: [
      'If new overdue inflow is larger than the backlog reduction, fix invoice acceptance, pre-due controls or recurring customer lateness before adding more backlog-clearing activity.',
      'If a few customers dominate old debt, assign account-specific owners and actions; if the balance is a dispersed low-value tail, use a systematic routine.',
      'Report cash separately from credits, corrections and write-offs so ledger housekeeping is not presented as cash recovered.',
      'Move a blocked or silent material balance to a defined resolution or escalation decision instead of leaving it in ordinary reminders.',
    ],
    workedExample: {
      introduction:
        'The opening overdue ledger is £88,400. During the month, £12,000 is collected but £15,500 becomes newly overdue, so the closing balance would rise to £91,900 before credits or corrections. Two customers also account for £68,600 of the old stock.',
      customers: [
        {
          name: 'Portman Equipment',
          valueOutstanding: 46600,
          averageDaysLate: 49,
          daysSinceLastPayment: 84,
          founderRisk: 'high',
          founderRiskReason: 'A payment date was missed and the finance contact has stopped responding.',
          rank: 1,
          rankReason: 'The largest contributor also shows inactivity and failed progress, so direct senior intervention can materially reduce the backlog.',
        },
        {
          name: 'Fairbridge Projects',
          valueOutstanding: 22000,
          averageDaysLate: 28,
          daysSinceLastPayment: 57,
          founderRisk: 'medium',
          founderRiskReason: 'Two invoices are held by one unresolved approval query.',
          rank: 2,
          rankReason: 'Resolving the specific query could release another quarter of the overdue ledger more effectively than broad reminders.',
        },
        {
          name: 'Twenty-seven smaller customers',
          valueOutstanding: 19800,
          averageDaysLate: 22,
          daysSinceLastPayment: 15,
          founderRisk: 'low',
          founderRiskReason: 'Most accounts remain responsive and several recent payments are recorded.',
          rank: 3,
          rankReason: 'Routine follow-up remains appropriate, but the dispersed tail should not consume the time needed for the two concentrated balances.',
        },
      ],
      conclusion:
        'Use senior contact for Portman, name a resolver for Fairbridge’s query and keep the small tail in a routine lane. At the same time, investigate the £15,500 inflow. Without that prevention track, even successful recovery from the two large accounts will be partly replaced by new overdue debt.',
    },
    recommendedActions: [
      'Reconcile opening debt, new overdue invoices, cash, credits or corrections, and the closing balance.',
      'Choose whether the immediate constraint is new inflow, concentrated old debt or both.',
      'Give each material old balance a collect, wait, resolve or escalate status with an owner and date.',
      'Run routine follow-up for the tail without letting it displace work on concentrated exposure.',
      'Review net backlog movement weekly and keep cash recovery distinct from ledger adjustments.',
    ],
    productBridge:
      'The prevention track still depends on invoicing, terms and customer management. For the backlog-clearing track, the product uses Xero accounting evidence and your chosen priority adjustment to keep the highest-scoring overdue customers at the top of the human queue.',
    ctaHeading: 'Work the backlog in the order that can change it',
    ctaDescription:
      'Compare plans for turning Xero balances and payment evidence into a focused customer-level queue.',
    ctaLabel: 'See plans and pricing',
    ctaHref: '/pricing',
    relatedSlugs: [
      'how-to-get-cash-in-faster-from-overdue-customers',
      'how-to-release-cash-tied-up-in-accounts-receivable',
    ],
    indexable: true,
  },
  {
    slug: 'how-to-speed-up-customer-payments',
    pageType: 'problem-outcome',
    intentFamily: 'cash-outcome',
    funnelStage: 'solution-aware',
    primaryKeyword: 'how to speed up customer payments',
    secondaryKeywords: [
      'get customers to pay faster',
      'improve customer payment speed',
      'reduce recurring payment delays',
    ],
    searchIntent: 'informational',
    queryCluster: 'speed-up-customer-payments',
    readerJob:
      'Improve how quickly customers pay on an ongoing basis.',
    uniqueAngle:
      'Different customer behaviours require different treatment; faster payment comes from fixing recurring causes of delay, not just chasing harder after invoices are overdue.',
    metaTitle: 'How to Speed Up Customer Payments',
    metaDescription:
      'Speed up customer payments by fixing invoicing and dispute delays, using payment history and treating different late-paying behaviours appropriately.',
    h1: 'How to speed up customer payments',
    directAnswer:
      'Speed up customer payments over future invoice cycles by fixing the recurring reason each customer pays slowly. Remove delays you control, such as late or rejected invoices. For a customer-controlled pattern, choose a proportionate commercial response: clearer dates, pre-due confirmation, different terms, a deposit, an exposure limit or earlier risk review. Measure new invoices after the change rather than judging the result from today’s old backlog.',
    whyItMatters:
      'An overdue chase can recover one invoice without changing how the next one will be paid. A normally prompt customer delayed by bad invoice data needs a process repair. A customer that always chooses a late payment run needs new commercial boundaries. A reliable account that suddenly slows needs investigation before more exposure is created. Treating all three with stronger reminders leaves the recurring cause intact.',
    sectionHeadings: {
      whyItMatters: 'Why customers pay slowly for different reasons',
      signals: 'Match the treatment to the cause of delay',
      decisionRules: 'Improve the ongoing payment pattern',
      workedExample: 'Three customers, three treatments',
      recommendedActions: 'Build faster payment into the customer process',
      productBridge: 'Prioritise late-paying behaviour needing attention',
      relatedGuides: 'Improve timing and use payment history',
    },
    signalIntroduction:
      'Review several completed invoice cycles, not just the oldest open invoice. Compare the customer’s normal timing with the current cycle and decide who controls the delay.',
    signals: [
      {
        key: 'invoice-and-terms',
        label: 'Invoice process and terms',
        explanation:
          'Check days from completed work to an accepted invoice, including purchase-order and submission requirements. Remove this delay before labelling the customer slow.',
      },
      {
        key: 'payment-history',
        label: 'Customer payment history',
        explanation:
          'Use several paid invoices to distinguish an established late habit from a one-off exception or a worsening trend.',
      },
      {
        key: 'recurring-blockages',
        label: 'Recurring disputes or administration issues',
        explanation:
          'Repeated purchase-order, approval or service issues show where the operating process needs a permanent owner and fix.',
      },
      {
        key: 'behaviour-change',
        label: 'Change in payment behaviour',
        explanation:
          'Lengthening delays, missed promises or weaker contact are reasons to investigate and reconsider new exposure, not merely to send reminders sooner.',
      },
      {
        key: 'commercial-leverage',
        label: 'Leverage on the next invoice',
        explanation:
          'Future terms, deposits, service holds or credit limits may change a persistent habit when post-due chasing has become routine and ineffective.',
      },
    ],
    decisionRules: [
      'If a reliable customer pays late only when invoice data is wrong, repair that hand-off and confirm the next invoice is accepted.',
      'If the customer predictably pays on its own later timetable, decide whether the relationship justifies it; otherwise change terms or exposure on future work.',
      'If payment behaviour deteriorates, contact the customer before granting more credit and make a deliberate risk decision.',
      'Test changes on the next invoice cohort; old disputed or exceptional balances will otherwise obscure whether the recurring pattern improved.',
    ],
    workedExample: {
      introduction:
        'All three customers are paying slowly, but faster ongoing payment requires a different intervention for each account.',
      customers: [
        {
          name: 'Hewitt Foods',
          valueOutstanding: 14800,
          averageDaysLate: 19,
          daysSinceLastPayment: 61,
          founderRisk: 'high',
          founderRiskReason: 'A historically prompt customer has moved from 4 to 32 days late and missed an update.',
          rank: 1,
          rankReason: 'The change from normal behaviour needs immediate contact and a risk review before the new pattern becomes established.',
        },
        {
          name: 'Larkspur Clinics',
          valueOutstanding: 11200,
          averageDaysLate: 6,
          daysSinceLastPayment: 39,
          founderRisk: 'medium',
          founderRiskReason: 'A normally prompt payer is waiting for a corrected purchase-order reference.',
          rank: 2,
          rankReason: 'Correcting the recurring invoice requirement is more likely to speed payment than escalating the chase.',
        },
        {
          name: 'Oldbury Office Group',
          valueOutstanding: 9700,
          averageDaysLate: 29,
          daysSinceLastPayment: 31,
          founderRisk: 'low',
          founderRiskReason: 'The customer reliably pays on a late monthly run and remains responsive.',
          rank: 3,
          rankReason: 'Planned follow-up should continue, while future terms or deposit requirements address the structural late habit.',
        },
      ],
      conclusion:
        'Call Hewitt before accepting more exposure, repair Larkspur’s invoice hand-off and decide whether Oldbury’s unofficial monthly timetable is acceptable for future work. Compare the next two or three invoices for each customer with its earlier pattern. One stronger reminder campaign would not test any of those changes.',
    },
    recommendedActions: [
      'Measure payment timing over several completed invoices for each material customer.',
      'Label the recurring delay as business-controlled, customer-controlled or a new deterioration.',
      'Apply one change matched to that cause before the next invoice enters the same cycle.',
      'Use pre-due checks, terms and exposure controls where routine post-due chasing has no leverage.',
      'Compare new invoice cohorts and keep only changes that bring accepted invoices to cash sooner.',
    ],
    productBridge:
      'You make the decisions about invoice design, terms and future exposure. The product shows Xero payment-history context alongside current exposure; in the current queue, the priority adjustment you choose can reflect a worsening pattern that needs attention.',
    ctaHeading: 'Spot the payment patterns that need intervention',
    ctaDescription:
      'Compare plans for using Xero history and business context to focus attention on changing customer behaviour.',
    ctaLabel: 'See plans and pricing',
    ctaHref: '/pricing',
    relatedSlugs: [
      'how-to-reduce-debtor-days',
      'how-payment-history-should-affect-invoice-chasing',
    ],
    indexable: true,
  },
  {
    slug: 'how-to-improve-accounts-receivable-for-a-small-business',
    pageType: 'outcome-improvement',
    intentFamily: 'cash-outcome',
    funnelStage: 'solution-aware',
    primaryKeyword: 'how to improve accounts receivable for a small business',
    secondaryKeywords: [
      'small business accounts receivable process',
      'improve SME receivables management',
      'simple accounts receivable system',
    ],
    searchIntent: 'informational',
    queryCluster: 'improve-small-business-accounts-receivable',
    readerJob:
      'Improve the overall AR operating process without building a large finance team.',
    uniqueAngle:
      'A minimum viable SME receivables system: clean invoicing, visibility, prioritisation, follow-up and escalation.',
    metaTitle: 'How to Improve Accounts Receivable for a Small Business',
    metaDescription:
      'Build a simple small-business accounts receivable process covering clean invoicing, visibility, prioritised follow-up, disputes and escalation.',
    h1: 'How to improve accounts receivable for a small business',
    directAnswer:
      'Improve small-business accounts receivable with one minimum viable routine: raise an accepted invoice promptly, keep one customer-level record, give every exception an owner and date, and review stalled accounts weekly. You need clean hand-offs that still work when the founder is busy, not a large finance-team process.',
    sectionHeadings: {
      drivers: 'What makes a small-business AR process work',
      focusFirst: 'Find the weakest part of the current process',
      improvementPlan: 'Build a minimum viable receivables routine',
      workedExample: 'Replace an informal receivables process',
      measurements: 'Measure whether the operating process improves',
      productBridge: 'Automate prioritisation within the wider process',
      relatedGuides: 'Improve collection and release receivables cash',
    },
    driverIntroduction:
      'A useful SME system lets another person see what happens next without reconstructing inboxes or asking the founder.',
    drivers: [
      {
        key: 'accurate-invoicing',
        label: 'Accurate and timely invoicing',
        explanation:
          'Define the billable event, required evidence and issue deadline.',
      },
      {
        key: 'clear-terms',
        label: 'Clear terms and customer requirements',
        explanation:
          'Store the agreed date, payment contact, purchase-order rules and submission route.',
      },
      {
        key: 'receivables-visibility',
        label: 'Customer-level visibility',
        explanation:
          'Keep exposure, status, last outcome, next action, owner and date together.',
      },
      {
        key: 'dispute-ownership',
        label: 'Dispute ownership',
        explanation:
          'Give each exception an owner, missing evidence and decision date.',
      },
      {
        key: 'prioritised-follow-up',
        label: 'Prioritised follow-up',
        explanation:
          'Systematise routine timing; reserve the weekly review for customers requiring judgement.',
      },
      {
        key: 'escalation-discipline',
        label: 'Escalation discipline',
        explanation:
          'Define when silence, a broken promise or dispute becomes a founder decision.',
      },
    ],
    focusIntroduction:
      'Trace one clean invoice and one difficult invoice to cash. Improve the first hand-off where the difficult case loses its owner, evidence or date.',
    focusAreas: [
      {
        area: 'Invoice and terms foundation',
        evidenceToCheck:
          'Look for late issue, rejection, unclear terms and approval requirements found after chasing starts.',
        whenToPrioritise:
          'Invoices need correction or miss a payment run before approval.',
      },
      {
        area: 'Visibility and next-action ownership',
        evidenceToCheck:
          'Ask whether anyone can see exposure, the latest outcome, next owner and date.',
        whenToPrioritise:
          'Each weekly session starts by rebuilding the position from memory and inboxes.',
      },
      {
        area: 'Dispute and escalation workflow',
        evidenceToCheck:
          'Review blocked invoices, repeated reminders and accounts without an escalation decision.',
        whenToPrioritise:
          'Exceptions have no route to payment or reminders continue without progress.',
      },
    ],
    improvementPlan: [
      'Set the trigger, owner and deadline for turning completed work into an accepted invoice.',
      'Record terms, submission rules and the payment contact once.',
      'Run a weekly customer review with balance, status, outcome, next action, owner and date.',
      'Route errors and disputes to a named resolver, outside routine chasing.',
      'Move stalled material accounts to a founder review for an explicit commercial decision.',
      'Track missed hand-offs for a month and repair the next weakest point.',
    ],
    workedExample: {
      businessContext:
        'Illustrative case: a twelve-person contractor shares receivables work between an administrator, project managers and the founder.',
      startingPosition:
        'Invoices start from email requests, payment is checked when cash is tight and latest actions are scattered.',
      primaryConstraint:
        'Without a customer-level workflow, errors, disputes and overdue follow-up depend on memory.',
      changesMade: [
        'Used a completion checklist for required invoice references.',
        'Created a weekly customer view with an owner and dated action.',
        'Assigned disputes to the relevant project manager.',
        'Defined the trigger for founder review.',
      ],
      result:
        'The administrator ran the review without rebuilding the ledger, while the founder saw only accounts needing a commercial decision.',
      lesson:
        'A small reliable operating model solved the problem without large-company AR bureaucracy.',
    },
    measurementIntroduction:
      'Measure operating reliability as well as cash. These checks may live outside the product.',
    measurements: [
      {
        metric: 'Invoice first-time acceptance',
        guidance:
          'Track acceptance without correction and time from billable work.',
      },
      {
        metric: 'Accounts with a dated next action',
        guidance:
          'Check each material overdue customer has an action, owner and date.',
      },
      {
        metric: 'Dispute backlog',
        guidance:
          'Monitor blocked value, age and ownership.',
      },
      {
        metric: 'Overdue cash and process time',
        guidance:
          'Track past-due value and time lost to reconstruction or low-value follow-up.',
      },
    ],
    productBridge:
      'You still need clear invoicing, exception ownership and escalation. The product supplies a prioritised customer view from Xero payment data and founder-assigned priority, so the weekly review starts with accounts needing human attention.',
    ctaHeading: 'Add a prioritised queue to your minimum AR routine',
    ctaDescription:
      'Compare plans for giving a small team one current, customer-level view from its Xero data.',
    ctaLabel: 'See plans and pricing',
    ctaHref: '/pricing',
    relatedSlugs: [
      'how-to-improve-cash-collection',
      'how-to-release-cash-tied-up-in-accounts-receivable',
    ],
    indexable: true,
  },
  {
    slug: 'how-to-release-cash-tied-up-in-accounts-receivable',
    pageType: 'outcome-improvement',
    intentFamily: 'cash-outcome',
    funnelStage: 'solution-aware',
    primaryKeyword: 'how to release cash tied up in accounts receivable',
    secondaryKeywords: [
      'release cash from receivables',
      'unlock working capital from accounts receivable',
      'convert receivables to cash faster',
    ],
    searchIntent: 'informational',
    queryCluster: 'release-cash-from-accounts-receivable',
    readerJob:
      'Convert receivables into cash more quickly to improve working capital.',
    uniqueAngle:
      'Focus on receivables that are both material and actionable instead of treating the whole debtor book as equally recoverable.',
    metaTitle: 'How to Release Cash Tied Up in Accounts Receivable',
    metaDescription:
      'Release working capital from receivables by separating current, disputed and recoverable balances, then focusing on material actionable cash.',
    h1: 'How to release cash tied up in accounts receivable',
    directAnswer:
      'To release working capital from accounts receivable, start with the cash amount and date needed, then identify what could realistically clear inside that window. Focus on material, accepted balances where a specific action can bring payment forward. Current invoices, disputes and weak recovery prospects are not cash available for the commitment.',
    sectionHeadings: {
      drivers: 'What determines whether receivables can become cash',
      focusFirst: 'Find material cash that is actionable now',
      improvementPlan: 'Build a working-capital release plan',
      workedExample: 'Separate the receivables book before forecasting cash',
      measurements: 'Measure receivables cash release',
      productBridge: 'Prioritise actionable overdue exposure',
      relatedGuides: 'Reduce overdue debt and strengthen AR',
    },
    driverIntroduction:
      'The ledger is not a bank balance. Convert its headline total into a dated view of plausible cleared cash.',
    drivers: [
      {
        key: 'cash-window',
        label: 'Cash requirement and deadline',
        explanation:
          'A supplier payment due in 14 days makes different receivables relevant from a quarterly aim.',
      },
      {
        key: 'accepted-value',
        label: 'Accepted value inside the window',
        explanation:
          'Separate current, disputed and accepted overdue amounts; only some can clear before the deadline.',
      },
      {
        key: 'customer-behaviour',
        label: 'Customer payment behaviour',
        explanation:
          'Cleared payments and kept commitments strengthen a forecast; silence and missed dates weaken it.',
      },
      {
        key: 'dispute-status',
        label: 'Dispute and administration status',
        explanation:
          'Count a dispute only when it has a resolver and credible decision path inside the window.',
      },
      {
        key: 'new-exposure',
        label: 'New credit exposure',
        explanation:
          'Further supply to a high-risk late payer can consume working capital faster than collection releases it.',
      },
    ],
    focusIntroduction:
      'Build a cash-conversion list, not a largest-debtor list. Record the amount, required action, decision-maker and earliest credible cleared date.',
    focusAreas: [
      {
        area: 'Material overdue and recoverable balances',
        evidenceToCheck:
          'Confirm accepted value, recent evidence, decision-maker and payment route.',
        whenToPrioritise:
          'One action can bring meaningful cleared cash inside the window.',
      },
      {
        area: 'Disputes with a clear route to resolution',
        evidenceToCheck:
          'Split disputed from undisputed value; identify the evidence, resolver and date.',
        whenToPrioritise:
          'Part-payment or resolution could convert material value before the deadline.',
      },
      {
        area: 'Balances that should not fund the plan',
        evidenceToCheck:
          'Identify invoices due later, unverified promises, blocked balances and silent high-risk debt.',
        whenToPrioritise:
          'Exclude them from committed cash unless new evidence changes the timing.',
      },
    ],
    improvementPlan: [
      'State the cash required, cleared-cash deadline and consequence of a shortfall.',
      'Classify receivables as current, accepted overdue, disputed or blocked.',
      'Prioritise material balances with a credible action and payment route inside the window.',
      'Pursue undisputed part-payments and give blockages an owner and date.',
      'Forecast cleared cash, not hopeful promises; address any remaining funding gap.',
      'Review further credit to customers consuming new working capital.',
    ],
    workedExample: {
      businessContext:
        'Illustrative case: a manufacturer needs £70,000 of cleared cash for a supplier in 21 days.',
      startingPosition:
        'Receivables total £240,000: £90,000 current, £55,000 disputed and £95,000 overdue.',
      primaryConstraint:
        'The £240,000 headline is treated as available, although much cannot clear within 21 days.',
      changesMade: [
        'Separated current, accepted overdue, disputed and blocked value.',
        'Found four overdue balances with a payment route inside 21 days.',
        'Requested an undisputed part-payment and assigned the remaining evidence.',
        'Excluded later promises from committed cash.',
      ],
      result:
        'Actions produced £58,000 by the deadline. A further £12,000 was promised after day 21, so the immediate gap remained a funding decision.',
      lesson:
        'A credible working-capital plan values timing and actionability, not just the size of the receivables ledger.',
    },
    measurementIntroduction:
      'Measure against the cash window. A later payment helps the business but did not fund this commitment. Treat these as management measures rather than promised product reports.',
    measurements: [
      {
        metric: 'Cleared cash by the deadline',
        guidance:
          'Separate money cleared inside the window from commitments and adjustments.',
      },
      {
        metric: 'Forecast cash coverage',
        guidance:
          'Compare credible dated receipts with the requirement and state the gap.',
      },
      {
        metric: 'Promise conversion',
        guidance:
          'Track which dated commitments become cash to improve later forecasts.',
      },
      {
        metric: 'New exposure to slow payers',
        guidance:
          'Monitor credit added where existing delay already consumes working capital.',
      },
    ],
    productBridge:
      'The cash forecast, disputes and funding response remain yours. The product combines Xero accounting evidence with the priority adjustment you choose to surface material overdue customers for human review.',
    ctaHeading: 'Find the receivables worth acting on inside the cash window',
    ctaDescription:
      'Compare plans for prioritising material overdue customers from Xero evidence and business context.',
    ctaLabel: 'See plans and pricing',
    ctaHref: '/pricing',
    relatedSlugs: [
      'how-to-reduce-overdue-debt',
      'how-to-improve-accounts-receivable-for-a-small-business',
    ],
    indexable: true,
  },
  {
    slug: 'what-to-do-about-customers-who-always-pay-late',
    pageType: 'problem-outcome',
    intentFamily: 'customer-risk',
    funnelStage: 'problem-aware',
    primaryKeyword: 'what to do about customers who always pay late',
    secondaryKeywords: [
      'customer always pays invoices late',
      'manage habitual late payers',
      'repeated late customer payments',
    ],
    searchIntent: 'informational',
    queryCluster: 'habitual-late-paying-customer-response',
    readerJob:
      'Decide how to manage a customer whose late payment is persistent rather than exceptional.',
    uniqueAngle:
      'Separate predictable habitual lateness from a new deterioration in customer risk, then adjust chasing, terms and exposure proportionately.',
    metaTitle: 'What to Do About Customers Who Always Pay Late',
    metaDescription:
      'Manage habitual late payers by distinguishing a stable poor habit from worsening payment behaviour, then adjust chasing and exposure.',
    h1: 'What to do about customers who always pay late',
    directAnswer:
      'Habitual lateness is not automatically an emergency when the customer pays predictably and their behaviour is stable, but it should influence chasing priority, payment terms and how much further exposure you accept. Compare the current delay with their usual pattern, then react more strongly if payment gaps, communication or promises are getting worse.',
    whyItMatters:
      'Treating every predictable late payment as a crisis wastes time and can strain a workable relationship. Treating the habit as harmless has the opposite risk: your business quietly funds the customer and may miss the point when a stable pattern starts to deteriorate. The useful response separates poor but predictable behaviour from new recovery risk.',
    sectionHeadings: {
      whyItMatters: 'Why a bad habit still needs active management',
      signals: 'Decide whether the pattern is stable or worsening',
      decisionRules: 'Match the response to the behaviour',
      workedExample: 'Habitual lateness versus deterioration',
      recommendedActions: 'Manage the pattern without ignoring new risk',
      productBridge: 'Keep the customer’s current behaviour in context',
      relatedGuides: 'Use payment history to spot a change',
    },
    signalIntroduction:
      'Start with the customer’s normal pattern rather than one invoice. Stable lateness still affects commercial terms, while a change in the pattern should affect urgency and risk.',
    signals: [
      {
        key: 'average-days-late',
        label: 'Usual days late',
        explanation:
          'Establish how late the customer normally pays so today’s position can be compared with a real baseline.',
      },
      {
        key: 'pattern-stability',
        label: 'Stability of the pattern',
        explanation:
          'A customer who repeatedly pays around the same date is different from one whose delay is lengthening each month.',
      },
      {
        key: 'payment-recency',
        label: 'Recent payment activity',
        explanation:
          'Check whether payments are still arriving at the expected late interval or have stopped beyond the usual cycle.',
      },
      {
        key: 'terms-and-exposure',
        label: 'Terms and exposure',
        explanation:
          'Consider whether current terms allow the late habit to create more credit exposure than the relationship justifies.',
      },
    ],
    decisionRules: [
      'Keep routine chasing proportionate when the customer remains predictable, responsive and within an understood late-payment pattern.',
      'Reflect persistent lateness in future terms, limits or deposit requirements instead of repeatedly accepting the same unpriced delay.',
      'Raise urgency when the customer moves beyond their normal range, misses commitments or becomes harder to contact.',
      'Review the pattern periodically rather than assuming a historically reliable late payer will remain reliable.',
    ],
    workedExample: {
      introduction:
        'Eastbrook and Linton both pay late, but only one is following a stable pattern. Their current treatment should therefore differ.',
      customers: [
        {
          name: 'Linton Events',
          valueOutstanding: 11600,
          averageDaysLate: 39,
          daysSinceLastPayment: 78,
          founderRisk: 'high',
          founderRiskReason: 'Delays have increased for three months and two promised dates were missed.',
          rank: 1,
          rankReason: 'The customer is no longer merely habitual: worsening delays, inactivity and broken promises justify stronger attention.',
        },
        {
          name: 'Eastbrook Trade',
          valueOutstanding: 8400,
          averageDaysLate: 31,
          daysSinceLastPayment: 35,
          founderRisk: 'low',
          founderRiskReason: 'The customer reliably pays around 30 days late and has confirmed the usual remittance run.',
          rank: 2,
          rankReason: 'The poor habit still affects terms and exposure, but the stable, responsive pattern is not a new emergency.',
        },
      ],
      conclusion:
        'Contact Linton first and reassess its risk because the behaviour has changed. Continue planned follow-up with Eastbrook, but address the structural issue through tighter future terms or exposure controls. The distinction is stability, not whether either customer can be described as late.',
    },
    recommendedActions: [
      'Measure the customer’s normal lateness and compare the current position with that baseline.',
      'Confirm whether payments and communication still follow the established pattern.',
      'Chase more urgently when delays, payment gaps or broken promises are worsening.',
      'Review future terms, deposits or credit exposure where habitual lateness is persistent.',
      'Record changes so a stable bad habit is not confused with new deterioration.',
    ],
    productBridge:
      'A manual history review becomes harder across many customers. The app shows current Xero payment evidence and historical timing context, while the priority adjustment you choose lets a familiar late pattern and a new concern influence attention differently.',
    ctaHeading: 'Keep changing late-payment patterns visible',
    ctaDescription:
      'Compare plans for separating predictable late payers from customers whose behaviour is getting worse.',
    ctaLabel: 'See plans and pricing',
    ctaHref: '/pricing',
    relatedSlugs: [
      'how-payment-history-should-affect-invoice-chasing',
      'how-to-spot-deteriorating-customer-payment-behaviour',
    ],
    indexable: true,
  },
  {
    slug: 'how-to-identify-risky-customers-from-payment-behaviour',
    pageType: 'problem-outcome',
    intentFamily: 'customer-risk',
    funnelStage: 'solution-aware',
    primaryKeyword: 'how to identify risky customers from payment behaviour',
    secondaryKeywords: [
      'payment behaviour risk signals',
      'which customers look risky',
      'identify risky overdue customers',
    ],
    searchIntent: 'informational',
    queryCluster: 'identify-risky-customers-payment-behaviour',
    readerJob:
      'Identify which customers currently show payment behaviours that deserve greater attention.',
    uniqueAngle:
      'A cross-sectional comparison of the customer base that identifies who currently displays the strongest credible payment-risk signals.',
    metaTitle: 'How to Identify Risky Customers From Payment Behaviour',
    metaDescription:
      'Compare current customer payment behaviour to identify persistent lateness, long payment gaps and broken promises that merit investigation.',
    h1: 'How to identify risky customers from payment behaviour',
    directAnswer:
      'Look across the current customer base for payment signals that reinforce one another: persistent lateness, long gaps since payment, broken commitments and credible business-risk information. Lateness alone does not prove financial distress; it identifies customers who deserve closer investigation when the wider evidence is also concerning.',
    whyItMatters:
      'A long overdue list can make every customer appear equally risky, while a balance-only view can hide serious behaviour on smaller accounts. A current cross-sectional review identifies where evidence is concentrated today. It is a screening decision about whom to investigate, not a claim that the customer is insolvent or a forecast that they will not pay.',
    sectionHeadings: {
      whyItMatters: 'Why one late invoice is not a risk diagnosis',
      signals: 'Compare current risk evidence across customers',
      decisionRules: 'Flag customers for closer attention',
      workedExample: 'Compare today’s strongest risk signals',
      recommendedActions: 'Turn current warning signs into investigation',
      productBridge: 'Bring accounting signals and founder context together',
      relatedGuides: 'Distinguish current risk from deterioration',
    },
    signalIntroduction:
      'Review the same current evidence across customers, while allowing business context to explain what the ledger cannot. Concern should increase when several signals point in the same direction.',
    signals: [
      {
        key: 'persistent-lateness',
        label: 'Persistent lateness',
        explanation:
          'Repeated late payment is more informative than one exceptional invoice, especially when delays are substantial across the account.',
      },
      {
        key: 'long-payment-gap',
        label: 'Long payment gap',
        explanation:
          'A long period since any payment can show that the account is no longer making meaningful progress.',
      },
      {
        key: 'broken-commitments',
        label: 'Broken commitments',
        explanation:
          'Missed specific promises weaken the reliability of the customer’s stated payment intentions.',
      },
      {
        key: 'credible-customer-context',
        label: 'Credible customer context',
        explanation:
          'Known disputes, financial pressure or worsening communication can raise concern when supported by concrete business information.',
      },
    ],
    decisionRules: [
      'Flag customers when multiple current warning signs reinforce each other rather than reacting to lateness alone.',
      'Use founder knowledge as evidence to investigate, not as an unsupported label.',
      'Lower immediate concern when recent payment or a verified administrative explanation shows progress.',
      'Treat the review as a current snapshot; use a separate trend review to decide who is deteriorating over time.',
    ],
    workedExample: {
      introduction:
        'These three customers are reviewed at the same point in time. Quarry currently shows the strongest combined risk evidence even though it does not have the largest balance.',
      customers: [
        {
          name: 'Quarry Office Systems',
          valueOutstanding: 14800,
          averageDaysLate: 48,
          daysSinceLastPayment: 79,
          founderRisk: 'high',
          founderRiskReason: 'Two payment promises were missed; replies from the usual accounts contact are now sporadic.',
          rank: 1,
          rankReason: 'Persistent lateness, inactivity and broken commitments combine into the clearest current case for investigation.',
        },
        {
          name: 'Tern Hospitality',
          valueOutstanding: 7900,
          averageDaysLate: 65,
          daysSinceLastPayment: 92,
          founderRisk: 'medium',
          founderRiskReason: 'Payment is very late, but the customer is responsive and a dispute is documented.',
          rank: 2,
          rankReason: 'The behaviour is concerning, although the known dispute provides a specific issue to resolve before assuming wider distress.',
        },
        {
          name: 'Severn Wholesale',
          valueOutstanding: 24000,
          averageDaysLate: 11,
          daysSinceLastPayment: 4,
          founderRisk: 'low',
          founderRiskReason: 'A part-payment arrived and the customer supplied remittance detail.',
          rank: 3,
          rankReason: 'The largest exposure deserves monitoring, but recent progress and reliable behaviour do not make it today’s strongest risk signal.',
        },
      ],
      conclusion:
        'Investigate Quarry first, then resolve the known issue with Tern. Keep Severn visible because the value is material, but do not label it risky solely because the remaining balance is large. This comparison answers who currently looks concerning; it does not yet show whose behaviour is getting worse.',
    },
    recommendedActions: [
      'Review customers side by side using current lateness, payment gaps and recorded commitments.',
      'Flag accounts where several warning signs reinforce one another.',
      'Check for disputes, administration problems or recent payments before drawing conclusions.',
      'Contact the flagged customers to replace assumptions with current information.',
      'Use the result to adjust customer priority and decide which trends need ongoing monitoring.',
    ],
    productBridge:
      'Comparing risk evidence manually becomes slow as the customer base grows. The app ranks current Xero accounting evidence and applies the priority adjustment you choose to help focus attention on accounts for investigation.',
    ctaHeading: 'Find the customers whose warning signs reinforce one another',
    ctaDescription:
      'Compare plans for combining Xero payment evidence with customer context in one prioritised queue.',
    ctaLabel: 'See plans and pricing',
    ctaHref: '/pricing',
    relatedSlugs: [
      'how-to-spot-deteriorating-customer-payment-behaviour',
      'how-to-prioritise-debtors-by-risk',
    ],
    indexable: true,
  },
  {
    slug: 'customer-suddenly-taking-longer-to-pay',
    pageType: 'customer-risk-scenario',
    intentFamily: 'customer-risk',
    funnelStage: 'problem-aware',
    primaryKeyword: 'customer suddenly taking longer to pay',
    secondaryKeywords: [
      'customer payment behaviour changed',
      'customer paying later than usual',
      'sudden payment slowdown',
    ],
    searchIntent: 'informational',
    queryCluster: 'sudden-customer-payment-slowdown',
    readerJob:
      "Understand what a sudden slowdown in one customer's payment behaviour might mean and how urgently to respond.",
    uniqueAngle:
      "Treat change from the customer's own payment baseline as the central risk signal, while checking ordinary operational explanations first.",
    metaTitle: 'Customer Suddenly Taking Longer to Pay: What to Do',
    metaDescription:
      "Compare a customer's sudden payment slowdown with their normal behaviour, check likely causes and decide how urgently to respond.",
    h1: 'Customer suddenly taking longer to pay',
    directAnswer:
      "A meaningful slowdown from a customer's normal payment behaviour is new risk information, even if the invoice is not exceptionally old in absolute terms. Contact the customer promptly, first checking for ordinary causes such as an approval problem, invoice error or dispute, then update your risk view if the explanation or payment progress is weak.",
    sectionHeadings: {
      whatItMightMean: 'What this sudden slowdown might mean',
      riskAssessment: 'Is this slowdown a serious warning sign?',
      workedScenario: 'A reliable payer moves outside its pattern',
      recommendedActions: 'Respond to the change, not just the age',
      productBridge: 'Keep accounting evidence in business context',
      relatedGuides: 'Track the trend and related commitments',
    },
    diagnosis: {
      introduction:
        "A slower payment does not establish why the customer has changed. Use the change as a reason to investigate and distinguish a fixable operational issue from a broader deterioration.",
      explanations: [
        {
          possibility: 'An invoice or approval problem',
          evidenceToCheck:
            'Confirm that the invoice reached the right person, carries the required purchase-order details and has entered the customer’s approval run.',
        },
        {
          possibility: 'A genuine dispute',
          evidenceToCheck:
            'Ask for the disputed item, amount and owner in writing, then check whether the undisputed balance can still be paid.',
        },
        {
          possibility: 'Temporary or wider financial pressure',
          evidenceToCheck:
            'Look for specific requests to delay, missed agreed dates, shrinking part-payments or credible information from your commercial relationship.',
        },
      ],
    },
    riskAssessment: {
      introduction:
        "Judge the change against the customer's own history. A moderate delay can deserve attention when it is unusual, while a longer delay may be less surprising for a consistently late but reliable payer.",
      factors: [
        {
          label: 'Change from normal behaviour',
          evidence: 'Compare current days late and payment gaps with the customer’s typical range.',
          interpretation:
            'A clear move outside that range raises concern even before an arbitrary ageing threshold is reached.',
        },
        {
          label: 'Recent payment progress',
          evidence: 'Check the last payment date, part-payments and whether the overdue balance is reducing.',
          interpretation:
            'Recent genuine progress can moderate urgency; a widening gap with no movement strengthens it.',
        },
        {
          label: 'Quality of communication',
          evidence: 'Record explanations, promised dates and whether the customer supplies verifiable detail.',
          interpretation:
            'Specific, consistent communication is more reassuring than vague updates or missed commitments.',
        },
        {
          label: 'Exposure and known context',
          evidence: 'Review the amount already overdue, pending supply and credible knowledge of the customer.',
          interpretation:
            'Greater exposure or corroborated concerns increase the cost of waiting for the pattern to resolve itself.',
        },
      ],
      conclusion:
        "Treat the slowdown as a prompt for direct contact and reassessment, not proof of distress. Urgency should rise when the deviation is large, payment progress has stopped and the customer's explanation does not survive basic checks.",
    },
    workedScenario: {
      customer: 'Harbour Kitchens',
      baseline:
        'For the previous year, Harbour paid six to ten days late and never went more than 34 days between payments.',
      currentSituation:
        'Two invoices are now 36 and 38 days late, 71 days have passed since the last payment, and an expected update from accounts did not arrive.',
      riskContext:
        'The £12,400 exposure is manageable, and no dispute or financial difficulty is currently known.',
      interpretation:
        'Thirty-eight days late is not universally decisive. What matters is that it is far outside Harbour’s established range and the payment gap has more than doubled. That makes the change itself a reason to investigate promptly.',
      nextAction:
        'Call the accounts contact, verify receipt and approval status, ask for a specific payment update, record the answer and reassess customer risk before accepting more exposure.',
    },
    recommendedActions: [
      "Compare today's delay and payment gap with the customer's established baseline.",
      'Check invoice delivery, approval and any claimed dispute before assuming a financial cause.',
      'Make direct contact and ask for specific, verifiable payment information.',
      'Record any explanation or commitment and update the customer risk view.',
      'Increase priority or control further exposure if the slowdown continues without credible progress.',
    ],
    productBridge:
      'Xero supplies the payment timeline; your team supplies what has changed in approval, dispute or the relationship. The product shows the accounting evidence and lets your chosen priority adjustment reflect that context without labelling a slowdown as financial distress.',
    ctaHeading: 'Bring unusual payment slowdowns into today’s chase order',
    ctaDescription:
      'Compare plans for identifying customers whose current behaviour has moved beyond their normal pattern.',
    ctaLabel: 'See plans and pricing',
    ctaHref: '/pricing',
    relatedSlugs: [
      'how-to-spot-deteriorating-customer-payment-behaviour',
      'customer-promised-to-pay-but-hasnt',
    ],
    indexable: true,
  },
  {
    slug: 'customer-hasnt-paid-for-60-days',
    pageType: 'customer-risk-scenario',
    intentFamily: 'customer-risk',
    funnelStage: 'problem-aware',
    primaryKeyword: "customer hasn't paid for 60 days",
    secondaryKeywords: [
      'customer invoice unpaid 60 days',
      '60 day overdue customer',
      'what to do after 60 days unpaid',
    ],
    searchIntent: 'informational',
    queryCluster: 'customer-unpaid-60-days',
    readerJob:
      'Decide what to do when a customer has gone roughly 60 days without paying.',
    uniqueAngle:
      'Treat a 60-day payment gap as serious enough for active intervention, while using prior behaviour, exposure and contact progress to choose the response.',
    metaTitle: "Customer Hasn't Paid for 60 Days: What to Do",
    metaDescription:
      'Act on 60 days without payment by confirming the debt, making direct contact and reassessing urgency using exposure and payment history.',
    h1: "Customer hasn't paid for 60 days",
    directAnswer:
      "Sixty days without payment is serious enough to require active intervention and a fresh risk assessment, not another passive reminder on its own. Confirm that the debt is valid, contact the customer directly, document a specific commitment and judge urgency using the amount exposed, their prior behaviour and whether recent chasing has produced genuine progress.",
    sectionHeadings: {
      whatItMightMean: 'What 60 days without payment might mean',
      riskAssessment: 'Assess the seriousness of a 60-day gap',
      workedScenario: 'Intervention at 60 days',
      recommendedActions: 'Strengthen the intervention now',
      productBridge: 'Use behaviour and context to set priority',
      relatedGuides: 'Prepare for escalation if progress stops',
    },
    diagnosis: {
      introduction:
        'A 60-day gap deserves attention, but it does not reveal the cause. Establish what is blocking payment before deciding whether the account needs resolution, a firm commitment or a stronger escalation path.',
      explanations: [
        {
          possibility: 'An unresolved administration issue',
          evidenceToCheck:
            'Verify invoice receipt, purchase-order details, approval ownership and whether the customer has asked for a correction.',
        },
        {
          possibility: 'A service or invoice dispute',
          evidenceToCheck:
            'Request the precise disputed amount and supporting detail, identify who can resolve it and ask about payment of any undisputed sum.',
        },
        {
          possibility: 'Payment is being delayed deliberately or under pressure',
          evidenceToCheck:
            'Review missed dates, vague updates, part-payment history and any credible commercial information rather than inferring distress from age alone.',
        },
      ],
    },
    riskAssessment: {
      introduction:
        'At around 60 days, assess whether direct intervention can still produce a credible route to payment. The position becomes more urgent when the gap is unusual, the balance is material or earlier contacts have achieved little.',
      factors: [
        {
          label: 'Payment gap and prior behaviour',
          evidence: 'Compare 60 days without payment with the customer’s usual payment interval and lateness.',
          interpretation:
            'A large departure from a reliable history is fresh risk evidence; habitual lateness still matters but changes the context.',
        },
        {
          label: 'Outstanding exposure',
          evidence: 'Total the customer-level overdue balance and any new work or orders that could increase it.',
          interpretation:
            'Higher material exposure justifies faster senior attention even when the reason for delay is not yet clear.',
        },
        {
          label: 'Contact and commitments',
          evidence: 'Review reminders, direct conversations, explanations and promised payment dates.',
          interpretation:
            'A responsive customer with a checkable issue presents a different next step from silence or a missed firm commitment.',
        },
        {
          label: 'Evidence of progress',
          evidence: 'Look for a correction completed, dispute owner assigned, part-payment received or a verified payment run.',
          interpretation:
            'Concrete progress may support a short monitored window; repeated words without movement should shorten it.',
        },
      ],
      conclusion:
        'The default at 60 days should be stronger, documented intervention. It is not yet automatically a conclusion that all routine recovery has failed, but the account should have a clear next action and a defined point for escalation if payment or credible progress does not follow.',
    },
    workedScenario: {
      customer: 'Northmere Interiors',
      baseline:
        'Northmere usually paid about 18 days late and had previously resolved invoice queries within a week.',
      currentSituation:
        'The customer owes £14,600, has made no payment for 62 days and has received two reminders. Its accounts contact says one invoice is waiting for internal approval but has not supplied a payment date.',
      riskContext:
        'The contact is still responding, no commitment has yet been broken and the disputed or blocked amount has not been clearly identified.',
      interpretation:
        'The gap is far outside normal behaviour and the exposure is material, so passive reminders are no longer enough. Continued communication leaves room for a direct resolution attempt, but the lack of a specific amount and date means escalation should be prepared if that attempt fails.',
      nextAction:
        'Confirm the valid and undisputed balance, speak to the decision-maker, obtain a dated commitment, record it and set a short review point for escalation if no progress follows.',
    },
    recommendedActions: [
      'Confirm invoice validity, receipt and the exact amount that is not disputed.',
      'Contact the customer directly rather than relying on another automated reminder.',
      'Ask for a specific payment date or a concrete route to resolving the blockage.',
      'Document commitments and reassess customer priority and risk.',
      'Set an explicit escalation review if payment or credible progress does not occur.',
    ],
    productBridge:
      'A 60-day gap and total exposure come from Xero; the approval history and quality of contact do not. The product lets the priority adjustment you choose from that context change the order while leaving cause and treatment to you.',
    ctaHeading: 'Make serious payment gaps visible before they drift further',
    ctaDescription:
      'Compare plans for prioritising 60-day payment gaps using exposure, payment history and customer context.',
    ctaLabel: 'See plans and pricing',
    ctaHref: '/pricing',
    relatedSlugs: [
      'when-should-i-escalate-an-overdue-invoice',
      'customer-hasnt-paid-for-90-days',
    ],
    indexable: true,
  },
  {
    slug: 'customer-hasnt-paid-for-90-days',
    pageType: 'customer-risk-scenario',
    intentFamily: 'customer-risk',
    funnelStage: 'problem-aware',
    primaryKeyword: "customer hasn't paid for 90 days",
    secondaryKeywords: [
      'customer invoice unpaid 90 days',
      '90 day overdue customer',
      'escalate prolonged non-payment',
    ],
    searchIntent: 'informational',
    queryCluster: 'customer-unpaid-90-days',
    readerJob:
      'Decide how to respond when a customer has gone roughly 90 days without paying.',
    uniqueAngle:
      'Treat prolonged non-payment and failed prior chasing as a point for deliberate escalation and tighter exposure control.',
    metaTitle: "Customer Hasn't Paid for 90 Days: What to Do",
    metaDescription:
      'Review escalation and further exposure when 90 days without payment shows that routine chasing is increasingly inadequate.',
    h1: "Customer hasn't paid for 90 days",
    directAnswer:
      'Ninety days without payment is materially more serious than ordinary overdue chasing. Review the full contact history, failed commitments, current exposure and available escalation options deliberately; routine reminders are increasingly inadequate when they have produced no payment or credible route forward.',
    sectionHeadings: {
      whatItMightMean: 'What prolonged non-payment might mean',
      riskAssessment: 'Decide whether normal chasing has run its course',
      workedScenario: 'When routine chasing has failed',
      recommendedActions: 'Move to an explicit escalation review',
      productBridge: 'Keep the evidence behind escalation visible',
      relatedGuides: 'Compare intervention and escalation',
    },
    diagnosis: {
      introduction:
        'The age and failed progress increase severity, but they still do not prove a single cause. Check whether a defined blockage remains resolvable or whether the wider behaviour now makes stronger recovery action and exposure controls proportionate.',
      explanations: [
        {
          possibility: 'A blockage has never been resolved',
          evidenceToCheck:
            'Trace the dispute or approval issue to a named owner, check what was supplied to resolve it and whether any undisputed balance was requested.',
        },
        {
          possibility: 'The customer is under sustained payment pressure',
          evidenceToCheck:
            'Look for repeated deferrals, missed specific dates, requests for extended time and credible information from the relationship.',
        },
        {
          possibility: 'Your account is being deprioritised',
          evidenceToCheck:
            'Compare promises with actual payments, responsiveness to senior contact and whether the customer continues to request supply without reducing debt.',
        },
      ],
    },
    riskAssessment: {
      introduction:
        'At around 90 days, focus on whether normal chasing has achieved anything and how much additional loss the business could accept. A long age combined with failed contact or commitments is more important than the number alone.',
      factors: [
        {
          label: 'Extended non-payment',
          evidence: 'Confirm days since the last payment and whether any part of the balance has moved during the period.',
          interpretation:
            'No payment for an extended period makes continued reliance on the same reminder cadence difficult to justify.',
        },
        {
          label: 'Failed prior chasing',
          evidence: 'List reminders, calls, responses and every promised date against the actual outcome.',
          interpretation:
            'Repeated attempts without progress show that routine chasing is increasingly insufficient.',
        },
        {
          label: 'Current and future exposure',
          evidence: 'Review the total overdue amount, open work, orders and credit already committed.',
          interpretation:
            'Growing exposure raises the consequence of delay and makes commercial controls more prominent.',
        },
        {
          label: 'Escalation readiness',
          evidence: 'Check that records, invoice documents, dispute history and decision ownership are complete.',
          interpretation:
            'A clear evidence trail supports a deliberate internal or external recovery decision without prescribing one legal route.',
        },
      ],
      conclusion:
        'A 90-day account should have an explicit escalation decision, not an indefinite sequence of similar reminders. The exact response depends on validity, proportionality, commercial context and professional advice where needed, but further exposure should not grow by default.',
    },
    workedScenario: {
      customer: 'Westford Engineering',
      baseline:
        'Westford previously paid 20 to 30 days late and responded when a director became involved.',
      currentSituation:
        'The account now owes £28,500, no payment has arrived for 93 days, four reminders and two calls have produced two missed dates, and a further £9,000 order has been requested.',
      riskContext:
        'No invoice dispute is recorded, communication has become intermittent and the commercial team still regards the account as important.',
      interpretation:
        'The prolonged gap, failed reminders and broken commitments show that the old chasing approach has not worked. Commercial importance remains relevant, but it does not remove the need to review stronger recovery action and prevent uncontrolled new exposure.',
      nextAction:
        'Assemble the payment and contact history, arrange a senior escalation review, decide proportionate recovery steps and pause or control new exposure until an authorised commercial decision is made.',
    },
    recommendedActions: [
      'Document the full invoice, contact, dispute and commitment history.',
      'Review internal and appropriate external escalation options with the responsible decision-maker.',
      'Control new exposure through a deliberate commercial decision rather than continued supply by default.',
      'Set a dated next step and owner instead of sending another equivalent reminder.',
      'Take suitable professional advice before any formal recovery action where necessary.',
    ],
    productBridge:
      'The product can surface the account because Xero shows prolonged inactivity and exposure and your priority adjustment can reflect failed commitments or commercial context. The escalation decision stays with the business.',
    ctaHeading: 'Surface prolonged non-payment that needs a decision',
    ctaDescription:
      'Compare plans for keeping age, failed commitments and customer exposure together in a prioritised queue.',
    ctaLabel: 'See plans and pricing',
    ctaHref: '/pricing',
    relatedSlugs: [
      'when-should-i-escalate-an-overdue-invoice',
      'customer-hasnt-paid-for-60-days',
    ],
    indexable: true,
  },
  {
    slug: 'customer-promised-to-pay-but-hasnt',
    pageType: 'customer-risk-scenario',
    intentFamily: 'customer-risk',
    funnelStage: 'problem-aware',
    primaryKeyword: "customer promised to pay but hasn't",
    secondaryKeywords: [
      'customer missed payment promise',
      'broken promise to pay invoice',
      'customer did not pay on promised date',
    ],
    searchIntent: 'informational',
    queryCluster: 'broken-promise-to-pay-customer',
    readerJob:
      'Decide what a missed promise to pay means and what to do next.',
    uniqueAngle:
      "Treat a broken payment commitment as new evidence about reliability, not simply another day added to the invoice's age.",
    metaTitle: "Customer Promised to Pay but Hasn't: Next Steps",
    metaDescription:
      'Follow up a missed payment promise promptly, check the explanation and use the broken commitment to reassess customer risk and escalation.',
    h1: "Customer promised to pay but hasn't",
    directAnswer:
      "Follow up promptly. A missed specific promise raises urgency because the customer's stated intention no longer matches their behaviour, although a genuine banking, approval or dispute issue may still explain it. Record the broken commitment, verify the reason, obtain evidence of the next step and reassess risk if the answer is vague or the behaviour repeats.",
    sectionHeadings: {
      whatItMightMean: 'What the missed promise might mean',
      riskAssessment: 'Judge what one missed promise changes',
      workedScenario: 'A specific date passes unpaid',
      recommendedActions: 'Follow up the commitment, not just the invoice',
      productBridge: 'Add commitment quality to the payment evidence',
      relatedGuides: 'Know when a broken promise changes the response',
    },
    diagnosis: {
      introduction:
        'Do not assume dishonesty or financial distress from one missed date. Establish whether payment was genuinely initiated, a defined issue intervened or the promise was made without a reliable plan.',
      explanations: [
        {
          possibility: 'A banking or processing delay',
          evidenceToCheck:
            'Ask when payment was released, for the remittance reference and when cleared funds should arrive.',
        },
        {
          possibility: 'A late approval or newly raised dispute',
          evidenceToCheck:
            'Identify the approver or disputed item, confirm why it was not raised before the promise and request a resolution date.',
        },
        {
          possibility: 'The customer cannot currently meet the commitment',
          evidenceToCheck:
            'Look for changing explanations, requests for more time, previous missed dates and any credible commercial context.',
        },
      ],
    },
    riskAssessment: {
      introduction:
        'The quality and history of the commitment matter. A precise first promise followed by evidence of a short processing delay is different from repeated vague assurances with no payment movement.',
      factors: [
        {
          label: 'Specificity of the promise',
          evidence: 'Check the promised amount, payment date, method and who authorised it.',
          interpretation:
            'A precise promise creates a clear test; a vague statement such as “soon” provides little assurance.',
        },
        {
          label: 'Payment recency',
          evidence: 'Review the last cleared payment and whether any part-payment arrived as agreed.',
          interpretation:
            'Recent progress may support a short follow-up window; no movement increases the significance of the missed date.',
        },
        {
          label: 'Commitment history',
          evidence: 'Count previous specific promises and compare each with the actual outcome.',
          interpretation:
            'A repeated pattern is stronger evidence of unreliability than one explained exception.',
        },
        {
          label: 'Communication after the miss',
          evidence: 'Note whether the customer alerts you, supplies evidence and proposes a credible correction.',
          interpretation:
            'Prompt, verifiable communication can moderate concern; silence or shifting accounts should raise it.',
        },
      ],
      conclusion:
        'Treat the missed date as a material update to the customer record. Verify before concluding why it happened, but do not erase the event by repeatedly replacing one untested promise with another.',
    },
    workedScenario: {
      customer: 'Bramley Care Supplies',
      baseline:
        'Bramley normally paid about 15 days late and had kept every previous specific commitment.',
      currentSituation:
        'With £9,800 overdue, its finance manager promised full payment on Friday. Five days later no payment or remittance has arrived, and the only reply says it should be sorted shortly.',
      riskContext:
        'The account has not previously broken a promise, but the new response gives no amount, authorised date or explanation.',
      interpretation:
        'The missed commitment is more important than five additional days alone because reliable communication has changed. One event does not prove distress, but it justifies immediate follow-up and a higher level of scrutiny.',
      nextAction:
        'Speak to the finance manager, ask what prevented Friday’s payment, request verifiable details for any transfer and record a new specific commitment only if it is credible.',
    },
    recommendedActions: [
      'Follow up as soon as the promised payment date passes.',
      'Record the promised amount and date as a broken commitment in the customer history.',
      'Ask for a specific explanation and evidence of any replacement payment step.',
      'Reassess customer risk and avoid accepting a chain of vague promises.',
      'Review escalation if another commitment fails or communication deteriorates.',
    ],
    productBridge:
      'Xero confirms whether cash arrived. Your priority adjustment can reflect that a promise failed or that an explanation is credible, so the account can move without the product claiming to judge intent.',
    ctaHeading: 'Make broken payment promises part of the priority',
    ctaDescription:
      'Compare plans for prioritising customers when a missed commitment changes the risk.',
    ctaLabel: 'See plans and pricing',
    ctaHref: '/pricing',
    relatedSlugs: [
      'when-should-i-escalate-an-overdue-invoice',
      'customer-suddenly-taking-longer-to-pay',
    ],
    indexable: true,
  },
  {
    slug: 'how-to-spot-deteriorating-customer-payment-behaviour',
    pageType: 'problem-outcome',
    intentFamily: 'customer-risk',
    funnelStage: 'solution-aware',
    primaryKeyword: 'how to spot deteriorating customer payment behaviour',
    secondaryKeywords: [
      'customer payment behaviour getting worse',
      'payment deterioration signals',
      'track customer payment trends',
    ],
    searchIntent: 'informational',
    queryCluster: 'detect-deteriorating-customer-payment-behaviour',
    readerJob:
      'Detect which customers are getting worse relative to their own historical payment pattern.',
    uniqueAngle:
      "Use longitudinal change against each customer's baseline, rather than absolute current risk or one universal lateness threshold.",
    metaTitle: 'How to Spot Deteriorating Customer Payment Behaviour',
    metaDescription:
      'Detect worsening customer payment behaviour by comparing current lateness, payment gaps, commitments and exposure with the customer’s own history.',
    h1: 'How to spot deteriorating customer payment behaviour',
    directAnswer:
      "Compare each customer's recent behaviour with their own baseline over several periods. Progressively later payments, longer gaps, more missed commitments, growing exposure or worsening credible risk information can reveal deterioration even when the customer is not yet the oldest debtor. There is no single lateness threshold that works for every customer.",
    whyItMatters:
      'A current risk snapshot can identify customers with serious warning signs today, but it can miss a previously reliable customer moving in the wrong direction. Trend review asks a different question: who is getting worse? The evidence should show a trajectory across periods, not one noisy invoice or an unsupported concern.',
    sectionHeadings: {
      whyItMatters: 'Why direction can matter more than the current level',
      signals: 'Look for a worsening trajectory',
      decisionRules: 'Separate a trend from a one-off exception',
      workedExample: 'One customer deteriorates over three cycles',
      recommendedActions: 'Investigate the change before exposure grows',
      productBridge: 'Put current evidence beside founder context',
      relatedGuides: 'Compare trend detection with current risk',
    },
    signalIntroduction:
      'Use several periods where possible and compare like with like. A trend becomes more credible when changes in timing, commitments and exposure reinforce one another.',
    signals: [
      {
        key: 'lateness-trend',
        label: 'Progressively later payment',
        explanation:
          'Track whether payment is moving from the customer’s normal range to later points across successive cycles.',
      },
      {
        key: 'payment-gap-trend',
        label: 'Lengthening payment gaps',
        explanation:
          'Check whether intervals between actual payments are increasing, even if reminders are still receiving replies.',
      },
      {
        key: 'commitment-trend',
        label: 'Worsening commitment reliability',
        explanation:
          'A shift from kept dates to rescheduled or missed dates adds behavioural evidence to the numerical trend.',
      },
      {
        key: 'exposure-and-context-trend',
        label: 'Growing exposure or risk context',
        explanation:
          'Rising overdue value, new supply, weaker communication or credible business information can increase the consequence of deterioration.',
      },
    ],
    decisionRules: [
      "Build an individual baseline from the customer's established payment pattern.",
      'Compare several recent cycles with that baseline instead of relying on one threshold.',
      'Investigate when multiple measures move in a worse direction or one material behavioural event occurs.',
      'Distinguish a resolved dispute or seasonal exception from a trend that continues after the cause should have cleared.',
      'Reassess risk and exposure as the trajectory changes, not only when an invoice reaches an old age bucket.',
    ],
    workedExample: {
      customer: 'Cedarpoint Components',
      baseline:
        'For nine months, Cedarpoint paid seven to eleven days late, made a payment every four weeks and kept agreed dates.',
      currentSituation:
        'Across the last three cycles it paid 18, then 29, then 44 days late. Payment gaps widened to 39 and 55 days, the overdue balance rose from £6,500 to £17,200, and the latest specific promise was missed.',
      riskContext:
        'The customer remains in contact and cites slower internal approval, but no lasting resolution or part-payment has followed.',
      interpretation:
        'No single invoice proves the cause. The repeated movement away from Cedarpoint’s own baseline across timing, exposure and commitment reliability is a worsening trajectory that deserves investigation now.',
      nextAction:
        'Ask the customer to explain the repeated change, verify the approval issue, reassess risk and control further exposure until payment behaviour shows credible improvement.',
    },
    recommendedActions: [
      'Establish each customer’s normal payment timing and commitment record.',
      'Review changes across several cycles rather than one current snapshot.',
      'Investigate sustained movement in lateness, payment gaps, exposure or communication.',
      'Record verified explanations so one-off exceptions are not mistaken for deterioration.',
      'Increase attention and review exposure when the worsening trajectory persists.',
    ],
    productBridge:
      'Xero provides payment history and current exposure. Add what the ledger misses—promises, disputes and material context—when adjusting which customers need attention as the pattern changes.',
    ctaHeading: 'Spot worsening payment behaviour before exposure grows',
    ctaDescription:
      'Compare plans for combining Xero payment history with current customer-risk judgement in a live priority queue.',
    ctaLabel: 'See plans and pricing',
    ctaHref: '/pricing',
    relatedSlugs: [
      'how-to-identify-risky-customers-from-payment-behaviour',
      'how-payment-history-should-affect-invoice-chasing',
    ],
    indexable: true,
  },
  {
    slug: 'should-i-keep-supplying-a-customer-who-pays-late',
    pageType: 'customer-risk-scenario',
    intentFamily: 'customer-risk',
    funnelStage: 'problem-aware',
    primaryKeyword: 'should I keep supplying a customer who pays late',
    secondaryKeywords: [
      'supply customer with overdue invoices',
      'late payer requesting another order',
      'control customer credit exposure',
    ],
    searchIntent: 'informational',
    queryCluster: 'continue-supplying-late-paying-customer',
    readerJob:
      'Decide whether to increase financial exposure to a customer who already pays late.',
    uniqueAngle:
      'Treat continued supply as a commercial credit and exposure decision rather than another invoice-chasing decision.',
    metaTitle: 'Should I Keep Supplying a Customer Who Pays Late?',
    metaDescription:
      'Decide whether to keep supplying a late-paying customer by weighing existing exposure, payment reliability and practical credit controls.',
    h1: 'Should I keep supplying a customer who pays late?',
    directAnswer:
      "Keep supplying only if the total exposure remains acceptable after considering the overdue balance, the new order and the customer's recent behaviour. If it does not, require prepayment, a deposit, staged delivery, tighter terms or a lower limit. Decline further credit until payment improves if those controls are unavailable. Commercial importance can inform your tolerance, but it does not make the risk disappear.",
    sectionHeadings: {
      whatItMightMean: 'What the late payment might mean for supply',
      riskAssessment: 'How much additional risk is acceptable?',
      workedScenario: 'An overdue customer requests another order',
      recommendedActions: 'Make a deliberate exposure decision',
      productBridge: 'Connect payment evidence with commercial judgement',
      relatedGuides: 'Review habitual lateness and concentrated exposure',
    },
    diagnosis: {
      introduction:
        'Before accepting or refusing the order, understand whether the overdue position is a stable commercial issue, a resolvable blockage or a deterioration. The reason changes which controls could be proportionate.',
      explanations: [
        {
          possibility: 'A known administrative or dispute issue',
          evidenceToCheck:
            'Confirm the affected invoice and amount, resolution owner and whether the customer will pay undisputed debt or the new order separately.',
        },
        {
          possibility: 'Predictable habitual lateness',
          evidenceToCheck:
            'Compare current timing with the customer’s normal payment pattern and verify whether previous late balances were ultimately cleared as expected.',
        },
        {
          possibility: 'A worsening ability or willingness to pay',
          evidenceToCheck:
            'Look for lengthening delays, broken promises, weaker communication, requests for more credit and credible risk information.',
        },
      ],
    },
    riskAssessment: {
      introduction:
        'Assess the total downside after the proposed order, not just the margin on the new sale. Commercial importance can support flexibility, but it should not make exposure invisible.',
      factors: [
        {
          label: 'Existing overdue exposure',
          evidence: 'Total all overdue invoices and any committed work at the customer level.',
          interpretation:
            'The decision should reflect the full amount at risk if the new supply is not paid.',
        },
        {
          label: 'Payment reliability',
          evidence: 'Compare current delay, recent payment and kept commitments with the established history.',
          interpretation:
            'Stable but late behaviour may support controlled supply; deterioration should reduce the risk you accept.',
        },
        {
          label: 'Size of the proposed supply',
          evidence: 'Measure the order value and delivery stages against current exposure and business tolerance.',
          interpretation:
            'A small, recoverable increment differs from an order that materially concentrates risk.',
        },
        {
          label: 'Available exposure controls',
          evidence: 'Consider whether both parties can agree a deposit, prepayment, staged supply, tighter terms or reduced credit limit.',
          interpretation:
            'Practical controls can change the decision by reducing how much additional unsecured exposure is created.',
        },
      ],
      conclusion:
        'Choose the option that keeps total exposure within an explicitly accepted level. That may be normal supply, controlled supply or no further supply, depending on the evidence and the commercial arrangements actually available.',
    },
    workedScenario: {
      customer: 'Kingswell Retail Fitout',
      baseline:
        'Kingswell has usually paid 22 to 27 days late but has cleared each balance and remained responsive.',
      currentSituation:
        'It owes £18,000, is now 43 days late and requests another £12,000 order needed for a store opening.',
      riskContext:
        'The customer says a project sign-off caused the delay, has provided the approver’s details and is commercially important, but no payment has arrived for 35 days.',
      interpretation:
        'Supplying the whole order on existing terms would raise exposure to £30,000 while current behaviour is worse than normal. Refusal is not automatic: a verified resolution plus a deposit, staged supply or reduced credit limit could materially change the risk.',
      nextAction:
        'Verify the approval issue, decide the maximum acceptable total exposure and agree any deposit, prepayment or staging before authorising further supply.',
    },
    recommendedActions: [
      'Calculate current overdue exposure and the additional exposure created by the order.',
      'Verify why payment is late and whether behaviour has changed from normal.',
      'Set the maximum additional risk the business is prepared to accept.',
      'Use agreed deposits, prepayment, staged supply, tighter terms or limits where appropriate.',
      'Record who authorised the decision and the evidence they used.',
    ],
    productBridge:
      'The product makes current exposure and payment recency visible in the priority order and shows historical payment timing as context. You supply the commercial importance and risk tolerance; deposits, terms and further supply remain business decisions.',
    ctaHeading: 'See the existing exposure before accepting more',
    ctaDescription:
      'Compare plans for prioritising overdue customers using Xero balances, payment behaviour and your commercial risk judgement.',
    ctaLabel: 'See plans and pricing',
    ctaHref: '/pricing',
    relatedSlugs: [
      'one-customer-owes-me-a-large-amount-of-money',
      'what-to-do-about-customers-who-always-pay-late',
    ],
    indexable: true,
  },
  {
    slug: 'one-customer-owes-me-a-large-amount-of-money',
    pageType: 'problem-outcome',
    intentFamily: 'customer-risk',
    funnelStage: 'problem-aware',
    primaryKeyword: 'one customer owes me a large amount of money',
    secondaryKeywords: [
      'large customer overdue balance',
      'customer debt concentration risk',
      'manage large overdue customer exposure',
    ],
    searchIntent: 'informational',
    queryCluster: 'large-single-customer-overdue-exposure',
    readerJob:
      'Decide how urgently to treat a large concentration of overdue debt in one customer.',
    uniqueAngle:
      'Show how one unusually large single-customer exposure changes the consequence of non-payment without making balance size the only urgency signal.',
    metaTitle: 'One Customer Owes Me a Large Amount of Money',
    metaDescription:
      'Assess a large overdue customer exposure using materiality, payment behaviour, progress and controls rather than balance size alone.',
    h1: 'One customer owes me a large amount of money',
    directAnswer:
      "Give a large single-customer balance deliberate attention because concentration increases the cash consequence if payment fails. Size alone still does not determine the next chase: combine materiality with payment behaviour, recent progress, credible customer risk and any further exposure before deciding urgency and controls.",
    whyItMatters:
      'A concentrated balance can affect payroll, tax or supplier decisions even when the customer has historically paid. That makes the account a management risk as well as a collections item. But automatically ranking it above every smaller debtor can hide a customer whose rapidly worsening behaviour needs immediate contact. Separate exposure management from a largest-invoice-first rule.',
    sectionHeadings: {
      whyItMatters: 'Why concentration changes the consequence',
      signals: 'Assess the exposure and the likelihood of progress',
      decisionRules: 'Manage concentration without using size alone',
      workedExample: 'Large exposure versus sharper deterioration',
      recommendedActions: 'Control the exposure and clarify payment',
      productBridge: 'See value and behaviour at customer level',
      relatedGuides: 'Control supply and know when to escalate',
    },
    signalIntroduction:
      'Start by judging whether the balance is material to your business, then use behavioural evidence to decide the immediate collections action. Both consequence and current risk belong in the decision.',
    signals: [
      {
        key: 'customer-level-exposure',
        label: 'Total customer exposure',
        explanation:
          'Combine overdue invoices, other outstanding amounts and committed work so the full concentration is visible.',
      },
      {
        key: 'business-materiality',
        label: 'Business materiality',
        explanation:
          'Assess what delayed or failed payment would mean for your own cash commitments rather than using a universal value threshold.',
      },
      {
        key: 'payment-progress',
        label: 'Payment behaviour and progress',
        explanation:
          'Compare the current position with history and check recent payments, commitments, disputes and communication.',
      },
      {
        key: 'future-exposure',
        label: 'Further exposure',
        explanation:
          'Include new orders or work that could increase concentration before the existing balance is reduced.',
      },
    ],
    decisionRules: [
      'Give the large balance management visibility even when current payment evidence is relatively reassuring.',
      'Raise immediate chasing urgency when deterioration, silence or broken commitments reinforce the high exposure.',
      'Do not let size automatically displace a smaller customer with a stronger need for action today.',
      'Avoid increasing uncontrolled exposure while payment status remains unclear.',
      'Plan for the cash consequence if the expected payment is delayed again.',
    ],
    workedExample: {
      introduction:
        'Alder carries the larger concentration, while Beacon shows the more urgent behavioural change. The result separates today’s contact order from the need to manage the large exposure.',
      customers: [
        {
          name: 'Beacon Installation',
          valueOutstanding: 12400,
          averageDaysLate: 37,
          daysSinceLastPayment: 69,
          founderRisk: 'high',
          founderRiskReason: 'A previously prompt customer missed two specific dates and has stopped returning calls.',
          rank: 1,
          rankReason: 'The smaller balance deserves the first contact because its behaviour has sharply deteriorated and progress has stopped.',
        },
        {
          name: 'Alder Distribution',
          valueOutstanding: 68000,
          averageDaysLate: 14,
          daysSinceLastPayment: 8,
          founderRisk: 'medium',
          founderRiskReason: 'A part-payment arrived with remittance and the remaining balance is in a documented approval run.',
          rank: 2,
          rankReason: 'Recent progress moderates immediate chasing urgency, but the £68,000 concentration still requires close monitoring and exposure control.',
        },
      ],
      conclusion:
        'Contact Beacon first because its worsening behaviour makes action time-sensitive. Separately, verify Alder’s approval date, avoid adding uncontrolled credit and plan around the concentrated balance. Alder is not ignored; it is managed for consequence without assuming the largest amount must always be the first chase.',
    },
    recommendedActions: [
      'Calculate total customer exposure and its materiality to your own cash position.',
      'Confirm the balance, payment status and any dispute directly with the customer.',
      'Compare recent behaviour and commitments with the customer’s normal pattern.',
      'Avoid increasing uncontrolled exposure while a material balance remains unresolved.',
      'Set monitoring, escalation and cash-contingency decisions appropriate to the concentration.',
    ],
    productBridge:
      'Customer-level Xero data keeps balance, age and payment recency together. Your priority adjustment can then reflect materiality or reliable new context instead of forcing a largest-balance-first rule.',
    ctaHeading: 'Keep concentrated balances visible without losing behavioural risk',
    ctaDescription:
      'Compare plans for ranking customer-level exposure alongside payment recency and your customer-risk judgement.',
    ctaLabel: 'See plans and pricing',
    ctaHref: '/pricing',
    relatedSlugs: [
      'should-i-keep-supplying-a-customer-who-pays-late',
      'when-should-i-escalate-an-overdue-invoice',
    ],
    indexable: true,
  },
  {
    slug: 'when-should-i-escalate-an-overdue-invoice',
    pageType: 'problem-outcome',
    intentFamily: 'customer-risk',
    funnelStage: 'solution-aware',
    primaryKeyword: 'when should I escalate an overdue invoice',
    secondaryKeywords: [
      'overdue invoice escalation threshold',
      'when normal invoice chasing has failed',
      'escalate unpaid customer invoice',
    ],
    searchIntent: 'informational',
    queryCluster: 'overdue-invoice-escalation-threshold',
    readerJob:
      'Decide when normal chasing should move to a stronger level of intervention.',
    uniqueAngle:
      'Use severity and failed progress to decide escalation instead of applying one arbitrary invoice-age threshold.',
    metaTitle: 'When Should I Escalate an Overdue Invoice?',
    metaDescription:
      'Escalate when invoice age, failed contact or promises, exposure and customer risk make routine chasing inadequate.',
    h1: 'When should I escalate an overdue invoice?',
    directAnswer:
      'Escalate when the combination of non-payment length, failed contact or commitments, exposure and credible customer risk makes routine chasing inadequate. No single age works for every account: a younger debt with broken promises and silence may justify escalation before an older debt moving through a verified resolution process.',
    whyItMatters:
      'Escalating every invoice on a fixed day can waste senior attention and damage a relationship where payment is genuinely progressing. Waiting indefinitely has the opposite cost: the same reminders continue after they have stopped producing information or payment. A useful threshold identifies when the current method is failing and a more deliberate response is proportionate, without prescribing detailed legal recovery steps.',
    sectionHeadings: {
      whyItMatters: 'Why invoice age alone is not an escalation rule',
      signals: 'Recognise when routine chasing is inadequate',
      decisionRules: 'Use an evidence-based escalation threshold',
      workedExample: 'Similar age, different response',
      recommendedActions: 'Make escalation a documented decision',
      productBridge: 'Keep the evidence for stronger action visible',
      relatedGuides: 'Apply the rule to prolonged non-payment',
    },
    signalIntroduction:
      'Escalation becomes more justified as several indicators reinforce one another. Consider whether the current chase is producing verifiable progress, not simply whether messages are being sent.',
    signals: [
      {
        key: 'failed-chasing',
        label: 'Failed contact or commitments',
        explanation:
          'Silence, repeated deferral or missed specific dates shows that the existing approach is no longer moving the account forward.',
      },
      {
        key: 'non-payment-length',
        label: 'Length of non-payment',
        explanation:
          'Use age and days since payment as severity evidence, interpreted against the customer’s history and any actual progress.',
      },
      {
        key: 'exposure-severity',
        label: 'Exposure and consequence',
        explanation:
          'A material balance or continued supply can make delay more costly and require an earlier senior decision.',
      },
      {
        key: 'risk-and-resolution',
        label: 'Risk and resolution evidence',
        explanation:
          'Worsening behaviour or credible concerns support escalation; a verified dispute owner, part-payment or approved date may support monitored normal chasing.',
      },
    ],
    decisionRules: [
      'Escalate when normal chasing has repeatedly failed to produce payment, reliable information or a credible route to resolution.',
      'Escalate earlier when broken commitments, silence, material exposure or worsening behaviour reinforce the invoice age.',
      'Continue normal chasing for a defined period when a verified issue is actively progressing and the remaining risk is acceptable.',
      'Document the evidence, owner and next review date whether you escalate now or wait.',
      'Use suitable professional advice before choosing formal recovery action.',
    ],
    workedExample: {
      introduction:
        'Rothwell and Greenbank have invoices of a similar age, but only Rothwell shows that routine chasing has become inadequate.',
      customers: [
        {
          name: 'Rothwell Services',
          valueOutstanding: 16200,
          averageDaysLate: 46,
          daysSinceLastPayment: 81,
          founderRisk: 'high',
          founderRiskReason: 'Three calls produced two missed promises, and the customer has now stopped responding.',
          rank: 1,
          rankReason: 'Failed commitments, lost contact and material exposure justify a deliberate escalation despite the debt not yet reaching 90 days.',
        },
        {
          name: 'Greenbank Studio',
          valueOutstanding: 15100,
          averageDaysLate: 43,
          daysSinceLastPayment: 77,
          founderRisk: 'medium',
          founderRiskReason: 'A documented invoice dispute has a named resolver, and the undisputed amount was paid yesterday.',
          rank: 2,
          rankReason: 'Similar age does not require the same response because recent payment and a verified resolution process show normal follow-up is still achieving progress.',
        },
      ],
      conclusion:
        'Escalate Rothwell through the business’s approved route and record why. Continue tightly monitored normal chasing with Greenbank until the agreed dispute-review date. The distinction is failed progress and severity, not a universal number of days.',
    },
    recommendedActions: [
      'Review invoice age together with every contact, commitment and payment outcome.',
      'Decide whether normal chasing is still producing credible progress.',
      'Record the evidence, escalation owner and next dated action.',
      'Control further exposure when delay could materially increase loss.',
      'Seek appropriate advice before taking formal recovery steps.',
    ],
    productBridge:
      'The queue can combine Xero age, exposure and payment recency with the priority adjustment you make for commitments or risk. It surfaces accounts for attention; it does not choose or execute escalation.',
    ctaHeading: 'Surface accounts where normal chasing is no longer enough',
    ctaDescription:
      'Compare plans for prioritising customers using invoice age, payment movement and the risk context you add.',
    ctaLabel: 'See plans and pricing',
    ctaHref: '/pricing',
    relatedSlugs: [
      'customer-hasnt-paid-for-60-days',
      'customer-hasnt-paid-for-90-days',
    ],
    indexable: true,
  },
  {
    slug: 'how-payment-history-should-affect-invoice-chasing',
    pageType: 'problem-outcome',
    intentFamily: 'customer-risk',
    funnelStage: 'solution-aware',
    primaryKeyword: 'how payment history should affect invoice chasing',
    secondaryKeywords: [
      'use customer payment history for chasing',
      'payment pattern overdue invoice urgency',
      'historical payment behaviour credit control',
    ],
    searchIntent: 'informational',
    queryCluster: 'payment-history-invoice-chasing-strategy',
    readerJob:
      "Use a customer's historical payment behaviour to decide how urgently and how closely to chase them.",
    uniqueAngle:
      "Show how payment history changes the meaning and chasing treatment of today's overdue position without turning the task into a whole-ledger risk screen.",
    metaTitle: 'How Payment History Should Affect Invoice Chasing',
    metaDescription:
      'Interpret current lateness against each customer’s payment history so chasing reflects deviations, recency and credible context.',
    h1: 'How payment history should affect invoice chasing',
    directAnswer:
      "Interpret current lateness relative to the customer's own payment history, not in isolation. A customer who is 20 days late but normally pays 30 days late may need planned follow-up rather than an emergency response; one who normally pays on time but is suddenly 20 days late may deserve earlier investigation.",
    whyItMatters:
      'The same ageing number can mean very different things. History provides a baseline for judging whether today’s position is predictable, unexpectedly poor or actually improving. It should shape urgency and follow-up frequency, while current exposure, payment recency and credible business knowledge prevent a familiar pattern from being treated as permanently safe.',
    sectionHeadings: {
      whyItMatters: 'Why the same overdue age can mean different things',
      signals: 'Put today’s position in historical context',
      decisionRules: 'Adjust chasing to the size of the deviation',
      workedExample: 'Similar lateness, different histories',
      recommendedActions: 'Use history without becoming complacent',
      productBridge: 'Combine payment records with current context',
      relatedGuides: 'Manage habitual patterns and detect deterioration',
    },
    signalIntroduction:
      'Use history to interpret the current customer, not to excuse it automatically. The clearest comparison is between today’s timing and an established normal range, supported by actual payment recency and current context.',
    signals: [
      {
        key: 'usual-days-late',
        label: 'Usual days late',
        explanation:
          'Establish the customer’s typical range across enough completed payments to avoid treating one exception as the baseline.',
      },
      {
        key: 'current-deviation',
        label: 'Current deviation from history',
        explanation:
          'Measure how far today’s overdue position sits inside or outside the customer’s normal range.',
      },
      {
        key: 'recent-payment-evidence',
        label: 'Recent payment evidence',
        explanation:
          'Check whether a cleared or part-payment shows ongoing progress that invoice age alone misses.',
      },
      {
        key: 'current-exceptions',
        label: 'Current exceptions and context',
        explanation:
          'Include broken promises, disputes, administration issues or credible risk information that make the historical pattern less reliable.',
      },
    ],
    decisionRules: [
      'Use an established historical range to interpret the current delay.',
      'Investigate earlier when a normally prompt customer moves materially outside that range.',
      'Keep predictable late payers on planned follow-up and address the pattern through terms or exposure rather than false emergencies.',
      'Override historical reassurance when recent payment stops, promises fail or credible risk information changes.',
      'Review the baseline periodically so gradual deterioration does not become the new normal unnoticed.',
    ],
    workedExample: {
      introduction:
        'Oakfield and Mere are both 20 days late today. Their histories change how that current position should be treated.',
      customers: [
        {
          name: 'Mere Medical Design',
          valueOutstanding: 9300,
          averageDaysLate: 3,
          daysSinceLastPayment: 51,
          founderRisk: 'medium',
          founderRiskReason: 'The customer normally pays within a few days and has not explained the unusual delay.',
          rank: 1,
          rankReason: 'Twenty days late is a material departure from Mere’s history, so an early direct check is justified despite the moderate absolute age.',
        },
        {
          name: 'Oakfield Catering',
          valueOutstanding: 10100,
          averageDaysLate: 30,
          daysSinceLastPayment: 22,
          founderRisk: 'low',
          founderRiskReason: 'The account routinely pays between 27 and 33 days late and remains responsive.',
          rank: 2,
          rankReason: 'Twenty days late is still inside Oakfield’s established pattern, supporting scheduled follow-up rather than emergency treatment.',
        },
      ],
      conclusion:
        'Contact Mere first to understand the unexplained deviation. Keep Oakfield’s planned chase and review its terms because habitual lateness still creates exposure. This is a decision about interpreting today’s overdue customers; a separate trend review asks whether either pattern is worsening over several cycles.',
    },
    recommendedActions: [
      'Build a reliable normal payment range from completed customer history.',
      'Compare each current overdue position with that customer-specific baseline.',
      'Use recent payments, commitments and known issues to test the historical interpretation.',
      'Chase unusual deviations earlier while keeping stable habits on proportionate follow-up.',
      'Review recurring lateness through terms and exposure, and monitor for deterioration.',
    ],
    productBridge:
      'The product uses Xero history to place current lateness and recent payment in context, while your priority adjustment accounts for facts such as a dispute or broken promise that the ledger cannot explain.',
    ctaHeading: 'Use payment history to shape today’s chase order',
    ctaDescription:
      'Compare plans for using Xero history to inform overdue-customer prioritisation alongside current customer context.',
    ctaLabel: 'See plans and pricing',
    ctaHref: '/pricing',
    relatedSlugs: [
      'what-to-do-about-customers-who-always-pay-late',
      'how-to-spot-deteriorating-customer-payment-behaviour',
    ],
    indexable: true,
  },
  ...hubDSeoPages,
  ...hubESeoPages,
] satisfies SeoProblemPage[]
