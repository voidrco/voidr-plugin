import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, readFile, readdir, realpath, rename, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, extname } from 'node:path'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const businessTerms = /credit|credito|cr[eé]dito|loan|bank|banco|banking|proposal|proposta|formaliz|consign|margem|underwrit|disburs|payment|pagamento|checkout|consent|contract|contrato|simulation|simulacao|simula[cç][aã]o|eligib|kyc|onboarding|settlement|liquidac|portability|portabilidade/i
const outboundCategories = new Set(['outbound-request', 'transport', 'messaging', 'file-transfer', 'webhook'])
const rules = {
  'outbound-request': /\b(?:fetch|curl_exec)\s*\(|\.(?:SendAsync|SendRequestAsync|GetAsync|PostAsync|PutAsync|PatchAsync|DeleteAsync|GetStringAsync|GetFromJsonAsync|PostAsJsonAsync|ExecuteAsync|ProcessAsync|GetResponseAsync|CallAsync)\s*(?:<[^;{}]*>)?\s*\(|\b(?:axios|requests|httpx|http|https|client|httpClient|restClient|apiClient|request|got|superagent|restTemplate|webClient)\s*\.\s*(?:get|post|put|patch|delete|send|request|exchange|execute|Do)\s*\(/i,
  'business-operation': businessTerms,
  'file-transfer': /\b(?:SftpClient|FtpClient|SSHClient|UploadFile|DownloadFile|PutFile|GetFile|SshTransferProtocol|ChannelSftp)\b|sftp:\/\/|ftps?:\/\//i,
  transport: /\b(?:HttpClient|IHttpClient|HttpRequestMessage|ProcessAsync|fetch|axios|RestClient|RestSharp|Refit|RestService|Flurl|HttpService|HttpWebRequest|WebRequest|WebClient|ChannelFactory|BasicHttpBinding|WSHttpBinding|FeignClient|Dio|WebSocket|XMLHttpRequest)\b/,
  messaging: /\b(?:SendCommandAsync|GetResourceAsync|IEstablishedChannelProvider|ServiceBusClient|QueueClient|Kafka|RabbitMQ|IMessageSender|PublishAsync)\b|postmaster@/,
  sdk: /PackageReference|<dependency>|\b(?:import|require|using)\b.*(?:client|sdk|firebase|sentry|segment|databricks|azure|aws|google|appcues|launchdarkly)|_client\.[a-zA-Z]+\(/i,
  storage: /\b(?:MongoClient|Redis|ConnectionMultiplexer|BlobServiceClient|BlobContainerClient|SqlConnection|OpenSearchClient|ElasticClient|Databricks|S3Client|CloudStorage)\b/i,
  identity: /\b(?:UserManager|oidc|OAuth|OpenIdConnect|TokenEndpoint|Authority|AuthenticationEndpoint)\b/i,
  destination: /https?:\/\/|\b(?:ApiEndpoint|BaseUrl|BaseAddress|ServiceUrl|WebhookUrl|Endpoint|Host)\s*[:=]|\.msging\.net/i,
  webhook: /\b(?:WebhookClient|WebhookProvider|SendDocumentAsync|WebhookEndpoint|webhook|callbackUrl)\b/i,
}
const extensions = new Set(['.cs', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.dart', '.py', '.go', '.java', '.kt', '.rb', '.php', '.vue', '.json', '.yaml', '.yml', '.xml', '.csproj', '.props', '.toml', '.config', '.html', '.wsdl', '.proto'])
const excluded = /(?:^|\/)(?:node_modules|vendor|dist|build|obj|bin|\.git|__tests__|__mocks__|tests?|fixtures?|mocks?|[^/]*[._-](?:tests?|fixtures?|mocks?))(?:\/|$)|\.(?:test|spec|min)\.|(?:package-lock|yarn\.lock|pnpm-lock)|(?:^|\/)\.env(?:\.|$)|(?:secret|credential|private[-_]?key)|\.(?:pem|p12|pfx|key)$/i
const sensitive = /(?:password|secret|token|authorization|api[-_]?key|connectionstring|privatekey)\s*["']?\s*[:=]|-----BEGIN .*KEY|https?:\/\/[^/\s]*@|[A-Za-z0-9+/=_-]{48,}/i
const git = (cwd, args) => execute('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
  cwd, timeout: 30000, maxBuffer: 16 * 1024 * 1024,
  env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' },
})
const digest = value => createHash('sha256').update(value).digest('hex').slice(0, 20)
const inside = (root, path) => { const part = relative(root, path); return part !== '' && !part.startsWith('..') && !isAbsolute(part) }
const snippet = line => sensitive.test(line) ? '[sensitive configuration omitted]' : line.trim().slice(0, 240)
const readJson = async path => JSON.parse(await readFile(path, 'utf8'))

async function saveJson(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600 })
  await rename(temporary, path)
}

export async function recordPreparedCodebase(root, record) {
  await saveJson(join(root, 'discovery-source.json'), record)
}

async function sourceFor(args, exec) {
  const cwd = exec.agent?.session?.header?.cwd
  if (!cwd || !isAbsolute(cwd) || !isAbsolute(args.workspacePath ?? '')) throw new Error('Use a prepared session checkout')
  const session = await realpath(cwd)
  const workspace = await realpath(args.workspacePath)
  const root = dirname(workspace)
  if (!inside(session, root) || dirname(root) !== session) throw new Error('Checkout is outside this session')
  const source = await readJson(join(root, 'discovery-source.json'))
  if (source.workspacePath !== workspace || !/^[a-f\d]{40,64}$/.test(source.revision)) throw new Error('Invalid prepared checkout')
  const head = (await git(workspace, ['rev-parse', 'HEAD'])).stdout.trim()
  if (head !== source.revision) throw new Error('Checkout revision changed; prepare the codebase again')
  return { ...source, root, statePath: join(root, 'discovery-state.json') }
}

function fileCandidates(source, path, content) {
  const lines = content.split(/\r?\n/)
  const businessHint = businessTerms.test(path) || lines.some(line => businessTerms.test(line))
  return Object.entries(rules).flatMap(([category, pattern]) => {
    const hits = lines.flatMap((text, index) => pattern.test(text) ? [{ line: index + 1, snippet: snippet(text) }] : [])
    const groups = category === 'outbound-request' ? hits.map(hit => [hit]) : hits.length ? [hits] : []
    return groups.map(group => ({ id: digest(`${source.repositoryId}:${source.revision}:${path}:${category}${category === 'outbound-request' ? `:${group[0].line}` : ''}`),
      repositoryId: source.repositoryId, revision: source.revision, path, category,
      businessHint, priority: candidatePriority(category, businessHint),
      occurrences: group.length, hits: group.slice(0, 8), status: 'unreviewed' }))
  })
}

function candidatePriority(category, businessHint) {
  if (category === 'outbound-request') return businessHint ? 0 : 1
  if (outboundCategories.has(category)) return businessHint ? 1 : 2
  if (category === 'business-operation') return 2
  return 3
}

function matchesFocus(item, focus) {
  if (focus === 'outbound') return outboundCategories.has(item.category)
  if (focus === 'business') return item.businessHint === true
  return true
}

async function scanFile(source, entry) {
  const [metadata, path] = entry.split('\t')
  if (!metadata?.startsWith('100') || !path || excluded.test(path) || !extensions.has(extname(path))) return { skipped: 'excluded' }
  const absolute = resolve(source.workspacePath, path)
  if (!inside(source.workspacePath, absolute)) return { skipped: 'unsafe' }
  const actual = await realpath(absolute)
  const stat = await lstat(absolute)
  if (actual !== absolute || !stat.isFile()) return { skipped: 'unsafe' }
  if (stat.size > 1024 * 1024) return { skipped: 'large' }
  const content = await readFile(absolute, 'utf8')
  if (content.includes('\0')) return { skipped: 'binary' }
  return { bytes: stat.size, candidates: fileCandidates(source, path, content) }
}

async function inventory(source, signal) {
  try { return await readJson(source.statePath) } catch (error) { if (error.code !== 'ENOENT') throw error }
  const entries = (await git(source.workspacePath, ['ls-tree', '-r', '-z', source.revision])).stdout.split('\0').filter(Boolean)
  const state = { repositoryId: source.repositoryId, revision: source.revision, trackedFiles: entries.length,
    scannedFiles: 0, scannedBytes: 0, skipped: {}, limited: false, candidates: [], reviewBatches: 0 }
  for (const entry of entries) {
    if (signal?.aborted) throw new Error('Discovery interrupted; retry to resume')
    if (state.scannedFiles >= 15000 || state.scannedBytes >= 100 * 1024 * 1024) { state.limited = true; break }
    const result = await scanFile(source, entry)
    if (result.skipped) state.skipped[result.skipped] = (state.skipped[result.skipped] ?? 0) + 1
    else { state.scannedFiles += 1; state.scannedBytes += result.bytes; state.candidates.push(...result.candidates) }
  }
  await saveJson(source.statePath, state)
  return state
}

function inventoryPage(state, args) {
  const query = String(args.query ?? '').toLowerCase()
  const filtered = state.candidates.filter(item => (!args.status || item.status === args.status) && matchesFocus(item, args.focus) &&
    (!args.category || item.category === args.category) && `${item.path} ${item.hits.map(hit => hit.snippet).join(' ')}`.toLowerCase().includes(query))
    .sort((a, b) => (a.priority ?? 3) - (b.priority ?? 3) || a.path.localeCompare(b.path) || a.hits[0].line - b.hits[0].line)
  const offset = args.offset ?? 0
  const limit = args.limit ?? 40
  const counts = state.candidates.reduce((totals, item) => ({ ...totals, [item.status]: (totals[item.status] ?? 0) + 1 }),
    { confirmed: 0, pending: 0, discarded: 0, unreviewed: 0 })
  return { repositoryId: state.repositoryId, revision: state.revision,
    coverage: { trackedFiles: state.trackedFiles, scannedFiles: state.scannedFiles, skipped: state.skipped, limited: state.limited,
      categories: Object.keys(rules), limitation: 'Heuristic source inventory; not proof of exhaustive dependency coverage or production usage.' },
    counts, reviewedCandidates: counts.confirmed + counts.pending + counts.discarded,
    outboundUnreviewed: state.candidates.filter(item => item.status === 'unreviewed' && outboundCategories.has(item.category)).length,
    businessUnreviewed: state.candidates.filter(item => item.status === 'unreviewed' && item.businessHint).length,
    priorityMeaning: 'Business hints only prioritize reading. A request-shaped expression is not proof of external traffic, a bank, or criticality; trace its receiver, consumer and configured destination.',
    countingRule: 'Counts represent file/category candidates or individual outbound request lines, not dependencies. outboundUnreviewed also includes transport, messaging, file-transfer and webhook signals. reviewBatches counts accepted write batches, not reviewed candidates or analysis passes.',
    reviewBatches: state.reviewBatches, totalCandidates: state.candidates.length, matchingCandidates: filtered.length,
    items: filtered.slice(offset, offset + limit), nextOffset: offset + limit < filtered.length ? offset + limit : null }
}

async function verifyEvidence(source, reference) {
  if (reference.revision !== source.revision || reference.repositoryId !== source.repositoryId) throw new Error('Evidence repository or revision mismatch')
  if (!reference.path || isAbsolute(reference.path) || reference.path.split('/').includes('..') || excluded.test(reference.path)) throw new Error('Evidence path is excluded or unsafe')
  const entry = (await git(source.workspacePath, ['ls-tree', source.revision, '--', reference.path])).stdout
  if (!entry.startsWith('100644 ') && !entry.startsWith('100755 ')) throw new Error('Evidence must reference a tracked regular file')
  const content = (await git(source.workspacePath, ['show', `${source.revision}:${reference.path}`])).stdout
  const line = content.split(/\r?\n/)[reference.line - 1]
  if (!Number.isInteger(reference.line) || reference.line < 1 || !line?.trim()) throw new Error('Evidence line is missing or blank')
  if (sensitive.test(line)) throw new Error(`Evidence line is sensitive; choose a safe reference: ${reference.path}:${reference.line}`)
  if (!reference.quote?.trim() || !line.includes(reference.quote.trim()))
    throw new Error(`Evidence quote does not match ${reference.path}:${reference.line}; read that exact line in the pinned checkout`)
  return { ...reference, quote: snippet(reference.quote), verified: true }
}

async function reviewDecision(source, state, decision) {
  if (!state.candidates.some(item => item.id === decision.candidateId))
    throw new Error(`Unknown candidate ID for ${source.repositoryId}; use the workspacePath that produced this candidate`)
  if (!['confirmed', 'pending', 'discarded'].includes(decision.status) || !decision.reason?.trim()) throw new Error('Provide a decision and concrete reason')
  const evidence = await Promise.all((decision.evidence ?? []).map(reference => verifyEvidence(source, reference)))
  if (decision.status === 'confirmed' && (!decision.dependency?.trim() || !['internal', 'external', 'indirect', 'dynamic'].includes(decision.kind) ||
    !evidence.some(item => item.role === 'callsite') || !evidence.some(item => item.role === 'destination')))
    throw new Error('Confirmed dependencies require a name plus verified callsite and destination evidence; otherwise use pending')
  if (decision.status === 'confirmed' && (!decision.operation?.trim() || !decision.purpose?.trim() ||
    !['business', 'platform', 'supporting'].includes(decision.dependencyRole) ||
    !['identified', 'unresolved'].includes(decision.identityStatus) || !decision.destinationExpression?.trim()))
    throw new Error('Provide the business/technical operation, purpose, dependencyRole, identityStatus and destinationExpression')
  if (decision.identityStatus === 'unresolved' && !decision.unresolvedReason?.trim())
    throw new Error('Explain what is missing to identify the destination; do not infer a vendor from a library')
  return { candidateId: decision.candidateId, status: decision.status, reason: decision.reason,
    dependency: decision.dependency ?? null, kind: decision.kind ?? null, operation: decision.operation ?? null, purpose: decision.purpose ?? null,
    dependencyRole: decision.dependencyRole ?? null, identityStatus: decision.identityStatus ?? null,
    destinationExpression: decision.destinationExpression ?? null, unresolvedReason: decision.unresolvedReason ?? null, evidence }
}

const updates = new Map()

const evidenceKey = item => [item.repositoryId, item.revision, item.path, item.line].join(':')

async function sessionInventories(exec) {
  const cwd = exec.agent?.session?.header?.cwd
  if (!cwd) return []
  const directories = (await readdir(cwd, { withFileTypes: true })).filter(item => item.isDirectory() && item.name.startsWith('third-party-'))
  const states = await Promise.all(directories.map(async directory => {
    try {
      const source = await sourceFor({ workspacePath: join(cwd, directory.name, 'source') }, exec)
      return await readJson(source.statePath)
    } catch (error) { if (error.code === 'ENOENT') return null; throw error }
  }))
  return states.filter(Boolean)
}

function approvedReferences(states) {
  return states.flatMap(state => state.candidates.filter(item => ['confirmed', 'pending'].includes(item.status))
    .flatMap(item => (item.evidence ?? []).filter(reference => reference.verified).map(reference => ({
      key: evidenceKey(reference), role: reference.role, confidence: item.status === 'confirmed' ? 'confirmed' : 'candidate',
    }))))
}

export async function assertReviewedCatalogChange({ exec, args, readCurrent }) {
  if (/^(?:create|replace)-catalog-journey-maps$/.test(args.operationId ?? '')) return assertJourneyEvidence({ exec, args, readCurrent });
  if (!/^(?:create|replace)-catalog-(?:partners|integrations)$/.test(args.operationId ?? '')) return
  const states = await sessionInventories(exec)
  if (!states.length) return
  const replacing = args.operationId.startsWith('replace-')
  if (replacing && (!Number.isInteger(args.body?.expectedVersion) || !args.body?.data))
    throw new Error('Replace requires body: { expectedVersion: currentVersion, data: { ...completeResource, evidence: [...] } }. Read the current resource and operation contract.')
  const data = replacing ? args.body?.data : args.body
  if (!Array.isArray(data?.evidence) || !data.evidence.length)
    throw new Error('Discovery writes require reviewed evidence. Read the operation contract; send one resource, then use third_party_review_mapping before persisting.')
  const current = replacing ? await readCurrent() : null
  const prior = current?.evidence ?? []
  const approved = approvedReferences(states)
  const inScope = new Set(states.map(state => state.repositoryId))
  const unsupported = data.evidence.filter(reference => {
    if (!inScope.has(reference.repositoryId)) return !prior.some(old => evidenceKey(old) === evidenceKey(reference) && old.confidence === reference.confidence)
    return !approved.some(proof => proof.key === evidenceKey(reference) &&
      (reference.confidence === 'candidate' || proof.confidence === 'confirmed'))
  })
  if (unsupported.length) throw new Error(`Unreviewed source evidence: ${unsupported.length} reference(s). Register accepted decisions with third_party_review_mapping and persist those exact references; confirmed evidence requires a confirmed decision.`)
  const confirmed = data.evidence.filter(reference => inScope.has(reference.repositoryId) && reference.confidence === 'confirmed')
  const roles = new Set(approved.filter(proof => proof.confidence === 'confirmed' &&
    confirmed.some(reference => evidenceKey(reference) === proof.key)).map(proof => proof.role))
  if (confirmed.length && (!roles.has('callsite') || !roles.has('destination')))
    throw new Error('Confirmed catalog resources require both reviewed callsite and destination references in their own evidence array. Include the accepted consumer and destination references before saving.')
}

async function preparedSources(exec) {
  const cwd = exec.agent?.session?.header?.cwd
  if (!cwd) throw new Error('A session workspace is required for codebase mapping')
  const entries = (await readdir(cwd, { withFileTypes: true })).filter(item => item.isDirectory() && item.name.startsWith('third-party-'))
  return (await Promise.all(entries.map(async entry => {
    try { return await sourceFor({ workspacePath: join(cwd, entry.name, 'source') }, exec) }
    catch (error) { if (error.code === 'ENOENT') return null; throw error }
  }))).filter(Boolean)
}

function journeyClaimSignature(claim) {
  const source = claim.source ?? {}
  return JSON.stringify([claim.id, claim.from, claim.to, claim.name, claim.kind, claim.partnerId, claim.integrationId, claim.operation,
    claim.label, claim.confidence, claim.reason, source.kind, source.repository, source.revision, source.path, source.line, source.quote])
}

async function assertJourneyEvidence({ exec, args, readCurrent }) {
  const data = args.operationId.startsWith('replace-') ? args.body?.data : args.body
  const claims = [...(data?.steps ?? []), ...(data?.connections ?? [])]
  if (!data?.mapping && claims.every(claim => !claim.confidence && claim.source?.kind !== 'code-reference')) return
  if (!data?.mapping || !data.applicationId || !data.externalId)
    throw new Error('Agent journey mappings require applicationId, stable externalId and mapping { status, analyzedAt, sessionId, gaps }. Read the exact journey contract.')
  if (data.mapping.sessionId !== basename(exec.agent?.session?.header?.cwd ?? ''))
    throw new Error('mapping.sessionId must be the current Platform Assistant session ID')
  const sources = await preparedSources(exec)
  const current = args.operationId.startsWith('replace-') ? await readCurrent() : null
  const prior = new Set([...(current?.steps ?? []), ...(current?.connections ?? [])].map(journeyClaimSignature))
  await Promise.all(claims.map(async claim => {
    if (!['code', 'inferred', 'unresolved'].includes(claim.confidence))
      throw new Error('Every step and connection needs confidence: code, inferred or unresolved')
    if (claim.confidence !== 'code' && !claim.reason?.trim()) throw new Error('Explain every inference and unresolved claim')
    const reference = claim.source
    if (claim.confidence === 'code' && reference?.kind !== 'code-reference') throw new Error('Code claims need a source reference')
    if (reference?.kind !== 'code-reference') return
    const source = sources.find(item => item.repositoryId === reference.repository && item.revision === reference.revision)
    if (!source && prior.has(journeyClaimSignature(claim))) return
    if (!source) throw new Error('Prepare the exact authorized repository revision in this session before saving its journey evidence')
    await verifyEvidence(source, { ...reference, repositoryId: reference.repository })
  }))
}

async function review(source, args, signal) {
  const previous = updates.get(source.root) ?? Promise.resolve()
  const task = previous.catch(() => {}).then(async () => {
    const state = await inventory(source, signal)
    const results = await Promise.all((args.decisions ?? []).map(async decision => {
      try { return { valid: true, decision: await reviewDecision(source, state, decision) } }
      catch (error) { return { valid: false, candidateId: decision.candidateId ?? null, error: error.message } }
    }))
    const accepted = new Map(results.filter(result => result.valid).map(result => [result.decision.candidateId, result.decision]))
    const next = { ...state, reviewBatches: state.reviewBatches + (accepted.size ? 1 : 0),
      candidates: state.candidates.map(item => accepted.has(item.id) ? { ...item, ...accepted.get(item.id) } : item) }
    await saveJson(source.statePath, next)
    return { ...inventoryPage(next, { status: 'unreviewed', limit: 20 }), results,
      evidenceCheck: 'Verifies source references, not the semantic truth of the decision. Review the call chain before persisting catalog records.' }
  })
  updates.set(source.root, task)
  try { return await task } finally { if (updates.get(source.root) === task) updates.delete(source.root) }
}

const referenceSchema = { type: 'object', additionalProperties: false, required: ['repositoryId', 'revision', 'path', 'line', 'quote', 'role'], properties: {
  repositoryId: { type: 'string' }, revision: { type: 'string' }, path: { type: 'string' }, line: { type: 'integer', minimum: 1 },
  quote: { type: 'string', minLength: 1, maxLength: 240 }, role: { type: 'string', enum: ['callsite', 'destination', 'supporting'] },
} }
const decisionSchema = { type: 'object', additionalProperties: false, required: ['candidateId', 'status', 'reason'], properties: {
  candidateId: { type: 'string' }, status: { type: 'string', enum: ['confirmed', 'pending', 'discarded'] },
  reason: { type: 'string', minLength: 1, maxLength: 1500 }, dependency: { type: 'string', maxLength: 200 },
  kind: { type: 'string', enum: ['internal', 'external', 'indirect', 'dynamic'] },
  operation: { type: 'string', maxLength: 250 }, purpose: { type: 'string', maxLength: 1000 },
  dependencyRole: { type: 'string', enum: ['business', 'platform', 'supporting'] },
  identityStatus: { type: 'string', enum: ['identified', 'unresolved'] },
  destinationExpression: { type: 'string', maxLength: 500 }, unresolvedReason: { type: 'string', maxLength: 1000 },
  evidence: { type: 'array', maxItems: 12, items: referenceSchema },
} }

export function registerThirdPartyDiscovery(ctx) {
  const tools = [
    { name: 'third_party_inventory_codebase', description: 'Discover business operations and outbound request sites before SDK/vendor inventory. Includes private HTTP APIs, messaging, file transfers and dynamic destinations. Requests have separate candidates per source line. Business hints prioritize reading, never prove criticality. Persist and review remaining outbound gaps.',
      properties: { category: { type: 'string', enum: Object.keys(rules) }, status: { type: 'string', enum: ['unreviewed', 'confirmed', 'pending', 'discarded'] },
        focus: { type: 'string', enum: ['business', 'outbound', 'all'] },
        query: { type: 'string', maxLength: 200 }, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 80 } },
      run: async (source, args, signal) => inventoryPage(await inventory(source, signal), args) },
    { name: 'third_party_review_mapping', description: 'Verify pinned source references and persist decisions. Confirmed needs callsite + destination evidence, operation, purpose, dependencyRole, identityStatus and destinationExpression. An integration may be proven while bank identity remains unresolved: name the operation and record unresolvedReason. No catalog writes. Empty decisions returns progress.',
      properties: { decisions: { type: 'array', maxItems: 40, items: decisionSchema } }, run: review },
  ]
  tools.forEach(tool => ctx.tools.register({ name: tool.name, description: tool.description,
    parameters: { type: 'object', additionalProperties: false, required: ['workspacePath'], properties: { workspacePath: { type: 'string' }, ...tool.properties } },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async (args, exec) => tool.run(await sourceFor(args, exec), args, exec.signal),
  }))
}
