import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildExecutionUrl,
  enrichToolResultWithExecutionLinks,
  executionIdsFromToolInput,
  executionIdsFromToolResult
} from '../scripts/lib/execution-links.mjs'

test('builds the production execution route', () => {
  assert.equal(
    buildExecutionUrl(
      '6a6a839850a27b89d2d7df2b',
      'https://platform.voidr.co/'
    ),
    'https://platform.voidr.co/execution/6a6a839850a27b89d2d7df2b'
  )
})

test('adds deterministic execution metadata to evidence tool results', () => {
  const executionId = '6a6a839850a27b89d2d7df2b'
  const result = enrichToolResultWithExecutionLinks(
    'playwright_get_test_timeline',
    { executionId, testCaseSlug: 'POLAR-182' },
    {
      content: [{ type: 'text', text: '{"status":"FAILED"}' }]
    },
    'https://platform.voidr.co'
  )

  const metadata = JSON.parse(result.content.at(-1).text)
  assert.equal(metadata.executionEvidence[0].executionId, executionId)
  assert.equal(
    metadata.requiredUserFacingOutput,
    `Execution: [Open execution](https://platform.voidr.co/execution/${executionId})`
  )
})

test('derives the latest execution from test history results', () => {
  const executionId = '6a6a814011024018378d4e19'
  assert.deepEqual(
    executionIdsFromToolResult('playwright_get_test_history', {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            history: [
              { executionId, status: 'FAILED' },
              {
                executionId: '6a6a7ee850a27b89d2d70337',
                status: 'PASSED'
              }
            ]
          })
        }
      ]
    }),
    [executionId]
  )
})

test('derives execution evidence from both defect creation tools', () => {
  const executionId = '6a6a814011024018378d4e19'
  for (const tool of [
    'defects_create_defect',
    'defects_create_defect_with_issue'
  ]) {
    assert.deepEqual(
      executionIdsFromToolInput(tool, {
        relations: { executions: [executionId] }
      }),
      [executionId]
    )
  }
})
