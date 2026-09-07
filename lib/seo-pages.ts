import {
  CUSTOMER_PRIORITISATION_SIGNAL_KEYS,
  SEO_FUNNEL_STAGES,
  SEO_INTENT_FAMILIES,
  SEO_PAGE_TYPES,
  seoGuideCategories,
  seoProblemPages,
  type SeoGuideCategory,
  type SeoIntentFamily,
  type SeoProblemPage,
  type WorkedExample,
  type WorkedCustomerScenario,
  type WorkedOutcomeExample,
  type WorkedProcessExample,
} from '@/content/seo-pages'

type SeoPageGovernance = Pick<
  SeoProblemPage,
  | 'slug'
  | 'pageType'
  | 'queryCluster'
  | 'readerJob'
  | 'uniqueAngle'
  | 'intentFamily'
  | 'funnelStage'
  | 'indexable'
>

type SeoGuideCategoryGovernance = Pick<
  SeoGuideCategory,
  'intentFamily' | 'slug' | 'title' | 'shortDescription' | 'description' | 'topics'
>

const intentFamilies = new Set<string>(SEO_INTENT_FAMILIES)
const funnelStages = new Set<string>(SEO_FUNNEL_STAGES)
const pageTypes = new Set<string>(SEO_PAGE_TYPES)
const MAX_RELATED_GUIDES = 2
const customerPrioritisationSignalKeys = new Set<string>(
  CUSTOMER_PRIORITISATION_SIGNAL_KEYS
)

export function validateSeoGuideCategories(
  categories: readonly SeoGuideCategoryGovernance[]
) {
  const slugs = new Set<string>()
  const categoryIntentFamilies = new Set<string>()

  for (const category of categories) {
    const slug = category.slug.trim()

    if (
      !slug ||
      !intentFamilies.has(category.intentFamily) ||
      !category.title.trim() ||
      !category.shortDescription.trim() ||
      !category.description.trim() ||
      category.topics.length === 0 ||
      category.topics.some((topic) => !topic.trim())
    ) {
      throw new Error(`SEO guide category fields must not be empty: ${category.slug}`)
    }

    if (slugs.has(slug)) {
      throw new Error(`Duplicate SEO guide category slug: ${slug}`)
    }

    if (categoryIntentFamilies.has(category.intentFamily)) {
      throw new Error(`Duplicate SEO guide intent family: ${category.intentFamily}`)
    }

    slugs.add(slug)
    categoryIntentFamilies.add(category.intentFamily)
  }
}

