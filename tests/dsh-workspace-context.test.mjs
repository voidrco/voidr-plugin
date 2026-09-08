import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepareDshContext, workspaceContextReady, buildDshWorkspace } from '../adapters/dsh/workspace-context.mjs'
import { readContextManifest } from '../scripts/lib/context.mjs'
import { loadDshPluginSkills } from '../adapters/dsh/plugin-skills.mjs'

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-context-test-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const binding = { organizationId: 'org_example', applicationId: '6a85d378d1984807c820348e',
    testPlanId: '6a8c94c96650202061d129c7', repositoryUrl: 'https://github.com/voidrco/example-tests' }
  execFileSync('git', ['init', '-q'], { cwd: root })
  execFileSync('git', ['remote', 'add', 'origin', binding.repositoryUrl], { cwd: root })
  writeFileSync(join(root, 'package.json'), '{"engines":{"node":"22"}}')
  const plan = { _id: binding.testPlanId, applicationId: binding.applicationId,
    createdBy: { organizationId: binding.organizationId }, gitProviderConfig: { repositoryUrl: binding.repositoryUrl },
    modules: [{ slug: 'login', suites: [{ slug: 'LOGIN', cases: [{ slug: 'LOGIN-01' }] }] }] }
  const environments = [{ name: 'Staging', slug: 'staging', applicationUrl: 'https://example.test' }]
  const cliEnvironment = { VOIDR_ORG_ID: binding.organizationId, VOIDR_API_URL: 'https://api.example.test',
    VOIDR_CLIENT_ID: 'test-sa', VOIDR_CLIENT_SECRET: 'test-only-secret' }
  const calls = []
  const run = async (exe, args, options) => {
    assert.equal(options.cwd, root)
    calls.push({ exe, args, env: options.env })
    if (args.includes('--version')) return { stdout: 'v22.22.3', stderr: '' }
    if (args.includes('link')) writeFileSync(join(root, 'project.json'), JSON.stringify({ orgId: binding.organizationId,
      appId: binding.applicationId, testPlanId: binding.testPlanId }))
    if (args.includes('scaffold')) {
      mkdirSync(join(root, 'modules/login/LOGIN'), { recursive: true })
      writeFileSync(join(root, 'modules/login/LOGIN/LOGIN-01.spec.js'), 'test("[LOGIN-01]", () => {});')
    }
    return { stdout: '', stderr: '' }
  }
  const callRemote = async name => ({ content: [{ type: 'text', text: JSON.stringify(
    name === 'test_plans_get_test_plan' ? plan : name === 'applications_list_environments'
      ? { data: environments } : { data: [{ sessionId: 'recording-1' }] }) }] })
  return { root, binding, cliEnvironment, callRemote, run, plan, environments, calls }
}

test('DSH uses canonical setup with its SA for link/scaffold/env, never interactive login', async t => {
  const f = fixture(t)
  assert.equal(workspaceContextReady(f.root, f.binding), false)
  const result = await prepareDshContext(f)
  assert.equal(workspaceContextReady(f.root, f.binding), true)
  assert.deepEqual(result.manifest.sessions, ['recording-1'])
  for (const name of ['link', 'scaffold', 'env']) {
    const call = f.calls.find(call => call.args.includes(name))
    assert.ok(call, name)
    assert.equal(call.env.VOIDR_CLIENT_ID, 'test-sa')
    assert.equal(call.env.VOIDR_CLIENT_SECRET, 'test-only-secret')
    assert.equal(call.env.VOIDR_ORG_ID, f.binding.organizationId)
  }
  assert.equal(f.calls.some(call => call.args.includes('login')), false)
  assert.doesNotMatch(JSON.stringify(result), /test-only-secret/)
  assert.match(readFileSync(join(f.root, '.gitignore'), 'utf8'), /manifest-context.json/)
  assert.match(readFileSync(join(f.root, '.gitignore'), 'utf8'), /^\.env$/m)
})

test('reprepare validates an existing project without relinking or replacing edited cases', async t => {
  const f = fixture(t)
  await prepareDshContext(f)
  f.calls.length = 0
  const spec = join(f.root, 'modules/login/LOGIN/LOGIN-01.spec.js')
  writeFileSync(spec, 'test("[LOGIN-01] user edits", () => {});')
  await prepareDshContext(f)
  assert.equal(f.calls.some(call => call.args.includes('link') || call.args.includes('scaffold')), false)
  assert.equal(readFileSync(spec, 'utf8'), 'test("[LOGIN-01] user edits", () => {});')
})

