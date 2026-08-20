import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const guard = join(root, 'scripts/guard-hive-tools.mjs')

function runHook(payload) {
  const dataRoot = mkdtempSync(join(tmpdir(), 'voidr-shell-detect-'))
  const result = spawnSync(process.execPath, [guard], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, COPILOT_PLUGIN_DATA: dataRoot }
  })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout || '{}')
}

const shell = (toolName, command) =>
  runHook({
    sessionId: 'shell-detect',
    cwd: root,
    toolName,
    toolArgs: { command }
  })

// VS Code's terminal tool is run_in_terminal; a bash|shell|powershell name
// match left the surviving acts unchecked on that host.
test('every host shell name reaches the surviving shell policies', () => {
  for (const tool of ['bash', 'run_in_terminal', 'powershell', 'cmd']) {
    const legacyDeploy = shell(tool, 'npx --no-install voidr deploy-latest')
    assert.equal(legacyDeploy.permissionDecision, 'deny', tool)
    assert.match(
      legacyDeploy.permissionDecisionReason,
      /immutable latest release gate/i,
      tool
    )

    const hiveDispatch = shell(tool, 'node dispatch.js trigger_hive_automation')
    assert.equal(hiveDispatch.permissionDecision, 'deny', tool)
    assert.match(hiveDispatch.permissionDecisionReason, /Hive/i, tool)

    // The credential surface only reads the command for tools it recognizes as
    // a shell, so it has to use the same wide match.
    const credentials = shell(tool, 'cat ~/.voidr/service-accounts.json')
    assert.equal(credentials.permissionDecision, 'deny', tool)
    assert.match(
      credentials.permissionDecisionReason,
      /Service Account credential files/i,
      tool
    )
  }
})

// The terminal is allowed: what the agent does with the framework there is
// its own business, and only the acts forbidden through any channel remain.
test('the terminal itself is not gated', () => {
  const allowed = [
    'npx voidr build',
    'npx playwright test modules/a/confi-09.spec.js',
    'git push origin feat/new-tests',
    'nvm use 22',
    '$c = @\' import x \'@; $c | Set-Content "d:\\repo\\modules\\a\\confi-09.spec.js"',
    'echo "test" > modules/b/caso-01.spec.js',
    'Get-Content "d:\\repo\\modules\\a\\confi-09.spec.js"',
    'ls modules/a/*.spec.js'
  ]
  for (const command of allowed) {
    for (const tool of ['run_in_terminal', 'powershell', 'bash']) {
      assert.deepEqual(shell(tool, command), {}, `${tool}: ${command}`)
    }
  }
})
