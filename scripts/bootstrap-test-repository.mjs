#!/usr/bin/env node

import { bootstrapTestRepository } from './lib/bootstrap.mjs'

const options = parseArgs(process.argv.slice(2))
for (const required of ['target', 'org-id', 'app-id', 'plan-id']) {
  if (!options[required]) {
    fail(`Missing required option --${required}`)
  }
}

try {
  const result = bootstrapTestRepository({
    target: options.target,
    name: options.name,
    organizationId: options['org-id'],
    applicationId: options['app-id'],
    testPlanId: options['plan-id'],
    workspaceRoot: options['workspace-root'] || process.cwd()
  })
  process.stdout.write(`${JSON.stringify(result)}\n`)
} catch (error) {
  fail(error instanceof Error ? error.message : 'Repository bootstrap failed.')
}

function parseArgs(args) {
  const parsed = {}
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]
    if (!token.startsWith('--')) fail(`Unexpected argument: ${token}`)
    const key = token.slice(2)
    const value = args[index + 1]
    if (!value || value.startsWith('--')) fail(`Missing value for --${key}`)
    parsed[key] = value
    index += 1
  }
  return parsed
}

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}
