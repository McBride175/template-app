import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { loadTypeScriptModule } from '../xero/test-helpers/ts-module-loader.mjs'

const GUIDE_ROUTE_PATH = new URL('../../app/guides/[slug]/page.tsx', import.meta.url)

const {
  getAllIndexableSeoProblemPages,
  getAllSeoGuideCategories,
  getIndexableSeoProblemPagesByIntentFamily,
  getRelatedSeoProblemPages,
  getSeoGuideCategoryByIntentFamily,
  getSeoProblemPageBySlug,
  validateCustomerRiskScenarioPages,
  validateOutcomeImprovementPages,
  validateProcessHowToPages,
  validateSoftwareSolutionPages,
  validateSeoGuideCategories,
  validateSeoProblemPageContent,
  validateSeoProblemPages,
} = loadTypeScriptModule('lib/seo-pages.ts')

const { default: CustomerRiskScenarioGuide } = loadTypeScriptModule(
  'app/guides/_components/CustomerRiskScenarioGuide.tsx',
  {
    mocks: {
      'next/link': {
        __esModule: true,
        default: ({ href, children, ...props }) =>
          React.createElement('a', { href, ...props }, children),
      },
    },
  }
)

const { default: OutcomeImprovementGuide } = loadTypeScriptModule(
  'app/guides/_components/OutcomeImprovementGuide.tsx',
  {
    mocks: {
      'next/link': {
        __esModule: true,
        default: ({ href, children, ...props }) =>
          React.createElement('a', { href, ...props }, children),
      },
    },
  }
)

const { default: ProcessHowToGuide } = loadTypeScriptModule(
  'app/guides/_components/ProcessHowToGuide.tsx',
  {
    mocks: {
      'next/link': {
        __esModule: true,
        default: ({ href, children, ...props }) =>
          React.createElement('a', { href, ...props }, children),
      },
    },
  }
)

const { default: SoftwareSolutionGuide } = loadTypeScriptModule(
  'app/guides/_components/SoftwareSolutionGuide.tsx',
  {
    mocks: {
      'next/link': {
        __esModule: true,
        default: ({ href, children, ...props }) =>
          React.createElement('a', { href, ...props }, children),
      },
    },
  }
)

function governancePage(overrides = {}) {
  return {
    slug: 'example-guide',
    pageType: 'problem-outcome',
    queryCluster: 'example-query-cluster',
    readerJob: 'Make one clear decision.',
    uniqueAngle: 'Explain the decision using evidence.',
    intentFamily: 'prioritisation',
    funnelStage: 'solution-aware',
    indexable: true,
    ...overrides,
  }
}

function customerRiskScenarioFixture(overrides = {}) {
  return {
    slug: 'customer-risk-scenario-renderer-fixture',
    pageType: 'customer-risk-scenario',
    intentFamily: 'customer-risk',
    funnelStage: 'problem-aware',
    primaryKeyword: 'customer risk scenario fixture',
    secondaryKeywords: ['payment behaviour fixture'],
    searchIntent: 'informational',
    queryCluster: 'customer-risk-scenario-fixture',
    readerJob: 'Assess one customer situation and choose the next action.',
    uniqueAngle: 'Test a longitudinal customer-risk scenario without publishing a guide.',
    metaTitle: 'Customer Risk Scenario Fixture',
    metaDescription: 'Non-production fixture for the customer-risk scenario renderer.',
    h1: 'Customer payment pattern changed',
    directAnswer:
      'Compare the new behaviour with the customer’s normal pattern before deciding how serious it is. Check for an administrative explanation, then use payment evidence and known customer context to choose the next action.',
    sectionHeadings: {
      whatItMightMean: 'What the change might mean',
      riskAssessment: 'How concerned should you be?',
      workedScenario: 'Customer scenario',
      recommendedActions: 'What to do next',
      productBridge: 'Keep payment evidence and context together',
      relatedGuides: 'Continue reading',
    },
    diagnosis: {
      introduction:
        'A change can have several explanations, so look for evidence before assuming the customer is in financial difficulty.',
      explanations: [
        {
          possibility: 'A temporary administration problem',
          evidenceToCheck: 'Confirm the invoice was received, approved and sent to the right contact.',
        },
        {
          possibility: 'Worsening customer liquidity',
          evidenceToCheck: 'Look for repeated delays, missed promises or requests to extend terms.',
        },
      ],
    },
    riskAssessment: {
      introduction:
        'Use only the factors relevant to this customer rather than forcing every possible signal into the assessment.',
      factors: [
        {
          label: 'Change from normal behaviour',
          evidence: 'The customer normally pays 8–12 days late and is now 38 days late.',
          interpretation: 'The change is material because it is unusual for this customer.',
        },
        {
          label: 'Further supply exposure',
          evidence: 'A new order would add £9,000 to the existing overdue balance.',
          interpretation: 'Any supply decision should consider the additional cash at risk.',
        },
      ],
      conclusion:
        'The evidence supports a direct conversation and a review of further exposure, but it does not prove why the customer is late.',
    },
    workedScenario: {
      customer: 'Customer A',
      baseline: 'Usually pays 8–12 days late and responds promptly to queries.',
      currentSituation: 'Now 38 days late, last paid 71 days ago and has placed a new order.',
      riskContext: 'A promised payment date was missed without an updated explanation.',
      interpretation: 'This is a meaningful deterioration from the customer’s normal pattern.',
      nextAction: 'Contact the customer directly and review further supply until the position is clearer.',
    },
    recommendedActions: [
      'Confirm there is no invoice administration problem or unresolved dispute.',
      'Contact the customer directly and record any new promise to pay.',
      'Reassess customer risk and further exposure using the evidence received.',
    ],
    productBridge:
      'The product combines accounting evidence with the customer-priority judgement supplied by the founder.',
    ctaHeading: 'Continue this customer-risk decision',
    ctaDescription:
      'Use CTA copy that follows the specific decision made in this guide.',
    ctaLabel: 'See plans and pricing',
    ctaHref: '/pricing',
    relatedSlugs: [],
    indexable: false,
    ...overrides,
  }
}

function outcomeImprovementFixture(overrides = {}) {
  return {
    slug: 'outcome-improvement-renderer-fixture',
    pageType: 'outcome-improvement',
    intentFamily: 'cash-outcome',
    funnelStage: 'solution-aware',
    primaryKeyword: 'improve a receivables outcome fixture',
    secondaryKeywords: ['cash outcome improvement fixture'],
    searchIntent: 'informational',
    queryCluster: 'outcome-improvement-renderer-fixture',
    readerJob: 'Improve a broader receivables outcome by fixing its main constraint.',
    uniqueAngle:
      'Test a business-level improvement flow without publishing an outcome article.',
    metaTitle: 'Outcome Improvement Renderer Fixture',
    metaDescription: 'Non-production fixture for the outcome-improvement renderer.',
    h1: 'Improve a broader receivables outcome',
    directAnswer:
      'Improve the outcome by finding the few constraints that cause most delay, then direct improvement work and human chasing effort towards them. Measure whether cash movement improves before expanding the plan.',
    sectionHeadings: {
      drivers: 'What drives this outcome',
      focusFirst: 'Where to focus first',
      improvementPlan: 'A practical improvement plan',
      workedExample: 'Worked business example',
      measurements: 'What to measure',
      productBridge: 'Prioritise the chasing component',
      relatedGuides: 'Continue improving collections',
    },
    driverIntroduction:
      'Use only the levers relevant to the outcome and the current business constraint.',
    drivers: [
      {
        key: 'invoice-quality',
        label: 'Invoice accuracy and timeliness',
        explanation: 'Errors and late issue dates can delay the payment process before chasing starts.',
      },
      {
        key: 'dispute-resolution',
        label: 'Dispute resolution',
        explanation: 'A concentrated dispute backlog can hold up cash even when reminders are frequent.',
      },
      {
        key: 'chasing-focus',
        label: 'Focus of human chasing',
        explanation: 'Scarce founder time has more effect when it is directed to customers where intervention matters.',
      },
    ],
    focusIntroduction:
      'Compare the evidence behind each delay and start with the constraint capable of materially improving cash collection.',
    focusAreas: [
      {
        area: 'Remove the concentrated dispute backlog',
        evidenceToCheck: 'Value and age of balances blocked by the same unresolved issue.',
        whenToPrioritise: 'A small number of disputes accounts for a material share of overdue cash.',
      },
      {
        area: 'Improve chasing allocation',
        evidenceToCheck: 'Time spent on routine reminders compared with higher-value judgement-intensive contacts.',
        whenToPrioritise: 'Founder time is scarce and chasing activity is not producing proportionate cash movement.',
      },
    ],
    improvementPlan: [
      'Record a simple baseline for overdue cash, disputes and chasing time.',
      'Identify the constraint responsible for the largest avoidable delay.',
      'Fix the process issue and separate routine follow-up from judgement-intensive chasing.',
      'Review the chosen measures and adjust the next improvement cycle.',
    ],
    workedExample: {
      businessContext: 'A small wholesaler manages receivables in a weekly founder-led session.',
      startingPosition:
        '£84,000 is overdue, several invoices are disputed and five hours a week are spent sending broad reminders.',
      primaryConstraint:
        'Three unresolved delivery disputes hold most of the overdue value while manual effort is spread across the ledger.',
      changesMade: [
        'Assigned an owner and deadline to each material dispute.',
        'Automated routine reminders and reserved founder time for the customers needing judgement.',
        'Reviewed overdue cash movement at the end of each week.',
      ],
      result:
        'The disputed balances began moving and the same collections window produced more useful customer contact.',
      lesson:
        'Improvement came from removing the main blockage and focusing human effort, not attempting to optimise every process at once.',
    },
    measurementIntroduction:
      'Choose a few measures that show whether the targeted constraint is improving; they are management guidance, not promised product reporting.',
    measurements: [
      {
        metric: 'Overdue balance',
        guidance: 'Track whether the cash value already past due is reducing over comparable periods.',
      },
      {
        metric: 'Dispute backlog',
        guidance: 'Monitor the value and age of invoices still blocked by unresolved disputes.',
      },
      {
        metric: 'Time spent chasing',
        guidance: 'Compare human chasing time with the payment movement and information it produces.',
      },
    ],
    productBridge:
      'Broader improvement may involve invoicing, disputes and commercial terms. The product addresses the prioritisation component by combining accounting payment data with founder risk knowledge to direct scarce chasing attention.',
    ctaHeading: 'Continue this outcome-specific job',
    ctaDescription: 'Use CTA copy that follows the decision made in this guide.',
    ctaLabel: 'See plans and pricing',
    ctaHref: '/pricing',
    relatedSlugs: [],
    indexable: false,
    ...overrides,
  }
}

