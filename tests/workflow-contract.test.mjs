import test from 'node:test'
import assert from 'node:assert/strict'
import {
  States,
  createWorkflow,
  transition
} from '../scripts/lib/workflow-contract.mjs'

test('asks new versus existing before any tool action', () => {
  const workflow = createWorkflow()
  assert.equal(workflow.state, States.INTAKE)
  assert.match(workflow.prompt, /novo Test Plan.*existente/i)
  assert.deepEqual(workflow.actions, [])

  const chosen = transition(workflow, {
    type: 'PLAN_MODE_CHOSEN',
    mode: 'new'
  })
  assert.deepEqual(chosen.actions, [
    { tool: 'voidr_auth_status', mutation: false }
  ])

  const authenticated = transition(chosen, {
    type: 'AUTHENTICATION_CONFIRMED',
    organizationId: 'org-voidr'
  })
  assert.equal(authenticated.state, States.AUTHENTICATED)
  assert.deepEqual(authenticated.actions, [
    { tool: 'applications_list_applications', mutation: false }
  ])
  assert.throws(
    () =>
      transition(authenticated, {
        type: 'APPLICATION_SELECTED',
        applicationId: 'app-voidr',
        applicationName: 'Voidr Monitor',
        applicationType: 'WEB'
      }),
    /explicitly confirmed/i
  )
  assert.throws(
    () =>
      transition(chosen, {
        type: 'APPLICATION_SELECTED',
        applicationId: 'workspace-folder',
        applicationName: 'demo-consulta-pj',
        applicationType: 'WEB',
        confirmedByUser: true
      }),
    /Expected AUTHENTICATED/
  )
})

test('missing authentication stops and redirects to voidr-connect', () => {
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
  assert.match(workflow.prompt, /\/copilot voidr-connect/)
  assert.throws(
    () =>
      transition(workflow, {
        type: 'AUTHENTICATION_CONFIRMED',
        organizationId: 'org-voidr'
      }),
    /Expected PLAN_MODE_SELECTED/
  )
})

test('new plan requires approval before platform mutations', () => {
  let workflow = createWorkflow()
  workflow = transition(workflow, {
    type: 'PLAN_MODE_CHOSEN',
    mode: 'new'
  })
  workflow = selectApplicationFromMcp(workflow)
  assert.match(workflow.prompt, /qual feature ou jornada/i)
  assert.deepEqual(workflow.actions, [])
  assert.throws(
    () =>
      transition(workflow, {
        type: 'NEW_PLAN_DRAFTED',
        feature: 'Login',
        caseSlugs: ['LOGIN-001']
      }),
    /Expected PLAN_CONTEXT_CONFIRMED/
  )
  workflow = collectNewPlanScope(workflow, 'Login com MFA')
  workflow = transition(workflow, {
    type: 'NEW_PLAN_DRAFTED',
    feature: 'Login com MFA',
    caseSlugs: ['LOGIN-001', 'LOGIN-002']
  })
  assert.equal(workflow.state, States.PLAN_DRAFTED)
  assert.deepEqual(workflow.actions, [])
  assert.match(workflow.prompt, /Aprova/)

  workflow = transition(workflow, {
    type: 'NEW_PLAN_APPROVED',
    planId: '0123456789abcdef01234567'
  })
  assert.equal(workflow.state, States.PLAN_APPROVED)
  assert.deepEqual(
    workflow.actions.map(action => action.tool),
    [
      'test_plans_create_test_plan',
      'test_plans_populate_test_plan',
      'test_plans_get_test_plan'
    ]
  )
})

test('new plan cannot infer a different feature from application or repository context', () => {
  let workflow = createWorkflow()
  workflow = transition(workflow, {
    type: 'PLAN_MODE_CHOSEN',
    mode: 'new'
  })
  workflow = selectApplicationFromMcp(workflow)
  workflow = collectNewPlanScope(workflow, 'Recuperação de senha')

  assert.throws(
    () =>
      transition(workflow, {
        type: 'NEW_PLAN_DRAFTED',
        feature: 'Login com dados válidos',
        caseSlugs: ['LOGIN-001']
      }),
    /preserve the user-selected feature/i
  )
})

