import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const guard = join(root, 'scripts/guard-hive-tools.mjs')

function runHook(payload) {
  const dataRoot = mkdtempSync(join(tmpdir(), 'voidr-shell-spec-'))
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
    sessionId: 'shell-spec',
    cwd: root,
    toolName,
    toolArgs: { command }
  })

// VS Code's terminal tool is run_in_terminal; the old bash|shell|powershell
// name match left every shell policy dormant on that host.
test('run_in_terminal is recognized as a shell tool', () => {
  const out = shell('run_in_terminal', 'npx voidr build')
  assert.equal(out.permissionDecision, 'deny')
  assert.match(out.permissionDecisionReason, /never run the Voidr CLI/i)
})

test('writing a spec through the shell is blocked in every form', () => {
  const escritas = [
    '$c = @\' import x \'@; $c | Set-Content "d:\\repo\\modules\\a\\confi-09.spec.js" -NoNewline',
    'Add-Content -Path modules/a/troca-03.spec.js -Value "await page.click()"',
    '$lines | Out-File "d:\\repo\\confi-10.spec.ts"',
    'echo "test" > modules/b/caso-01.spec.js',
    'cat body.txt >> suite.spec.mjs',
    '[IO.File]::WriteAllText("d:\\repo\\x.spec.js", $texto)',
    'node -e "fs.writeFileSync(process.argv[1])" -- a.spec.js',
    'printf x | tee modules/c/novo.spec.js'
  ]
  for (const cmd of escritas) {
    for (const tool of ['run_in_terminal', 'powershell', 'bash']) {
      const out = shell(tool, cmd)
      assert.equal(out.permissionDecision, 'deny', `${tool}: ${cmd}`)
      assert.match(out.permissionDecisionReason, /spec content inspection/i)
    }
  }
})

test('reading and listing specs in the terminal stays allowed', () => {
  const leituras = [
    'Get-Content "d:\\repo\\modules\\a\\confi-09.spec.js"',
    'Select-String -Path troca-03.spec.js -Pattern "expect"',
    'ls modules/a/*.spec.js',
    'git diff -- modules/a/confi-09.spec.js'
  ]
  for (const cmd of leituras) {
    assert.deepEqual(shell('run_in_terminal', cmd), {}, cmd)
  }
})

test('shell writes to non-spec files are not this gate\u2019s business', () => {
  assert.deepEqual(
    shell('run_in_terminal', '$notes | Set-Content "d:\\repo\\notes.md"'),
    {}
  )
})