function processHowToFixture(overrides = {}) {
  return {
    slug: 'process-how-to-renderer-fixture',
    pageType: 'process-how-to',
    intentFamily: 'credit-control-process',
    funnelStage: 'solution-aware',
    primaryKeyword: 'small business credit control process fixture',
    secondaryKeywords: ['organise invoice chasing fixture'],
    searchIntent: 'informational',
    queryCluster: 'process-how-to-renderer-fixture',
    readerJob: 'Run a repeatable credit-control process with limited staff time.',
    uniqueAngle:
      'Test a record-controlled operating model without publishing a Hub D article.',
    metaTitle: 'Process How-to Renderer Fixture',
    metaDescription: 'Non-production fixture for the process-how-to renderer.',
    h1: 'Run a repeatable small-business credit-control process',
    directAnswer:
      'Use a short repeatable process that makes the next action, owner and follow-up point clear for every account needing attention. Systemise routine administration, then reserve human judgement for prioritisation, customer risk and escalation decisions.',
    sectionHeadings: {
      minimumProcess: 'The minimum process for this business',
      operatingRhythm: 'How the team runs it',
      automationAndJudgement: 'What to systemise and where judgement matters',
      workedExample: 'Worked operating example',
      failurePoints: 'Where this process can break down',
      productBridge: 'Focus limited attention on the right customers',
      relatedGuides: 'Continue improving the process',
    },
    processIntroduction:
      'Keep the workflow small enough to run consistently and make each stage produce a clear next action.',
    processStages: [
      {
        stage: 'Refresh the working information',
        guidance:
          'Bring invoices, payments, disputes and recorded customer commitments up to date before reviewing the workload.',
      },
      {
        stage: 'Select the accounts needing attention',
        guidance:
          'Separate routine follow-ups from accounts where value, payment behaviour or known risk needs a decision.',
      },
      {
        stage: 'Assign and complete the next action',
        guidance:
          'Give each selected account an owner and one specific contact, investigation or escalation action.',
      },
      {
        stage: 'Record the outcome and return point',
        guidance:
          'Capture what happened, any promise or dispute, and when the account should be reviewed again.',
      },
    ],
    operatingIntroduction:
      'Use cadence labels that match the work rather than forcing every process into fixed daily and weekly sections.',
    operatingRhythm: [
      {
        cadence: 'At the start of each chasing session',
        activity:
          'Refresh payment information and choose a short list of accounts for that session.',
        purpose:
          'Prevents time being spent on customers who have paid or on low-value routine work.',
      },
      {
        cadence: 'After meaningful customer contact',
        activity:
          'Record the response, owner, next action and any commitment with a return date.',
        purpose:
          'Makes the next review evidence-based and reduces reliance on memory.',
      },
      {
        cadence: 'When an exception persists',
        activity:
          'Review failed contact, broken commitments, disputes and growing exposure.',
        purpose:
          'Surfaces the accounts where normal follow-up may no longer be enough.',
      },
    ],
    automationAndJudgement: {
      introduction:
        'Systemise repeatable administration where practical, while keeping accountable human decisions around customer treatment.',
      routineWork: [
        {
          task: 'Refresh standard payment information',
          guidance:
            'Keep invoice and payment status current without requiring a founder to rebuild the list manually.',
        },
        {
          task: 'Schedule routine follow-up',
          guidance:
            'Use consistent return dates for ordinary reminders and recorded commitments.',
        },
      ],
      judgementWork: [
        {
          task: 'Choose who deserves attention first',
          guidance:
            'Interpret value, payment behaviour and credible business knowledge in context.',
        },
        {
          task: 'Decide when treatment should change',
          guidance:
            'Assess whether a dispute, deterioration or failed commitment requires different contact or escalation.',
        },
      ],
    },
    workedExample: {
      businessContext:
        'A twelve-person services business shares credit-control work between its office manager and founder.',
      previousApproach:
        'The office manager sent reminders from memory and brought difficult accounts to the founder only when they became urgent.',
      processIntroduced: [
        'Refreshed payment data before two scheduled chasing sessions each week.',
        'Assigned one next action and review date to every account selected for attention.',
        'Reserved a short founder review for deteriorating behaviour, disputes and escalation decisions.',
      ],
      operatingRhythm:
        'The office manager runs the routine sessions; the founder reviews only the documented exceptions at the end of the second session.',
      result:
        'Ownership became clearer, missed follow-ups reduced and the founder spent less time reconstructing account history.',
      lesson:
        'A lightweight operating rhythm works when routine administration is repeatable and judgement-heavy exceptions reach the right person with context.',
    },
    failurePoints: [
      {
        failure: 'Relying on memory',
        consequence:
          'Promises, disputes and next actions disappear between chasing sessions.',
        betterApproach:
          'Record the outcome and return date as part of completing each action.',
      },
      {
        failure: 'No clear owner',
        consequence:
          'Important accounts can be assumed to be somebody else’s responsibility.',
        betterApproach:
          'Assign one owner to the next action, even when another person may later escalate it.',
      },
      {
        failure: 'Treating every account alike',
        consequence:
          'Routine reminders consume the same attention as accounts needing investigation or judgement.',
        betterApproach:
          'Separate routine work from exceptions and prioritise human time using current evidence and customer context.',
      },
    ],
    productBridge:
      'Routine credit-control administration can often be systemised, but deciding where limited attention should go still requires context. The product addresses that prioritisation step by combining accounting payment data with founder-assigned customer risk; it does not replace the wider credit-control process.',
    ctaHeading: 'Continue this process-specific job',
    ctaDescription:
      'Use CTA copy that follows the process described in this guide.',
    ctaLabel: 'See plans and pricing',
    ctaHref: '/pricing',
    relatedSlugs: [],
    indexable: false,
    ...overrides,
  }
}

function softwareSolutionFixture(overrides = {}) {
  return {
    slug: 'software-solution-renderer-fixture',
    pageType: 'software-solution',
    intentFamily: 'xero',
    funnelStage: 'product-aware',
    primaryKeyword: 'accounting credit control software fixture',
    secondaryKeywords: ['credit control tooling fixture'],
    searchIntent: 'commercial',
    queryCluster: 'software-solution-renderer-fixture',
    readerJob:
      'Evaluate whether additional software is needed and which solution approach fits the credit-control problem.',
    uniqueAngle:
      'Test a platform-aware software-selection flow without publishing a Hub E article.',
    metaTitle: 'Software Solution Renderer Fixture',
    metaDescription: 'Non-production fixture for the software-solution renderer.',
    h1: 'Choose credit-control software around your accounting platform',
    directAnswer:
      'Additional software is useful when the existing accounting platform provides reliable receivables data but the business still struggles to organise action, automate suitable work or decide where limited attention should go. Choose the tool for that specific gap rather than assuming every overdue ledger needs another system.',
    sectionHeadings: {
      existingPlatform: 'Start with what the accounting platform already provides',
      additionalSoftware: 'Recognise when another layer becomes useful',
      selectionCriteria: 'Evaluate capabilities against the real problem',
      solutionApproaches: 'Compare categories of solution',
      productDifferentiation: 'How this prioritisation approach works',
      fit: 'Where the approach fits — and where it does not',
      relatedGuides: 'Continue evaluating credit-control options',
    },
    existingPlatformIntroduction:
      'Describe current platform capabilities from maintained article evidence so the page does not manufacture a software gap.',
    existingPlatformCapabilities: [
      {
        capability: 'Receivables source data',
        guidance:
          'The accounting platform remains the source for the invoice, balance and payment records used by the business.',
        context:
          'The article should verify the relevant platform behaviour when production content is written or updated.',
      },
      {
        capability: 'Existing collection features',
        guidance:
          'Credit-control tooling should be assessed alongside the relevant reporting, reminder or payment features already available.',
      },
    ],
    additionalSoftwareIntroduction:
      'An additional layer should earn its place by solving an operating constraint the current setup does not handle well enough.',
    additionalSoftwareTriggers: [
      {
        trigger: 'The overdue workload exceeds manual capacity',
        guidance:
          'Repeated preparation and follow-up consume time that should be reserved for useful customer action.',
      },
      {
        trigger: 'The next customer action is unclear',
        guidance:
          'The business has data but cannot consistently decide which overdue customer deserves attention first.',
      },
      {
        trigger: 'Customer context is fragmented',
        guidance:
          'Relevant risk knowledge sits outside the accounting evidence and is not available when priorities are set.',
      },
    ],
    selectionIntroduction:
      'Select only the criteria that matter to the reader’s actual constraint; this is not a universal software checklist.',
    selectionCriteria: [
      {
        criterion: 'Reliable accounting-data connection',
        whyItMatters:
          'The solution should use current source information without creating another ledger to reconcile manually.',
      },
      {
        criterion: 'Customer-level prioritisation',
        whyItMatters:
          'The business needs to distinguish accounts requiring judgement from routine overdue work.',
      },
      {
        criterion: 'Proportionate operating complexity',
        whyItMatters:
          'A small team should be able to operate the chosen approach without recreating an enterprise collections function.',
      },
    ],
    approachesIntroduction:
      'Different solution categories address different gaps, so compare their intended job before comparing individual products.',
    solutionApproaches: [
      {
        approach: 'Use the accounting platform alone',
        bestFor:
          'A manageable overdue position where current platform features and a simple internal routine provide enough control.',
        limitation:
          'It may not solve a separate prioritisation or cross-team workflow problem if that is the real constraint.',
      },
      {
        approach: 'Add routine chasing automation',
        bestFor:
          'A business whose main need is consistent handling of repeatable, low-judgement follow-up.',
        limitation:
          'More messages do not by themselves decide which customer deserves scarce human attention.',
      },
      {
        approach: 'Add prioritisation and workflow support',
        bestFor:
          'A business with competing overdue accounts, limited capacity and customer decisions that need context.',
      },
    ],
    productDifferentiation: {
      introduction:
        'The fixture represents a focused prioritisation layer rather than a replacement accounting or full credit-control system.',
      inputs: [
        {
          source: 'Accounting signals',
          contribution:
            'Supply current balances, payment timing and other maintained ledger evidence.',
        },
        {
          source: 'Founder-assigned customer risk',
          contribution:
            'Adds credible business context that the accounting record cannot contain by itself.',
        },
      ],
      outcome: 'A ranked overdue-customer attention queue for human review.',
    },
    fitIntroduction:
      'State practical fit limits so the reader can reject the approach when a different problem or service is primary.',
    goodFit: [
      {
        situation: 'A meaningful overdue customer workload',
        guidance:
          'Prioritisation has value when several customer accounts compete for limited human attention.',
      },
      {
        situation: 'A small team with relevant customer knowledge',
        guidance:
          'The business can add accountable risk context without needing a sophisticated collections department.',
      },
    ],
    poorFit: [
      {
        situation: 'Almost no overdue debt',
        guidance:
          'Another prioritisation layer may add more operating cost than value.',
      },
      {
        situation: 'The primary need is formal debt recovery',
        guidance:
          'Use an appropriately qualified service or recovery solution for that distinct requirement.',
      },
    ],
    productBridge:
      'This approach helps decide which overdue customers deserve attention first. It does not replace the accounting platform, resolve disputes, send every reminder or replace the wider credit-control process.',
    ctaHeading: 'See whether focused customer prioritisation fits your process',
    ctaDescription:
      'Review the product scope and plans without assuming it replaces your accounting or credit-control systems.',
    ctaLabel: 'See plans and pricing',
    ctaHref: '/pricing',
    relatedSlugs: [],
    indexable: false,
    ...overrides,
  }
}

function articleBodyWordCount(page) {
  const joinText = (parts) =>
    parts
      .flat(Infinity)
      .filter((part) => typeof part === 'string')
      .join(' ')

  let articleText
  if (page.pageType === 'customer-risk-scenario') {
    articleText = joinText([
      page.directAnswer,
      page.diagnosis.introduction,
      page.diagnosis.explanations.flatMap((explanation) => [
        explanation.possibility,
        explanation.evidenceToCheck,
      ]),
      page.riskAssessment.introduction,
      page.riskAssessment.factors.flatMap((factor) => [
        factor.label,
        factor.evidence,
        factor.interpretation,
      ]),
      page.riskAssessment.conclusion,
      Object.values(page.workedScenario),
      page.recommendedActions,
      page.productBridge,
    ])
  } else if (page.pageType === 'outcome-improvement') {
    articleText = joinText([
      page.directAnswer,
      page.driverIntroduction,
      page.drivers.flatMap((driver) => [driver.label, driver.explanation]),
      page.focusIntroduction,
      page.focusAreas.flatMap((focusArea) => [
        focusArea.area,
        focusArea.evidenceToCheck,
        focusArea.whenToPrioritise,
      ]),
      page.improvementPlan,
      Object.values(page.workedExample),
      page.measurementIntroduction,
      page.measurements.flatMap((measurement) => [
        measurement.metric,
        measurement.guidance,
      ]),
      page.productBridge,
    ])
  } else if (page.pageType === 'process-how-to') {
    articleText = joinText([
      page.directAnswer,
      page.processIntroduction,
      page.processStages.flatMap((stage) => [stage.stage, stage.guidance]),
      page.operatingIntroduction,
      page.operatingRhythm.flatMap((item) => [
        item.cadence,
        item.activity,
        item.purpose,
      ]),
      page.automationAndJudgement.introduction,
      page.automationAndJudgement.routineWork.flatMap((item) => [
        item.task,
        item.guidance,
      ]),
      page.automationAndJudgement.judgementWork.flatMap((item) => [
        item.task,
        item.guidance,
      ]),
      Object.values(page.workedExample),
      page.failurePoints.flatMap((point) => [
        point.failure,
        point.consequence,
        point.betterApproach,
      ]),
      page.productBridge,
    ])
  } else if (page.pageType === 'software-solution') {
    articleText = joinText([
      page.directAnswer,
      page.existingPlatformIntroduction,
      page.existingPlatformCapabilities.flatMap((item) => [
        item.capability,
        item.guidance,
        item.context,
      ]),
      page.additionalSoftwareIntroduction,
      page.additionalSoftwareTriggers.flatMap((item) => [
        item.trigger,
        item.guidance,
      ]),
      page.selectionIntroduction,
      page.selectionCriteria.flatMap((item) => [
        item.criterion,
        item.whyItMatters,
      ]),
      page.approachesIntroduction,
      page.solutionApproaches.flatMap((item) => [
        item.approach,
        item.bestFor,
        item.limitation,
      ]),
      page.productDifferentiation.introduction,
      page.productDifferentiation.inputs.flatMap((item) => [
        item.source,
        item.contribution,
      ]),
      page.productDifferentiation.outcome,
      page.productBridge,
      page.fitIntroduction,
      page.goodFit.flatMap((item) => [item.situation, item.guidance]),
      page.poorFit.flatMap((item) => [item.situation, item.guidance]),
      page.ctaHeading,
      page.ctaDescription,
    ])
  } else {
    const workedExample = page.workedExample
    const workedText =
      'customers' in workedExample
        ? [
            workedExample.introduction,
            workedExample.customers.flatMap((customer) => [
              customer.name,
              customer.founderRiskReason,
              customer.rankReason,
            ]),
            workedExample.conclusion,
          ]
        : Object.values(workedExample)

    articleText = joinText([
      page.directAnswer,
      page.whyItMatters,
      page.signalIntroduction,
      page.signals.flatMap((signal) => [signal.label, signal.explanation]),
      page.decisionRules,
      workedText,
      page.recommendedActions,
      page.productBridge,
    ])
  }

  return articleText.trim().split(/\s+/).filter(Boolean).length
}

