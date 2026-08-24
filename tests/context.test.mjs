import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  contextBootstrap,
  contextRefresh,
  readContextManifest,
  writeContextManifest
} from '../scripts/lib/context.mjs'

test('a rejected plan id reports what it received, so a truncation is visible', async () => {
  // A model that drops a character while copying the id gets told only that the
  // id is invalid, concludes the user typed it wrong, and asks them to retype a
  // value they got right. The error has to show the evidence of who lost it.
  const truncated = '6a84dc17b3fb9bc40143d6a'

  await assert.rejects(
    contextBootstrap({ planId: truncated }),
    error => {
      assert.match(error.message, /24-hex Test Plan id/)
      assert.match(error.message, /23 characters/)
      assert.ok(
        error.message.includes(truncated),
        'the received value must appear so it can be compared with the original'
      )
      assert.match(error.message, /never ask them to retype it/i)
      return true
    }
  )
})

test('an absent plan id is refused without inventing a length', async () => {
  await assert.rejects(contextBootstrap({}), error => {
    assert.match(error.message, /24-hex Test Plan id/)
    assert.match(error.message, /0 characters/)
    return true
  })
})

test('refresh replaces a stale case tree without repeating preparation', async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'voidr-context-refresh-'))
  const repositoryPath = join(workspaceRoot, 'tests')
  mkdirSync(repositoryPath)
  const planId = '6a8c94c96650202061d129c7'
  const repositoryUrl = 'https://github.com/voidrco/example-tests'
  const bootstrap = {
    npmInstall: true,
    linked: true,
    scaffolded: true,
    envPulled: true
  }

  writeContextManifest(repositoryPath, {
    version: 1,
    createdAt: '2026-08-24T19:34:03.000Z',
    organizationId: 'org_example',
    applicationId: '6a85d378d1984807c820348e',
    planId,
    environmentSlug: 'principal',
    repository: {
      url: repositoryUrl,
      path: repositoryPath,
      defaultBranch: 'main'
    },
    modules: [{ slug: 'feature-mock', suites: [{ slug: 'SYNCG', cases: ['FEATU-01'] }] }],
    sessions: [],
    bootstrap
  })

  const callRemote = async name => {
    const payload = name === 'test_plans_get_test_plan'
      ? {
          _id: planId,
          applicationId: '6a85d378d1984807c820348e',
          createdBy: { organizationId: 'org_example' },
          gitProviderConfig: { repositoryUrl, defaultBranch: 'main' },
          modules: [
            {
              slug: 'feature-mock',
              suites: [
                {
                  slug: 'SYNCG',
                  cases: [
                    { slug: 'FEATU-01' },
                    { slug: 'FEATU-02' },
                    { slug: 'FEATU-03' }
                  ]
                }
              ]
            }
          ]
        }
      : name === 'applications_list_environments'
        ? { data: [{ name: 'Principal', slug: 'principal', applicationUrl: 'https://example.test' }] }
        : { data: [{ sessionId: 'session-current' }] }
    return { content: [{ type: 'text', text: JSON.stringify(payload) }] }
  }

  try {
    const result = await contextRefresh({
      planId,
      workspaceRoot,
      callRemote,
      locate: async () => ({ path: repositoryPath }),
      prepare: async () => {
        throw new Error('refresh must not prepare the repository')
      }
    })
    const manifest = readContextManifest(repositoryPath)

    assert.equal(result.refreshed, true)
    assert.equal(result.prepared, null)
    assert.equal(manifest.createdAt, '2026-08-24T19:34:03.000Z')
    assert.ok(manifest.updatedAt)
    assert.deepEqual(manifest.bootstrap, bootstrap)
    assert.deepEqual(manifest.modules[0].suites[0].cases, [
      'FEATU-01',
      'FEATU-02',
      'FEATU-03'
    ])
    assert.deepEqual(manifest.sessions, ['session-current'])
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true })
  }
})