export function validateSeoProblemPages(pages: readonly SeoPageGovernance[]) {
  const slugs = new Set<string>()
  const indexableClusters = new Map<string, string>()
  const indexableReaderJobs = new Map<string, string>()
  const indexableUniqueAngles = new Map<string, string>()

  for (const page of pages) {
    const slug = page.slug.trim()
    const queryCluster = page.queryCluster.trim()

    if (
      !slug ||
      !queryCluster ||
      !pageTypes.has(page.pageType) ||
      !page.readerJob.trim() ||
      !page.uniqueAngle.trim() ||
      !intentFamilies.has(page.intentFamily) ||
      !funnelStages.has(page.funnelStage)
    ) {
      throw new Error(`SEO problem page governance fields must not be empty: ${page.slug}`)
    }

    if (slugs.has(slug)) {
      throw new Error(`Duplicate SEO problem page slug: ${slug}`)
    }
    slugs.add(slug)

    if (!page.indexable) continue

    const normalizedCluster = queryCluster.toLowerCase()
    const existingSlug = indexableClusters.get(normalizedCluster)
    if (existingSlug) {
      throw new Error(
        `Duplicate indexable SEO query cluster "${queryCluster}": ${existingSlug}, ${slug}`
      )
    }

    indexableClusters.set(normalizedCluster, slug)

    const normalizedReaderJob = `${page.intentFamily}:${page.readerJob.trim().toLowerCase()}`
    const existingReaderJobSlug = indexableReaderJobs.get(normalizedReaderJob)
    if (existingReaderJobSlug) {
      throw new Error(
        `Duplicate indexable SEO reader job in "${page.intentFamily}": ${existingReaderJobSlug}, ${slug}`
      )
    }
    indexableReaderJobs.set(normalizedReaderJob, slug)

    const normalizedUniqueAngle = `${page.intentFamily}:${page.uniqueAngle.trim().toLowerCase()}`
    const existingUniqueAngleSlug = indexableUniqueAngles.get(normalizedUniqueAngle)
    if (existingUniqueAngleSlug) {
      throw new Error(
        `Duplicate indexable SEO unique angle in "${page.intentFamily}": ${existingUniqueAngleSlug}, ${slug}`
      )
    }
    indexableUniqueAngles.set(normalizedUniqueAngle, slug)
  }
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function hasValidRecommendedActions(actions: readonly string[]) {
  return (
    actions.length >= 3 &&
    actions.length <= 5 &&
    actions.every((action) => hasText(action))
  )
}

function isValidWorkedCustomerScenario(scenario: WorkedCustomerScenario) {
  return (
    hasText(scenario.customer) &&
    hasText(scenario.baseline) &&
    hasText(scenario.currentSituation) &&
    (scenario.riskContext === undefined || hasText(scenario.riskContext)) &&
    hasText(scenario.interpretation) &&
    hasText(scenario.nextAction)
  )
}

function isValidWorkedOutcomeExample(example: WorkedOutcomeExample) {
  const normalizedChanges = example.changesMade.map((change) =>
    change.trim().toLowerCase()
  )

  return (
    hasText(example.businessContext) &&
    hasText(example.startingPosition) &&
    hasText(example.primaryConstraint) &&
    example.changesMade.length >= 2 &&
    example.changesMade.length <= 6 &&
    new Set(normalizedChanges).size === example.changesMade.length &&
    example.changesMade.every((change) => hasText(change)) &&
    hasText(example.result) &&
    hasText(example.lesson)
  )
}

function isValidWorkedProcessExample(example: WorkedProcessExample) {
  const introducedSteps = example.processIntroduced.map((step) =>
    step.trim().toLowerCase()
  )

  return (
    hasText(example.businessContext) &&
    hasText(example.previousApproach) &&
    example.processIntroduced.length >= 2 &&
    example.processIntroduced.length <= 7 &&
    new Set(introducedSteps).size === example.processIntroduced.length &&
    example.processIntroduced.every((step) => hasText(step)) &&
    hasText(example.operatingRhythm) &&
    hasText(example.result) &&
    hasText(example.lesson)
  )
}

function isValidRankedCustomerExample(example: WorkedExample, minimumCustomers: number) {
  const customerNames = new Set(
    example.customers.map((customer) => customer.name.trim())
  )
  const sortedRanks = example.customers
    .map((customer) => customer.rank)
    .sort((a, b) => a - b)

  return (
    hasText(example.introduction) &&
    hasText(example.conclusion) &&
    example.customers.length >= minimumCustomers &&
    customerNames.size === example.customers.length &&
    example.customers.every(
      (customer) =>
        hasText(customer.name) &&
        hasText(customer.rankReason) &&
        Number.isFinite(customer.valueOutstanding) &&
        customer.valueOutstanding >= 0 &&
        Number.isFinite(customer.averageDaysLate) &&
        customer.averageDaysLate >= 0 &&
        Number.isFinite(customer.daysSinceLastPayment) &&
        customer.daysSinceLastPayment >= 0
    ) &&
    sortedRanks.every((rank, index) => rank === index + 1)
  )
}

export function validateSeoProblemPageContent(pages: readonly SeoProblemPage[]) {
  const signalCopyBySlug = new Map<string, string>()
  const actionCopyBySlug = new Map<string, string>()

  for (const page of pages) {
    if (page.pageType !== 'problem-outcome') continue

    const headings = page.sectionHeadings
    const requiredHeadings = [
      headings?.whyItMatters,
      headings?.signals,
      headings?.decisionRules,
      headings?.workedExample,
      headings?.recommendedActions,
      headings?.productBridge,
    ]
    const configuredHeadings = Object.values(headings ?? {})

    if (
      !hasText(page.directAnswer) ||
      !hasText(page.whyItMatters) ||
      !hasText(page.signalIntroduction) ||
      !hasText(page.productBridge) ||
      !hasText(page.ctaHeading) ||
      !hasText(page.ctaDescription) ||
      configuredHeadings.some((heading) => !heading.trim())
    ) {
      throw new Error(`Problem-outcome guide content fields must not be empty: ${page.slug}`)
    }

    const signalKeys = new Set(page.signals.map((signal) => signal.key.trim()))
    if (
      page.signals.length === 0 ||
      signalKeys.size !== page.signals.length ||
      page.signals.some(
        (signal) =>
          !hasText(signal.key) ||
          !hasText(signal.label) ||
          !hasText(signal.explanation)
      )
    ) {
      throw new Error(
        `Problem-outcome guide signals must be distinct and complete: ${page.slug}`
      )
    }

    if (
      page.decisionRules.length < 2 ||
      page.decisionRules.length > 5 ||
      page.decisionRules.some((rule) => !rule.trim())
    ) {
      throw new Error(
        `Problem-outcome guide must have two to five decision rules: ${page.slug}`
      )
    }

    if (!hasValidRecommendedActions(page.recommendedActions)) {
      throw new Error(
        `Problem-outcome guide must have three to five recommended actions: ${page.slug}`
      )
    }

    const workedExampleIsValid =
      'customers' in page.workedExample
        ? isValidRankedCustomerExample(page.workedExample, 1)
        : isValidWorkedCustomerScenario(page.workedExample)
    if (!workedExampleIsValid) {
      if (page.intentFamily === 'prioritisation') {
        throw new Error(
          `Prioritisation worked example must contain a valid ranked customer comparison: ${page.slug}`
        )
      }
      throw new Error(
        `Problem-outcome guide must contain a valid worked example: ${page.slug}`
      )
    }

    if (page.intentFamily !== 'prioritisation') continue

    if (
      requiredHeadings.some((heading) => !heading?.trim())
    ) {
      throw new Error(`Prioritisation guide content fields must not be empty: ${page.slug}`)
    }

    if (
      page.signals.length !== CUSTOMER_PRIORITISATION_SIGNAL_KEYS.length ||
      signalKeys.size !== CUSTOMER_PRIORITISATION_SIGNAL_KEYS.length ||
      [...signalKeys].some((key) => !customerPrioritisationSignalKeys.has(key))
    ) {
      throw new Error(
        `Prioritisation guide must explain each customer signal exactly once: ${page.slug}`
      )
    }

    if (
      !('customers' in page.workedExample) ||
      !isValidRankedCustomerExample(page.workedExample, 2)
    ) {
      throw new Error(
        `Prioritisation worked example must contain a valid ranked customer comparison: ${page.slug}`
      )
    }

    const signalCopy = page.signals
      .map((signal) => signal.explanation.trim().toLowerCase())
      .join('|')
    const existingSignalSlug = signalCopyBySlug.get(signalCopy)
    if (existingSignalSlug) {
      throw new Error(
        `Duplicate prioritisation signal guidance: ${existingSignalSlug}, ${page.slug}`
      )
    }
    signalCopyBySlug.set(signalCopy, page.slug)

    const actionCopy = page.recommendedActions
      .map((action) => action.trim().toLowerCase())
      .join('|')
    const existingActionSlug = actionCopyBySlug.get(actionCopy)
    if (existingActionSlug) {
      throw new Error(
        `Duplicate prioritisation action checklist: ${existingActionSlug}, ${page.slug}`
      )
    }
    actionCopyBySlug.set(actionCopy, page.slug)
  }
}

export function validateCustomerRiskScenarioPages(pages: readonly SeoProblemPage[]) {
  for (const page of pages) {
    if (page.pageType !== 'customer-risk-scenario') continue

    const headings = page.sectionHeadings
    const requiredHeadings = [
      headings?.whatItMightMean,
      headings?.riskAssessment,
      headings?.workedScenario,
      headings?.recommendedActions,
      headings?.productBridge,
      headings?.relatedGuides,
    ]
    const explanations = page.diagnosis.explanations
    const explanationNames = new Set(
      explanations.map((explanation) => explanation.possibility.trim().toLowerCase())
    )
    const factors = page.riskAssessment.factors
    const factorNames = new Set(
      factors.map((factor) => factor.label.trim().toLowerCase())
    )

    if (
      page.intentFamily !== 'customer-risk' ||
      !hasText(page.directAnswer) ||
      !hasText(page.diagnosis.introduction) ||
      !hasText(page.riskAssessment.introduction) ||
      !hasText(page.riskAssessment.conclusion) ||
      !hasText(page.productBridge) ||
      !hasText(page.ctaHeading) ||
      !hasText(page.ctaDescription) ||
      requiredHeadings.some((heading) => !heading?.trim())
    ) {
      throw new Error(`Customer-risk scenario fields must not be empty: ${page.slug}`)
    }

    if (
      explanations.length < 2 ||
      explanations.length > 5 ||
      explanationNames.size !== explanations.length ||
      explanations.some(
        (explanation) =>
          !hasText(explanation.possibility) ||
          !hasText(explanation.evidenceToCheck)
      )
    ) {
      throw new Error(
        `Customer-risk scenario must have two to five distinct explanations: ${page.slug}`
      )
    }

    if (
      factors.length < 1 ||
      factors.length > 6 ||
      factorNames.size !== factors.length ||
      factors.some(
        (factor) =>
          !hasText(factor.label) ||
          !hasText(factor.evidence) ||
          !hasText(factor.interpretation)
      )
    ) {
      throw new Error(
        `Customer-risk scenario must have one to six distinct assessment factors: ${page.slug}`
      )
    }

    if (!isValidWorkedCustomerScenario(page.workedScenario)) {
      throw new Error(
        `Customer-risk scenario must contain a complete worked customer scenario: ${page.slug}`
      )
    }

    if (!hasValidRecommendedActions(page.recommendedActions)) {
      throw new Error(
        `Customer-risk scenario must have three to five recommended actions: ${page.slug}`
      )
    }
  }
}

export function validateOutcomeImprovementPages(pages: readonly SeoProblemPage[]) {
  for (const page of pages) {
    if (page.pageType !== 'outcome-improvement') continue

    const headings = page.sectionHeadings
    const requiredHeadings = [
      headings?.drivers,
      headings?.focusFirst,
      headings?.improvementPlan,
      headings?.workedExample,
      headings?.measurements,
      headings?.productBridge,
    ]
    const driverKeys = new Set(
      page.drivers.map((driver) => driver.key.trim().toLowerCase())
    )
    const driverLabels = new Set(
      page.drivers.map((driver) => driver.label.trim().toLowerCase())
    )
    const focusAreas = new Set(
      page.focusAreas.map((focusArea) => focusArea.area.trim().toLowerCase())
    )
    const improvementSteps = new Set(
      page.improvementPlan.map((step) => step.trim().toLowerCase())
    )
    const measurementNames = new Set(
      page.measurements.map((measurement) => measurement.metric.trim().toLowerCase())
    )

    if (
      (page.intentFamily !== 'cash-outcome' &&
        page.intentFamily !== 'credit-control-process') ||
      !hasText(page.directAnswer) ||
      !hasText(page.driverIntroduction) ||
      !hasText(page.focusIntroduction) ||
      !hasText(page.measurementIntroduction) ||
      !hasText(page.productBridge) ||
      !hasText(page.ctaHeading) ||
      !hasText(page.ctaDescription) ||
      requiredHeadings.some((heading) => !heading?.trim())
    ) {
      throw new Error(`Outcome-improvement guide fields must not be empty: ${page.slug}`)
    }

    if (
      page.drivers.length < 2 ||
      page.drivers.length > 7 ||
      driverKeys.size !== page.drivers.length ||
      driverLabels.size !== page.drivers.length ||
      page.drivers.some(
        (driver) =>
          !hasText(driver.key) ||
          !hasText(driver.label) ||
          !hasText(driver.explanation)
      )
    ) {
      throw new Error(
        `Outcome-improvement guide must have two to seven distinct outcome drivers: ${page.slug}`
      )
    }

    if (
      page.focusAreas.length < 1 ||
      page.focusAreas.length > 5 ||
      focusAreas.size !== page.focusAreas.length ||
      page.focusAreas.some(
        (focusArea) =>
          !hasText(focusArea.area) ||
          !hasText(focusArea.evidenceToCheck) ||
          !hasText(focusArea.whenToPrioritise)
      )
    ) {
      throw new Error(
        `Outcome-improvement guide must have one to five complete focus areas: ${page.slug}`
      )
    }

    if (
      page.improvementPlan.length < 4 ||
      page.improvementPlan.length > 6 ||
      improvementSteps.size !== page.improvementPlan.length ||
      page.improvementPlan.some((step) => !hasText(step))
    ) {
      throw new Error(
        `Outcome-improvement guide must have four to six distinct plan steps: ${page.slug}`
      )
    }

    if (!isValidWorkedOutcomeExample(page.workedExample)) {
      throw new Error(
        `Outcome-improvement guide must contain a complete worked business example: ${page.slug}`
      )
    }

    if (
      page.measurements.length < 2 ||
      page.measurements.length > 5 ||
      measurementNames.size !== page.measurements.length ||
      page.measurements.some(
        (measurement) =>
          !hasText(measurement.metric) || !hasText(measurement.guidance)
      )
    ) {
      throw new Error(
        `Outcome-improvement guide must have two to five distinct measurements: ${page.slug}`
      )
    }
  }
}

export function validateProcessHowToPages(pages: readonly SeoProblemPage[]) {
  for (const page of pages) {
    if (page.pageType !== 'process-how-to') continue

    const headings = page.sectionHeadings
    const requiredHeadings = [
      headings?.minimumProcess,
      headings?.operatingRhythm,
      headings?.automationAndJudgement,
      headings?.workedExample,
      headings?.failurePoints,
      headings?.productBridge,
    ]
    const processStageNames = new Set(
      page.processStages.map((stage) => stage.stage.trim().toLowerCase())
    )
    const cadenceNames = new Set(
      page.operatingRhythm.map((item) => item.cadence.trim().toLowerCase())
    )
    const routineTasks = new Set(
      page.automationAndJudgement.routineWork.map((item) =>
        item.task.trim().toLowerCase()
      )
    )
    const judgementTasks = new Set(
      page.automationAndJudgement.judgementWork.map((item) =>
        item.task.trim().toLowerCase()
      )
    )
    const failureNames = new Set(
      page.failurePoints.map((point) => point.failure.trim().toLowerCase())
    )

    if (
      !['credit-control-process', 'xero'].includes(page.intentFamily) ||
      !hasText(page.directAnswer) ||
      !hasText(page.processIntroduction) ||
      !hasText(page.operatingIntroduction) ||
      !hasText(page.automationAndJudgement.introduction) ||
      !hasText(page.productBridge) ||
      !hasText(page.ctaHeading) ||
      !hasText(page.ctaDescription) ||
      requiredHeadings.some((heading) => !heading?.trim())
    ) {
      throw new Error(`Process-how-to guide fields must not be empty: ${page.slug}`)
    }

    if (
      page.processStages.length < 3 ||
      page.processStages.length > 8 ||
      processStageNames.size !== page.processStages.length ||
      page.processStages.some(
        (stage) => !hasText(stage.stage) || !hasText(stage.guidance)
      )
    ) {
      throw new Error(
        `Process-how-to guide must have three to eight distinct process stages: ${page.slug}`
      )
    }

    if (
      page.operatingRhythm.length < 1 ||
      page.operatingRhythm.length > 6 ||
      cadenceNames.size !== page.operatingRhythm.length ||
      page.operatingRhythm.some(
        (item) =>
          !hasText(item.cadence) ||
          !hasText(item.activity) ||
          !hasText(item.purpose)
      )
    ) {
      throw new Error(
        `Process-how-to guide must have one to six complete operating-rhythm items: ${page.slug}`
      )
    }

    if (
      page.automationAndJudgement.routineWork.length < 1 ||
      page.automationAndJudgement.routineWork.length > 6 ||
      routineTasks.size !== page.automationAndJudgement.routineWork.length ||
      page.automationAndJudgement.routineWork.some(
        (item) => !hasText(item.task) || !hasText(item.guidance)
      )
    ) {
      throw new Error(
        `Process-how-to guide must have one to six distinct routine-work items: ${page.slug}`
      )
    }

    if (
      page.automationAndJudgement.judgementWork.length < 1 ||
      page.automationAndJudgement.judgementWork.length > 6 ||
      judgementTasks.size !== page.automationAndJudgement.judgementWork.length ||
      page.automationAndJudgement.judgementWork.some(
        (item) => !hasText(item.task) || !hasText(item.guidance)
      )
    ) {
      throw new Error(
        `Process-how-to guide must have one to six distinct judgement-work items: ${page.slug}`
      )
    }

    if (!isValidWorkedProcessExample(page.workedExample)) {
      throw new Error(
        `Process-how-to guide must contain a complete worked process example: ${page.slug}`
      )
    }

    if (
      page.failurePoints.length < 3 ||
      page.failurePoints.length > 5 ||
      failureNames.size !== page.failurePoints.length ||
      page.failurePoints.some(
        (point) =>
          !hasText(point.failure) ||
          !hasText(point.consequence) ||
          !hasText(point.betterApproach)
      )
    ) {
      throw new Error(
        `Process-how-to guide must have three to five distinct failure points: ${page.slug}`
      )
    }
  }
}

export function validateSoftwareSolutionPages(pages: readonly SeoProblemPage[]) {
  for (const page of pages) {
    if (page.pageType !== 'software-solution') continue

    const headings = page.sectionHeadings
    const requiredHeadings = [
      headings?.existingPlatform,
      headings?.additionalSoftware,
      headings?.selectionCriteria,
      headings?.solutionApproaches,
      headings?.productDifferentiation,
      headings?.fit,
      headings?.relatedGuides,
    ]
    const capabilityNames = new Set(
      page.existingPlatformCapabilities.map((item) =>
        item.capability.trim().toLowerCase()
      )
    )
    const triggerNames = new Set(
      page.additionalSoftwareTriggers.map((item) =>
        item.trigger.trim().toLowerCase()
      )
    )
    const criterionNames = new Set(
      page.selectionCriteria.map((item) =>
        item.criterion.trim().toLowerCase()
      )
    )
    const approachNames = new Set(
      page.solutionApproaches.map((item) =>
        item.approach.trim().toLowerCase()
      )
    )
    const positioningSources = new Set(
      page.productDifferentiation.inputs.map((item) =>
        item.source.trim().toLowerCase()
      )
    )
    const goodFitSituations = new Set(
      page.goodFit.map((item) => item.situation.trim().toLowerCase())
    )
    const poorFitSituations = new Set(
      page.poorFit.map((item) => item.situation.trim().toLowerCase())
    )

    if (
      page.intentFamily !== 'xero' ||
      !hasText(page.directAnswer) ||
      !hasText(page.existingPlatformIntroduction) ||
      !hasText(page.additionalSoftwareIntroduction) ||
      !hasText(page.selectionIntroduction) ||
      !hasText(page.approachesIntroduction) ||
      !hasText(page.productDifferentiation.introduction) ||
      !hasText(page.productDifferentiation.outcome) ||
      !hasText(page.fitIntroduction) ||
      !hasText(page.productBridge) ||
      !hasText(page.ctaHeading) ||
      !hasText(page.ctaDescription) ||
      !hasText(page.ctaLabel) ||
      !hasText(page.ctaHref) ||
      requiredHeadings.some((heading) => !heading?.trim())
    ) {
      throw new Error(`Software-solution guide fields must not be empty: ${page.slug}`)
    }

    if (
      page.existingPlatformCapabilities.length < 1 ||
      page.existingPlatformCapabilities.length > 8 ||
      capabilityNames.size !== page.existingPlatformCapabilities.length ||
      page.existingPlatformCapabilities.some(
        (item) =>
          !hasText(item.capability) ||
          !hasText(item.guidance) ||
          (item.context !== undefined && !hasText(item.context))
      )
    ) {
      throw new Error(
        `Software-solution guide must have one to eight distinct existing-platform capabilities: ${page.slug}`
      )
    }

    if (
      page.additionalSoftwareTriggers.length < 2 ||
      page.additionalSoftwareTriggers.length > 8 ||
      triggerNames.size !== page.additionalSoftwareTriggers.length ||
      page.additionalSoftwareTriggers.some(
        (item) => !hasText(item.trigger) || !hasText(item.guidance)
      )
    ) {
      throw new Error(
        `Software-solution guide must have two to eight distinct additional-software triggers: ${page.slug}`
      )
    }

    if (
      page.selectionCriteria.length < 2 ||
      page.selectionCriteria.length > 8 ||
      criterionNames.size !== page.selectionCriteria.length ||
      page.selectionCriteria.some(
        (item) => !hasText(item.criterion) || !hasText(item.whyItMatters)
      )
    ) {
      throw new Error(
        `Software-solution guide must have two to eight distinct selection criteria: ${page.slug}`
      )
    }

    if (
      page.solutionApproaches.length < 2 ||
      page.solutionApproaches.length > 6 ||
      approachNames.size !== page.solutionApproaches.length ||
      page.solutionApproaches.some(
        (item) =>
          !hasText(item.approach) ||
          !hasText(item.bestFor) ||
          (item.limitation !== undefined && !hasText(item.limitation))
      )
    ) {
      throw new Error(
        `Software-solution guide must have two to six distinct solution approaches: ${page.slug}`
      )
    }

    if (
      page.productDifferentiation.inputs.length < 2 ||
      page.productDifferentiation.inputs.length > 4 ||
      positioningSources.size !== page.productDifferentiation.inputs.length ||
      page.productDifferentiation.inputs.some(
        (item) => !hasText(item.source) || !hasText(item.contribution)
      )
    ) {
      throw new Error(
        `Software-solution guide must have two to four distinct positioning inputs: ${page.slug}`
      )
    }

    if (
      page.goodFit.length < 1 ||
      page.goodFit.length > 6 ||
      goodFitSituations.size !== page.goodFit.length ||
      page.goodFit.some(
        (item) => !hasText(item.situation) || !hasText(item.guidance)
      )
    ) {
      throw new Error(
        `Software-solution guide must have one to six distinct good-fit situations: ${page.slug}`
      )
    }

    if (
      page.poorFit.length < 1 ||
      page.poorFit.length > 6 ||
      poorFitSituations.size !== page.poorFit.length ||
      page.poorFit.some(
        (item) => !hasText(item.situation) || !hasText(item.guidance)
      )
    ) {
      throw new Error(
        `Software-solution guide must have one to six distinct poorer-fit situations: ${page.slug}`
      )
    }
  }
}

validateSeoProblemPages(seoProblemPages)
validateSeoProblemPageContent(seoProblemPages)
validateCustomerRiskScenarioPages(seoProblemPages)
validateOutcomeImprovementPages(seoProblemPages)
validateProcessHowToPages(seoProblemPages)
validateSoftwareSolutionPages(seoProblemPages)
validateSeoGuideCategories(seoGuideCategories)

const seoProblemPagesBySlug = new Map<string, SeoProblemPage>()
const seoGuideCategoriesByIntentFamily = new Map<SeoIntentFamily, SeoGuideCategory>()

for (const category of seoGuideCategories) {
  seoGuideCategoriesByIntentFamily.set(category.intentFamily, category)
}

for (const page of seoProblemPages) {
  if (!seoGuideCategoriesByIntentFamily.has(page.intentFamily)) {
    throw new Error(`Unknown SEO guide intent family "${page.intentFamily}": ${page.slug}`)
  }

  const relatedSlugs = new Set<string>()
  for (const relatedSlug of page.relatedSlugs) {
    if (relatedSlug === page.slug) {
      throw new Error(`SEO problem page cannot relate to itself: ${page.slug}`)
    }
    if (relatedSlugs.has(relatedSlug)) {
      throw new Error(`Duplicate related SEO problem page slug "${relatedSlug}": ${page.slug}`)
    }
    relatedSlugs.add(relatedSlug)
  }

  seoProblemPagesBySlug.set(page.slug, page)
}

for (const page of seoProblemPages) {
  for (const relatedSlug of page.relatedSlugs) {
    if (!seoProblemPagesBySlug.has(relatedSlug)) {
      throw new Error(`Unknown related SEO problem page slug "${relatedSlug}": ${page.slug}`)
    }
  }
}

export function getAllSeoGuideCategories() {
  return [...seoGuideCategories]
}

export function getSeoGuideCategoryByIntentFamily(intentFamily: SeoIntentFamily) {
  return seoGuideCategoriesByIntentFamily.get(intentFamily) ?? null
}

export function getIndexableSeoProblemPagesByIntentFamily(intentFamily: SeoIntentFamily) {
  return seoProblemPages.filter(
    (page) => page.indexable && page.intentFamily === intentFamily
  )
}

export function getAllSeoProblemPages() {
  return [...seoProblemPages]
}

export function getAllIndexableSeoProblemPages() {
  return seoProblemPages.filter((page) => page.indexable)
}

export function getSeoProblemPageBySlug(slug: string) {
  return seoProblemPagesBySlug.get(slug) ?? null
}

export function getRelatedSeoProblemPages(
  page: Pick<SeoProblemPage, 'slug' | 'intentFamily' | 'relatedSlugs'>
) {
  const seenSlugs = new Set([page.slug])
  const relatedPages: SeoProblemPage[] = []

  for (const slug of page.relatedSlugs) {
    if (seenSlugs.has(slug)) continue

    const relatedPage = getSeoProblemPageBySlug(slug)
    if (!relatedPage) continue

    seenSlugs.add(slug)
    relatedPages.push(relatedPage)
  }

  if (relatedPages.length > 0) {
    return relatedPages
  }

  for (const familyPage of getIndexableSeoProblemPagesByIntentFamily(page.intentFamily)) {
    if (seenSlugs.has(familyPage.slug)) continue

    seenSlugs.add(familyPage.slug)
    relatedPages.push(familyPage)

    if (relatedPages.length === MAX_RELATED_GUIDES) break
  }

  return relatedPages
}
