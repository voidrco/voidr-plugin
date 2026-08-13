#!/usr/bin/env node

// Syncs the Voidr skill catalog to the host's skills directory.
//
// Runs two ways:
//   - as Claude Code's SessionStart hook, reading the payload on stdin;
//   - by hand, on any host:  node scripts/sync-voidr-skills.mjs --force
//
// Never fails the session. A missing credential, an offline machine, or a broken
// catalog leaves whatever is already on disk in place and exits 0 — a skill that
// did not refresh is a much smaller problem than a session that will not start.

import { authStatus } from './lib/credentials.mjs'
import { CLAUDE, detectHost } from './lib/host.mjs'
import {
  minSyncIntervalMs,
  skillsRoot,
  syncScopes,
  syncSkills
} from './lib/skills-sync.mjs'
import { VoidrRestClient } from './lib/voidr-rest.mjs'

const isHookInvocation = !process.stdin.isTTY && !process.argv.includes('--standalone')
const force = process.argv.includes('--force')
const projectScope = process.argv.includes('--project')
const verbose = process.argv.includes('--verbose')

const payload = isHookInvocation ? await readPayload() : {}
const host = detectHost(payload)

try {
  const status = authStatus()
  if (!status.authenticated) {
    finish({ note: 'Voidr is not connected; skills were not synced.' })
  }

  const root = skillsRoot({
    scope: projectScope ? 'project' : 'user',
    workspace: payload.cwd || process.cwd()
  })
  const scopes = syncScopes()
  const rest = new VoidrRestClient()

  const client = {
    async list() {
      const response = await rest.get('skills')
      return response?.data?.skills || []
    },
    async get(name) {
      const response = await rest.get(
        `skills/resolve/${encodeURIComponent(name)}?includeAssets=true`
      )
      return response?.data || {}
    }
  }

  const result = await syncSkills({
    client,
    root,
    scopes,
    minIntervalMs: force ? 0 : minSyncIntervalMs(),
    force
  })

  if (result.skipped === 'throttled') {
    finish({ note: 'Skill sync skipped: the catalog was refreshed recently.' })
  }

  const changed = result.written.length + result.removed.length
  const summary =
    changed === 0
      ? `Voidr skills already up to date (${result.kept.length} in place).`
      : `Voidr skills synced: ${result.written.length} written, ${result.removed.length} removed, ${result.kept.length} unchanged.`

  const failures = (result.failed || []).length
    ? ` ${result.failed.length} skill(s) could not be read: ${result.failed
        .map(failure => failure.name)
        .join(', ')}.`
    : ''

  finish({
    note: `${summary}${failures}`,
    // Only speak up when something actually changed. A line on every session
    // start is noise, and noise gets ignored.
    announce: changed > 0 || failures.length > 0,
    root,
    scopes
  })
} catch (error) {
  finish({ note: `Skill sync skipped: ${error?.message || error}` })
}

function finish({ note, announce = false, root, scopes } = {}) {
  if (verbose) process.stderr.write(`${note}${root ? ` root=${root}` : ''}${scopes ? ` scopes=${scopes.join(',')}` : ''}\n`)

  if (!isHookInvocation) {
    process.stdout.write(`${note}\n`)
    process.exit(0)
  }

  // Claude reads SessionStart context from hookSpecificOutput; a synced skill
  // only becomes callable next session, so saying so is worth one line.
  const output = announce
    ? host === CLAUDE
      ? {
          hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext: `${note} New or changed skills load on the next session.`
          },
          systemMessage: note
        }
      : { systemMessage: note }
    : {}
  process.stdout.write(`${JSON.stringify(output)}\n`)
  process.exit(0)
}

async function readPayload() {
  let input = ''
  try {
    for await (const chunk of process.stdin) input += chunk
    return input.trim() ? JSON.parse(input) : {}
  } catch {
    return {}
  }
}
