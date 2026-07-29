export const States = Object.freeze({
  INTAKE: 'INTAKE',
  PLAN_MODE_SELECTED: 'PLAN_MODE_SELECTED',
  AUTHENTICATION_REQUIRED: 'AUTHENTICATION_REQUIRED',
  AUTHENTICATED: 'AUTHENTICATED',
  APPLICATION_SELECTED: 'APPLICATION_SELECTED',
  PLAN_DRAFTED: 'PLAN_DRAFTED',
  PLAN_LOADED: 'PLAN_LOADED',
  PLAN_APPROVED: 'PLAN_APPROVED',
  TEST_REPOSITORY_SELECTED: 'TEST_REPOSITORY_SELECTED',
  REPOSITORY_LINK_VALIDATED: 'REPOSITORY_LINK_VALIDATED',
  LOCAL_VALIDATION_PASSED: 'LOCAL_VALIDATION_PASSED',
  PR_MERGE_VERIFIED: 'PR_MERGE_VERIFIED',
  DEPLOY_APPROVED: 'DEPLOY_APPROVED',
  RELEASE_LATEST_VERIFIED: 'RELEASE_LATEST_VERIFIED',
  DEPLOY_SYNC_VERIFIED: 'DEPLOY_SYNC_VERIFIED',
  EXECUTION_APPROVED: 'EXECUTION_APPROVED',
  EXECUTION_CREATED: 'EXECUTION_CREATED',
  COMPLETED: 'COMPLETED'
})

export function createWorkflow() {
  return {
    state: States.INTAKE,
    context: {
      planMode: null,
      organizationId: null,
      applicationId: null,
      applicationName: null,
      planId: null,
      selectedCases: [],
      testRepository: null,
      projectLink: null,
      pullRequest: null,
      mergeCommitSha: null,
      codebaseVersion: null,
      latestCodebaseVersion: null,
      deployConfirmed: false,
      syncVerified: false,
      executionConfirmed: false
    },
    prompt:
      'Você quer criar um novo Test Plan ou trabalhar em um Test Plan existente?',
    actions: []
  }
}