test('platform environment and localhost smoke remain separate confirmed targets', () => {
  let workflow = createWorkflow()
  workflow = transition(workflow, {
    type: 'PLAN_MODE_CHOSEN',
    mode: 'new'
  })
  workflow = transition(workflow, {
    type: 'AUTHENTICATION_CONFIRMED',
    organizationId: 'org-voidr'
  })
  workflow = transition(workflow, {
    type: 'APPLICATION_SELECTED',
    applicationId: 'app-voidr',
    applicationName: 'Voidr Monitor',
    applicationType: 'WEB',
    confirmedByUser: true
  })
  assert.throws(
    () =>
      transition(workflow, {
        type: 'ENVIRONMENT_SELECTED',
        environmentName: 'produção',
        environmentSlug: 'producao',
        applicationUrl: 'https://prod.example.test',
        fromMcp: true
      }),
    /explicitly confirmed/i
  )
  workflow = transition(workflow, {
    type: 'ENVIRONMENT_SELECTED',
    environmentName: 'produção',
    environmentSlug: 'producao',
    applicationUrl: 'https://prod.example.test',
    fromMcp: true,
    confirmedByUser: true
  })
  workflow = transition(workflow, {
    type: 'FEATURE_SELECTED',
    feature: 'Login'
  })
  assert.equal(workflow.context.applicationType, 'WEB')
  assert.match(workflow.prompt, /aplicação selecionada é WEB/i)
  workflow = transition(workflow, {
    type: 'LOCAL_SMOKE_TARGET_SELECTED',
    mode: 'localhost',
    baseUrl: 'http://localhost:5173'
  })

  assert.equal(workflow.context.platformEnvironmentSlug, 'producao')
  assert.equal(workflow.context.platformEnvironmentUrl, 'https://prod.example.test')
  assert.equal(workflow.context.localSmokeMode, 'localhost')
  assert.equal(workflow.context.localSmokeBaseUrl, 'http://localhost:5173')
  assert.match(workflow.prompt, /Com base em quais insumos/i)
})

test('explicit product repository analysis can supply evidence-backed plan context', () => {
  let workflow = createWorkflow()
  workflow = transition(workflow, {
    type: 'PLAN_MODE_CHOSEN',
    mode: 'new'
  })
  workflow = selectApplicationFromMcp(workflow)
  workflow = transition(workflow, {
    type: 'FEATURE_SELECTED',
    feature: 'Login'
  })
  workflow = transition(workflow, {
    type: 'LOCAL_SMOKE_TARGET_SELECTED',
    mode: 'platform'
  })
  workflow = transition(workflow, {
    type: 'PLAN_CONTEXT_SOURCE_SELECTED',
    source: 'codebase'
  })
  workflow = transition(workflow, {
    type: 'NEW_PLAN_CONTEXT_COLLECTED',
    source: 'codebase',
    productRepositories: ['/workspace/demo-consulta-pj'],
    evidence: [
      'src/routes/login.ts validates credentials and redirects authenticated users'
    ],
    criticalScenarios: ['valid credentials', 'invalid credentials'],
    expectedBehavior:
      'Valid credentials create a session; invalid credentials show an error.',
    preconditions: ['Synthetic credentials are supplied through environment variables']
  })

  assert.equal(workflow.state, States.PLAN_CONTEXT_COLLECTED)
  assert.equal(workflow.context.contextSource, 'codebase')
  assert.deepEqual(workflow.context.productRepositories, [
    '/workspace/demo-consulta-pj'
  ])
  assert.equal(workflow.context.contextEvidence.length, 1)
  assert.match(workflow.context.outOfScope, /não determinado pela codebase/i)
  assert.match(workflow.prompt, /Confirmar insumos do planejamento/i)
  assert.deepEqual(workflow.actions, [])
})