test('accepts distinct indexable query clusters', () => {
  assert.doesNotThrow(() =>
    validateSeoProblemPages([
      governancePage(),
      governancePage({
        slug: 'second-guide',
        queryCluster: 'second-query-cluster',
        readerJob: 'Make a different decision.',
        uniqueAngle: 'Explain a different decision using evidence.',
      }),
    ])
  )
})

test('rejects two indexable pages in the same query cluster', () => {
  assert.throws(
    () =>
      validateSeoProblemPages([
        governancePage(),
        governancePage({
          slug: 'overlapping-guide',
          readerJob: 'Make a different decision.',
          uniqueAngle: 'Explain a different decision using evidence.',
        }),
      ]),
    /Duplicate indexable SEO query cluster/
  )
})

test('rejects duplicate reader jobs or unique angles within one intent family', () => {
  assert.throws(
    () =>
      validateSeoProblemPages([
        governancePage(),
        governancePage({
          slug: 'same-job-guide',
          queryCluster: 'different-cluster',
          uniqueAngle: 'A genuinely different angle.',
        }),
      ]),
    /Duplicate indexable SEO reader job/
  )

  assert.throws(
    () =>
      validateSeoProblemPages([
        governancePage(),
        governancePage({
          slug: 'same-angle-guide',
          queryCluster: 'different-cluster',
          readerJob: 'Make a genuinely different decision.',
        }),
      ]),
    /Duplicate indexable SEO unique angle/
  )
})

test('rejects missing intent-governance fields', () => {
  assert.throws(
    () => validateSeoProblemPages([governancePage({ uniqueAngle: '  ' })]),
    /governance fields must not be empty/
  )

  assert.throws(
    () => validateSeoProblemPages([governancePage({ intentFamily: undefined })]),
    /governance fields must not be empty/
  )
  assert.throws(
    () => validateSeoProblemPages([governancePage({ funnelStage: undefined })]),
    /governance fields must not be empty/
  )
  assert.throws(
    () => validateSeoProblemPages([governancePage({ pageType: 'unknown' })]),
    /governance fields must not be empty/
  )
})

test('exposes the five credit-control topic hubs in the intended order', () => {
  const categories = getAllSeoGuideCategories()

  assert.deepEqual(
    categories.map((category) => category.slug),
    [
      'prioritising-overdue-invoices',
      'get-paid-faster',
      'late-paying-customers-and-risk',
      'credit-control-process',
      'xero-credit-control',
    ]
  )
})

test('assigns every indexable guide to one of the topic hubs', () => {
  const categories = getAllSeoGuideCategories()
  const categoryIntentFamilies = new Set(
    categories.map((category) => category.intentFamily)
  )
  const guides = getAllIndexableSeoProblemPages()

  for (const guide of guides) {
    assert.equal(categoryIntentFamilies.has(guide.intentFamily), true)
    assert.equal(getSeoGuideCategoryByIntentFamily(guide.intentFamily) !== null, true)
    assert.equal(
      getIndexableSeoProblemPagesByIntentFamily(guide.intentFamily).some(
        (familyGuide) => familyGuide.slug === guide.slug
      ),
      true
    )
    assert.equal(typeof guide.funnelStage, 'string')
  }
})

test('publishes Hub C with both approved content shapes', () => {
  const scenario = customerRiskScenarioFixture()
  const hubCGuides = getIndexableSeoProblemPagesByIntentFamily('customer-risk')

  assert.equal(hubCGuides.length, 11)
  assert.equal(
    hubCGuides.filter(
      (guide) => guide.pageType === 'customer-risk-scenario'
    ).length,
    5
  )
  assert.equal(
    hubCGuides.filter((guide) => guide.pageType === 'problem-outcome').length,
    6
  )
  assert.doesNotThrow(() => validateSeoProblemPages([scenario]))
  assert.doesNotThrow(() => validateCustomerRiskScenarioPages([scenario]))

  assert.throws(
    () =>
      validateCustomerRiskScenarioPages([
        {
          ...scenario,
          riskAssessment: { ...scenario.riskAssessment, factors: [] },
        },
      ]),
    /must have one to six distinct assessment factors/
  )

  assert.throws(
    () =>
      validateCustomerRiskScenarioPages([
        { ...scenario, recommendedActions: scenario.recommendedActions.slice(0, 2) },
      ]),
    /must have three to five recommended actions/
  )
})

test('publishes Hub B with the two approved content shapes it needs', () => {
  const outcomePage = outcomeImprovementFixture()
  const hubBGuides = getIndexableSeoProblemPagesByIntentFamily('cash-outcome')

  assert.equal(hubBGuides.length, 7)
  assert.equal(hubBGuides[0].slug, 'how-to-get-cash-in-faster-from-overdue-customers')
  assert.equal(hubBGuides[0].pageType, 'problem-outcome')
  assert.equal(
    hubBGuides.filter(
      (guide) => guide.pageType === 'outcome-improvement'
    ).length,
    4
  )
  assert.equal(
    hubBGuides.filter((guide) => guide.pageType === 'problem-outcome').length,
    3
  )
  assert.doesNotThrow(() => validateSeoProblemPages([outcomePage]))
  assert.doesNotThrow(() => validateOutcomeImprovementPages([outcomePage]))
})

test('validates outcome-improvement drivers, focus, plan, example and measures', () => {
  const outcomePage = outcomeImprovementFixture()

  assert.throws(
    () =>
      validateOutcomeImprovementPages([
        { ...outcomePage, drivers: outcomePage.drivers.slice(0, 1) },
      ]),
    /must have two to seven distinct outcome drivers/
  )
  assert.throws(
    () => validateOutcomeImprovementPages([{ ...outcomePage, focusAreas: [] }]),
    /must have one to five complete focus areas/
  )
  assert.throws(
    () =>
      validateOutcomeImprovementPages([
        { ...outcomePage, improvementPlan: outcomePage.improvementPlan.slice(0, 3) },
      ]),
    /must have four to six distinct plan steps/
  )
  assert.throws(
    () =>
      validateOutcomeImprovementPages([
        {
          ...outcomePage,
          workedExample: { ...outcomePage.workedExample, primaryConstraint: ' ' },
        },
      ]),
    /must contain a complete worked business example/
  )
  assert.throws(
    () =>
      validateOutcomeImprovementPages([
        { ...outcomePage, measurements: outcomePage.measurements.slice(0, 1) },
      ]),
    /must have two to five distinct measurements/
  )
  assert.throws(
    () =>
      validateOutcomeImprovementPages([
        { ...outcomePage, intentFamily: 'prioritisation' },
      ]),
    /fields must not be empty/
  )
  assert.throws(
    () => validateOutcomeImprovementPages([{ ...outcomePage, ctaHeading: ' ' }]),
    /fields must not be empty/
  )
})

test('publishes Hub D with its three approved content shapes and preserves hub counts', () => {
  const processPage = processHowToFixture()
  const hubDOutcomeFixture = outcomeImprovementFixture({
    slug: 'credit-control-outcome-fixture',
    intentFamily: 'credit-control-process',
    queryCluster: 'credit-control-outcome-fixture',
    readerJob: 'Improve one operational outcome within a credit-control process.',
    uniqueAngle: 'Exercise outcome improvement inside Hub D without publishing it.',
  })
  const hubDGuides = getIndexableSeoProblemPagesByIntentFamily(
    'credit-control-process'
  )

  assert.equal(hubDGuides.length, 10)
  assert.equal(getIndexableSeoProblemPagesByIntentFamily('prioritisation').length, 8)
  assert.equal(getIndexableSeoProblemPagesByIntentFamily('cash-outcome').length, 7)
  assert.equal(getIndexableSeoProblemPagesByIntentFamily('customer-risk').length, 11)
  assert.equal(getIndexableSeoProblemPagesByIntentFamily('xero').length, 5)
  assert.equal(getAllIndexableSeoProblemPages().length, 41)
  assert.equal(
    hubDGuides.filter(
      (guide) => guide.pageType === 'process-how-to'
    ).length,
    5
  )
  assert.equal(
    hubDGuides.filter((guide) => guide.pageType === 'problem-outcome').length,
    4
  )
  assert.equal(
    hubDGuides.filter((guide) => guide.pageType === 'outcome-improvement').length,
    1
  )
  assert.doesNotThrow(() => validateSeoProblemPages([processPage]))
  assert.doesNotThrow(() => validateProcessHowToPages([processPage]))
  assert.doesNotThrow(() => validateSeoProblemPages([hubDOutcomeFixture]))
  assert.doesNotThrow(() => validateOutcomeImprovementPages([hubDOutcomeFixture]))
  assert.equal(getRelatedSeoProblemPages(processPage).length, 2)
  assert.equal(
    getRelatedSeoProblemPages(processPage).every(
      (guide) => guide.intentFamily === 'credit-control-process'
    ),
    true
  )
})

test('validates each required part of a process-how-to guide', () => {
  const processPage = processHowToFixture()

  assert.throws(
    () =>
      validateProcessHowToPages([
        { ...processPage, processStages: processPage.processStages.slice(0, 2) },
      ]),
    /must have three to eight distinct process stages/
  )
  assert.throws(
    () => validateProcessHowToPages([{ ...processPage, operatingRhythm: [] }]),
    /must have one to six complete operating-rhythm items/
  )
  assert.throws(
    () =>
      validateProcessHowToPages([
        {
          ...processPage,
          automationAndJudgement: {
            ...processPage.automationAndJudgement,
            routineWork: [],
          },
        },
      ]),
    /must have one to six distinct routine-work items/
  )
  assert.throws(
    () =>
      validateProcessHowToPages([
        {
          ...processPage,
          automationAndJudgement: {
            ...processPage.automationAndJudgement,
            judgementWork: [],
          },
        },
      ]),
    /must have one to six distinct judgement-work items/
  )
  assert.throws(
    () =>
      validateProcessHowToPages([
        {
          ...processPage,
          workedExample: {
            ...processPage.workedExample,
            operatingRhythm: ' ',
          },
        },
      ]),
    /must contain a complete worked process example/
  )
  assert.throws(
    () =>
      validateProcessHowToPages([
        { ...processPage, failurePoints: processPage.failurePoints.slice(0, 2) },
      ]),
    /must have three to five distinct failure points/
  )
  assert.throws(
    () => validateProcessHowToPages([{ ...processPage, ctaDescription: ' ' }]),
    /fields must not be empty/
  )
  assert.throws(
    () =>
      validateProcessHowToPages([
        { ...processPage, intentFamily: 'cash-outcome' },
      ]),
    /fields must not be empty/
  )
  assert.doesNotThrow(() =>
    validateProcessHowToPages([
      {
        ...processPage,
        intentFamily: 'xero',
        slug: 'xero-process-fixture',
        queryCluster: 'xero-process-fixture',
        readerJob: 'Run a Xero-specific process fixture.',
        uniqueAngle: 'Exercise the approved process shape for the Xero family.',
      },
    ])
  )
})

test('publishes one Hub E software-solution while keeping its fixture non-production', () => {
  const softwarePage = softwareSolutionFixture()
  const hubESoftwarePages = getIndexableSeoProblemPagesByIntentFamily('xero').filter(
    (guide) => guide.pageType === 'software-solution'
  )

  assert.equal(softwarePage.funnelStage, 'product-aware')
  assert.equal(softwarePage.intentFamily, 'xero')
  assert.equal('workedExample' in softwarePage, false)
  assert.doesNotThrow(() => validateSeoProblemPages([softwarePage]))
  assert.doesNotThrow(() => validateSoftwareSolutionPages([softwarePage]))
  assert.equal(getIndexableSeoProblemPagesByIntentFamily('xero').length, 5)
  assert.deepEqual(
    hubESoftwarePages.map((guide) => guide.slug),
    ['xero-credit-control-software']
  )
  assert.equal(getSeoProblemPageBySlug(softwarePage.slug), null)
  assert.equal(
    getRelatedSeoProblemPages(softwarePage).every(
      (guide) => guide.intentFamily === 'xero'
    ),
    true
  )
})

