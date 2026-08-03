import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const manifestPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../plugin.json'
)

let cached = null

export function pluginVersion() {
  if (cached) return cached
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    cached = typeof manifest.version === 'string' ? manifest.version : '0.0.0'
  } catch {
    cached = '0.0.0'
  }
  return cached
}
