import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertReviewedCatalogChange, findPreparedCodebase, recordPreparedCodebase, registerThirdPartyDiscovery } from '../adapters/dsh/third-party-discovery.mjs'

async function fixture(t) {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'discovery-review-')))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  const root = join(cwd, 'third-party-repository'), workspacePath = join(root, 'source')
  await mkdir(workspacePath, { recursive: true })
  const lines = ['const firstEndpoint = "https://first.example/pay";', 'fetch(firstEndpoint);',
    'const secondEndpoint = "https://second.example/pay";', 'fetch(secondEndpoint);']
  await writeFile(join(workspacePath, 'client.js'), lines.join('\n'))
  const git = args => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], { cwd: workspacePath, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim()
  git(['init']); git(['add', '.']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture'])
  const revision = git(['rev-parse', 'HEAD']), repositoryId = 'a'.repeat(24)
  const source = { workspacePath, revision, repositoryId, branch: 'main', repository: 'https://fixture.invalid/repo.git' }
  await recordPreparedCodebase(root, source)
  const tools = new Map(), exec = { agent: { session: { header: { cwd } } } }
  registerThirdPartyDiscovery({ tools: { register: tool => tools.set(tool.name, tool) } })
  const invoke = (name, args = {}) => tools.get(`third_party_${name}`).execute({ workspacePath, ...args }, exec)
  const inventory = await invoke('inventory_codebase')
  const reference = (line, role) => ({ repositoryId, revision, path: 'client.js', line, quote: lines[line - 1], role })
  const decision = line => ({ candidateId: inventory.items.find(item => item.category === 'outbound-request' && item.hits[0].line === line).id,
    status: 'confirmed', reason: 'Call uses this configured endpoint', dependency: `Provider ${line}`, kind: 'external', operation: 'pay',
    purpose: 'Payment', dependencyRole: 'business', identityStatus: 'identified', destinationExpression: lines[line - 2],
    evidence: [reference(line, 'callsite'), reference(line - 1, 'destination')] })
  const save = evidence => assertReviewedCatalogChange({ exec, args: { operationId: 'create-catalog-integrations', body: { evidence } } })
  return { root, source, exec, invoke, decision, save, evidence: d => d.evidence.map(ref => ({ ...ref, confidence: 'confirmed' })) }
}

test('catalog evidence must belong to one complete accepted decision', async t => {
  const f = await fixture(t), first = f.decision(2), second = f.decision(4)
  const review = await f.invoke('review_mapping', { decisions: [first, second] })
  assert.ok(review.results.every(result => result.valid))
  await f.save(f.evidence(first))
  await f.save([...f.evidence(first), ...f.evidence(second)])
  await assert.rejects(f.save([f.evidence(first)[0], f.evidence(second)[1]]), /same accepted decision/)
  await assert.rejects(f.save(f.evidence(first).map(ref => ({ ...ref, quote: 'changed quote' }))), /Unreviewed/)
  await assert.rejects(f.save(f.evidence(first).map(ref => ({ ...ref, role: ref.role === 'callsite' ? 'destination' : 'callsite' }))), /Unreviewed/)
})

test('short substrings cannot establish evidence', async t => {
  const f = await fixture(t), decision = f.decision(2)
  decision.evidence[0].quote = 'fetch'
  const review = await f.invoke('review_mapping', { decisions: [decision] })
  assert.equal(review.results[0].valid, false)
  await assert.rejects(f.save(f.evidence(decision)), /Unreviewed/)
})

test('tampered workspace approvals fail closed', async t => {
  const f = await fixture(t), decision = f.decision(2)
  await f.invoke('review_mapping', { decisions: [decision] })
  const path = join(f.root, 'discovery-state.json')
  const state = JSON.parse(await readFile(path, 'utf8'))
  state.value.candidates[0].reason = 'forged approval'
  await writeFile(path, JSON.stringify(state))
  await assert.rejects(f.invoke('inventory_codebase'), /Untrusted discovery state/)
  await assert.rejects(f.save(f.evidence(decision)), /Prepare and review/)
})

test('tampered provenance and missing inventories cannot bypass review', async t => {
  const f = await fixture(t), decision = f.decision(2)
  await rm(join(f.root, 'discovery-state.json'))
  await assert.rejects(f.save(f.evidence(decision)), /Prepare and review/)
  await writeFile(join(f.root, 'discovery-source.json'), JSON.stringify(f.source))
  await assert.rejects(f.invoke('inventory_codebase'), /Untrusted discovery state/)
  await assert.rejects(f.save(f.evidence(decision)), /Prepare and review/)
})

test('prepared checkouts are reused only at the exact clean branch and revision', async t => {
  const f = await fixture(t)
  assert.equal((await findPreparedCodebase(f.exec, f.source)).workspacePath, f.source.workspacePath)
  assert.equal(await findPreparedCodebase(f.exec, { ...f.source, revision: 'b'.repeat(40) }), null)
  assert.equal(await findPreparedCodebase(f.exec, { ...f.source, branch: 'other' }), null)
  await writeFile(join(f.source.workspacePath, 'client.js'), 'changed')
  assert.equal(await findPreparedCodebase(f.exec, f.source), null)
})
