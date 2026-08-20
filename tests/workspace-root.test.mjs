import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  isInside,
  pluginInstallationRoot,
  resolveWorkspaceRoot,
  validateRepositorySelection
} from '../scripts/lib/workspace.mjs'

const installationRoot = pluginInstallationRoot()

// resolveWorkspaceRoot now also consults the shared prompt state, so tests
// that assert its failure must point the state root at an empty directory —
// otherwise a real state file on the developer's machine leaks in.
function withEmptyPromptState(run) {
  const previous = process.env.COPILOT_PLUGIN_DATA
  process.env.COPILOT_PLUGIN_DATA = mkdtempSync(
    join(tmpdir(), 'voidr-empty-state-')
  )
  try {
    return run()
  } finally {
    if (previous === undefined) delete process.env.COPILOT_PLUGIN_DATA
    else process.env.COPILOT_PLUGIN_DATA = previous
  }
}

test('never resolves the plugin installation directory as the workspace root', () => {
  const realWorkspace = mkdtempSync(join(tmpdir(), 'voidr-workspace-root-'))

  withEmptyPromptState(() => {
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
})

// The prompt hook records its cwd (the real workspace folder); the bridge —
// whose own cwd is the plugin installation — adopts it as a last-resort
// candidate instead of failing and teaching the model to retry.
test('the bridge adopts the workspace recorded by the prompt hook', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'voidr-state-handoff-'))
  const realWorkspace = mkdtempSync(join(tmpdir(), 'voidr-real-workspace-'))
  const promptHook = resolve(
    import.meta.dirname,
    '../scripts/route-voidr-prompt.mjs'
  )

  const recorded = spawnSync(process.execPath, [promptHook], {
    input: JSON.stringify({
      sessionId: 'workspace-handoff',
      prompt: 'oi',
      cwd: realWorkspace,
      timestamp: Date.now()
    }),
    encoding: 'utf8',
    env: { ...process.env, COPILOT_PLUGIN_DATA: dataRoot }
  })
  assert.equal(recorded.status, 0, recorded.stderr)

  const previous = process.env.COPILOT_PLUGIN_DATA
  process.env.COPILOT_PLUGIN_DATA = dataRoot
  try {
    assert.equal(
      resolveWorkspaceRoot({ env: {}, cwd: installationRoot }),
      realpathSync(realWorkspace)
    )
  } finally {
    if (previous === undefined) delete process.env.COPILOT_PLUGIN_DATA
    else process.env.COPILOT_PLUGIN_DATA = previous
  }
})

// On Windows, path.relative() across drives returns the candidate's absolute
// path, which does not start with '..'. Without an isAbsolute guard every
// path on another drive counted as inside every root — a workspace on D:
// with the plugin installed on C: had its checkout rejected as living
// "inside the plugin installation directory".
test(
  'a path on another drive is never inside the root',
  { skip: process.platform !== 'win32' },
  () => {
    assert.equal(
      isInside('D:\\voidr\\teste-copilot', 'C:\\Users\\any\\.copilot\\installed-plugins'),
      false
    )
    assert.equal(isInside('C:\\a\\b\\c', 'C:\\a\\b'), true)
    assert.equal(isInside('C:\\a', 'C:\\a\\b'), false)
  }
)

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