test('refresh updates platform facts without setup and rejects environment changes', async t => {
  const f = fixture(t)
  await prepareDshContext(f)
  f.calls.length = 0
  f.plan.modules[0].suites[0].cases.push({ slug: 'LOGIN-02' })
  const result = await prepareDshContext({ ...f, refreshOnly: true })
  assert.equal(result.refreshed, true)
  assert.equal(f.calls.length, 0)
  assert.deepEqual(result.manifest.modules[0].suites[0].cases, ['LOGIN-01', 'LOGIN-02'])
  assert.equal(workspaceContextReady(f.root, f.binding), true)
  await assert.rejects(prepareDshContext({ ...f, refreshOnly: true, environmentSlug: 'prod' }), /Changing environment/)
})

test('multiple environments ask before writing context or running setup', async t => {
  const f = fixture(t)
  f.environments.push({ name: 'Production', slug: 'production' })
  const result = await prepareDshContext(f)
  assert.equal(result.needsEnvironmentSelection, true)
  assert.equal(f.calls.length, 0)
  assert.equal(readContextManifest(f.root), null)
})

test('failed link remains unprepared and the error names the failed step', async t => {
  const f = fixture(t)
  await assert.rejects(prepareDshContext({ ...f, run: async (exe, args, options) => {
    if (args.includes('link')) throw new Error('Workspace link failed: unauthorized')
    return f.run(exe, args, options)
  } }), /Workspace link failed/)
  assert.equal(workspaceContextReady(f.root, f.binding), false)
  await assert.rejects(buildDshWorkspace(f), /prepare/)
})

test('wrong platform binding or existing project never runs setup', async t => {
  const f = fixture(t)
  f.plan.createdBy.organizationId = 'another-org'
  await assert.rejects(prepareDshContext(f), /authorized session binding/)
  assert.equal(f.calls.length, 0)
  f.plan.createdBy.organizationId = f.binding.organizationId
  writeFileSync(join(f.root, 'project.json'), JSON.stringify({ orgId: 'another-org', appId: f.binding.applicationId,
    testPlanId: f.binding.testPlanId }))
  await assert.rejects(prepareDshContext(f), /project.json|organization/)
  assert.equal(f.calls.length, 0)
})

test('a context symlink cannot be used to read or overwrite another session', async t => {
  const f = fixture(t)
  const target = join(f.root, 'outside.json')
  writeFileSync(target, 'untouched')
  symlinkSync(target, join(f.root, 'manifest-context.json'))
  await assert.rejects(prepareDshContext(f), /symbolic link/)
  assert.equal(readFileSync(target, 'utf8'), 'untouched')
})

test('environment secrets cannot be pulled into a Git-tracked file', async t => {
  const f = fixture(t)
  writeFileSync(join(f.root, '.env'), 'existing fixture')
  execFileSync('git', ['add', '.env'], { cwd: f.root })
  await assert.rejects(prepareDshContext(f), /Remove .env from Git tracking/)
  assert.equal(f.calls.length, 0)
  assert.equal(readFileSync(join(f.root, '.env'), 'utf8'), 'existing fixture')
})

test('canonical parity retains evidence and approval rules but replaces incompatible host routes', () => {
  const skills = Object.fromEntries(loadDshPluginSkills().map(skill => [skill.name, skill.content]))
  const generate = skills['voidr-generate']
  for (const text of ['sessions_get_session_actions', 'sessions_get_session_digest', 'sessions_get_session_screenmap',
    '.selectors.json', 'Three validation runs', 'Never weaken an', 'AAA × product divergence']) assert.ok(generate.includes(text), text)
  assert.match(generate, /Never install browsers or run Playwright inside the DSH pod/)
  assert.doesNotMatch(generate, /`voidr_explore`/)
  assert.match(skills['voidr-context'], /Service supplies scoped credentials/)
  assert.doesNotMatch(skills['voidr-context'], /ask\s+them to clone/)
  assert.match(skills['voidr-execute'], /FAILED is eligible only after diagnosing/)
  assert.match(skills['voidr-execute'], /confirm: true/)
  assert.doesNotMatch(skills['voidr-execute'], /PreToolUse|GitHub choice|\*\*Claude Code\*\*/)
})

test('DSH execution keeps canonical tag consent and readback separate from code deployment', () => {
  const execute = loadDshPluginSkills().find(skill => skill.name === 'voidr-execute').content
  for (const text of ['## Promoting a case to LIVE', 'test_plans_update_test_case_tag',
    'canWrite: true', 'Read the plan back', 'ask_user_question',
    'caseTagsChanged: false', 'alreadyPublished: true']) assert.ok(execute.includes(text), text)
  assert.match(execute, /Refusal leaves tags unchanged/)
  assert.match(execute, /If code publication failed, do not\s+proceed to tags/)
  assert.match(execute, /do not repeat the code deploy/)
  assert.doesNotMatch(execute, /offer the SAME candidate for LIVE|successful LIVE deployment/)
})
