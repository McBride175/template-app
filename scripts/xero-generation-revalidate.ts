#!/usr/bin/env node

import { parseArgs } from 'node:util'
import {
  formatXeroGenerationOperatorFailure,
  XERO_GENERATION_OPERATOR_TEST_PROJECT_REF,
} from '@/lib/xero/generation-operator'
import { runXeroGenerationRevalidationOperator } from '@/lib/xero/generation-revalidation-operator'

function printUsage() {
  console.log(`Test-only prepared Xero generation revalidation operator

Usage:
  pnpm xero:generation:revalidate -- \\
    --project-ref ${XERO_GENERATION_OPERATOR_TEST_PROJECT_REF} \\
    --user-id <uuid> \\
    --tenant-id <uuid> \\
    --grant-id <uuid> \\
    --run-id <uuid> \\
    [--dry-run]

Dry-run performs read-only current-contract validation. Execute mode reacquires
the same prepared run with a new finite fence, records current validation
evidence, and stops. Production and generation promotion are unavailable.`)
}

async function main() {
  try {
    const cliArgs = process.argv.slice(2)
    if (cliArgs[0] === '--') cliArgs.shift()
    const { values, positionals } = parseArgs({
      args: cliArgs,
      allowPositionals: true,
      strict: true,
      options: {
        'project-ref': { type: 'string' },
        'user-id': { type: 'string' },
        'tenant-id': { type: 'string' },
        'grant-id': { type: 'string' },
        'run-id': { type: 'string' },
        'dry-run': { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    })

    if (values.help) {
      printUsage()
    } else {
      if (positionals.length > 0) throw new Error('Unexpected positional arguments')
      const output = await runXeroGenerationRevalidationOperator({
        input: {
          projectRef: values['project-ref'] ?? '',
          userId: values['user-id'] ?? '',
          tenantId: values['tenant-id'] ?? '',
          grantId: values['grant-id'] ?? '',
          syncRunId: values['run-id'] ?? '',
          dryRun: values['dry-run'] ?? false,
        },
      })
      console.log(JSON.stringify(output, null, 2))
    }
  } catch (error) {
    const failure = formatXeroGenerationOperatorFailure(error)
    console.error(JSON.stringify(failure.output, null, 2))
    process.exitCode = failure.exitCode
  }
}

void main()
