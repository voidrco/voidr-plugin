import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MANIFEST_FILE,
  SKILL_DIR_PREFIX,
  isSafeAssetPath,
  listSyncedDirectories,
  manifestPath,
  materializeSkill,
  minSyncIntervalMs,
  planSync,
  readManifest,
  removeSkill,
  renderSkillFile,
  skillsRoot,
  syncScopes,
  syncSkills,
  writeManifest
} from '../scripts/lib/skills-sync.mjs'

function scratch() {
  return mkdtempSync(join(tmpdir(), 'voidr-skills-root-'))
}

function summary(overrides = {}) {
  return {
    name: 'healer',
    description: 'Diagnoses failing Playwright specs.',
    scope: 'global',
    etag: 'etag-1',
    ...overrides
  }
}

test('the sync target is never inside the plugin', () => {
  const user = skillsRoot({ home: '/home/dev' })
  const project = skillsRoot({ scope: 'project', workspace: '/work/repo' })

  assert.equal(user, '/home/dev/.claude/skills')
  assert.equal(project, '/work/repo/.claude/skills')
  // The guard forbids writing into the installation directory, and
  // CLAUDE_PLUGIN_ROOT moves on every plugin update.
  for (const root of [user, project]) {
    assert.doesNotMatch(root, /plugin/i)
  }
})

test('only the Voidr catalog syncs unless an org opts in', () => {
  assert.deepEqual(syncScopes({}), ['global'])
  assert.deepEqual(syncScopes({ VOIDR_SKILLS_SYNC_SCOPES: 'global,org,app' }), [
    'global',
    'org',
    'app'
  ])
  // Junk must not silently widen the default.
  assert.deepEqual(syncScopes({ VOIDR_SKILLS_SYNC_SCOPES: 'nonsense' }), ['global'])
  assert.deepEqual(syncScopes({ VOIDR_SKILLS_SYNC_SCOPES: '' }), ['global'])
})

test('the throttle interval falls back to a sane default', () => {
  assert.equal(minSyncIntervalMs({}), 15 * 60 * 1000)
  assert.equal(minSyncIntervalMs({ VOIDR_SKILLS_SYNC_MIN_INTERVAL_MS: '0' }), 0)
  assert.equal(minSyncIntervalMs({ VOIDR_SKILLS_SYNC_MIN_INTERVAL_MS: 'abc' }), 15 * 60 * 1000)
})

test('the plan compares etags by inequality, never order', () => {
  const manifest = { skills: { healer: 'etag-1' }, lastSyncAt: 0 }

  const unchanged = planSync([summary({ etag: 'etag-1' })], manifest)
  assert.deepEqual(unchanged.keep, ['healer'])
  assert.equal(unchanged.write.length, 0)

  // An org skill shadowing a global one can carry a LOWER version. Any
  // greater-than logic would serve the stale body forever.
  const shadowed = planSync([summary({ scope: 'global', etag: 'etag-0' })], manifest)
  assert.equal(shadowed.write.length, 1)
})

test('the plan ignores scopes the org did not opt into', () => {
  const catalog = [summary({ scope: 'global' }), summary({ name: 'nossa', scope: 'org' })]

  const globalOnly = planSync(catalog, { skills: {}, lastSyncAt: 0 })
  assert.deepEqual(globalOnly.write.map(skill => skill.name), ['healer'])

  const both = planSync(catalog, { skills: {}, lastSyncAt: 0 }, { scopes: ['global', 'org'] })
  assert.deepEqual(both.write.map(skill => skill.name).sort(), ['healer', 'nossa'])
})

test('removal is limited to what this plugin recorded', () => {
  // The single most destructive thing this code could do is sweep the skills
  // directory. The manifest is the allowlist, so a hand-written skill and one
  // installed by another tool are both invisible to removal.
  const manifest = { skills: { healer: 'etag-1', gone: 'etag-9' }, lastSyncAt: 0 }
  const plan = planSync([summary()], manifest)

  assert.deepEqual(plan.remove, ['gone'])
})

test('a corrupt manifest authorizes no deletions', () => {
  const root = scratch()
  writeFileSync(manifestPath(root), '{not json', 'utf8')

  const manifest = readManifest(root)

  assert.deepEqual(manifest.skills, {})
  assert.deepEqual(planSync([], manifest).remove, [])
})

