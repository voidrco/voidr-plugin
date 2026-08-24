import test from 'node:test'
import assert from 'node:assert/strict'
import {
  States,
  createWorkflow,
  transition
} from '../../scripts/lib/workflow-contract.mjs'
import { loadPolicy } from '../../scripts/lib/policy.mjs'

test('natural-language greenfield journey reaches deploy and execution through every gate', () => {
  const transcript = []
  let workflow = createWorkflow()
  transcript.push({
    user: 'Quero desenvolver testes na Voidr',
    assistant: workflow.prompt,
    actions: workflow.actions
  })
  assert.match(transcript[0].assistant, /novo Test Plan.*existente/i)
  assert.deepEqual(transcript[0].actions, [])

  workflow = transition(workflow, {
    type: 'PLAN_MODE_CHOSEN',
    mode: 'new'
  })
  assert.deepEqual(workflow.actions, [
    { tool: 'voidr_auth_status', mutation: false }
  ])

  workflow = transition(workflow, {
    type: 'AUTHENTICATION_CONFIRMED',
    organizationId: 'org-blip'
  })
  assert.deepEqual(workflow.actions, [
    { tool: 'applications_list_applications', mutation: false }
  ])
  workflow = transition(workflow, {
    type: 'APPLICATION_SELECTED',
    applicationId: 'app-monitor',
    applicationName: 'Blip Monitor',
    applicationType: 'API',
    confirmedByUser: true
  })
  assert.equal(workflow.context.applicationId, 'app-monitor')
  assert.equal(workflow.context.applicationType, 'API')
  assert.deepEqual(workflow.actions, [
    {
      tool: 'applications_list_environments',
      mutation: false,
      applicationId: 'app-monitor'
    }
  ])
  workflow = transition(workflow, {
    type: 'ENVIRONMENT_SELECTED',
    environmentName: 'staging',
    environmentSlug: 'staging',
    applicationUrl: 'https://monitor.staging.example.test',
    fromMcp: true,
    confirmedByUser: true
  })
  assert.match(workflow.prompt, /qual feature ou jornada/i)
  assert.deepEqual(workflow.actions, [])

  workflow = transition(workflow, {
    type: 'FEATURE_SELECTED',
    feature: 'Monitoramento de indisponibilidade'
  })
  assert.equal(workflow.state, States.FEATURE_SELECTED)
  assert.equal(workflow.context.feature, 'Monitoramento de indisponibilidade')
  assert.match(workflow.prompt, /sondas locais de inspeção/i)
  workflow = transition(workflow, {
    type: 'LOCAL_SMOKE_TARGET_SELECTED',
    mode: 'platform'
  })
  assert.equal(
    workflow.context.localSmokeBaseUrl,
    'https://monitor.staging.example.test'
  )
  assert.match(workflow.prompt, /Com base em quais insumos/i)
  workflow = transition(workflow, {
    type: 'PLAN_CONTEXT_SOURCE_SELECTED',
    source: 'business'
  })
  workflow = transition(workflow, {
    type: 'NEW_PLAN_CONTEXT_COLLECTED',
    source: 'business',
    evidence: [
      'user-confirmed: endpoint availability and latency thresholds are critical'
    ],
    criticalScenarios: ['endpoint indisponível', 'latência acima do limite'],
    expectedBehavior: 'A plataforma registra e alerta a indisponibilidade.',
    outOfScope: 'Falhas de infraestrutura da própria Voidr',
    preconditions: ['Endpoint sintético controlado']
  })
  assert.match(workflow.prompt, /Confirmar insumos do planejamento/i)
  workflow = transition(workflow, {
    type: 'PLAN_CONTEXT_CONFIRMED'
  })
  workflow = transition(workflow, {
    type: 'NEW_PLAN_DRAFTED',
    feature: 'Monitoramento de indisponibilidade',
    caseSlugs: ['MONITOR-001', 'MONITOR-002']
  })
  assert.equal(workflow.state, States.PLAN_DRAFTED)
  assert.equal(workflow.actions.length, 0)

  workflow = transition(workflow, {
    type: 'NEW_PLAN_APPROVED',
  })
  assert.deepEqual(workflow.actions, [
    { tool: 'test_plans_create_test_plan', mutation: true }
  ])
  workflow = transition(workflow, {
    type: 'NEW_PLAN_REPOSITORY_PROVISIONED',
    planId: '0123456789abcdef01234567',
    repository: {
      url: 'https://github.com/voidrco/voidr-tp-monitor',
      owner: 'voidrco',
      name: 'voidr-tp-monitor',
      defaultBranch: 'main'
    }
  })
  assert.deepEqual(
    workflow.actions.map(action => action.tool),
    ['test_plans_populate_test_plan', 'test_plans_get_test_plan']
  )

  workflow = transition(workflow, {
    type: 'TEST_REPOSITORY_SELECTED',
    path: '/workspace/blip-monitor-tests'
  })
  workflow = transition(workflow, {
    type: 'PROJECT_LINK_CHECKED',
    status: 'missing'
  })
  assert.match(workflow.prompt, /criar project\.json/i)
  workflow = transition(workflow, { type: 'PROJECT_LINK_APPROVED' })
  workflow = transition(workflow, { type: 'LOCAL_VALIDATION_PASSED' })

  workflow = transition(workflow, {
    type: 'VALIDATION_CANDIDATE_VERIFIED',
    validationOutcome: 'PASSED',
    codebaseVersion: 'b'.repeat(64)
  })
  assert.match(workflow.prompt, /testes passaram/i)

  workflow = transition(workflow, {
    type: 'DEPLOY_APPROVED',
    repositoryDelivery: 'SYNC'
  })
  assert.deepEqual(workflow.actions, [
    {
      tool: 'voidr_release_deploy_live',
      mutation: true,
      codebaseVersion: 'b'.repeat(64),
      repositoryDelivery: 'SYNC'
    }
  ])
  workflow = transition(workflow, {
    type: 'RELEASE_DEPLOYED',
    immutableCandidateVerified: true,
    codebaseVersion: 'b'.repeat(64),
    latestVerified: true,
    latestCodebaseVersion: 'b'.repeat(64)
  })
  assert.equal(workflow.state, States.RELEASE_LATEST_VERIFIED)
  assert.deepEqual(
    workflow.actions.map(action => action.tool),
    ['test_plans_get_test_plan', 'test_plans_get_test_counts']
  )
  workflow = transition(workflow, {
    type: 'DEPLOY_SYNC_VERIFIED',
    syncVerified: true
  })
  assert.match(workflow.prompt, /iniciar esta execução/i)

  workflow = transition(workflow, { type: 'EXECUTION_APPROVED' })
  assert.deepEqual(workflow.actions, [
    { tool: 'executions_create_execution', mutation: true }
  ])
  workflow = transition(workflow, {
    type: 'EXECUTION_CREATED',
    executionId: 'execution-e2e'
  })
  workflow = transition(workflow, { type: 'COMPLETED' })
  assert.equal(workflow.state, States.COMPLETED)

  const forbidden = new Set(loadPolicy().forbiddenTools)
  const allActions = transcript
    .flatMap(item => item.actions)
    .concat(workflow.actions)
  assert.equal(
    allActions.some(action => forbidden.has(action.tool)),
    false
  )
})

