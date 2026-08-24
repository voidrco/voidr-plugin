import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRepositorySyncPatch } from '../scripts/lib/repository-sync.mjs'

test('builds a complete patch without staging or leaking operator files', async () => {
  const repositoryPath = mkdtempSync(join(tmpdir(), 'voidr-sync-source-'))
  execFileSync('git', ['init', '--quiet', '-b', 'main'], { cwd: repositoryPath })
  execFileSync('git', ['config', 'user.email', 'test@voidr.co'], {
    cwd: repositoryPath
  })
  execFileSync('git', ['config', 'user.name', 'Voidr Test'], {
    cwd: repositoryPath
  })
  mkdirSync(join(repositoryPath, 'modules', 'checkout'), { recursive: true })
  writeFileSync(
    join(repositoryPath, 'modules', 'checkout', 'existing.spec.js'),
    'export const value = 1\n'
  )
  writeFileSync(join(repositoryPath, 'package.json'), '{}\n')
  execFileSync('git', ['add', '.'], { cwd: repositoryPath })
  execFileSync('git', ['commit', '--quiet', '-m', 'initial'], {
    cwd: repositoryPath
  })
  execFileSync('git', ['update-ref', 'refs/remotes/origin/main', 'HEAD'], {
    cwd: repositoryPath
  })
  execFileSync(
    'git',
    ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main'],
    { cwd: repositoryPath }
  )

  writeFileSync(
    join(repositoryPath, 'modules', 'checkout', 'existing.spec.js'),
    'export const value = 2\n'
  )
  writeFileSync(
    join(repositoryPath, 'modules', 'checkout', 'new.spec.js'),
    'export const created = true\n'
  )
  mkdirSync(join(repositoryPath, '.agents'), { recursive: true })
  writeFileSync(join(repositoryPath, '.agents', 'operator.md'), 'do not commit\n')
  writeFileSync(join(repositoryPath, 'AGENTS.md'), 'do not commit\n')

  const result = await createRepositorySyncPatch({ repositoryPath })

  assert.equal(result.needed, true)
  assert.deepEqual(result.changedFiles.sort(), [
    'modules/checkout/existing.spec.js',
    'modules/checkout/new.spec.js'
  ])
  assert.match(result.patch, /existing\.spec\.js/)
  assert.match(result.patch, /new\.spec\.js/)
  assert.doesNotMatch(result.patch, /operator\.md|AGENTS\.md/)
  assert.equal(
    execFileSync('git', ['diff', '--cached', '--name-only'], {
      cwd: repositoryPath,
      encoding: 'utf8'
    }),
    ''
  )
})

test('returns no patch when the remote default branch already matches', async () => {
  const repositoryPath = mkdtempSync(join(tmpdir(), 'voidr-sync-clean-'))
  execFileSync('git', ['init', '--quiet', '-b', 'main'], { cwd: repositoryPath })
  execFileSync('git', ['config', 'user.email', 'test@voidr.co'], {
    cwd: repositoryPath
  })
  execFileSync('git', ['config', 'user.name', 'Voidr Test'], {
    cwd: repositoryPath
  })
  writeFileSync(join(repositoryPath, 'package.json'), '{}\n')
  execFileSync('git', ['add', '.'], { cwd: repositoryPath })
  execFileSync('git', ['commit', '--quiet', '-m', 'initial'], {
    cwd: repositoryPath
  })
  execFileSync('git', ['update-ref', 'refs/remotes/origin/main', 'HEAD'], {
    cwd: repositoryPath
  })
  execFileSync(
    'git',
    ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main'],
    { cwd: repositoryPath }
  )

  const result = await createRepositorySyncPatch({ repositoryPath })

  assert.equal(result.needed, false)
  assert.deepEqual(result.changedFiles, [])
  assert.equal(readFileSync(join(repositoryPath, 'package.json'), 'utf8'), '{}\n')
})
