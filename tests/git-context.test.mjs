import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectGitContext } from '../scripts/lib/git-context.mjs'

function git(cwd, ...args) {
  const result = spawnSync(
    'git',
    ['-c', 'user.email=test@example.test', '-c', 'user.name=Test', ...args],
    { cwd, encoding: 'utf8' }
  )
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}

function createFeatureRepository(workspace, name) {
  const path = join(workspace, name)
  mkdirSync(path)
  git(path, 'init', '-b', 'main')
  writeFileSync(join(path, 'app.js'), 'base')
  git(path, 'add', '-A')
  git(path, 'commit', '-m', 'chore: base')
  git(path, 'checkout', '-b', 'feat/recarga-creditos')
  writeFileSync(join(path, 'recarga.js'), 'feature')
  git(path, 'add', '-A')
  git(path, 'commit', '-m', 'feat: recarga de creditos')
  return path
}

test('describes feature branches without touching the shell path quoting', async () => {
  // The workspace name reproduces the client setup: spaces and a dash.
  const workspace = mkdtempSync(join(tmpdir(), 'Teste - Plugin '))
  const featureRepo = createFeatureRepository(workspace, 'demo-produto')

  const mainRepo = join(workspace, 'demo-parado')
  mkdirSync(mainRepo)
  git(mainRepo, 'init', '-b', 'main')
  writeFileSync(join(mainRepo, 'index.js'), 'x')
  git(mainRepo, 'add', '-A')
  git(mainRepo, 'commit', '-m', 'chore: init')

  const context = await collectGitContext({ workspaceRoot: workspace })
  assert.equal(context.workspaceRoot, realpathSync(workspace))
  assert.equal(context.repositories.length, 2)

  const feature = context.repositories.find(repo =>
    repo.path.endsWith('demo-produto')
  )
  assert.equal(feature.currentBranch, 'feat/recarga-creditos')
  assert.equal(feature.defaultBranch, 'main')
  assert.equal(feature.onFeatureBranch, true)
  assert.equal(feature.commitsAheadOfDefault, 1)
  assert.deepEqual(feature.changedFilesVsDefault, ['recarga.js'])
  assert.match(feature.recentCommits[0], /feat: recarga de creditos/)

  const idle = context.repositories.find(repo =>
    repo.path.endsWith('demo-parado')
  )
  assert.equal(idle.onFeatureBranch, false)
  assert.equal(idle.currentBranch, 'main')
})

test('returns the changed hunks so scenarios can be scoped to the change', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'voidr-git-hunks-'))
  const path = join(workspace, 'demo-produto')
  mkdirSync(path)
  git(path, 'init', '-b', 'main')
  writeFileSync(join(path, 'regras.js'), 'export const limiteMaximo = 900\n')
  git(path, 'add', '-A')
  git(path, 'commit', '-m', 'chore: base')
  git(path, 'checkout', '-b', 'feat/valor-minimo')
  writeFileSync(
    join(path, 'regras.js'),
    'export const limiteMaximo = 900\nexport const valorMinimo = 5000\n'
  )
  git(path, 'add', '-A')
  git(path, 'commit', '-m', 'feat: exige valor minimo')

  const context = await collectGitContext({
    workspaceRoot: workspace,
    repositoryPath: path
  })
  const hunks = context.repositories[0].changedHunksVsDefault
  assert.equal(hunks.truncated, false)
  assert.match(hunks.diff, /\+export const valorMinimo = 5000/)
  assert.doesNotMatch(hunks.diff, /^\+.*limiteMaximo/m)
})

test('reports the repositories a single call could not inspect', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'voidr-git-cap-'))
  createFeatureRepository(workspace, 'demo-a')
  createFeatureRepository(workspace, 'demo-b')

  const context = await collectGitContext({
    workspaceRoot: workspace,
    maxRepositories: 1
  })
  assert.equal(context.repositories.length, 1)
  assert.equal(context.repositoriesNotInspected.length, 1)
  assert.match(context.note, /repositoryPath/)
})

test('inspects a single repository when repositoryPath is given', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'voidr-git-context-'))
  createFeatureRepository(workspace, 'demo-produto')

  const context = await collectGitContext({
    workspaceRoot: workspace,
    repositoryPath: join(workspace, 'demo-produto')
  })
  assert.equal(context.repositories.length, 1)
  assert.equal(context.repositories[0].currentBranch, 'feat/recarga-creditos')
})

test('a truncated diff keeps only whole lines', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'voidr-git-trunc-'))
  const path = join(workspace, 'demo-produto')
  mkdirSync(path)
  git(path, 'init', '-b', 'main')
  const base = Array.from({ length: 400 }, (_, i) => `linha ${i} original`)
  writeFileSync(join(path, 'grande.js'), `${base.join('\n')}\n`)
  git(path, 'add', '-A')
  git(path, 'commit', '-m', 'chore: base')
  git(path, 'checkout', '-b', 'feat/muda-tudo')
  writeFileSync(
    join(path, 'grande.js'),
    `${base.map((line, i) => `${line} alterada ${i}`).join('\n')}\n`
  )
  git(path, 'add', '-A')
  git(path, 'commit', '-m', 'feat: altera todas as linhas')

  const context = await collectGitContext({
    workspaceRoot: workspace,
    repositoryPath: path
  })
  const hunks = context.repositories[0].changedHunksVsDefault
  assert.equal(hunks.truncated, true)
  assert.ok(hunks.diff.length <= 12_000)
  // Cutting mid-line would render a diff line as code the change never made.
  assert.ok(hunks.diff.endsWith('\n'), 'the truncated diff must end on a line break')
  assert.match(hunks.note, /truncated at 12000 characters/)
})