export function transition(workflow, event) {
  const next = structuredClone(workflow)
  next.actions = []
  next.prompt = null

  switch (event.type) {
    case 'PLAN_MODE_CHOSEN':
      requireState(next, States.INTAKE)
      if (!['new', 'existing'].includes(event.mode)) {
        throw new Error('Plan mode must be new or existing.')
      }
      next.context.planMode = event.mode
      next.state = States.PLAN_MODE_SELECTED
      next.actions.push({ tool: 'voidr_auth_status', mutation: false })
      return next

    case 'AUTHENTICATION_CONFIRMED':
      requireState(next, States.PLAN_MODE_SELECTED)
      if (!event.organizationId) {
        throw new Error('An explicit organization ID is required.')
      }
      next.context.organizationId = event.organizationId
      next.state = States.AUTHENTICATED
      next.actions.push({
        tool: 'applications_list_applications',
        mutation: false
      })
      return next

    case 'AUTHENTICATION_MISSING':
      requireState(next, States.PLAN_MODE_SELECTED)
      next.state = States.AUTHENTICATION_REQUIRED
      next.prompt =
        'A Voidr não está conectada. Execute `/copilot voidr-connect` para conectar uma Service Account. Depois volte e continue este fluxo.'
      return next

    case 'APPLICATION_SELECTED':
      requireState(next, States.AUTHENTICATED)
      if (!event.applicationId || !event.applicationName) {
        throw new Error(
          'Application must be selected from applications_list_applications.'
        )
      }
      next.context.applicationId = event.applicationId
      next.context.applicationName = event.applicationName
      next.state = States.APPLICATION_SELECTED
      return next

    case 'NEW_PLAN_DRAFTED':
      requireState(next, States.APPLICATION_SELECTED)
      if (next.context.planMode !== 'new') throw new Error('Not in new-plan mode.')
      next.state = States.PLAN_DRAFTED
      next.context.selectedCases = [...event.caseSlugs]
      next.prompt = 'Aprova este Test Plan para criação na Voidr?'
      return next

    case 'NEW_PLAN_APPROVED':
      requireState(next, States.PLAN_DRAFTED)
      next.state = States.PLAN_APPROVED
      next.context.planId = event.planId
      next.actions.push(
        { tool: 'test_plans_create_test_plan', mutation: true },
        { tool: 'test_plans_populate_test_plan', mutation: true },
        { tool: 'test_plans_get_test_plan', mutation: false }
      )
      next.prompt =
        'Para implementar os testes, você quer usar um repositório de testes existente ou criar um novo?'
      return next

    case 'EXISTING_PLAN_SELECTED':
      requireState(next, States.APPLICATION_SELECTED)
      if (next.context.planMode !== 'existing') {
        throw new Error('Not in existing-plan mode.')
      }
      next.state = States.PLAN_LOADED
      next.context.planId = event.planId
      next.context.selectedCases = [...event.caseSlugs]
      next.prompt = 'Confirma este Test Plan e estes casos?'
      return next

    case 'EXISTING_PLAN_CONFIRMED':
      requireState(next, States.PLAN_LOADED)
      next.state = States.PLAN_APPROVED
      next.prompt =
        'Para implementar os testes, você quer usar um repositório de testes existente ou criar um novo?'
      return next

    case 'TEST_REPOSITORY_SELECTED':
      requireState(next, States.PLAN_APPROVED)
      next.context.testRepository = event.path
      next.state = States.TEST_REPOSITORY_SELECTED
      next.actions.push({
        tool: 'voidr_workspace_select_test_repository',
        mutation: false
      })
      return next

    case 'PROJECT_LINK_CHECKED':
      requireState(next, States.TEST_REPOSITORY_SELECTED)
      next.context.projectLink = event.status
      if (event.status === 'match') {
        next.state = States.REPOSITORY_LINK_VALIDATED
      } else {
        next.prompt =
          event.status === 'missing'
            ? 'Posso criar project.json com os IDs selecionados?'
            : 'project.json não corresponde à seleção. Posso relinkar este repositório?'
      }
      return next

    case 'PROJECT_LINK_APPROVED':
      requireState(next, States.TEST_REPOSITORY_SELECTED)
      if (!['missing', 'mismatch'].includes(next.context.projectLink)) {
        throw new Error('No project link change is pending.')
      }
      next.state = States.REPOSITORY_LINK_VALIDATED
      return next

    case 'LOCAL_VALIDATION_PASSED':
      requireState(next, States.REPOSITORY_LINK_VALIDATED)
      next.state = States.LOCAL_VALIDATION_PASSED
      next.prompt =
        'Qual é o PR destes testes já mergeado na branch principal? O deploy permanece bloqueado até eu verificar o merge.'
      return next

    case 'PR_MERGE_VERIFIED':
      requireState(next, States.LOCAL_VALIDATION_PASSED)
      requireMergedPullRequest(event)
      next.context.pullRequest = {
        number: event.pullRequestNumber,
        url: event.pullRequestUrl,
        defaultBranch: event.defaultBranch,
        mergedAt: event.mergedAt
      }
      next.context.mergeCommitSha = event.mergeCommitSha
      next.state = States.PR_MERGE_VERIFIED
      next.prompt =
        'Posso publicar a release imutável deste commit e promovê-la para latest na Voidr?'
      return next

    case 'DEPLOY_APPROVED':
      requireState(next, States.PR_MERGE_VERIFIED)
      next.context.deployConfirmed = true
      next.state = States.DEPLOY_APPROVED
      next.actions.push({
        tool: 'voidr_release_deploy_merged_pr',
        mutation: true,
        pullRequestNumber: next.context.pullRequest.number,
        mergeCommitSha: next.context.mergeCommitSha
      })
      return next

    case 'RELEASE_DEPLOYED':
      requireState(next, States.DEPLOY_APPROVED)
      const releaseVerified =
        event.prMerged === true &&
        event.immutableCandidateVerified === true &&
        event.latestVerified === true &&
        event.mergeCommitSha === next.context.mergeCommitSha &&
        /^[a-f0-9]{64}$/.test(String(event.codebaseVersion || '')) &&
        event.latestCodebaseVersion === event.codebaseVersion
      if (!releaseVerified) {
        next.prompt =
          'O deploy não terminou: PR, release imutável e latest precisam apontar para o mesmo release. A execução permanece bloqueada.'
        return next
      }
      next.context.codebaseVersion = event.codebaseVersion
      next.context.latestCodebaseVersion = event.latestCodebaseVersion
      next.state = States.RELEASE_LATEST_VERIFIED
      next.actions.push(
        { tool: 'test_plans_get_test_plan', mutation: false },
        { tool: 'test_plans_get_test_counts', mutation: false }
      )
      return next

    case 'DEPLOY_SYNC_VERIFIED':
      requireState(next, States.RELEASE_LATEST_VERIFIED)
      if (!event.syncVerified) {
        next.context.syncVerified = false
        next.prompt =
          'A sincronização não foi verificada; a execução permanece bloqueada.'
        return next
      }
      next.context.syncVerified = true
      next.state = States.DEPLOY_SYNC_VERIFIED
      next.prompt = 'Posso iniciar esta execução na plataforma?'
      return next

    case 'EXECUTION_APPROVED':
      requireState(next, States.DEPLOY_SYNC_VERIFIED)
      if (!next.context.syncVerified) throw new Error('Sync is not verified.')
      next.context.executionConfirmed = true
      next.state = States.EXECUTION_APPROVED
      next.actions.push({ tool: 'executions_create_execution', mutation: true })
      return next

    case 'EXECUTION_CREATED':
      requireState(next, States.EXECUTION_APPROVED)
      next.context.executionId = event.executionId
      next.state = States.EXECUTION_CREATED
      next.actions.push({ tool: 'executions_get_execution', mutation: false })
      return next

    case 'COMPLETED':
      requireState(next, States.EXECUTION_CREATED)
      next.state = States.COMPLETED
      return next

    default:
      throw new Error(`Unsupported workflow event: ${event.type}`)
  }
}

function requireState(workflow, expected) {
  if (workflow.state !== expected) {
    throw new Error(`Expected ${expected}, received ${workflow.state}.`)
  }
}

function requireMergedPullRequest(event) {
  if (
    event.prMerged !== true ||
    event.state !== 'MERGED' ||
    !event.mergedAt ||
    event.baseBranch !== event.defaultBranch ||
    event.localHeadSha !== event.mergeCommitSha ||
    event.mergeCommitOnRemoteDefault !== true ||
    event.worktreeClean !== true ||
    !/^[a-f0-9]{40}$/i.test(String(event.mergeCommitSha || ''))
  ) {
    throw new Error(
      'Deploy requires a clean repository at the exact PR commit already merged into the default branch.'
    )
  }
}