test('validates each required part of a software-solution guide', () => {
  const softwarePage = softwareSolutionFixture()

  assert.throws(
    () =>
      validateSoftwareSolutionPages([
        { ...softwarePage, existingPlatformCapabilities: [] },
      ]),
    /must have one to eight distinct existing-platform capabilities/
  )
  assert.throws(
    () =>
      validateSoftwareSolutionPages([
        {
          ...softwarePage,
          additionalSoftwareTriggers: softwarePage.additionalSoftwareTriggers.slice(
            0,
            1
          ),
        },
      ]),
    /must have two to eight distinct additional-software triggers/
  )
  assert.throws(
    () =>
      validateSoftwareSolutionPages([
        {
          ...softwarePage,
          selectionCriteria: softwarePage.selectionCriteria.slice(0, 1),
        },
      ]),
    /must have two to eight distinct selection criteria/
  )
  assert.throws(
    () =>
      validateSoftwareSolutionPages([
        {
          ...softwarePage,
          solutionApproaches: softwarePage.solutionApproaches.slice(0, 1),
        },
      ]),
    /must have two to six distinct solution approaches/
  )
  assert.throws(
    () =>
      validateSoftwareSolutionPages([
        {
          ...softwarePage,
          productDifferentiation: {
            ...softwarePage.productDifferentiation,
            inputs: softwarePage.productDifferentiation.inputs.slice(0, 1),
          },
        },
      ]),
    /must have two to four distinct positioning inputs/
  )
  assert.throws(
    () => validateSoftwareSolutionPages([{ ...softwarePage, goodFit: [] }]),
    /must have one to six distinct good-fit situations/
  )
  assert.throws(
    () => validateSoftwareSolutionPages([{ ...softwarePage, poorFit: [] }]),
    /must have one to six distinct poorer-fit situations/
  )
  assert.throws(
    () =>
      validateSoftwareSolutionPages([
        { ...softwarePage, productBridge: ' ' },
      ]),
    /fields must not be empty/
  )
  assert.throws(
    () =>
      validateSoftwareSolutionPages([
        { ...softwarePage, ctaDescription: ' ' },
      ]),
    /fields must not be empty/
  )
  assert.throws(
    () =>
      validateSoftwareSolutionPages([
        { ...softwarePage, intentFamily: 'credit-control-process' },
      ]),
    /fields must not be empty/
  )
})

test('allows Hub C problem-outcome guides to use selective signals and one customer over time', () => {
  const methodGuide = getSeoProblemPageBySlug('how-to-prioritise-overdue-invoices')
  const scenario = customerRiskScenarioFixture()

  assert.ok(methodGuide)

  const futureFrameworkFixture = {
    ...methodGuide,
    slug: 'customer-risk-framework-fixture',
    intentFamily: 'customer-risk',
    queryCluster: 'customer-risk-framework-fixture',
    readerJob: 'Understand how one customer’s payment behaviour is changing.',
    uniqueAngle: 'Use only the evidence relevant to a longitudinal risk assessment.',
    signals: [
      {
        key: 'change-from-normal',
        label: 'Change from normal behaviour',
        explanation: 'Compare the current delay with this customer’s own payment baseline.',
      },
      {
        key: 'broken-promise',
        label: 'Broken promise',
        explanation: 'Treat a missed commitment as relevant context rather than a universal score.',
      },
    ],
    workedExample: scenario.workedScenario,
    relatedSlugs: [],
    indexable: false,
  }

  assert.doesNotThrow(() => validateSeoProblemPageContent([futureFrameworkFixture]))
})

test('renders a customer-risk scenario fixture and dispatches the new page type', async () => {
  const scenario = customerRiskScenarioFixture()
  const html = renderToStaticMarkup(
    React.createElement(CustomerRiskScenarioGuide, {
      page: scenario,
      category: {
        intentFamily: 'customer-risk',
        slug: 'late-paying-customers-and-risk',
        title: 'Late-paying customers and risk',
        shortDescription: 'Assess changes in customer payment behaviour.',
        description: 'Use accounting evidence and customer context together.',
        topics: ['Payment behaviour changes'],
      },
      relatedPages: [],
    })
  )

  assert.match(html, /Customer payment pattern changed/)
  assert.match(html, /What the change might mean/)
  assert.match(html, /Evidence to check:/)
  assert.match(html, /How concerned should you be\?/)
  assert.match(html, /Further supply exposure/)
  assert.match(html, /Normal payment behaviour/)
  assert.match(html, /Customer context/)
  assert.match(html, /Recommended next action/)
  assert.match(html, /Reassess customer risk and further exposure/)
  assert.match(html, /Continue this customer-risk decision/)
  assert.match(html, /Use CTA copy that follows the specific decision/)
  assert.match(html, /href="\/blog#late-paying-customers-and-risk"/)

  const routeSource = await readFile(GUIDE_ROUTE_PATH, 'utf8')
  assert.match(routeSource, /case 'customer-risk-scenario'/)
  assert.match(routeSource, /<CustomerRiskScenarioGuide/)
})

test('renders a non-production outcome-improvement fixture and dispatches it', async () => {
  const outcomePage = outcomeImprovementFixture({
    ctaHeading: 'Continue this outcome-specific job',
    ctaDescription: 'Use CTA copy that follows the decision made in this guide.',
  })
  const html = renderToStaticMarkup(
    React.createElement(OutcomeImprovementGuide, {
      page: outcomePage,
      category: {
        intentFamily: 'cash-outcome',
        slug: 'get-paid-faster',
        title: 'Get paid faster',
        shortDescription: 'Improve customer cash collection.',
        description: 'Improve the constraints that delay customer cash.',
        topics: ['Cash collection improvement'],
      },
      relatedPages: [],
    })
  )

  assert.match(html, /Improve a broader receivables outcome/)
  assert.match(html, /What drives this outcome/)
  assert.match(html, /Invoice accuracy and timeliness/)
  assert.match(html, /Where to focus first/)
  assert.match(html, /Focus here when/)
  assert.match(html, /A practical improvement plan/)
  assert.match(html, /Worked business example/)
  assert.match(html, /Starting position/)
  assert.match(html, /Main constraint/)
  assert.match(html, /Changes made/)
  assert.match(html, /Takeaway/)
  assert.match(html, /What to measure/)
  assert.match(html, /Time spent chasing/)
  assert.match(html, /management guidance, not promised product reporting/)
  assert.match(html, /prioritisation component/)
  assert.match(html, /Continue this outcome-specific job/)
  assert.match(html, /Use CTA copy that follows the decision made in this guide/)
  assert.match(html, /href="\/blog#get-paid-faster"/)

  const routeSource = await readFile(GUIDE_ROUTE_PATH, 'utf8')
  assert.match(routeSource, /case 'outcome-improvement'/)
  assert.match(routeSource, /<OutcomeImprovementGuide/)
})

test('renders a non-production process-how-to fixture and dispatches it', async () => {
  const processPage = processHowToFixture()
  const html = renderToStaticMarkup(
    React.createElement(ProcessHowToGuide, {
      page: processPage,
      category: {
        intentFamily: 'credit-control-process',
        slug: 'credit-control-process',
        title: 'Credit control for small businesses',
        shortDescription: 'Build a repeatable credit-control process.',
        description: 'Run credit control consistently with limited staff time.',
        topics: ['Small-business credit control process'],
      },
      relatedPages: [],
    })
  )

  assert.match(html, /Run a repeatable small-business credit-control process/)
  assert.match(html, /The minimum process for this business/)
  assert.match(html, /Refresh the working information/)
  assert.match(html, /How the team runs it/)
  assert.match(html, /At the start of each chasing session/)
  assert.match(html, /What to systemise and where judgement matters/)
  assert.match(html, /Routine work/)
  assert.match(html, /Work that needs judgement/)
  assert.match(html, /Worked operating example/)
  assert.match(html, /Previous approach/)
  assert.match(html, /Process introduced/)
  assert.match(html, /How it is run/)
  assert.match(html, /Operational result/)
  assert.match(html, /Where this process can break down/)
  assert.match(html, /Relying on memory/)
  assert.match(html, /prioritisation step/)
  assert.match(html, /does not replace the wider credit-control process/)
  assert.match(html, /Continue this process-specific job/)
  assert.match(html, /Use CTA copy that follows the process described in this guide/)
  assert.match(html, /href="\/blog#credit-control-process"/)

  const routeSource = await readFile(GUIDE_ROUTE_PATH, 'utf8')
  assert.match(routeSource, /case 'process-how-to'/)
  assert.match(routeSource, /<ProcessHowToGuide/)
})

test('renders a non-production software-solution fixture and dispatches it', async () => {
  const softwarePage = softwareSolutionFixture()
  const html = renderToStaticMarkup(
    React.createElement(SoftwareSolutionGuide, {
      page: softwarePage,
      category: {
        intentFamily: 'xero',
        slug: 'xero-credit-control',
        title: 'Xero credit control',
        shortDescription: 'Use accounting data in a focused credit-control process.',
        description: 'Evaluate software around the existing accounting platform.',
        topics: ['Software selection'],
      },
      relatedPages: [],
    })
  )

  assert.match(html, /Choose credit-control software around your accounting platform/)
  assert.match(html, /Start with what the accounting platform already provides/)
  assert.match(html, /Receivables source data/)
  assert.match(html, /Context:/)
  assert.match(html, /Recognise when another layer becomes useful/)
  assert.match(html, /The next customer action is unclear/)
  assert.match(html, /Evaluate capabilities against the real problem/)
  assert.match(html, /Reliable accounting-data connection/)
  assert.match(html, /Compare categories of solution/)
  assert.match(html, /Add routine chasing automation/)
  assert.match(html, /Best suited to/)
  assert.match(html, /Consider/)
  assert.match(html, /How this prioritisation approach works/)
  assert.match(html, /Accounting signals/)
  assert.match(html, /Founder-assigned customer risk/)
  assert.match(html, /A ranked overdue-customer attention queue/)
  assert.match(html, /does not replace the accounting platform/)
  assert.match(html, /Good fit/)
  assert.match(html, /Poorer fit/)
  assert.match(html, /See whether focused customer prioritisation fits your process/)
  assert.match(html, /href="\/blog#xero-credit-control"/)
  assert.doesNotMatch(html, /Worked example/)
  assert.doesNotMatch(html, /software-solution-renderer-fixture/)

  const routeSource = await readFile(GUIDE_ROUTE_PATH, 'utf8')
  assert.match(routeSource, /case 'software-solution'/)
  assert.match(routeSource, /<SoftwareSolutionGuide/)
})

test('rejects duplicate or incomplete topic hubs', () => {
  const category = {
    intentFamily: 'prioritisation',
    slug: 'prioritising-overdue-invoices',
    title: 'Prioritising overdue invoices',
    shortDescription: 'Choose what to chase first.',
    description: 'Build a ranked order for overdue customer action.',
    topics: ['Customer-level ranking'],
  }

  assert.throws(
    () => validateSeoGuideCategories([category, category]),
    /Duplicate SEO guide category slug/
  )
  assert.throws(
    () => validateSeoGuideCategories([{ ...category, topics: [] }]),
    /category fields must not be empty/
  )
  assert.throws(
    () =>
      validateSeoGuideCategories([
        category,
        { ...category, slug: 'get-paid-faster' },
      ]),
    /Duplicate SEO guide intent family/
  )
})

test('keeps the intended guide URLs and assigns all five governance fields', () => {
  const guides = getAllIndexableSeoProblemPages()

  assert.deepEqual(
    guides.map((guide) => guide.slug),
    [
      'how-to-prioritise-overdue-invoices',
      'which-customer-should-i-chase-first-for-payment',
      'how-to-prioritise-multiple-overdue-customers',
      'should-i-chase-the-largest-invoice-first',
      'should-i-chase-the-oldest-invoice-first',
      'how-to-create-a-daily-credit-control-priority-list',
      'how-to-prioritise-debtors-by-risk',
      'how-to-prioritise-invoice-chasing-when-you-only-have-an-hour',
      'how-to-get-cash-in-faster-from-overdue-customers',
      'how-to-improve-cash-collection',
      'how-to-reduce-debtor-days',
      'how-to-reduce-overdue-debt',
      'how-to-speed-up-customer-payments',
      'how-to-improve-accounts-receivable-for-a-small-business',
      'how-to-release-cash-tied-up-in-accounts-receivable',
      'what-to-do-about-customers-who-always-pay-late',
      'how-to-identify-risky-customers-from-payment-behaviour',
      'customer-suddenly-taking-longer-to-pay',
      'customer-hasnt-paid-for-60-days',
      'customer-hasnt-paid-for-90-days',
      'customer-promised-to-pay-but-hasnt',
      'how-to-spot-deteriorating-customer-payment-behaviour',
      'should-i-keep-supplying-a-customer-who-pays-late',
      'one-customer-owes-me-a-large-amount-of-money',
      'when-should-i-escalate-an-overdue-invoice',
      'how-payment-history-should-affect-invoice-chasing',
      'how-to-do-credit-control-for-a-small-business',
      'how-to-manage-overdue-invoices-efficiently',
      'how-to-organise-invoice-chasing',
      'how-to-create-a-credit-control-process',
      'how-to-manage-credit-control-without-a-credit-controller',
      'too-many-overdue-invoices-where-do-i-start',
      'how-much-time-should-a-small-business-spend-chasing-invoices',
      'how-to-stay-on-top-of-customer-payments',
      'how-to-make-invoice-chasing-less-time-consuming',
      'how-often-should-you-chase-overdue-invoices',
      'how-to-prioritise-overdue-invoices-in-xero',
      'xero-credit-control',
      'xero-invoice-chasing',
      'how-to-manage-overdue-customers-in-xero',
      'xero-credit-control-software',
    ]
  )

  for (const guide of guides) {
    assert.equal(
      [
        guide.queryCluster,
        guide.readerJob,
        guide.uniqueAngle,
        guide.intentFamily,
        guide.funnelStage,
      ].every((value) => typeof value === 'string' && value.trim().length > 0),
      true
    )
  }
})

