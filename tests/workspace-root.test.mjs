import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  pluginInstallationRoot,
  resolveWorkspaceRoot,
  validateRepositorySelection
} from '../scripts/lib/workspace.mjs'

const installationRoot = pluginInstallationRoot()

test('never resolves the plugin installation directory as the workspace root', () => {
  const realWorkspace = mkdtempSync(join(tmpdir(), 'voidr-workspace-root-'))

  assert.equal(
    resolveWorkspaceRoot({
      explicit: realWorkspace,
      env: {},
      cwd: installationRoot
    }),
    realpathSync(realWorkspace)
  )

  assert.equal(
    resolveWorkspaceRoot({
      env: { VOIDR_WORKSPACE_ROOT: realWorkspace },
      cwd: join(installationRoot, 'scripts')
    }),
    realpathSync(realWorkspace)
  )

  assert.throws(
    () => resolveWorkspaceRoot({ env: {}, cwd: installationRoot }),
    /plugin installation directory[\s\S]*workspaceRoot/i
  )
})

test('rejects selecting a test repository inside the plugin installation', () => {
  assert.throws(
    () =>
      validateRepositorySelection(
        join(installationRoot, 'scripts'),
        resolve(installationRoot, '..')
      ),
    /plugin installation directory/i
  )
})
