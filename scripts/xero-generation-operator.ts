#!/usr/bin/env node

import { parseArgs } from 'node:util'
import {
  formatXeroGenerationOperatorFailure,
  runXeroGenerationOperator,
  XERO_GENERATION_OPERATOR_TEST_PROJECT_REF,
} from '@/lib/xero/generation-operator'

function printUsage() {
  console.log(`Test-only inactive Xero generation operator

Usage:
  pnpm xero:generation:operator -- \\
    --project-ref ${XERO_GENERATION_OPERATOR_TEST_PROJECT_REF} \\
    --user-id <uuid> \\
    --tenant-id <uuid> \\
    --grant-id <uuid> \\
    [--dry-run]

The command is structurally restricted to Test, invokes the importer at most once,
and has no generation-promotion capability. Use --dry-run for read-only preflight.`)
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
        'dry-run': { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    })

    if (values.help) {
      printUsage()
    } else {
      if (positionals.length > 0) throw new Error('Unexpected positional arguments')
      const output = await runXeroGenerationOperator({
        input: {
          projectRef: values['project-ref'] ?? '',
          userId: values['user-id'] ?? '',
          tenantId: values['tenant-id'] ?? '',
          grantId: values['grant-id'] ?? '',
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