test('separates the prioritisation method from the immediate next-chase decision', () => {
  const methodGuide = getSeoProblemPageBySlug('how-to-prioritise-overdue-invoices')
  const nextChaseGuide = getSeoProblemPageBySlug(
    'which-customer-should-i-chase-first-for-payment'
  )

  assert.ok(methodGuide)
  assert.ok(nextChaseGuide)
  assert.equal(methodGuide.intentFamily, 'prioritisation')
  assert.equal(nextChaseGuide.intentFamily, 'prioritisation')
  assert.equal(methodGuide.funnelStage, 'solution-aware')
  assert.equal(nextChaseGuide.funnelStage, 'problem-aware')
  assert.notEqual(methodGuide.queryCluster, nextChaseGuide.queryCluster)
  assert.notEqual(methodGuide.readerJob, nextChaseGuide.readerJob)
  assert.notEqual(methodGuide.uniqueAngle, nextChaseGuide.uniqueAngle)
  assert.notEqual(
    methodGuide.sectionHeadings.decisionRules,
    nextChaseGuide.sectionHeadings.decisionRules
  )
  assert.notDeepEqual(
    methodGuide.signals.map((signal) => signal.explanation),
    nextChaseGuide.signals.map((signal) => signal.explanation)
  )
  assert.notDeepEqual(methodGuide.recommendedActions, nextChaseGuide.recommendedActions)
  assert.equal(
    methodGuide.secondaryKeywords.includes(nextChaseGuide.primaryKeyword),
    false
  )
  assert.equal(
    getRelatedSeoProblemPages(methodGuide).some(
      (guide) => guide.slug === nextChaseGuide.slug
    ),
    true
  )
  assert.equal(
    getRelatedSeoProblemPages(nextChaseGuide).some(
      (guide) => guide.slug === methodGuide.slug
    ),
    true
  )
})

test('keeps Hub A flat with the eight approved article records', () => {
  assert.deepEqual(
    getIndexableSeoProblemPagesByIntentFamily('prioritisation').map(
      (guide) => guide.slug
    ),
    [
      'how-to-prioritise-overdue-invoices',
      'which-customer-should-i-chase-first-for-payment',
      'how-to-prioritise-multiple-overdue-customers',
      'should-i-chase-the-largest-invoice-first',
      'should-i-chase-the-oldest-invoice-first',
      'how-to-create-a-daily-credit-control-priority-list',
      'how-to-prioritise-debtors-by-risk',
      'how-to-prioritise-invoice-chasing-when-you-only-have-an-hour',
    ]
  )
})

test('keeps all eight Hub A targeting and article treatments distinct', () => {
  const guides = getIndexableSeoProblemPagesByIntentFamily('prioritisation')
  const uniqueValues = (values) => new Set(values).size === guides.length

  assert.equal(guides.length, 8)
  assert.equal(uniqueValues(guides.map((guide) => guide.primaryKeyword.toLowerCase())), true)
  assert.equal(uniqueValues(guides.map((guide) => guide.queryCluster.toLowerCase())), true)
  assert.equal(uniqueValues(guides.map((guide) => guide.readerJob.toLowerCase())), true)
  assert.equal(uniqueValues(guides.map((guide) => guide.uniqueAngle.toLowerCase())), true)
  assert.equal(uniqueValues(guides.map((guide) => guide.directAnswer.toLowerCase())), true)
  assert.equal(
    uniqueValues(
      guides.map((guide) => guide.sectionHeadings.decisionRules.toLowerCase())
    ),
    true
  )
  assert.equal(
    uniqueValues(
      guides.map((guide) => guide.workedExample.introduction.toLowerCase())
    ),
    true
  )
  assert.equal(
    uniqueValues(
      guides.map((guide) => guide.recommendedActions.join('|').toLowerCase())
    ),
    true
  )
  assert.equal(uniqueValues(guides.map((guide) => guide.ctaHeading.toLowerCase())), true)
  assert.equal(
    uniqueValues(guides.map((guide) => guide.ctaDescription.toLowerCase())),
    true
  )

  const largestFirst = getSeoProblemPageBySlug(
    'should-i-chase-the-largest-invoice-first'
  )
  const oldestFirst = getSeoProblemPageBySlug('should-i-chase-the-oldest-invoice-first')
  assert.ok(largestFirst)
  assert.ok(oldestFirst)
  assert.equal(largestFirst.directAnswer.startsWith('No, not automatically.'), true)
  assert.equal(oldestFirst.directAnswer.startsWith('No, not automatically.'), true)

  for (const guide of guides) {
    assert.equal(guide.relatedSlugs.length > 0 && guide.relatedSlugs.length <= 2, true)
    assert.equal(
      getRelatedSeoProblemPages(guide).every(
        (relatedGuide) => relatedGuide.intentFamily === 'prioritisation'
      ),
      true
    )
  }
})

test('gives every indexable Hub A guide an inbound curated sibling link', () => {
  const guides = getIndexableSeoProblemPagesByIntentFamily('prioritisation')
  const incomingLinks = new Map(guides.map((guide) => [guide.slug, 0]))

  for (const guide of guides) {
    for (const relatedSlug of guide.relatedSlugs) {
      if (incomingLinks.has(relatedSlug)) {
        incomingLinks.set(relatedSlug, incomingLinks.get(relatedSlug) + 1)
      }
    }
  }

  assert.deepEqual(
    [...incomingLinks].filter(([, count]) => count === 0),
    []
  )
})

test('enforces the shared Hub A content shape for future records', () => {
  const methodGuide = getSeoProblemPageBySlug('how-to-prioritise-overdue-invoices')
  const nextChaseGuide = getSeoProblemPageBySlug(
    'which-customer-should-i-chase-first-for-payment'
  )

  assert.ok(methodGuide)
  assert.ok(nextChaseGuide)
  assert.doesNotThrow(() =>
    validateSeoProblemPageContent(
      getIndexableSeoProblemPagesByIntentFamily('prioritisation')
    )
  )

  assert.throws(
    () =>
      validateSeoProblemPageContent([
        { ...methodGuide, signals: methodGuide.signals.slice(1) },
      ]),
    /must explain each customer signal exactly once/
  )

  assert.throws(
    () =>
      validateSeoProblemPageContent([
        { ...methodGuide, recommendedActions: methodGuide.recommendedActions.slice(0, 2) },
      ]),
    /must have three to five recommended actions/
  )

  assert.throws(
    () => validateSeoProblemPageContent([{ ...methodGuide, ctaHeading: '' }]),
    /content fields must not be empty/
  )

  assert.throws(
    () =>
      validateSeoProblemPageContent([
        {
          ...methodGuide,
          workedExample: {
            ...methodGuide.workedExample,
            customers: methodGuide.workedExample.customers.map((customer, index) => ({
              ...customer,
              rank: index === 1 ? 1 : customer.rank,
            })),
          },
        },
      ]),
    /must contain a valid ranked customer comparison/
  )

  assert.throws(
    () =>
      validateSeoProblemPageContent([
        methodGuide,
        {
          ...nextChaseGuide,
          signals: methodGuide.signals,
        },
      ]),
    /Duplicate prioritisation signal guidance/
  )
})

test('keeps Hub B flat with the seven approved article records and page types', () => {
  const hubBGuides = getIndexableSeoProblemPagesByIntentFamily('cash-outcome')

  assert.deepEqual(
    hubBGuides.map((guide) => [guide.slug, guide.pageType]),
    [
      ['how-to-get-cash-in-faster-from-overdue-customers', 'problem-outcome'],
      ['how-to-improve-cash-collection', 'outcome-improvement'],
      ['how-to-reduce-debtor-days', 'outcome-improvement'],
      ['how-to-reduce-overdue-debt', 'problem-outcome'],
      ['how-to-speed-up-customer-payments', 'problem-outcome'],
      [
        'how-to-improve-accounts-receivable-for-a-small-business',
        'outcome-improvement',
      ],
      [
        'how-to-release-cash-tied-up-in-accounts-receivable',
        'outcome-improvement',
      ],
    ]
  )
  assert.equal(hubBGuides.every((guide) => guide.intentFamily === 'cash-outcome'), true)

  const preservedUrl = hubBGuides[0]
  assert.equal(preservedUrl.primaryKeyword, 'how to get overdue invoices paid faster')
  assert.equal(preservedUrl.h1, 'How to get overdue invoices paid faster')
  assert.equal(preservedUrl.queryCluster, 'get-overdue-invoices-paid-faster')
})

test('keeps all seven Hub B targeting and worked treatments distinct', () => {
  const guides = getIndexableSeoProblemPagesByIntentFamily('cash-outcome')
  const uniqueValues = (values) => new Set(values).size === guides.length
  const workedSignature = (guide) => {
    const example = guide.workedExample
    if ('customers' in example) {
      return [
        example.introduction,
        ...example.customers.map((customer) => customer.name),
        example.conclusion,
      ]
        .join('|')
        .toLowerCase()
    }

    return [
      example.businessContext,
      example.startingPosition,
      example.primaryConstraint,
      ...example.changesMade,
      example.result,
      example.lesson,
    ]
      .join('|')
      .toLowerCase()
  }
  const actionSignature = (guide) =>
    (guide.pageType === 'outcome-improvement'
      ? guide.improvementPlan
      : guide.recommendedActions
    )
      .join('|')
      .toLowerCase()

  assert.equal(guides.length, 7)
  assert.equal(uniqueValues(guides.map((guide) => guide.primaryKeyword.toLowerCase())), true)
  assert.equal(uniqueValues(guides.map((guide) => guide.queryCluster.toLowerCase())), true)
  assert.equal(uniqueValues(guides.map((guide) => guide.readerJob.toLowerCase())), true)
  assert.equal(uniqueValues(guides.map((guide) => guide.uniqueAngle.toLowerCase())), true)
  assert.equal(uniqueValues(guides.map((guide) => guide.directAnswer.toLowerCase())), true)
  assert.equal(uniqueValues(guides.map((guide) => guide.ctaHeading.toLowerCase())), true)
  assert.equal(uniqueValues(guides.map((guide) => guide.ctaDescription.toLowerCase())), true)
  assert.equal(uniqueValues(guides.map(workedSignature)), true)
  assert.equal(uniqueValues(guides.map(actionSignature)), true)

  const outcomeGuides = guides.filter(
    (guide) => guide.pageType === 'outcome-improvement'
  )
  assert.equal(
    new Set(
      outcomeGuides.map((guide) => guide.workedExample.primaryConstraint.toLowerCase())
    ).size,
    outcomeGuides.length
  )
  assert.equal(
    new Set(
      outcomeGuides.map((guide) =>
        guide.measurements.map((measurement) => measurement.metric).join('|')
      )
    ).size,
    outcomeGuides.length
  )
})

test('keeps every Hub B article body within the requested word-count range', () => {
  const guides = getIndexableSeoProblemPagesByIntentFamily('cash-outcome')

  for (const guide of guides) {
    const wordCount = articleBodyWordCount(guide)
    assert.equal(
      wordCount >= 350 && wordCount <= 650,
      true,
      `${guide.slug} has ${wordCount} article words`
    )
  }
})

test('enforces the six Hub B cannibalisation boundaries', () => {
  const guide = (slug) => {
    const result = getSeoProblemPageBySlug(slug)
    assert.ok(result)
    return result
  }

  const improveCollection = guide('how-to-improve-cash-collection')
  const reduceDebtorDays = guide('how-to-reduce-debtor-days')
  assert.match(improveCollection.readerJob, /overall effectiveness.*collecting customer cash/i)
  assert.match(improveCollection.uniqueAngle, /collection system/i)
  assert.match(reduceDebtorDays.readerJob, /average time.*collect receivables/i)
  assert.match(reduceDebtorDays.uniqueAngle, /outcome metric/i)

  const improveAr = guide(
    'how-to-improve-accounts-receivable-for-a-small-business'
  )
  assert.match(improveCollection.readerJob, /effectiveness/i)
  assert.match(improveAr.readerJob, /overall AR operating process/i)
  assert.match(improveAr.uniqueAngle, /minimum viable SME receivables system/i)

  const releaseCash = guide(
    'how-to-release-cash-tied-up-in-accounts-receivable'
  )
  assert.match(improveAr.uniqueAngle, /system/i)
  assert.match(releaseCash.readerJob, /working capital/i)
  assert.match(releaseCash.uniqueAngle, /material and actionable/i)

  const reduceOverdue = guide('how-to-reduce-overdue-debt')
  assert.match(reduceOverdue.readerJob, /overdue portion/i)
  assert.match(reduceOverdue.uniqueAngle, /overdue backlog/i)
  assert.match(releaseCash.readerJob, /receivables into cash/i)

  const overdueFaster = guide('how-to-get-cash-in-faster-from-overdue-customers')
  const speedPayments = guide('how-to-speed-up-customer-payments')
  assert.match(overdueFaster.readerJob, /already overdue/i)
  assert.match(overdueFaster.uniqueAngle, /overdue customers/i)
  assert.match(speedPayments.readerJob, /ongoing basis/i)
  assert.match(speedPayments.uniqueAngle, /recurring causes of delay/i)

  assert.match(reduceDebtorDays.readerJob, /average time/i)
  assert.match(speedPayments.readerJob, /how quickly customers pay/i)
  assert.notEqual(reduceDebtorDays.queryCluster, speedPayments.queryCluster)
})