test('greenfield journey without credentials redirects to voidr-setup and stops', () => {
  let workflow = createWorkflow()
  workflow = transition(workflow, {
    type: 'PLAN_MODE_CHOSEN',
    mode: 'new'
  })
  workflow = transition(workflow, {
    type: 'AUTHENTICATION_MISSING'
  })

  assert.equal(workflow.state, States.AUTHENTICATION_REQUIRED)
  assert.deepEqual(workflow.actions, [])
  assert.equal(workflow.context.organizationId, null)
  assert.equal(workflow.context.applicationId, null)
  assert.match(workflow.prompt, /\/copilot voidr-setup/)
})

test('existing-plan journey does not use project.json as a selector', () => {
  let workflow = createWorkflow()
  workflow = transition(workflow, {
    type: 'PLAN_MODE_CHOSEN',
    mode: 'existing'
  })
  workflow = transition(workflow, {
    type: 'AUTHENTICATION_CONFIRMED',
    organizationId: 'org-blip'
  })
  assert.deepEqual(workflow.actions, [
    { tool: 'applications_list_applications', mutation: false }
  ])
  workflow = transition(workflow, {
    type: 'APPLICATION_SELECTED',
    applicationId: 'app-monitor',
    applicationName: 'Blip Monitor',
    applicationType: 'WEB',
    confirmedByUser: true
  })
  workflow = transition(workflow, {
    type: 'ENVIRONMENT_SELECTED',
    environmentName: 'produção',
    environmentSlug: 'producao',
    applicationUrl: 'https://monitor.example.test',
    fromMcp: true,
    confirmedByUser: true
  })
  workflow = transition(workflow, {
    type: 'EXISTING_PLAN_SELECTED',
    planId: 'abcdef0123456789abcdef01',
    caseSlugs: ['MONITOR-001']
  })
  assert.equal(workflow.context.planId, 'abcdef0123456789abcdef01')
  workflow = transition(workflow, { type: 'EXISTING_PLAN_CONFIRMED' })
  workflow = transition(workflow, {
    type: 'TEST_REPOSITORY_SELECTED',
    path: '/workspace/legacy-tests'
  })
  workflow = transition(workflow, {
    type: 'PROJECT_LINK_CHECKED',
    status: 'mismatch'
  })

  assert.equal(workflow.context.planId, 'abcdef0123456789abcdef01')
  assert.equal(workflow.state, States.TEST_REPOSITORY_SELECTED)
  assert.deepEqual(workflow.actions, [])
  assert.match(workflow.prompt, /relinkar/i)
})
