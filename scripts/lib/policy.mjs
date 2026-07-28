import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const moduleDir = dirname(fileURLToPath(import.meta.url))
const policyPath = resolve(moduleDir, '../../policy/tool-policy.json')

export function loadPolicy() {
  const policy = JSON.parse(readFileSync(policyPath, 'utf8'))
  if (policy.schemaVersion !== 1) {
    throw new Error(`Unsupported tool policy schema: ${policy.schemaVersion}`)
  }
  return policy
}

export function canonicalToolName(value) {
  const name = String(value || '')
  const policy = loadPolicy()
  const known = [
    ...policy.safeRemoteTools,
    ...policy.localTools,
    ...policy.forbiddenTools
  ].sort((a, b) => b.length - a.length)

  return known.find(candidate => {
    return (
      name === candidate ||
      name.endsWith(`-${candidate}`) ||
      name.endsWith(`__${candidate}`) ||
      name.endsWith(`/${candidate}`) ||
      name.endsWith(`(${candidate})`)
    )
  }) || name
}

export function isWriteTool(name) {
  const policy = loadPolicy()
  const canonical = canonicalToolName(name)
  return (
    policy.writeRemoteTools.includes(canonical) ||
    (policy.writeLocalTools || []).includes(canonical)
  )
}