test('keeps Hub B internal links curated, limited and non-orphaned', () => {
  const guides = getIndexableSeoProblemPagesByIntentFamily('cash-outcome')
  const expectedRelatedSlugs = {
    'how-to-get-cash-in-faster-from-overdue-customers': [
      'how-to-reduce-overdue-debt',
      'how-to-prioritise-overdue-invoices',
    ],
    'how-to-improve-cash-collection': [
      'how-to-reduce-debtor-days',
      'how-to-improve-accounts-receivable-for-a-small-business',
    ],
    'how-to-reduce-debtor-days': [
      'how-to-improve-cash-collection',
      'how-to-speed-up-customer-payments',
    ],
    'how-to-reduce-overdue-debt': [
      'how-to-get-cash-in-faster-from-overdue-customers',
      'how-to-release-cash-tied-up-in-accounts-receivable',
    ],
    'how-to-speed-up-customer-payments': [
      'how-to-reduce-debtor-days',
      'how-payment-history-should-affect-invoice-chasing',
    ],
    'how-to-improve-accounts-receivable-for-a-small-business': [
      'how-to-improve-cash-collection',
      'how-to-release-cash-tied-up-in-accounts-receivable',
    ],
    'how-to-release-cash-tied-up-in-accounts-receivable': [
      'how-to-reduce-overdue-debt',
      'how-to-improve-accounts-receivable-for-a-small-business',
    ],
  }
  const incomingLinks = new Map(guides.map((guide) => [guide.slug, 0]))

  for (const page of guides) {
    assert.deepEqual(page.relatedSlugs, expectedRelatedSlugs[page.slug])
    assert.equal(page.relatedSlugs.length <= 2, true)
    assert.equal(getRelatedSeoProblemPages(page).length, page.relatedSlugs.length)
    for (const relatedSlug of page.relatedSlugs) {
      if (incomingLinks.has(relatedSlug)) {
        incomingLinks.set(relatedSlug, incomingLinks.get(relatedSlug) + 1)
      }
    }
  }

  assert.deepEqual(
    [...incomingLinks].filter(([, count]) => count === 0),
    []
  )
})

test('keeps Hub C flat with the eleven approved article records and page types', () => {
  const hubCGuides = getIndexableSeoProblemPagesByIntentFamily('customer-risk')

  assert.deepEqual(
    hubCGuides.map((guide) => [guide.slug, guide.pageType]),
    [
      ['what-to-do-about-customers-who-always-pay-late', 'problem-outcome'],
      [
        'how-to-identify-risky-customers-from-payment-behaviour',
        'problem-outcome',
      ],
      ['customer-suddenly-taking-longer-to-pay', 'customer-risk-scenario'],
      ['customer-hasnt-paid-for-60-days', 'customer-risk-scenario'],
      ['customer-hasnt-paid-for-90-days', 'customer-risk-scenario'],
      ['customer-promised-to-pay-but-hasnt', 'customer-risk-scenario'],
      [
        'how-to-spot-deteriorating-customer-payment-behaviour',
        'problem-outcome',
      ],
      [
        'should-i-keep-supplying-a-customer-who-pays-late',
        'customer-risk-scenario',
      ],
      ['one-customer-owes-me-a-large-amount-of-money', 'problem-outcome'],
      ['when-should-i-escalate-an-overdue-invoice', 'problem-outcome'],
      ['how-payment-history-should-affect-invoice-chasing', 'problem-outcome'],
    ]
  )
  assert.equal(hubCGuides.every((guide) => guide.intentFamily === 'customer-risk'), true)
})

test('keeps all Hub C targeting, actions and worked treatments distinct', () => {
  const guides = getIndexableSeoProblemPagesByIntentFamily('customer-risk')
  const uniqueValues = (values) => new Set(values).size === guides.length
  const workedSignature = (guide) => {
    const example =
      guide.pageType === 'customer-risk-scenario'
        ? guide.workedScenario
        : guide.workedExample

    if ('customers' in example) {
      return [
        example.introduction,
        ...example.customers.map((customer) => customer.name),
        example.conclusion,
      ]
        .join('|')
        .toLowerCase()
    }

    return [
      example.customer,
      example.baseline,
      example.currentSituation,
      example.riskContext ?? '',
      example.interpretation,
      example.nextAction,
    ]
      .join('|')
      .toLowerCase()
  }

  assert.equal(guides.length, 11)
  assert.equal(uniqueValues(guides.map((guide) => guide.primaryKeyword.toLowerCase())), true)
  assert.equal(uniqueValues(guides.map((guide) => guide.queryCluster.toLowerCase())), true)
  assert.equal(uniqueValues(guides.map((guide) => guide.readerJob.toLowerCase())), true)
  assert.equal(uniqueValues(guides.map((guide) => guide.uniqueAngle.toLowerCase())), true)
  assert.equal(uniqueValues(guides.map((guide) => guide.directAnswer.toLowerCase())), true)
  assert.equal(uniqueValues(guides.map(workedSignature)), true)
  assert.equal(
    uniqueValues(
      guides.map((guide) => guide.recommendedActions.join('|').toLowerCase())
    ),
    true
  )

  const scenarioGuides = guides.filter(
    (guide) => guide.pageType === 'customer-risk-scenario'
  )
  assert.equal(
    new Set(scenarioGuides.map((guide) => guide.workedScenario.customer)).size,
    scenarioGuides.length
  )

  for (const guide of guides) {
    assert.equal(typeof guide.ctaHeading, 'string')
    assert.equal(typeof guide.ctaDescription, 'string')
    assert.equal(guide.relatedSlugs.length > 0 && guide.relatedSlugs.length <= 2, true)
    assert.equal(getRelatedSeoProblemPages(guide).length, guide.relatedSlugs.length)
  }
})

test('keeps every Hub C article body within the requested word-count range', () => {
  const guides = getIndexableSeoProblemPagesByIntentFamily('customer-risk')

  for (const guide of guides) {
    const wordCount = articleBodyWordCount(guide)
    assert.equal(
      wordCount >= 350 && wordCount <= 650,
      true,
      `${guide.slug} has ${wordCount} article words`
    )
  }
})