test('routing metadata cannot be used as Test Plan evidence', () => {
  let workflow = createWorkflow()
  workflow = transition(workflow, {
    type: 'PLAN_MODE_CHOSEN',
    mode: 'new'
  })
  workflow = selectApplicationFromMcp(workflow)
  workflow = transition(workflow, {
    type: 'FEATURE_SELECTED',
    feature: 'Consulta de CNPJ'
  })
  workflow = transition(workflow, {
    type: 'LOCAL_SMOKE_TARGET_SELECTED',
    mode: 'platform'
  })

  assert.match(workflow.prompt, /Com base em quais insumos/i)
  assert.throws(
    () =>
      transition(workflow, {
        type: 'NEW_PLAN_DRAFTED',
        feature: 'Consulta de CNPJ',
        caseSlugs: ['CNPJ-001']
      }),
    /Expected PLAN_CONTEXT_CONFIRMED/
  )

  workflow = transition(workflow, {
    type: 'PLAN_CONTEXT_SOURCE_SELECTED',
    source: 'documentation'
  })
  assert.throws(
    () =>
      transition(workflow, {
        type: 'NEW_PLAN_CONTEXT_COLLECTED',
        source: 'documentation',
        evidence: [],
        criticalScenarios: ['consulta válida'],
        expectedBehavior: 'Exibir o resultado',
        outOfScope: 'Não informado',
        preconditions: []
      }),
    /concrete evidence/i
  )
})

test('project.json mismatch cannot silently change the selected plan', () => {
  let workflow = existingPlanThroughRepositorySelection()
  workflow = transition(workflow, {
    type: 'PROJECT_LINK_CHECKED',
    status: 'mismatch'
  })
  assert.equal(workflow.state, States.TEST_REPOSITORY_SELECTED)
  assert.match(workflow.prompt, /não corresponde.*relinkar/i)
  assert.deepEqual(workflow.actions, [])
  assert.equal(workflow.context.planId, 'abcdef0123456789abcdef01')
})

test('deployment is impossible until a clean merged PR is verified', () => {
  let workflow = readyToDeploy()
  assert.match(workflow.prompt, /PR.*mergeado/i)
  assert.throws(
    () => transition(workflow, { type: 'DEPLOY_APPROVED' }),
    /Expected PR_MERGE_VERIFIED/
  )
  assert.throws(
    () =>
      transition(workflow, {
        type: 'PR_MERGE_VERIFIED',
        ...mergedPrEvidence(),
        prMerged: false,
        state: 'OPEN'
      }),
    /Deploy requires/
  )
})

test('execution requires merged PR, immutable latest, and independent sync', () => {
  let workflow = readyToDeploy()
  workflow = transition(workflow, {
    type: 'PR_MERGE_VERIFIED',
    ...mergedPrEvidence()
  })
  assert.equal(workflow.state, States.PR_MERGE_VERIFIED)
  assert.match(workflow.prompt, /release imutável.*latest/i)

  workflow = transition(workflow, { type: 'DEPLOY_APPROVED' })
  assert.deepEqual(workflow.actions, [
    {
      tool: 'voidr_release_deploy_merged_pr',
      mutation: true,
      pullRequestNumber: 42,
      mergeCommitSha: 'a'.repeat(40)
    }
  ])
  workflow = transition(workflow, {
    type: 'RELEASE_DEPLOYED',
    prMerged: true,
    mergeCommitSha: 'a'.repeat(40),
    immutableCandidateVerified: true,
    codebaseVersion: 'b'.repeat(64),
    latestVerified: true,
    latestCodebaseVersion: 'c'.repeat(64)
  })
  assert.equal(workflow.state, States.DEPLOY_APPROVED)
  assert.match(workflow.prompt, /deploy não terminou/i)
  assert.throws(
    () => transition(workflow, { type: 'EXECUTION_APPROVED' }),
    /Expected DEPLOY_SYNC_VERIFIED/
  )

  workflow = transition(workflow, {
    type: 'RELEASE_DEPLOYED',
    prMerged: true,
    mergeCommitSha: 'a'.repeat(40),
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
    syncVerified: false
  })
  assert.equal(workflow.state, States.RELEASE_LATEST_VERIFIED)
  assert.match(workflow.prompt, /execução permanece bloqueada/i)

  workflow = transition(workflow, {
    type: 'DEPLOY_SYNC_VERIFIED',
    syncVerified: true
  })
  workflow = transition(workflow, { type: 'EXECUTION_APPROVED' })
  assert.equal(workflow.state, States.EXECUTION_APPROVED)
  assert.deepEqual(workflow.actions, [
    { tool: 'executions_create_execution', mutation: true }
  ])
})

