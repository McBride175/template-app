import type { SeoProblemPage } from './seo-pages'

export const hubESeoPages = [
  {
    slug: 'how-to-prioritise-overdue-invoices-in-xero',
    pageType: 'problem-outcome',
    intentFamily: 'xero',
    funnelStage: 'solution-aware',
    primaryKeyword: 'how to prioritise overdue invoices in xero',
    secondaryKeywords: [
      'prioritise xero overdue invoices',
      'xero overdue customer priority',
      'rank overdue customers from xero',
    ],
    searchIntent: 'informational',
    queryCluster: 'prioritise-overdue-invoices-xero',
    readerJob:
      'Turn overdue information from Xero into an ordered customer chasing priority.',
    uniqueAngle:
      'Xero can show the underlying receivables and payment position; this page explains how to turn that information into a customer-level priority decision.',
    metaTitle: 'How to Prioritise Overdue Invoices in Xero',
    metaDescription:
      'Turn Xero receivables and payment information into a customer chase order using exposure, behaviour, recency and current business evidence.',
    h1: 'How to prioritise overdue invoices in Xero',
    directAnswer:
      'Do not chase from the Xero report order. Group overdue invoices by customer, set aside balances already paid, covered by a credible promise or blocked, then compare the rest by exposure, usual payment behaviour, last-payment recency and current risk. Produce a short queue with a reason and next action, not another invoice list.',
    whyItMatters:
      'Xero shows what is outstanding, when it was due and what has been paid. It cannot know that the largest debtor paid yesterday, the oldest invoice has a purchase-order error or a smaller customer broke two promises. Grouping by customer exposes those trade-offs and prevents duplicate chases.',
    sectionHeadings: {
      whyItMatters: 'Turn Xero visibility into a priority decision',
      signals: 'Build one evidence row per Xero contact',
      decisionRules: 'Turn the evidence into today’s chase order',
      workedExample: 'Three Xero customers, one defensible order',
      recommendedActions: 'The useful output is a queue, not a score',
      productBridge: 'From Xero data to focused human attention',
      relatedGuides: 'Apply the method in context',
    },
    signalIntroduction:
      'Use the same four columns for each candidate. Some need calculating from invoice history rather than copying from one Xero field. They support judgement, not a universal score.',
    signals: [
      {
        key: 'value-outstanding',
        label: 'Value outstanding',
        explanation:
          'Add each contact’s overdue invoices. Compare the pounds at stake and whether they are material to your business; neither makes the customer automatically first.',
      },
      {
        key: 'average-days-late',
        label: 'Average days late',
        explanation:
          'Review completed payments consistently. Ask whether today is normal for this customer or a genuine deterioration; treat a thin history as uncertainty.',
      },
      {
        key: 'days-since-last-payment',
        label: 'Days since last payment',
        explanation:
          'A recent part-payment can reduce urgency. A long gap strengthens concern only if the customer would normally pay more often.',
      },
      {
        key: 'founder-risk',
        label: 'Founder-assigned customer risk',
        explanation:
          'Record the fact behind the judgement: a broken promise, lost contact, dispute or credible update. Avoid unexplained labels.',
      },
    ],
    decisionRules: [
      'Refresh the Xero position first. Remove paid or corrected items, and park a credible promise until its date rather than manufacturing urgency.',
      'Move a customer up when meaningful exposure, deterioration, weak recent payment evidence and a specific risk event reinforce one another.',
      'When signals conflict, ask what may worsen before the next review and whether contact now can release cash, confirm a date or expose a blocker.',
      'Write one reason and one next action beside each leading customer. Re-rank after a payment, missed promise, dispute update or material change in risk.',
    ],
    workedExample: {
      introduction:
        'A distributor reviews three contacts from its current Xero receivables. The largest balance is already moving; the oldest invoice now has an actionable question. This is a comparison, not a score.',
      customers: [
        {
          name: 'Fenwick Components',
          valueOutstanding: 18600,
          averageDaysLate: 34,
          daysSinceLastPayment: 74,
          founderRisk: 'high',
          founderRiskReason:
            'A named payment date was missed and two recent calls have not been returned.',
          rank: 1,
          rankReason:
            'The material balance, long payment gap and broken commitment create the strongest case for a senior call now.',
        },
        {
          name: 'Northmere Stores',
          valueOutstanding: 31500,
          averageDaysLate: 12,
          daysSinceLastPayment: 3,
          founderRisk: 'low',
          founderRiskReason:
            'A part-payment has cleared and remittance for the balance has been supplied.',
          rank: 3,
          rankReason:
            'This is the largest balance, but the cleared part-payment and remittance support waiting until the stated date rather than chasing today.',
        },
        {
          name: 'Alderworks',
          valueOutstanding: 9800,
          averageDaysLate: 58,
          daysSinceLastPayment: 47,
          founderRisk: 'medium',
          founderRiskReason:
            'The oldest invoice had a purchase-order error; the correction was accepted yesterday but no payment date was given.',
          rank: 2,
          rankReason:
            'The blocker has been removed, so a targeted call can now secure a payment date. Age supports the decision but does not put it above Fenwick.',
        },
      ],
      conclusion:
        'Call Fenwick first, then Alderworks. Northmere owes more, but current evidence says to monitor rather than interrupt progress; Alderworks has the oldest invoice, but age alone does not outweigh Fenwick’s failed commitment and silence. Change the order when Xero records a payment or a promised date passes.',
    },
    recommendedActions: [
      'Create one row per customer: overdue total, payment behaviour, last payment, risk fact, priority reason and next action.',
      'Keep only the customers you can act on now in the active queue; give promised payments and blockers their own return dates.',
      'Work from the top for the time available and record what each contact changes.',
      'Refresh that customer when new evidence arrives instead of rebuilding the list from memory.',
    ],
    productBridge:
      'You can build this queue manually from Xero data. The repetitive part is regrouping invoices and refreshing exposure, behaviour and payment recency as the ledger changes. The product performs that comparison and lets founder-assigned risk change the order; it does not send every reminder, resolve disputes or make escalation decisions.',
    ctaHeading: 'Keep the Xero customer order current',
    ctaDescription:
      'See plans for turning changing Xero invoice and payment data into a ranked queue you can adjust with customer knowledge.',
    ctaLabel: 'See plans and pricing',
    ctaHref: '/pricing',
    relatedSlugs: ['xero-credit-control', 'how-to-prioritise-overdue-invoices'],
    indexable: true,
  },
  {
    slug: 'xero-credit-control',
    pageType: 'process-how-to',
    intentFamily: 'xero',
    funnelStage: 'solution-aware',
    primaryKeyword: 'xero credit control',
    secondaryKeywords: [
      'credit control with xero',
      'xero credit control process',
      'small business xero debtors process',
    ],
    searchIntent: 'mixed',
    queryCluster: 'xero-credit-control',
    readerJob: 'Run a practical small-business credit-control process around Xero.',
    uniqueAngle:
      'Use Xero as the accounting and receivables system while adding a disciplined process for prioritisation, human follow-up and escalation.',
    metaTitle: 'Xero Credit Control for Small Businesses',
    metaDescription:
      'Run credit control around Xero with current receivables, a fixed review rhythm, owned customer actions and a separate exception path.',
    h1: 'Xero credit control',
    directAnswer:
      'Use Xero as the accounting record, then run a repeatable control loop: refresh the position, review by customer, split reminders from exceptions, prioritise human work, record outcomes and return unresolved cases at a set time. Xero supplies receivables information; credit control supplies ownership and decisions.',
    sectionHeadings: {
      minimumProcess: 'Turn Xero receivables into an owned control loop',
      operatingRhythm: 'Set the rhythm from promises and exposure',
      automationAndJudgement: 'Give systems routine work and people the exceptions',
      workedExample: 'Four outputs from one Xero review',
      failurePoints: 'Where a Xero-based process loses control',
      productBridge: 'Prioritisation inside the wider process',
      relatedGuides: 'Continue the Xero workflow',
    },
    processIntroduction:
      'Each session should leave four outputs: routine reminders, a ranked contact queue, owned blockers and exceptions for management review.',
    processStages: [
      {
        stage: 'Keep the Xero position current',
        guidance:
          'Confirm cleared payments, credits and corrections before deciding a customer is late.',
      },
      {
        stage: 'Review receivables by customer',
        guidance:
          'Combine each contact’s invoices so exposure and recent progress appear together.',
      },
      {
        stage: 'Separate routine work from exceptions',
        guidance:
          'Leave uncomplicated reminders alone; pull out disputes, failed promises, lost contact and deterioration.',
      },
      {
        stage: 'Prioritise human attention',
        guidance:
          'Order judgement-heavy cases by exposure, behaviour, recent payment and a recorded risk fact.',
      },
      {
        stage: 'Contact and capture the outcome',
        guidance:
          'Record the response, owner, next action and exact return date.',
      },
      {
        stage: 'Review exceptions and escalation',
        guidance:
          'Move persistent non-payment, failed contact and growing exposure to an accountable decision.',
      },
    ],
    operatingIntroduction:
      'There is no universal cadence. Review often enough that a material missed promise or blocker never waits for the next cash squeeze.',
    operatingRhythm: [
      {
        cadence: 'On the fixed control day',
        activity:
          'Refresh Xero, produce the four outputs and complete the ranked actions that fit.',
        purpose:
          'Makes credit control scheduled work rather than a reaction to a low bank balance.',
      },
      {
        cadence: 'When a return date arrives',
        activity:
          'Check the promised payment, dispute action or document and update that customer.',
        purpose:
          'Stops commitments expiring between full reviews.',
      },
      {
        cadence: 'At the management exception review',
        activity:
          'Decide treatment for broken promises, unresolved disputes, failed contact and increasing exposure.',
        purpose:
          'Prevents failed routine action from repeating indefinitely.',
      },
    ],
    automationAndJudgement: {
      introduction:
        'Automate predictable administration where appropriate. Keep a person accountable for promises, blockers and intervention.',
      routineWork: [
        {
          task: 'Maintain invoice and payment status',
          guidance:
            'Remove paid or corrected invoices from the working set.',
        },
        {
          task: 'Run ordinary reminder activity',
          guidance:
            'Use configured reminders for cases needing a consistent nudge.',
        },
      ],
      judgementWork: [
        {
          task: 'Choose the next customer attention',
          guidance:
            'Decide which exposure, deterioration and current evidence justify scarce time.',
        },
        {
          task: 'Interpret deterioration and intervention',
          guidance:
            'Choose a call, blocker resolution, monitoring or management review.',
        },
      ],
    },
    workedExample: {
      businessContext:
        'A twenty-person building-products supplier keeps its sales invoices and payment records in Xero; the operations manager owns credit control alongside other duties.',
      previousApproach:
        'The manager opened the report when cash felt tight, chased the oldest line and kept promises in email.',
      processIntroduced: [
        'Refreshed Xero and produced a contact-level overdue view.',
        'Left eleven uncomplicated customers in routine reminders and put three accounts in the human queue.',
        'Assigned two invoice blockers to their internal owners with Friday return dates.',
        'Took one missed £18,000 commitment to the founder’s exception review.',
      ],
      operatingRhythm:
        'Every Tuesday the manager runs the session, checks due commitments and gives the founder only exceptions.',
      result:
        'Every reviewed customer ended in routine contact, a ranked action, an owned blocker or a management decision.',
      lesson:
        'The process is controlled when the report reliably produces owned work and return dates.',
    },
    failurePoints: [
      {
        failure: 'Treating Xero visibility as the whole process',
        consequence: 'The overdue position is visible but nobody owns what happens next.',
        betterApproach: 'Make every reviewed exception end with a treatment, owner and return date.',
      },
      {
        failure: 'Working only by invoice age',
        consequence: 'Old routine items displace customers whose total exposure or changed behaviour needs attention.',
        betterApproach: 'Review by customer and compare age with value, payment progress and current risk evidence.',
      },
      {
        failure: 'Losing customer context outside the workflow',
        consequence: 'A broken promise or known blocker disappears when the report is opened again.',
        betterApproach: 'Keep the fact, owner and return date where the next reviewer will use them.',
      },
      {
        failure: 'Leaving escalation undefined',
        consequence: 'Persistent exceptions keep receiving reminders after ordinary follow-up has failed.',
        betterApproach: 'Name the decision-maker and the evidence that moves a customer to exception review.',
      },
    ],
    productBridge:
      'The product supports one output from this loop: the ranked human-attention queue. It combines relevant Xero accounting signals with founder-assigned customer risk. It does not replace Xero or the surrounding work of reminders, blocker ownership, contact records and escalation.',
    ctaHeading: 'Add a ranked queue to your Xero control loop',
    ctaDescription:
      'See plans if the process works but deciding where human attention goes still takes too long.',
    ctaLabel: 'See plans and pricing',
    ctaHref: '/pricing',
    relatedSlugs: ['xero-invoice-chasing', 'xero-credit-control-software'],
    indexable: true,
  },
  {
    slug: 'xero-invoice-chasing',
    pageType: 'process-how-to',
    intentFamily: 'xero',
    funnelStage: 'solution-aware',
    primaryKeyword: 'xero invoice chasing',
    secondaryKeywords: [
      'chase overdue invoices in xero',
      'xero payment follow up process',
      'xero overdue invoice chasing',
    ],
    searchIntent: 'mixed',
    queryCluster: 'xero-invoice-chasing',
    readerJob: 'Run the invoice-follow-up and chasing part of credit control when using Xero.',
    uniqueAngle:
      'Use routine or system-supported follow-up where appropriate, then reserve manual attention for customers whose value, behaviour, risk or situation justifies it.',
    metaTitle: 'Xero Invoice Chasing for Small Businesses',
    metaDescription:
      'Chase Xero invoices by leaving uncomplicated cases in reminders and giving exceptions a tailored contact, owner and next date.',
    h1: 'Xero invoice chasing',
    directAnswer:
      'Do not manually chase every overdue Xero invoice. Confirm the balance is due, leave uncomplicated cases in reminders and reserve tailored contact for failed promises, disputes, lost contact, material exposure or deterioration. Seek payment, a firm date or a named blocker, then record what happens next.',
    sectionHeadings: {
      minimumProcess: 'Decide whether this invoice needs a reminder or a person',
      operatingRhythm: 'Let each response set the next chase date',
      automationAndJudgement: 'Keep routine reminders separate from tailored contact',
      workedExample: 'Four customers, four chasing decisions',
      failurePoints: 'Where Xero invoice chasing wastes effort',
      productBridge: 'Prioritise the manual part of chasing',
      relatedGuides: 'Place chasing in the wider workflow',
    },
    processIntroduction:
      'This workflow starts after an invoice becomes overdue and ends with a controlled next state. Wider credit policy and escalation belong to the full credit-control process.',
    processStages: [
      {
        stage: 'Confirm the chase is valid',
        guidance:
          'Check Xero and the combined customer position. Exclude cleared payments, approved credits and duplicates.',
      },
      {
        stage: 'Leave routine cases in routine follow-up',
        guidance:
          'Use a configured reminder when the invoice is simply overdue and no context changes treatment.',
      },
      {
        stage: 'Choose the useful manual contacts',
        guidance:
          'Pull out failed promises, silence, disputes, material exposure and deterioration; order cases where contact can help.',
      },
      {
        stage: 'Ask for one concrete outcome',
        guidance:
          'Seek payment, an exact date or what is needed to remove a blocker. Route non-payment issues to their resolver.',
      },
      {
        stage: 'Set the next state before moving on',
        guidance:
          'Record paid, promised, blocked, no response or review needed, with an owner and return date.',
      },
    ],
    operatingIntroduction:
      'The latest payment or response should decide when and how the customer returns, not a fixed sequence of repeated emails.',
    operatingRhythm: [
      {
        cadence: 'At chase-list preparation',
        activity:
          'Refresh status, combine by contact and split reminders from manual exceptions.',
        purpose:
          'Prevents duplicate contact and wasted time.',
      },
      {
        cadence: 'Immediately after customer contact',
        activity:
          'Capture the commitment, blocker or failed contact and next owner.',
        purpose:
          'Makes the next chase evidence-led rather than repetitive.',
      },
      {
        cadence: 'When the recorded return point arrives',
        activity:
          'Check Xero and the assigned action, then close, contact, reroute or flag the case.',
        purpose:
          'Tests the promise or blocker when it becomes actionable.',
      },
    ],
    automationAndJudgement: {
      introduction:
        'Xero supports automated reminders for predictable nudges; they do not interpret a failed promise or hold a customer-specific conversation.',
      routineWork: [
        {
          task: 'Standard reminders for uncomplicated overdue invoices',
          guidance:
            'Use an appropriate schedule where no dispute, promise or risk changes the message.',
        },
        {
          task: 'Refresh payment and overdue status',
          guidance:
            'Remove paid or corrected items before contact.',
        },
      ],
      judgementWork: [
        {
          task: 'Choose who receives direct contact',
          guidance:
            'Prefer material cases with a question, change or failure that can be addressed now.',
        },
        {
          task: 'Choose the right treatment',
          guidance:
            'Choose a payment request, promise check, blocker hand-off or review.',
        },
      ],
    },
    workedExample: {
      businessContext:
        'An engineering consultancy uses Xero reminders and prepares a manual exception list twice a week.',
      previousApproach:
        'An administrator emailed every overdue invoice and left replies in the inbox, hiding which cases needed different treatment.',
      processIntroduced: [
        'Left responsive Dale Services in routine follow-up.',
        'Put Ember Group into direct founder contact after a missed £8,400 promise, asking for payment or the precise blocker.',
        'Stopped chasing Fleetworks’ disputed timesheet and gave the project owner a Thursday deadline.',
        'Called Grove Retail after its payment behaviour deteriorated and agreed dated part-payments.',
        'Recorded each result and return date.',
      ],
      operatingRhythm:
        'The administrator checks Xero, handles routine work and gives the founder only judgement-heavy conversations.',
      result:
        'Manual contact was reserved for securing cash, exposing a blocker or testing a failed commitment.',
      lesson:
        'Useful chasing reflects the customer’s current state.',
    },
    failurePoints: [
      {
        failure: 'Manually touching every invoice',
        consequence: 'Routine cases consume time needed for material exceptions.',
        betterApproach: 'Keep repeatable follow-up outside the small manual queue.',
      },
      {
        failure: 'Chasing a dispute as a payment problem',
        consequence: 'Payment requests do not resolve missing evidence or service issues.',
        betterApproach: 'Stop the chase, name the resolver and return when the blocker action is due.',
      },
      {
        failure: 'Asking only “when will you pay?”',
        consequence: 'A vague answer creates another vague follow-up.',
        betterApproach: 'Seek payment, a firm date or a specific blocker with an owner.',
      },
      {
        failure: 'Leaving the result in the inbox',
        consequence: 'Promises expire and the next person repeats the chase.',
        betterApproach: 'Record the state, owner and return date before opening the next customer.',
      },
    ],
    productBridge:
      'The product helps decide which overdue Xero customers should enter the manual exception queue first by combining accounting signals with founder-assigned risk. It does not write every message, resolve disputes or decide what a customer-specific conversation should promise.',
    ctaHeading: 'Start each manual chase session with the exceptions',
    ctaDescription:
      'See plans if finding the few Xero customers who need personal attention is the slow part.',
    ctaLabel: 'See plans and pricing',
    ctaHref: '/pricing',
    relatedSlugs: ['xero-credit-control', 'how-to-manage-overdue-customers-in-xero'],
    indexable: true,
  },
  {
    slug: 'how-to-manage-overdue-customers-in-xero',
    pageType: 'problem-outcome',
    intentFamily: 'xero',
    funnelStage: 'solution-aware',
    primaryKeyword: 'how to manage overdue customers in xero',
    secondaryKeywords: [
      'manage xero overdue customers',
      'xero overdue customer actions',
      'customer level debtors management xero',
    ],
    searchIntent: 'informational',
    queryCluster: 'manage-overdue-customers-xero',
    readerJob:
      'Manage a group of overdue Xero customers by assigning appropriate next actions and levels of attention.',
    uniqueAngle:
      'Move from invoice-level visibility to customer-level treatment and next-action management.',
    metaTitle: 'How to Manage Overdue Customers in Xero',
    metaDescription:
      'Turn Xero receivables into a controlled customer list with a priority, treatment, owner, next action and return date for every exception.',
    h1: 'How to manage overdue customers in Xero',
    directAnswer:
      'Manage overdue customers as cases, not invoice rows. Use current Xero information to give each contact a combined position, priority, treatment, owner, next action and return date. Choose routine follow-up, direct contact, blocker investigation, promise monitoring or escalation review according to the case. A rank alone is not a management plan.',
    whyItMatters:
      'Several invoices for one contact usually represent one situation. Kept separate, they can cause duplicate messages while hiding the real state. One customer needs a payment conversation, another a delivery document and another no contact until a promise date. Customer-level management keeps those paths visible.',
    sectionHeadings: {
      whyItMatters: 'One customer needs one controlled case',
      signals: 'Give every overdue customer a usable state',
      decisionRules: 'Choose treatment separately from priority',
      workedExample: 'Four overdue customers, four controlled paths',
      recommendedActions: 'The output: a customer control list',
      productBridge: 'Prioritisation supports treatment decisions',
      relatedGuides: 'Refine priority and follow-up',
    },
    signalIntroduction:
      'Use only the evidence needed to control what happens next. This is not a second prioritisation method: priority allocates attention, while state and treatment decide the work.',
    signals: [
      {
        key: 'customer-position',
        label: 'Combined customer position',
        explanation:
          'Review the contact’s relevant overdue transactions, credits and recent payments together so the case reflects total exposure and genuine progress.',
      },
      {
        key: 'payment-or-blocker',
        label: 'Current case state',
        explanation:
          'Classify the customer as routine, promised, blocked, needing direct contact or needing review. The state should explain why ordinary follow-up does or does not apply.',
      },
      {
        key: 'commitment-state',
        label: 'Treatment that can move the case',
        explanation:
          'Choose the action that addresses the state: reminder, payment conversation, document or dispute resolution, promise check or escalation decision.',
      },
      {
        key: 'next-action-control',
        label: 'Owner, next action and return date',
        explanation:
          'A case is controlled only when somebody is responsible, knows the next action and knows exactly when it comes back for review.',
      },
    ],
    decisionRules: [
      'Consolidate the current Xero position by customer, then choose a case state before choosing an action.',
      'Use priority to allocate scarce attention. Do not assume the highest-priority customer needs the same treatment as the next one.',
      'Keep uncomplicated cases in routine follow-up; route a genuine dispute or administration issue to the person able to remove it.',
      'Monitor a specific, credible promise until its date. A missed promise changes the evidence and normally returns the customer to direct contact or review.',
      'Close every review with one accountable owner, one next action and one return date so the list can be resumed without reconstructing the inbox.',
    ],
    workedExample: {
      introduction:
        'An IT services firm reviews four contacts from Xero. The figures inform attention, but the management output is four different states, treatments and next actions.',
      customers: [
        {
          name: 'Harbour Leisure',
          valueOutstanding: 22400,
          averageDaysLate: 41,
          daysSinceLastPayment: 83,
          founderRisk: 'high',
          founderRiskReason: 'A promised transfer failed and the finance contact is no longer responding.',
          rank: 1,
          rankReason:
            'High priority; treatment: direct founder chase and escalation review; next action: call the commercial sponsor today, then decide whether normal chasing has ended.',
        },
        {
          name: 'Juniper Foods',
          valueOutstanding: 14800,
          averageDaysLate: 27,
          daysSinceLastPayment: 38,
          founderRisk: 'medium',
          founderRiskReason: 'Payment is held against a disputed service milestone with documents now supplied.',
          rank: 2,
          rankReason:
            'Medium priority; treatment: dispute investigation; next action: the delivery lead sends acceptance evidence by Thursday, when finance reviews the case again.',
        },
        {
          name: 'Kingsway Dental',
          valueOutstanding: 11900,
          averageDaysLate: 19,
          daysSinceLastPayment: 16,
          founderRisk: 'low',
          founderRiskReason: 'A specific payment date is documented and remains credible.',
          rank: 3,
          rankReason:
            'Controlled priority; treatment: promise monitoring; next action: check Xero on the promised date and move to direct contact only if payment is absent.',
        },
        {
          name: 'Linden Studio',
          valueOutstanding: 3600,
          averageDaysLate: 8,
          daysSinceLastPayment: 21,
          founderRisk: 'low',
          founderRiskReason: 'The balance is uncomplicated and contact remains responsive.',
          rank: 4,
          rankReason:
            'Routine priority; treatment: standard follow-up; next action: keep the account in the ordinary reminder path and reopen it only if the state changes.',
        },
      ],
      conclusion:
        'The list now has four controlled paths: direct intervention, blocker resolution, promise monitoring and routine follow-up. Harbour receives attention first, but Juniper’s next useful action belongs to delivery, not collections. That distinction is what turns a ranked list into customer management.',
    },
    recommendedActions: [
      'Keep one row per contact with the combined overdue position and latest payment evidence from Xero.',
      'Add the current state, attention level, treatment, owner, next action and return date.',
      'Filter today’s work by return date and priority; do not reopen promised or blocked cases merely because they remain overdue.',
      'When new evidence arrives, update that customer’s state and treatment rather than starting the review again.',
    ],
    productBridge:
      'The product helps with one column in this control list: which overdue Xero customers deserve human attention first. It combines accounting signals with founder-assigned risk. Your team still sets the state, carries out the treatment, owns blockers and makes escalation decisions.',
    ctaHeading: 'Rank the human-attention column of your control list',
    ctaDescription:
      'See plans if customer states are clear but deciding which Xero accounts need attention first is still manual.',
    ctaLabel: 'See plans and pricing',
    ctaHref: '/pricing',
    relatedSlugs: [
      'how-to-prioritise-overdue-invoices-in-xero',
      'xero-invoice-chasing',
    ],
    indexable: true,
  },
  {
    slug: 'xero-credit-control-software',
    pageType: 'software-solution',
    intentFamily: 'xero',
    funnelStage: 'product-aware',
    primaryKeyword: 'xero credit control software',
    secondaryKeywords: [
      'xero collections software',
      'collections software for xero',
      'xero credit control app',
      'credit control app for xero',
    ],
    searchIntent: 'commercial',
    queryCluster: 'xero-credit-control-software',
    readerJob:
      'Evaluate whether additional credit-control software is needed alongside Xero and what type of solution best fits the business.',
    uniqueAngle:
      'Start from what Xero already provides, identify the remaining workflow and prioritisation need, explain the main solution approaches, and position our product specifically around prioritised human attention.',
    metaTitle: 'Xero Credit Control Software: What to Look For',
    metaDescription:
      'Decide whether to add credit-control software to Xero, identify the unresolved job and compare reminder, workflow, prioritisation and recovery tools.',
    h1: 'Xero credit control software',
    directAnswer:
      'Do not buy another app merely because Xero shows overdue invoices. Name the job still failing after Xero is configured: routine reminders, ownership and promises, human-attention priority or formal recovery. Buy only if a tool solves that constraint more safely and economically than your current process.',
    sectionHeadings: {
      existingPlatform: 'Start with the Xero capability you already pay for',
      additionalSoftware: 'Use a buy test, not a feature wish list',
      selectionCriteria: 'Questions to put to any Xero credit-control vendor',
      solutionApproaches: 'Match the software category to the unresolved job',
      productDifferentiation: 'Where our product fits — disclosed plainly',
      fit: 'Use this fit test before looking at plans',
      relatedGuides: 'See the process the software should support',
    },
    existingPlatformIntroduction:
      'Check the current Xero plan and settings first. Establish what its visibility and routine follow-up already solve.',
    existingPlatformCapabilities: [
      {
        capability: 'Invoice and payment status',
        guidance:
          'Xero tracks sales-invoice status, including outstanding and overdue items.',
        context:
          'Every downstream decision needs a current position.',
      },
      {
        capability: 'Aged receivables reporting',
        guidance:
          'Aged Receivables Summary and Detail show outstanding amounts and age.',
        context:
          'Age and value do not choose the next human action.',
      },
      {
        capability: 'Automated invoice reminders',
        guidance:
          'Xero can send customised automatic due or overdue reminders.',
        context:
          'Reminders do not interpret disputes, failed promises or deterioration.',
      },
    ],
    additionalSoftwareIntroduction:
      'Add software when a material failure persists, costs time or cash, and has an owner who will use the new workflow.',
    additionalSoftwareTriggers: [
      {
        trigger: 'Manual review no longer produces a reliable order',
        guidance:
          'Changing invoices and payments obscure which customer needs attention today.',
      },
      {
        trigger: 'Routine work crowds out customer judgement',
        guidance:
          'Uncomplicated cases consume time while material exceptions wait.',
      },
      {
        trigger: 'Ownership and follow-up state keep being lost',
        guidance:
          'Promises, disputes and return dates disappear into inboxes.',
      },
      {
        trigger: 'The current route has genuinely failed',
        guidance:
          'Ordinary chasing has ended and a specialist recovery decision is needed.',
      },
    ],
    selectionIntroduction:
      'Ask vendors to demonstrate your actual decision from synced Xero data, not recite features.',
    selectionCriteria: [
      {
        criterion: 'What data moves, how often and with what safeguards?',
        whyItMatters:
          'Confirm the sync scope, correction and failure handling, security controls and how access is revoked.',
      },
      {
        criterion: 'Does it show the customer or merely another invoice list?',
        whyItMatters:
          'Test several invoices, a part-payment and a dispute as one customer case.',
      },
      {
        criterion: 'What exact work is better on Monday morning?',
        whyItMatters:
          'Demand a concrete output: fewer messages, controlled promises, a priority order or a managed recovery case.',
      },
      {
        criterion: 'Where does automation stop and judgement begin?',
        whyItMatters:
          'A person should see exceptions and understand, override and own material decisions.',
      },
      {
        criterion: 'Is the operating cost proportionate?',
        whyItMatters:
          'Include setup, training, duplicate entry and process change. Test anonymised real scenarios before committing.',
      },
    ],
    approachesIntroduction:
      'Choose the category before the supplier. These are different buying decisions.',
    solutionApproaches: [
      {
        approach: 'Use Xero alone',
        bestFor:
          'A small, stable overdue book controlled with reports and reminders.',
        limitation:
          'Manual priority can fail as complexity rises.',
      },
      {
        approach: 'Reminder or chasing automation',
        bestFor:
          'Reducing repetitive messages for uncomplicated cases.',
        limitation:
          'More messages do not allocate judgement or resolve blockers.',
      },
      {
        approach: 'Workflow or prioritisation software',
        bestFor:
          'Controlling actions or turning evidence into an attention order.',
        limitation:
          'Ranking, case management and communication are separate capabilities.',
      },
      {
        approach: 'Specialist recovery software or service',
        bestFor:
          'Cases moving beyond ordinary chasing into formal recovery.',
        limitation:
          'This is distinct from day-to-day credit control.',
      },
    ],
    productDifferentiation: {
      introduction:
        'We sell this product, so this is a fit explanation, not an independent comparison. Its job is to direct limited human attention.',
      inputs: [
        {
          source: 'Relevant Xero accounting signals',
          contribution:
            'Exposure, payment behaviour and recency provide accounting evidence.',
        },
        {
          source: 'Founder-assigned customer risk',
          contribution:
            'The founder adds current knowledge outside the ledger.',
        },
      ],
      outcome:
        'A ranked overdue-customer queue for human attention.',
    },
    productBridge:
      'The product does not replace Xero, manage every action, send every reminder, resolve disputes or decide recovery. It is a prioritisation layer; choose another category if that is not the problem.',
    fitIntroduction:
      'Buy only if unclear attention order is the recurring constraint. Xero use alone is not a reason.',
    goodFit: [
      {
        situation: 'Xero-using SME with meaningful overdue volume',
        guidance:
          'Volume or change makes manual customer comparison unreliable.',
      },
      {
        situation: 'Limited founder or administrator attention',
        guidance:
          'A short queue protects time for cases needing a person.',
      },
      {
        situation: 'Unclear customer priorities',
        guidance:
          'Accounting facts and customer knowledge are not producing one order.',
      },
    ],
    poorFit: [
      {
        situation: 'Almost no overdue debt',
        guidance:
          'Manage a small, stable set directly in Xero.',
      },
      {
        situation: 'Existing workflow already produces a trusted order',
        guidance:
          'Another priority layer would duplicate a working queue.',
      },
      {
        situation: 'Primary need is reminders, case management or recovery',
        guidance:
          'Choose a product or service designed for that job.',
      },
    ],
    ctaHeading: 'Check the prioritisation product against your unresolved job',
    ctaDescription:
      'Review plans only if Xero data still leaves limited human time without a clear customer order.',
    ctaLabel: 'See plans and pricing',
    ctaHref: '/pricing',
    relatedSlugs: [
      'xero-credit-control',
      'how-to-prioritise-overdue-invoices-in-xero',
    ],
    indexable: true,
  },
] satisfies readonly SeoProblemPage[]