test('enforces the six Hub C cannibalisation boundaries', () => {
  const guide = (slug) => {
    const result = getSeoProblemPageBySlug(slug)
    assert.ok(result)
    return result
  }

  const identifyRisky = guide(
    'how-to-identify-risky-customers-from-payment-behaviour'
  )
  const deteriorating = guide(
    'how-to-spot-deteriorating-customer-payment-behaviour'
  )
  assert.match(identifyRisky.uniqueAngle, /cross-sectional/i)
  assert.match(identifyRisky.directAnswer, /current customer base/i)
  assert.match(deteriorating.uniqueAngle, /longitudinal/i)
  assert.match(deteriorating.directAnswer, /own baseline over several periods/i)

  const sixtyDays = guide('customer-hasnt-paid-for-60-days')
  const ninetyDays = guide('customer-hasnt-paid-for-90-days')
  assert.match(sixtyDays.directAnswer, /active intervention/i)
  assert.match(sixtyDays.riskAssessment.conclusion, /not yet automatically/i)
  assert.match(ninetyDays.directAnswer, /materially more serious/i)
  assert.match(ninetyDays.directAnswer, /routine reminders are increasingly inadequate/i)

  const habitual = guide('what-to-do-about-customers-who-always-pay-late')
  assert.match(habitual.uniqueAngle, /habitual lateness.*deterioration/i)
  assert.match(habitual.directAnswer, /behaviour is stable/i)
  assert.match(deteriorating.directAnswer, /progressively later payments/i)

  const paymentHistory = guide('how-payment-history-should-affect-invoice-chasing')
  assert.match(paymentHistory.uniqueAngle, /today's overdue position/i)
  assert.match(paymentHistory.directAnswer, /relative to the customer's own payment history/i)
  assert.match(deteriorating.readerJob, /getting worse relative to their own historical/i)

  const largeExposure = guide('one-customer-owes-me-a-large-amount-of-money')
  const largestFirst = guide('should-i-chase-the-largest-invoice-first')
  assert.match(largeExposure.readerJob, /large concentration of overdue debt/i)
  assert.match(largeExposure.uniqueAngle, /single-customer exposure/i)
  assert.match(largestFirst.readerJob, /biggest outstanding balance.*chased first/i)
  assert.notEqual(largeExposure.queryCluster, largestFirst.queryCluster)

  const escalation = guide('when-should-i-escalate-an-overdue-invoice')
  assert.match(escalation.readerJob, /when normal chasing should move/i)
  assert.match(escalation.uniqueAngle, /severity and failed progress/i)
  assert.match(ninetyDays.readerJob, /roughly 90 days/i)
  assert.notEqual(escalation.queryCluster, ninetyDays.queryCluster)
})

test('keeps Hub C internal links curated and limited', () => {
  const guides = getIndexableSeoProblemPagesByIntentFamily('customer-risk')
  const expectedRelatedSlugs = {
    'what-to-do-about-customers-who-always-pay-late': [
      'how-payment-history-should-affect-invoice-chasing',
      'how-to-spot-deteriorating-customer-payment-behaviour',
    ],
    'how-to-identify-risky-customers-from-payment-behaviour': [
      'how-to-spot-deteriorating-customer-payment-behaviour',
      'how-to-prioritise-debtors-by-risk',
    ],
    'customer-suddenly-taking-longer-to-pay': [
      'how-to-spot-deteriorating-customer-payment-behaviour',
      'customer-promised-to-pay-but-hasnt',
    ],
    'customer-hasnt-paid-for-60-days': [
      'when-should-i-escalate-an-overdue-invoice',
      'customer-hasnt-paid-for-90-days',
    ],
    'customer-hasnt-paid-for-90-days': [
      'when-should-i-escalate-an-overdue-invoice',
      'customer-hasnt-paid-for-60-days',
    ],
    'customer-promised-to-pay-but-hasnt': [
      'when-should-i-escalate-an-overdue-invoice',
      'customer-suddenly-taking-longer-to-pay',
    ],
    'how-to-spot-deteriorating-customer-payment-behaviour': [
      'how-to-identify-risky-customers-from-payment-behaviour',
      'how-payment-history-should-affect-invoice-chasing',
    ],
    'should-i-keep-supplying-a-customer-who-pays-late': [
      'one-customer-owes-me-a-large-amount-of-money',
      'what-to-do-about-customers-who-always-pay-late',
    ],
    'one-customer-owes-me-a-large-amount-of-money': [
      'should-i-keep-supplying-a-customer-who-pays-late',
      'when-should-i-escalate-an-overdue-invoice',
    ],
    'when-should-i-escalate-an-overdue-invoice': [
      'customer-hasnt-paid-for-60-days',
      'customer-hasnt-paid-for-90-days',
    ],
    'how-payment-history-should-affect-invoice-chasing': [
      'what-to-do-about-customers-who-always-pay-late',
      'how-to-spot-deteriorating-customer-payment-behaviour',
    ],
  }

  for (const page of guides) {
    assert.deepEqual(page.relatedSlugs, expectedRelatedSlugs[page.slug])
  }
})

test('keeps Hub D flat with exactly the ten approved article records and page types', () => {
  const hubDGuides = getIndexableSeoProblemPagesByIntentFamily(
    'credit-control-process'
  )

  assert.deepEqual(
    hubDGuides.map((guide) => [guide.slug, guide.pageType]),
    [
      ['how-to-do-credit-control-for-a-small-business', 'process-how-to'],
      ['how-to-manage-overdue-invoices-efficiently', 'problem-outcome'],
      ['how-to-organise-invoice-chasing', 'process-how-to'],
      ['how-to-create-a-credit-control-process', 'process-how-to'],
      [
        'how-to-manage-credit-control-without-a-credit-controller',
        'process-how-to',
      ],
      ['too-many-overdue-invoices-where-do-i-start', 'problem-outcome'],
      [
        'how-much-time-should-a-small-business-spend-chasing-invoices',
        'problem-outcome',
      ],
      ['how-to-stay-on-top-of-customer-payments', 'process-how-to'],
      [
        'how-to-make-invoice-chasing-less-time-consuming',
        'outcome-improvement',
      ],
      ['how-often-should-you-chase-overdue-invoices', 'problem-outcome'],
    ]
  )
  assert.equal(
    hubDGuides.every(
      (guide) => guide.intentFamily === 'credit-control-process' && guide.indexable
    ),
    true
  )
  assert.equal(
    getAllSeoGuideCategories().find(
      (category) => category.intentFamily === 'credit-control-process'
    ).title,
    'Credit control for small businesses'
  )
})

test('keeps all Hub D governance, direct answers and worked treatments distinct', () => {
  const guides = getIndexableSeoProblemPagesByIntentFamily(
    'credit-control-process'
  )
  const uniqueValues = (values) => new Set(values).size === guides.length
  const workedSignature = (guide) => {
    const example = guide.workedExample

    if ('customers' in example) {
      return [
        example.introduction,
        ...example.customers.map((customer) => customer.name),
        example.conclusion,
      ]
        .join('|')
        .toLowerCase()
    }

    return Object.values(example).flat().join('|').toLowerCase()
  }

  assert.equal(guides.length, 10)
  assert.equal(uniqueValues(guides.map((guide) => guide.primaryKeyword.toLowerCase())), true)
  assert.equal(uniqueValues(guides.map((guide) => guide.queryCluster.toLowerCase())), true)
  assert.equal(uniqueValues(guides.map((guide) => guide.readerJob.toLowerCase())), true)
  assert.equal(uniqueValues(guides.map((guide) => guide.uniqueAngle.toLowerCase())), true)
  assert.equal(uniqueValues(guides.map((guide) => guide.directAnswer.toLowerCase())), true)
  assert.equal(uniqueValues(guides.map(workedSignature)), true)

  const expectedGovernance = {
    'how-to-do-credit-control-for-a-small-business': [
      'small-business-credit-control-how-to',
      'solution-aware',
    ],
    'how-to-manage-overdue-invoices-efficiently': [
      'efficient-overdue-invoice-management',
      'solution-aware',
    ],
    'how-to-organise-invoice-chasing': [
      'organise-invoice-chasing-workflow',
      'solution-aware',
    ],
    'how-to-create-a-credit-control-process': [
      'create-credit-control-process',
      'solution-aware',
    ],
    'how-to-manage-credit-control-without-a-credit-controller': [
      'credit-control-without-credit-controller',
      'solution-aware',
    ],
    'too-many-overdue-invoices-where-do-i-start': [
      'overdue-invoice-backlog-where-to-start',
      'problem-aware',
    ],
    'how-much-time-should-a-small-business-spend-chasing-invoices': [
      'small-business-invoice-chasing-time',
      'problem-aware',
    ],
    'how-to-stay-on-top-of-customer-payments': [
      'stay-on-top-of-customer-payments',
      'solution-aware',
    ],
    'how-to-make-invoice-chasing-less-time-consuming': [
      'reduce-time-spent-invoice-chasing',
      'solution-aware',
    ],
    'how-often-should-you-chase-overdue-invoices': [
      'overdue-invoice-chasing-frequency',
      'solution-aware',
    ],
  }

  for (const guide of guides) {
    assert.deepEqual(
      [guide.queryCluster, guide.funnelStage],
      expectedGovernance[guide.slug]
    )
  }
})

test('gives the five Hub D process guides different operating designs', () => {
  const processGuides = getIndexableSeoProblemPagesByIntentFamily(
    'credit-control-process'
  ).filter((guide) => guide.pageType === 'process-how-to')
  const uniqueValues = (values) => new Set(values).size === processGuides.length

  assert.equal(processGuides.length, 5)
  assert.equal(
    uniqueValues(
      processGuides.map((guide) =>
        guide.processStages.map((stage) => stage.stage).join('|').toLowerCase()
      )
    ),
    true
  )
  assert.equal(
    uniqueValues(
      processGuides.map((guide) =>
        guide.operatingRhythm.map((item) => item.cadence).join('|').toLowerCase()
      )
    ),
    true
  )
  assert.equal(
    uniqueValues(
      processGuides.map((guide) =>
        [
          ...guide.automationAndJudgement.routineWork.map((item) => item.task),
          ...guide.automationAndJudgement.judgementWork.map((item) => item.task),
        ]
          .join('|')
          .toLowerCase()
      )
    ),
    true
  )
  assert.equal(
    uniqueValues(
      processGuides.map((guide) => guide.workedExample.businessContext.toLowerCase())
    ),
    true
  )
  assert.equal(
    uniqueValues(
      processGuides.map((guide) =>
        guide.workedExample.processIntroduced.join('|').toLowerCase()
      )
    ),
    true
  )
  assert.equal(
    uniqueValues(
      processGuides.map((guide) =>
        guide.failurePoints.map((point) => point.failure).join('|').toLowerCase()
      )
    ),
    true
  )

  assert.match(processGuides[0].workedExample.businessContext, /cleaning company/i)
  assert.match(processGuides[1].workedExample.businessContext, /design studio/i)
  assert.match(processGuides[2].workedExample.businessContext, /manufacturer/i)
  assert.match(processGuides[3].workedExample.businessContext, /consultancy/i)
  assert.match(processGuides[4].workedExample.businessContext, /recruitment agency/i)
})

test('uses different problem examples for ledger efficiency, backlog, time allocation and cadence', () => {
  const problemGuides = getIndexableSeoProblemPagesByIntentFamily(
    'credit-control-process'
  ).filter((guide) => guide.pageType === 'problem-outcome')

  assert.equal(problemGuides.length, 4)
  assert.equal(
    new Set(
      problemGuides.map((guide) => guide.workedExample.introduction.toLowerCase())
    ).size,
    problemGuides.length
  )

  const efficient = getSeoProblemPageBySlug(
    'how-to-manage-overdue-invoices-efficiently'
  )
  const backlog = getSeoProblemPageBySlug(
    'too-many-overdue-invoices-where-do-i-start'
  )
  const timeAllocation = getSeoProblemPageBySlug(
    'how-much-time-should-a-small-business-spend-chasing-invoices'
  )
  const frequency = getSeoProblemPageBySlug(
    'how-often-should-you-chase-overdue-invoices'
  )

  assert.match(
    efficient.workedExample.customers.map((customer) => customer.rankReason).join(' '),
    /Direct chase:[\s\S]*Investigate:[\s\S]*Monitor:[\s\S]*No immediate human action:/i
  )
  assert.match(backlog.workedExample.introduction, /forty-seven overdue invoices/i)
  assert.deepEqual(
    timeAllocation.workedExample.customers.map((customer) => customer.name),
    ['Northstar Facilities', 'Pine Research']
  )
  assert.match(frequency.workedExample.introduction, /next useful contact points/i)
})

test('keeps every Hub D article body within the requested word-count range', () => {
  const guides = getIndexableSeoProblemPagesByIntentFamily(
    'credit-control-process'
  )

  for (const guide of guides) {
    const wordCount = articleBodyWordCount(guide)
    assert.equal(
      wordCount >= 350 && wordCount <= 650,
      true,
      `${guide.slug} has ${wordCount} article words`
    )
  }
})

test('enforces the seven requested Hub D cannibalisation boundaries', () => {
  const guide = (slug) => {
    const result = getSeoProblemPageBySlug(slug)
    assert.ok(result)
    return result
  }

  const operate = guide('how-to-do-credit-control-for-a-small-business')
  const design = guide('how-to-create-a-credit-control-process')
  assert.match(operate.readerJob, /operate a practical credit-control function/i)
  assert.match(operate.uniqueAngle, /operating system/i)
  assert.match(design.readerJob, /design and implement/i)
  assert.match(design.directAnswer, /Create the process before payment problems occur/i)

  const organise = guide('how-to-organise-invoice-chasing')
  const stayOnTop = guide('how-to-stay-on-top-of-customer-payments')
  assert.match(organise.readerJob, /organised workflow.*ownership and next actions/i)
  assert.match(organise.uniqueAngle, /active chasing work/i)
  assert.match(stayOnTop.readerJob, /noticed early instead of becoming a backlog/i)
  assert.match(stayOnTop.uniqueAngle, /Prevent reactive credit control/i)

  const efficient = guide('how-to-manage-overdue-invoices-efficiently')
  const reduceTime = guide('how-to-make-invoice-chasing-less-time-consuming')
  assert.match(efficient.readerJob, /existing overdue ledger/i)
  assert.match(efficient.uniqueAngle, /human effort selectively/i)
  assert.match(reduceTime.readerJob, /admin and human time/i)
  assert.match(reduceTime.uniqueAngle, /Remove low-value work/i)

  const noController = guide(
    'how-to-manage-credit-control-without-a-credit-controller'
  )
  assert.match(noController.readerJob, /nobody owns it full-time/i)
  assert.match(noController.uniqueAngle, /limited founder or admin capacity/i)
  assert.notEqual(noController.queryCluster, operate.queryCluster)

  const backlog = guide('too-many-overdue-invoices-where-do-i-start')
  const nextCustomer = guide('which-customer-should-i-chase-first-for-payment')
  assert.match(backlog.readerJob, /overwhelming overdue-invoice backlog/i)
  assert.match(backlog.uniqueAngle, /manageable shortlist.*full ledger/i)
  assert.match(nextCustomer.readerJob, /which specific customer to contact next/i)

  const timeAllocation = guide(
    'how-much-time-should-a-small-business-spend-chasing-invoices'
  )
  const fixedHour = guide(
    'how-to-prioritise-invoice-chasing-when-you-only-have-an-hour'
  )
  assert.match(timeAllocation.readerJob, /how much credit-control effort/i)
  assert.match(timeAllocation.directAnswer, /no universal hours-per-week target/i)
  assert.match(fixedHour.readerJob, /one limited hour/i)

  const frequency = guide('how-often-should-you-chase-overdue-invoices')
  const escalation = guide('when-should-i-escalate-an-overdue-invoice')
  assert.match(frequency.readerJob, /follow-up cadence/i)
  assert.match(frequency.directAnswer, /no universal “every X days” rule/i)
  assert.match(escalation.readerJob, /normal chasing should move/i)
  assert.match(escalation.uniqueAngle, /severity and failed progress/i)
})

test('keeps Hub D internal links curated, limited and on the intended journeys', () => {
  const guides = getIndexableSeoProblemPagesByIntentFamily(
    'credit-control-process'
  )
  const expectedRelatedSlugs = {
    'how-to-do-credit-control-for-a-small-business': [
      'how-to-create-a-credit-control-process',
      'how-to-manage-credit-control-without-a-credit-controller',
    ],
    'how-to-manage-overdue-invoices-efficiently': [
      'too-many-overdue-invoices-where-do-i-start',
      'how-to-prioritise-overdue-invoices',
    ],
    'how-to-organise-invoice-chasing': [
      'how-to-stay-on-top-of-customer-payments',
      'how-to-create-a-daily-credit-control-priority-list',
    ],
    'how-to-create-a-credit-control-process': [
      'how-to-do-credit-control-for-a-small-business',
      'how-to-organise-invoice-chasing',
    ],
    'how-to-manage-credit-control-without-a-credit-controller': [
      'how-to-make-invoice-chasing-less-time-consuming',
      'how-much-time-should-a-small-business-spend-chasing-invoices',
    ],
    'too-many-overdue-invoices-where-do-i-start': [
      'how-to-manage-overdue-invoices-efficiently',
      'which-customer-should-i-chase-first-for-payment',
    ],
    'how-much-time-should-a-small-business-spend-chasing-invoices': [
      'how-to-make-invoice-chasing-less-time-consuming',
      'how-to-prioritise-invoice-chasing-when-you-only-have-an-hour',
    ],
    'how-to-stay-on-top-of-customer-payments': [
      'how-to-organise-invoice-chasing',
      'how-often-should-you-chase-overdue-invoices',
    ],
    'how-to-make-invoice-chasing-less-time-consuming': [
      'how-to-manage-credit-control-without-a-credit-controller',
      'how-to-manage-overdue-invoices-efficiently',
    ],
    'how-often-should-you-chase-overdue-invoices': [
      'how-payment-history-should-affect-invoice-chasing',
      'when-should-i-escalate-an-overdue-invoice',
    ],
  }

  for (const page of guides) {
    assert.deepEqual(page.relatedSlugs, expectedRelatedSlugs[page.slug])
    assert.equal(page.relatedSlugs.length <= 2, true)
    assert.equal(getRelatedSeoProblemPages(page).length, page.relatedSlugs.length)
  }
})

test('keeps Hub E flat with exactly the five approved article records and page types', () => {
  const hubEGuides = getIndexableSeoProblemPagesByIntentFamily('xero')

  assert.deepEqual(
    hubEGuides.map((guide) => [guide.slug, guide.pageType]),
    [
      ['how-to-prioritise-overdue-invoices-in-xero', 'problem-outcome'],
      ['xero-credit-control', 'process-how-to'],
      ['xero-invoice-chasing', 'process-how-to'],
      ['how-to-manage-overdue-customers-in-xero', 'problem-outcome'],
      ['xero-credit-control-software', 'software-solution'],
    ]
  )
  assert.equal(
    hubEGuides.every(
      (guide) => guide.intentFamily === 'xero' && guide.indexable
    ),
    true
  )
  assert.equal(
    getAllSeoGuideCategories().find(
      (category) => category.intentFamily === 'xero'
    ).title,
    'Xero credit control'
  )
  assert.equal(getAllIndexableSeoProblemPages().length, 41)
})

test('keeps all Hub E governance and direct answers distinct', () => {
  const guides = getIndexableSeoProblemPagesByIntentFamily('xero')
  const uniqueValues = (values) => new Set(values).size === guides.length
  const expectedGovernance = {
    'how-to-prioritise-overdue-invoices-in-xero': [
      'prioritise-overdue-invoices-xero',
      'Turn overdue information from Xero into an ordered customer chasing priority.',
      'Xero can show the underlying receivables and payment position; this page explains how to turn that information into a customer-level priority decision.',
      'solution-aware',
    ],
    'xero-credit-control': [
      'xero-credit-control',
      'Run a practical small-business credit-control process around Xero.',
      'Use Xero as the accounting and receivables system while adding a disciplined process for prioritisation, human follow-up and escalation.',
      'solution-aware',
    ],
    'xero-invoice-chasing': [
      'xero-invoice-chasing',
      'Run the invoice-follow-up and chasing part of credit control when using Xero.',
      'Use routine or system-supported follow-up where appropriate, then reserve manual attention for customers whose value, behaviour, risk or situation justifies it.',
      'solution-aware',
    ],
    'how-to-manage-overdue-customers-in-xero': [
      'manage-overdue-customers-xero',
      'Manage a group of overdue Xero customers by assigning appropriate next actions and levels of attention.',
      'Move from invoice-level visibility to customer-level treatment and next-action management.',
      'solution-aware',
    ],
    'xero-credit-control-software': [
      'xero-credit-control-software',
      'Evaluate whether additional credit-control software is needed alongside Xero and what type of solution best fits the business.',
      'Start from what Xero already provides, identify the remaining workflow and prioritisation need, explain the main solution approaches, and position our product specifically around prioritised human attention.',
      'product-aware',
    ],
  }

  assert.equal(guides.length, 5)
  assert.equal(uniqueValues(guides.map((guide) => guide.queryCluster)), true)
  assert.equal(uniqueValues(guides.map((guide) => guide.readerJob)), true)
  assert.equal(uniqueValues(guides.map((guide) => guide.uniqueAngle)), true)
  assert.equal(uniqueValues(guides.map((guide) => guide.directAnswer)), true)

  for (const guide of guides) {
    assert.deepEqual(
      [
        guide.queryCluster,
        guide.readerJob,
        guide.uniqueAngle,
        guide.funnelStage,
      ],
      expectedGovernance[guide.slug]
    )
  }
})

test('uses distinct Hub E prioritisation, customer-management and process treatments', () => {
  const priority = getSeoProblemPageBySlug(
    'how-to-prioritise-overdue-invoices-in-xero'
  )
  const manage = getSeoProblemPageBySlug(
    'how-to-manage-overdue-customers-in-xero'
  )
  const creditControl = getSeoProblemPageBySlug('xero-credit-control')
  const chasing = getSeoProblemPageBySlug('xero-invoice-chasing')

  assert.ok(priority)
  assert.ok(manage)
  assert.ok(creditControl)
  assert.ok(chasing)
  assert.deepEqual(
    priority.signals.map((signal) => signal.key),
    [
      'value-outstanding',
      'average-days-late',
      'days-since-last-payment',
      'founder-risk',
    ]
  )
  assert.deepEqual(
    priority.workedExample.customers.map((customer) => customer.name),
    ['Fenwick Components', 'Northmere Stores', 'Alderworks']
  )
  assert.match(priority.workedExample.conclusion, /owes more.*oldest invoice/i)
  assert.match(
    manage.workedExample.customers.map((customer) => customer.rankReason).join(' '),
    /treatment: direct founder chase[\s\S]*treatment: dispute investigation[\s\S]*treatment: promise monitoring[\s\S]*treatment: standard follow-up/i
  )
  assert.notDeepEqual(
    priority.signals.map((signal) => signal.key),
    manage.signals.map((signal) => signal.key)
  )

  assert.notDeepEqual(
    creditControl.processStages.map((stage) => stage.stage),
    chasing.processStages.map((stage) => stage.stage)
  )
  assert.notDeepEqual(
    creditControl.operatingRhythm.map((item) => item.cadence),
    chasing.operatingRhythm.map((item) => item.cadence)
  )
  assert.notDeepEqual(
    creditControl.failurePoints.map((point) => point.failure),
    chasing.failurePoints.map((point) => point.failure)
  )
  assert.match(creditControl.workedExample.businessContext, /building-products supplier/i)
  assert.match(chasing.workedExample.businessContext, /engineering consultancy/i)
  assert.match(
    chasing.workedExample.processIntroduced.join(' '),
    /routine follow-up[\s\S]*direct founder contact[\s\S]*disputed[\s\S]*deteriorated/i
  )
})

test('enforces the requested Hub E cannibalisation boundaries', () => {
  const guide = (slug) => {
    const result = getSeoProblemPageBySlug(slug)
    assert.ok(result)
    return result
  }

  const xeroPriority = guide('how-to-prioritise-overdue-invoices-in-xero')
  const generalPriority = guide('how-to-prioritise-overdue-invoices')
  assert.match(xeroPriority.readerJob, /from Xero/i)
  assert.match(xeroPriority.uniqueAngle, /Xero can show/i)
  assert.match(generalPriority.uniqueAngle, /reusable four-signal/i)
  assert.notEqual(xeroPriority.queryCluster, generalPriority.queryCluster)

  const xeroControl = guide('xero-credit-control')
  const genericControl = guide('how-to-do-credit-control-for-a-small-business')
  assert.match(xeroControl.readerJob, /around Xero/i)
  assert.match(genericControl.readerJob, /without enterprise-level complexity/i)

  const chasing = guide('xero-invoice-chasing')
  assert.match(xeroControl.uniqueAngle, /prioritisation, human follow-up and escalation/i)
  assert.match(chasing.readerJob, /invoice-follow-up and chasing part/i)
  assert.match(chasing.processIntroduction, /Wider credit policy.*full credit-control process/i)

  const manage = guide('how-to-manage-overdue-customers-in-xero')
  assert.match(xeroPriority.readerJob, /ordered customer chasing priority/i)
  assert.match(manage.readerJob, /assigning appropriate next actions/i)
  assert.match(manage.directAnswer, /rank alone is not a management plan/i)
  assert.match(chasing.uniqueAngle, /manual attention/i)
  assert.match(manage.uniqueAngle, /treatment and next-action management/i)

  const software = guide('xero-credit-control-software')
  assert.match(software.readerJob, /Evaluate whether additional.*software/i)
  assert.match(xeroControl.readerJob, /Run a practical/i)
  assert.equal('workedExample' in software, false)
})

test('keeps Xero capability claims conservative, record-controlled and separate from product claims', async () => {
  const guides = getIndexableSeoProblemPagesByIntentFamily('xero')
  const software = getSeoProblemPageBySlug('xero-credit-control-software')
  const rendererSource = await readFile(
    new URL('../../app/guides/_components/SoftwareSolutionGuide.tsx', import.meta.url),
    'utf8'
  )

  assert.ok(software)
  assert.deepEqual(
    software.existingPlatformCapabilities.map((item) => item.capability),
    [
      'Invoice and payment status',
      'Aged receivables reporting',
      'Automated invoice reminders',
    ]
  )
  assert.match(
    software.existingPlatformIntroduction,
    /check (?:the )?current Xero plan and settings/i
  )
  assert.doesNotMatch(rendererSource, /Xero|aged receivables|invoice reminders/i)

  const hubEArticleCopy = guides
    .map((guide) => JSON.stringify(guide))
    .join(' ')
  assert.doesNotMatch(hubEArticleCopy, /Xero cannot/i)
  assert.doesNotMatch(
    hubEArticleCopy,
    /best Xero credit-control software|our product replaces Xero|complete AR automation/i
  )
  for (const guide of guides) {
    assert.match(guide.productBridge, /product|prioritisation/i)
    assert.match(guide.productBridge, /accounting|Xero/i)
  }
})

test('absorbs Xero collections software variants without creating a sixth guide', () => {
  const guides = getIndexableSeoProblemPagesByIntentFamily('xero')
  const software = getSeoProblemPageBySlug('xero-credit-control-software')

  assert.ok(software)
  assert.equal(guides.length, 5)
  assert.equal(
    guides.some((guide) => guide.slug === 'xero-collections-software'),
    false
  )
  assert.deepEqual(software.secondaryKeywords, [
    'xero collections software',
    'collections software for xero',
    'xero credit control app',
    'credit control app for xero',
  ])
})

test('keeps Hub E internal links curated, limited and gives every article an inbound link', () => {
  const guides = getIndexableSeoProblemPagesByIntentFamily('xero')
  const expectedRelatedSlugs = {
    'how-to-prioritise-overdue-invoices-in-xero': [
      'xero-credit-control',
      'how-to-prioritise-overdue-invoices',
    ],
    'xero-credit-control': [
      'xero-invoice-chasing',
      'xero-credit-control-software',
    ],
    'xero-invoice-chasing': [
      'xero-credit-control',
      'how-to-manage-overdue-customers-in-xero',
    ],
    'how-to-manage-overdue-customers-in-xero': [
      'how-to-prioritise-overdue-invoices-in-xero',
      'xero-invoice-chasing',
    ],
    'xero-credit-control-software': [
      'xero-credit-control',
      'how-to-prioritise-overdue-invoices-in-xero',
    ],
  }
  const inboundHubELinks = new Map(guides.map((guide) => [guide.slug, 0]))

  for (const page of guides) {
    assert.deepEqual(page.relatedSlugs, expectedRelatedSlugs[page.slug])
    assert.equal(page.relatedSlugs.length <= 2, true)
    assert.equal(getRelatedSeoProblemPages(page).length, page.relatedSlugs.length)
    for (const relatedSlug of page.relatedSlugs) {
      if (inboundHubELinks.has(relatedSlug)) {
        inboundHubELinks.set(relatedSlug, inboundHubELinks.get(relatedSlug) + 1)
      }
    }
  }

  assert.equal(
    [...inboundHubELinks.values()].every((count) => count > 0),
    true
  )
})

test('keeps every Hub E article body within the requested word-count range', () => {
  const guides = getIndexableSeoProblemPagesByIntentFamily('xero')

  for (const guide of guides) {
    const wordCount = articleBodyWordCount(guide)
    assert.equal(
      wordCount >= 350 && wordCount <= 650,
      true,
      `${guide.slug} has ${wordCount} article words`
    )
  }
})

test('keeps site-wide headings, product bridges and CTAs editorially specific', () => {
  const guides = getAllIndexableSeoProblemPages()
  const headings = guides.flatMap((guide) => Object.values(guide.sectionHeadings ?? {}))

  assert.equal(new Set(headings.map((heading) => heading.toLowerCase())).size, headings.length)
  assert.equal(
    headings.some((heading) =>
      /^(worked example|worked process|worked scenario|worked business example):/i.test(
        heading
      )
    ),
    false
  )
  assert.equal(
    new Set(guides.map((guide) => guide.ctaHeading.toLowerCase())).size,
    guides.length
  )
  assert.equal(
    new Set(guides.map((guide) => guide.ctaDescription.toLowerCase())).size,
    guides.length
  )

  for (const guide of guides) {
    assert.doesNotMatch(
      guide.productBridge,
      /the app uses both when helping prioritise|which overdue customers deserve human attention first/i
    )
  }
})

test('gives every indexable guide at least one contextual inbound path', () => {
  const guides = getAllIndexableSeoProblemPages()
  const incomingLinks = new Map(guides.map((guide) => [guide.slug, 0]))

  for (const guide of guides) {
    for (const relatedSlug of guide.relatedSlugs) {
      if (incomingLinks.has(relatedSlug)) {
        incomingLinks.set(relatedSlug, incomingLinks.get(relatedSlug) + 1)
      }
    }
  }

  assert.deepEqual(
    [...incomingLinks].filter(([, count]) => count === 0),
    []
  )
})

test('preserves curated related guides and falls back to at most two family siblings', () => {
  const prioritisationGuide = getAllIndexableSeoProblemPages().find(
    (guide) => guide.intentFamily === 'prioritisation'
  )

  assert.ok(prioritisationGuide)
  assert.deepEqual(
    getRelatedSeoProblemPages(prioritisationGuide).map((guide) => guide.slug),
    [
      'how-to-prioritise-multiple-overdue-customers',
      'which-customer-should-i-chase-first-for-payment',
    ]
  )

  const pageWithoutCuration = {
    ...prioritisationGuide,
    slug: 'future-prioritisation-guide',
    relatedSlugs: [],
  }
  const fallbackGuides = getRelatedSeoProblemPages(pageWithoutCuration)

  assert.equal(fallbackGuides.length <= 2, true)
  assert.equal(
    fallbackGuides.every((guide) => guide.intentFamily === pageWithoutCuration.intentFamily),
    true
  )

  assert.deepEqual(
    getRelatedSeoProblemPages(outcomeImprovementFixture()).map(
      (guide) => guide.slug
    ),
    [
      'how-to-get-cash-in-faster-from-overdue-customers',
      'how-to-improve-cash-collection',
    ]
  )
})