test('removeSkill refuses a directory outside the prefix', () => {
  const root = scratch()
  const handWritten = join(root, 'my-own-skill')
  mkdirSync(handWritten, { recursive: true })
  writeFileSync(join(handWritten, 'SKILL.md'), 'mine', 'utf8')

  // Reachable only through a poisoned manifest, and refused anyway.
  assert.equal(removeSkill(root, '../my-own-skill'), false)
  assert.ok(existsSync(handWritten))
})

test('the written file keeps the author frontmatter and adds provenance', () => {
  const rendered = renderSkillFile({
    name: 'healer',
    scope: 'global',
    version: 3,
    etag: 'abc',
    markdown: '---\nname: healer\ndescription: Fixes specs\n---\n\n# Healer\n\nBody.\n'
  })

  // The host parses this frontmatter, so it has to come first and unchanged.
  assert.match(rendered, /^---\nname: healer\ndescription: Fixes specs\n---\n/)
  assert.match(rendered, /Synced from Voidr/)
  assert.match(rendered, /scope: global/)
  assert.match(rendered, /Curated by Voidr/)
  assert.match(rendered, /# Healer/)
})

test('an org skill is labelled as customer-authored, not as Voidr content', () => {
  const rendered = renderSkillFile({
    name: 'nossa',
    scope: 'org',
    etag: 'abc',
    markdown: '# Nossa\n'
  })

  assert.match(rendered, /Authored inside your organization, not by Voidr/)
})

test('unsafe asset paths are refused on the client too', () => {
  for (const path of [
    '/etc/passwd',
    '../../.ssh/authorized_keys',
    'templates/../../escape',
    'C:/Windows/x',
    'a\\b',
    '',
    'dir/'
  ]) {
    assert.equal(isSafeAssetPath(path), false, path)
  }
  for (const path of ['report.css', 'templates/sections/00-kpi.html']) {
    assert.equal(isSafeAssetPath(path), true, path)
  }
})

test('materialize writes assets and refuses to escape the skill directory', () => {
  const root = scratch()

  materializeSkill(root, {
    name: 'render',
    scope: 'global',
    etag: 'e1',
    markdown: '# render\n',
    assets: [
      { path: 'templates/report.css', content: 'body{}' },
      { path: 'examples/one.md', content: '# one' }
    ]
  })

  const directory = join(root, `${SKILL_DIR_PREFIX}render`)
  assert.ok(existsSync(join(directory, 'SKILL.md')))
  assert.equal(readFileSync(join(directory, 'templates/report.css'), 'utf8'), 'body{}')

  assert.throws(
    () =>
      materializeSkill(root, {
        name: 'evil',
        scope: 'global',
        etag: 'e1',
        markdown: '# evil\n',
        assets: [{ path: '../../escaped.txt', content: 'x' }]
      }),
    /unsafe asset path/i
  )
})

test('materialize replaces the directory so dropped files do not linger', () => {
  const root = scratch()
  materializeSkill(root, {
    name: 'render',
    scope: 'global',
    etag: 'e1',
    markdown: '# render\n',
    assets: [{ path: 'old.md', content: 'old' }]
  })

  materializeSkill(root, {
    name: 'render',
    scope: 'global',
    etag: 'e2',
    markdown: '# render\n',
    assets: [{ path: 'new.md', content: 'new' }]
  })

  const directory = join(root, `${SKILL_DIR_PREFIX}render`)
  assert.ok(existsSync(join(directory, 'new.md')))
  assert.equal(existsSync(join(directory, 'old.md')), false)
})

test('a full sync writes, keeps, and removes against the manifest', async () => {
  const root = scratch()
  // Pre-existing state: one synced skill that is gone from the catalog, and one
  // hand-written skill that must survive.
  materializeSkill(root, { name: 'gone', scope: 'global', etag: 'old', markdown: '# gone\n' })
  mkdirSync(join(root, 'my-own-skill'), { recursive: true })
  writeFileSync(join(root, 'my-own-skill', 'SKILL.md'), 'mine', 'utf8')
  writeManifest(root, { skills: { gone: 'old', healer: 'etag-1' }, lastSyncAt: 0 })
  materializeSkill(root, { name: 'healer', scope: 'global', etag: 'etag-1', markdown: '# old\n' })

  const client = {
    list: async () => [summary({ etag: 'etag-1' }), summary({ name: 'novo', etag: 'etag-2' })],
    get: async name => ({ name, markdown: `# ${name}\n`, assets: [] })
  }

  const result = await syncSkills({ client, root, now: 1_000, force: true })

  assert.deepEqual(result.written, ['novo'])
  assert.deepEqual(result.kept, ['healer'])
  assert.deepEqual(result.removed, ['gone'])
  assert.ok(existsSync(join(root, 'my-own-skill', 'SKILL.md')))

  const manifest = readManifest(root)
  assert.deepEqual(manifest.skills, { healer: 'etag-1', novo: 'etag-2' })
  assert.equal(manifest.lastSyncAt, 1_000)
})

test('one unreadable skill does not abort the pass', async () => {
  const root = scratch()
  const client = {
    list: async () => [summary({ name: 'ok', etag: 'e1' }), summary({ name: 'broken', etag: 'e2' })],
    get: async name => {
      if (name === 'broken') throw new Error('HTTP 500')
      return { name, markdown: `# ${name}\n`, assets: [] }
    }
  }

  const result = await syncSkills({ client, root, force: true })

  assert.deepEqual(result.written, ['ok'])
  assert.equal(result.failed.length, 1)
  assert.equal(result.failed[0].name, 'broken')
  // The failure must not be recorded as synced, or it never retries.
  assert.equal(readManifest(root).skills.broken, undefined)
})

test('the throttle skips a sync that just ran', async () => {
  const root = scratch()
  writeManifest(root, { skills: {}, lastSyncAt: 1_000 })
  let listed = 0
  const client = {
    list: async () => {
      listed += 1
      return []
    },
    get: async () => ({})
  }

  const throttled = await syncSkills({
    client,
    root,
    now: 1_500,
    minIntervalMs: 1_000
  })
  assert.equal(throttled.skipped, 'throttled')
  assert.equal(listed, 0)

  const ran = await syncSkills({ client, root, now: 5_000, minIntervalMs: 1_000 })
  assert.equal(ran.skipped, null)
  assert.equal(listed, 1)
})

test('synced directories are listable without touching the rest', () => {
  const root = scratch()
  materializeSkill(root, { name: 'a', scope: 'global', etag: 'e', markdown: '#a\n' })
  mkdirSync(join(root, 'not-ours'), { recursive: true })
  writeFileSync(join(root, MANIFEST_FILE), '{}', 'utf8')

  assert.deepEqual(listSyncedDirectories(root), [`${SKILL_DIR_PREFIX}a`])
})

test('the hook never fails the session, even with no credential', async () => {
  // A SessionStart hook that exits non-zero or hangs is a session that will not
  // start. Failing open is the whole contract of this script.
  const { spawnSync } = await import('node:child_process')
  const { resolve } = await import('node:path')
  const script = resolve(import.meta.dirname, '../scripts/sync-voidr-skills.mjs')

  const result = spawnSync(process.execPath, [script], {
    input: JSON.stringify({ hook_event_name: 'SessionStart', cwd: process.cwd() }),
    encoding: 'utf8',
    env: {
      HOME: mkdtempSync(join(tmpdir(), 'voidr-empty-home-')),
      PATH: process.env.PATH,
      VOIDR_API_URL: 'http://127.0.0.1:1'
    },
    timeout: 30_000
  })

  assert.equal(result.status, 0, result.stderr)
  // Valid JSON, and silent: nothing changed, so nothing is said.
  assert.deepEqual(JSON.parse(result.stdout || '{}'), {})
})

test('the hook stays silent when the catalog is unchanged', async () => {
  const { spawnSync } = await import('node:child_process')
  const { resolve } = await import('node:path')
  const script = resolve(import.meta.dirname, '../scripts/sync-voidr-skills.mjs')
  const home = mkdtempSync(join(tmpdir(), 'voidr-home-'))

  const result = spawnSync(process.execPath, [script], {
    input: JSON.stringify({ hook_event_name: 'SessionStart', cwd: process.cwd() }),
    encoding: 'utf8',
    env: { HOME: home, PATH: process.env.PATH, VOIDR_API_URL: 'http://127.0.0.1:1' },
    timeout: 30_000
  })

  assert.equal(result.status, 0)
  assert.doesNotMatch(result.stdout, /systemMessage/)
})