function existingPlanThroughRepositorySelection() {
  let workflow = createWorkflow()
  workflow = transition(workflow, {
    type: 'PLAN_MODE_CHOSEN',
    mode: 'existing'
  })
  workflow = selectApplicationFromMcp(workflow)
  workflow = transition(workflow, {
    type: 'EXISTING_PLAN_SELECTED',
    planId: 'abcdef0123456789abcdef01',
    caseSlugs: ['CHECKOUT-001']
  })
  workflow = transition(workflow, {
    type: 'EXISTING_PLAN_CONFIRMED'
  })
  return transition(workflow, {
    type: 'TEST_REPOSITORY_SELECTED',
    path: '/workspace/checkout-tests'
  })
}

function selectApplicationFromMcp(workflow) {
  workflow = transition(workflow, {
    type: 'AUTHENTICATION_CONFIRMED',
    organizationId: 'org-voidr'
  })
  assert.deepEqual(workflow.actions, [
    { tool: 'applications_list_applications', mutation: false }
  ])
  workflow = transition(workflow, {
    type: 'APPLICATION_SELECTED',
    applicationId: 'app-voidr',
    applicationName: 'Voidr Monitor',
    applicationType: 'WEB',
    confirmedByUser: true
  })
  assert.deepEqual(workflow.actions, [
    {
      tool: 'applications_list_environments',
      mutation: false,
      applicationId: 'app-voidr'
    }
  ])
  return transition(workflow, {
    type: 'ENVIRONMENT_SELECTED',
    environmentName: 'staging',
    environmentSlug: 'staging',
    applicationUrl: 'https://staging.example.test',
    fromMcp: true,
    confirmedByUser: true
  })
}

function collectNewPlanScope(workflow, feature) {
  workflow = transition(workflow, {
    type: 'FEATURE_SELECTED',
    feature
  })
  assert.equal(workflow.state, States.FEATURE_SELECTED)
  assert.deepEqual(workflow.actions, [])
  assert.equal(workflow.context.applicationType, 'WEB')
  assert.match(workflow.prompt, /smoke local/i)
  workflow = transition(workflow, {
    type: 'LOCAL_SMOKE_TARGET_SELECTED',
    mode: 'localhost',
    baseUrl: 'http://localhost:3000'
  })
  assert.equal(workflow.context.platformEnvironmentUrl, 'https://staging.example.test')
  assert.equal(workflow.context.localSmokeBaseUrl, 'http://localhost:3000')
  assert.match(workflow.prompt, /Com base em quais insumos/i)
  workflow = transition(workflow, {
    type: 'PLAN_CONTEXT_SOURCE_SELECTED',
    source: 'business'
  })
  workflow = transition(workflow, {
    type: 'NEW_PLAN_CONTEXT_COLLECTED',
    source: 'business',
    evidence: [
      'user-confirmed: valid and invalid credential scenarios are critical'
    ],
    criticalScenarios: ['happy path', 'invalid credentials'],
    expectedBehavior: 'The user reaches the authenticated home page.',
    outOfScope: 'Social login',
    preconditions: ['A writable synthetic test account exists']
  })
  assert.match(workflow.prompt, /Confirmar insumos do planejamento/i)
  return transition(workflow, {
    type: 'PLAN_CONTEXT_CONFIRMED'
  })
}

function readyToDeploy() {
  let workflow = existingPlanThroughRepositorySelection()
  workflow = transition(workflow, {
    type: 'PROJECT_LINK_CHECKED',
    status: 'match'
  })
  return transition(workflow, { type: 'LOCAL_VALIDATION_PASSED' })
}

function mergedPrEvidence() {
  return {
    prMerged: true,
    pullRequestNumber: 42,
    pullRequestUrl: 'https://github.com/acme/tests/pull/42',
    state: 'MERGED',
    mergedAt: '2026-07-28T12:00:00Z',
    defaultBranch: 'main',
    baseBranch: 'main',
    mergeCommitSha: 'a'.repeat(40),
    localHeadSha: 'a'.repeat(40),
    mergeCommitOnRemoteDefault: true,
    worktreeClean: true
  }
}
