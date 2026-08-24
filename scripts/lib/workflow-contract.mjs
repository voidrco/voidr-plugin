export const States = Object.freeze({
  INTAKE: 'INTAKE',
  PLAN_MODE_SELECTED: 'PLAN_MODE_SELECTED',
  AUTHENTICATION_REQUIRED: 'AUTHENTICATION_REQUIRED',
  AUTHENTICATED: 'AUTHENTICATED',
  APPLICATION_SELECTED: 'APPLICATION_SELECTED',
  ENVIRONMENT_SELECTED: 'ENVIRONMENT_SELECTED',
  FEATURE_SELECTED: 'FEATURE_SELECTED',
  LOCAL_SMOKE_TARGET_SELECTED: 'LOCAL_SMOKE_TARGET_SELECTED',
  PLAN_CONTEXT_SOURCE_SELECTED: 'PLAN_CONTEXT_SOURCE_SELECTED',
  PLAN_CONTEXT_COLLECTED: 'PLAN_CONTEXT_COLLECTED',
  PLAN_CONTEXT_CONFIRMED: 'PLAN_CONTEXT_CONFIRMED',
  PLAN_DRAFTED: 'PLAN_DRAFTED',
  PLAN_LOADED: 'PLAN_LOADED',
  PLAN_APPROVED: 'PLAN_APPROVED',
  PLAN_REPOSITORY_PROVISIONED: 'PLAN_REPOSITORY_PROVISIONED',
  TEST_REPOSITORY_SELECTED: 'TEST_REPOSITORY_SELECTED',
  REPOSITORY_LINK_VALIDATED: 'REPOSITORY_LINK_VALIDATED',
  LOCAL_VALIDATION_PASSED: 'LOCAL_VALIDATION_PASSED',
  VALIDATION_CANDIDATE_VERIFIED: 'VALIDATION_CANDIDATE_VERIFIED',
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
      applicationType: null,
      platformEnvironmentName: null,
      platformEnvironmentSlug: null,
      platformEnvironmentUrl: null,
      feature: null,
      localSmokeMode: null,
      localSmokeBaseUrl: null,
      contextSource: null,
      productRepositories: [],
      contextEvidence: [],
      criticalScenarios: [],
      expectedBehavior: null,
      outOfScope: null,
      preconditions: [],
      planId: null,
      provisionedRepository: null,
      selectedCases: [],
      testRepository: null,
      projectLink: null,
      codebaseVersion: null,
      validationOutcome: null,
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
        'A Voidr não está conectada. Execute `/copilot voidr-setup` para conectar uma Service Account. Depois volte e continue este fluxo.'
      return next

    case 'APPLICATION_SELECTED':
      requireState(next, States.AUTHENTICATED)
      if (
        !event.applicationId ||
        !event.applicationName ||
        !['WEB', 'API'].includes(event.applicationType) ||
        event.confirmedByUser !== true
      ) {
        throw new Error(
          'Application and its WEB/API type must be explicitly confirmed from applications_list_applications.'
        )
      }
      next.context.applicationId = event.applicationId
      next.context.applicationName = event.applicationName
      next.context.applicationType = event.applicationType
      next.state = States.APPLICATION_SELECTED
      next.actions.push({
        tool: 'applications_list_environments',
        mutation: false,
        applicationId: event.applicationId
      })
      return next

    case 'ENVIRONMENT_SELECTED':
      requireState(next, States.APPLICATION_SELECTED)
      if (
        !event.environmentName ||
        !event.environmentSlug ||
        !isHttpUrl(event.applicationUrl) ||
        event.confirmedByUser !== true ||
        event.fromMcp !== true
      ) {
        throw new Error(
          'Platform environment must be explicitly confirmed from applications_list_environments.'
        )
      }
      next.context.platformEnvironmentName = event.environmentName
      next.context.platformEnvironmentSlug = event.environmentSlug
      next.context.platformEnvironmentUrl = event.applicationUrl
      next.state = States.ENVIRONMENT_SELECTED
      if (next.context.planMode === 'new') {
        next.prompt = `Qual feature ou jornada da aplicação ${next.context.applicationName} você quer testar primeiro?`
      } else {
        next.actions.push({
          tool: 'test_plans_list_test_plans',
          mutation: false
        })
      }
      return next

    case 'FEATURE_SELECTED':
      requireState(next, States.ENVIRONMENT_SELECTED)
      if (next.context.planMode !== 'new') throw new Error('Not in new-plan mode.')
      if (!String(event.feature || '').trim()) {
        throw new Error('A user-selected feature or journey is required.')
      }
      next.context.feature = String(event.feature).trim()
      next.state = States.FEATURE_SELECTED
      next.prompt = `A aplicação selecionada é ${next.context.applicationType}. Para as sondas locais de inspeção (exploração), deseja usar a URL do ambiente Voidr (${next.context.platformEnvironmentUrl}) ou localhost?`
      return next

    case 'LOCAL_SMOKE_TARGET_SELECTED':
      requireState(next, States.FEATURE_SELECTED)
      if (!['platform', 'localhost'].includes(event.mode)) {
        throw new Error('Local smoke mode must be platform or localhost.')
      }
      if (
        event.mode === 'localhost' &&
        !/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$)/i.test(
          String(event.baseUrl || '')
        )
      ) {
        throw new Error('An explicit localhost or 127.0.0.1 URL is required.')
      }
      next.context.localSmokeMode = event.mode
      next.context.localSmokeBaseUrl =
        event.mode === 'platform'
          ? next.context.platformEnvironmentUrl
          : event.baseUrl
      next.state = States.LOCAL_SMOKE_TARGET_SELECTED
      next.prompt =
        'Com base em quais insumos devo montar o Test Plan? Escolha: Analisar código-fonte do workspace; Usar documentação ou requisitos; Descrever regras e cenários no chat; ou Combinar código, documentação e contexto do negócio.'
      return next

    case 'PLAN_CONTEXT_SOURCE_SELECTED':
      requireState(next, States.LOCAL_SMOKE_TARGET_SELECTED)
      if (
        !['codebase', 'documentation', 'business', 'combined'].includes(
          event.source
        )
      ) {
        throw new Error('A supported planning-input source is required.')
      }
      next.context.contextSource = event.source
      next.state = States.PLAN_CONTEXT_SOURCE_SELECTED
      next.prompt = planningInputPrompt(event.source)
      return next

    case 'NEW_PLAN_CONTEXT_COLLECTED':
      requireState(next, States.PLAN_CONTEXT_SOURCE_SELECTED)
      requireNewPlanContext(event)
      if (event.source !== next.context.contextSource) {
        throw new Error('Collected context must match the selected source.')
      }
      next.context.productRepositories = [...(event.productRepositories || [])]
      next.context.contextEvidence = [...(event.evidence || [])]
      next.context.criticalScenarios = [...event.criticalScenarios]
      next.context.expectedBehavior = event.expectedBehavior
      next.context.outOfScope =
        event.outOfScope ||
        'Não determinado pela codebase; validar como premissa no draft.'
      next.context.preconditions = [...event.preconditions]
      next.state = States.PLAN_CONTEXT_COLLECTED
      next.prompt =
        'Mostre o Resumo dos insumos do planejamento e peça que o usuário digite “Confirmar insumos do planejamento” em uma nova mensagem normal do chat. Não use ask_user e ainda não apresente o draft.'
      return next

    case 'PLAN_CONTEXT_CONFIRMED':
      requireState(next, States.PLAN_CONTEXT_COLLECTED)
      next.state = States.PLAN_CONTEXT_CONFIRMED
      next.prompt =
        'Apresente um draft do Test Plan para a feature selecionada, incluindo módulos, suites, casos e Arrange/Act/Assert. Não persista nada antes da aprovação.'
      return next

    case 'NEW_PLAN_DRAFTED':
      requireState(next, States.PLAN_CONTEXT_CONFIRMED)
      if (next.context.planMode !== 'new') throw new Error('Not in new-plan mode.')
      if (event.feature !== next.context.feature) {
        throw new Error('The draft must preserve the user-selected feature.')
      }
      if (!Array.isArray(event.caseSlugs) || event.caseSlugs.length === 0) {
        throw new Error('The approved draft must contain at least one case.')
      }
      next.state = States.PLAN_DRAFTED
      next.context.selectedCases = [...event.caseSlugs]
      next.prompt =
        'Peça que o usuário digite “Aprovo este Test Plan” em uma nova mensagem normal do chat. Não use ask_user. Um “sim” genérico não é aprovação.'
      return next

    case 'NEW_PLAN_APPROVED':
      requireState(next, States.PLAN_DRAFTED)
      next.state = States.PLAN_APPROVED
      next.actions.push({ tool: 'test_plans_create_test_plan', mutation: true })
      next.prompt =
        'Valide o ID e o objeto repository retornados por create_test_plan. Não popule nem prossiga se o repositório vinculado estiver ausente.'
      return next

    case 'NEW_PLAN_REPOSITORY_PROVISIONED':
      requireState(next, States.PLAN_APPROVED)
      requireProvisionedRepository(event)
      next.state = States.PLAN_REPOSITORY_PROVISIONED
      next.context.planId = event.planId
      next.context.provisionedRepository = {
        url: event.repository.url,
        owner: event.repository.owner,
        name: event.repository.name,
        defaultBranch: event.repository.defaultBranch
      }
      next.actions.push(
        { tool: 'test_plans_populate_test_plan', mutation: true },
        { tool: 'test_plans_get_test_plan', mutation: false }
      )
      next.prompt =
        'Popule apenas o Test Plan retornado e verifique que o vínculo persistido corresponde ao repository.url.'
      return next

    case 'EXISTING_PLAN_SELECTED':
      requireState(next, States.ENVIRONMENT_SELECTED)
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
      if (
        ![States.PLAN_APPROVED, States.PLAN_REPOSITORY_PROVISIONED].includes(
          next.state
        )
      ) {
        throw new Error(
          `Expected PLAN_APPROVED or PLAN_REPOSITORY_PROVISIONED, received ${next.state}.`
        )
      }
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
        'Os testes passaram na checagem local. Valide este candidato na plataforma antes de publicá-lo em LIVE.'
      return next

    case 'VALIDATION_CANDIDATE_VERIFIED':
      requireState(next, States.LOCAL_VALIDATION_PASSED)
      requireValidatedCandidate(event)
      next.context.codebaseVersion = event.codebaseVersion
      next.context.validationOutcome = event.validationOutcome
      next.state = States.VALIDATION_CANDIDATE_VERIFIED
      next.prompt =
        event.validationOutcome === 'PASSED'
          ? 'A execução de validação terminou e os testes passaram. Posso publicar exatamente esta versão em LIVE?'
          : 'A execução de validação terminou com falhas, e o diagnóstico foi concluído. Posso publicar exatamente esta versão em LIVE mesmo vermelha?'
      return next

    case 'DEPLOY_APPROVED':
      requireState(next, States.VALIDATION_CANDIDATE_VERIFIED)
      next.context.deployConfirmed = true
      next.state = States.DEPLOY_APPROVED
      next.actions.push({
        tool: 'voidr_release_deploy_live',
        mutation: true,
        codebaseVersion: next.context.codebaseVersion
      })
      return next

    case 'RELEASE_DEPLOYED':
      requireState(next, States.DEPLOY_APPROVED)
      const releaseVerified =
        event.immutableCandidateVerified === true &&
        event.latestVerified === true &&
        event.codebaseVersion === next.context.codebaseVersion &&
        event.latestCodebaseVersion === event.codebaseVersion
      if (!releaseVerified) {
        next.prompt =
          'O deploy não terminou: LIVE precisa apontar para a mesma versão que passou na validação. A execução permanece bloqueada.'
        return next
      }
      next.context.codebaseVersion = event.codebaseVersion
      next.context.latestCodebaseVersion = event.latestCodebaseVersion
      next.state = States.RELEASE_LATEST_VERIFIED
      next.actions.push(
        { tool: 'voidr_repository_sync_github', mutation: true },
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

function requireValidatedCandidate(event) {
  const completedVerdict = ['PASSED', 'FAILED'].includes(event.validationOutcome)
  const diagnosedFailure =
    event.validationOutcome !== 'FAILED' || event.diagnosisCompleted === true
  const validVersion = /^[a-f0-9]{64}$/.test(
    String(event.codebaseVersion || '')
  )
  if (!completedVerdict || !diagnosedFailure || !validVersion) {
    throw new Error(
      'Deploy requires a PASSED verdict or a diagnosed FAILED verdict for this immutable codebaseVersion.'
    )
  }
}

function requireNewPlanContext(event) {
  const source = event.source
  if (
    !['codebase', 'documentation', 'business', 'combined'].includes(source) ||
    !Array.isArray(event.criticalScenarios) ||
    event.criticalScenarios.length === 0 ||
    !String(event.expectedBehavior || '').trim() ||
    !Array.isArray(event.preconditions) ||
    !Array.isArray(event.evidence) ||
    event.evidence.length === 0 ||
    (source === 'business' && !String(event.outOfScope || '').trim()) ||
    (source === 'codebase' &&
      (!Array.isArray(event.productRepositories) ||
        event.productRepositories.length === 0))
  ) {
    throw new Error(
      'New Test Plan context requires a selected source, concrete evidence, scenarios, expected behavior, preconditions, and source-specific scope.'
    )
  }
}

function requireProvisionedRepository(event) {
  if (
    !String(event.planId || '').trim() ||
    !event.repository ||
    !isHttpUrl(event.repository.url) ||
    !String(event.repository.owner || '').trim() ||
    !String(event.repository.name || '').trim() ||
    !String(event.repository.defaultBranch || '').trim()
  ) {
    throw new Error(
      'Test Plan population requires the server-returned plan ID and linked repository URL, owner, name, and default branch.'
    )
  }
}

function planningInputPrompt(source) {
  switch (source) {
    case 'codebase':
      return 'Selecione o repositório ou os repositórios exatos do produto para análise somente leitura.'
    case 'documentation':
      return 'Anexe, cole ou informe o caminho ou URL exata da documentação ou dos requisitos.'
    case 'business':
      return 'Informe em um grupo os cenários críticos, critérios de aceite, itens fora do escopo e dados ou pré-condições.'
    default:
      return 'Informe quais repositórios, documentos e regras de negócio devem ser combinados como insumos.'
  }
}

function isHttpUrl(value) {
  try {
    const url = new URL(String(value || ''))
    return ['http:', 'https:'].includes(url.protocol)
  } catch {
    return false
  }
}
