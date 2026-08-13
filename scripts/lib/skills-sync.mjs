import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

// Materializes the platform skill catalog as real host skills on disk.
//
// The MCP tools (skills_list_skills / skills_get_skill) already let a model
// fetch a skill mid-session, but a fetched skill is not a host skill: it has no
// /slash name and nothing loads its description to decide relevance. Writing it
// to the host's skills directory buys progressive disclosure — the host reads
// only the frontmatter until the skill actually fires.
//
// See docs/skills-repository.md, phase 2.

/** Every directory this plugin writes is prefixed, so it can never collide
 *  with a skill the developer wrote by hand. */
export const SKILL_DIR_PREFIX = 'voidr-'
export const MANIFEST_FILE = '.voidr-skills-manifest.json'

/**
 * Which scopes are written to disk.
 *
 * Defaults to the Voidr catalog only. An `org`/`app` skill is customer-authored
 * text, and materializing it hands it the same standing as a Voidr-authored
 * skill inside an agent that has a shell and credentials. That is a product
 * decision (open question 1 in the spec), not a default worth assuming, so it
 * takes an explicit opt-in. The durable form of this switch is an organization
 * setting served by the platform; this env var is the phase-2 stand-in.
 */
export function syncScopes(environment = process.env) {
  const raw = String(environment.VOIDR_SKILLS_SYNC_SCOPES || 'global')
  const requested = raw
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean)
  const allowed = requested.filter(scope => ['global', 'org', 'app'].includes(scope))
  return allowed.length > 0 ? allowed : ['global']
}

/** Skips a sync that just ran, so opening ten sessions is not ten catalog calls. */
export function minSyncIntervalMs(environment = process.env) {
  const raw = Number(environment.VOIDR_SKILLS_SYNC_MIN_INTERVAL_MS)
  return Number.isFinite(raw) && raw >= 0 ? raw : 15 * 60 * 1000
}

/**
 * Where the host reads skills from.
 *
 * Never inside the plugin: the guard forbids writing to the installation
 * directory, and `CLAUDE_PLUGIN_ROOT` moves on every plugin update. A synced
 * skill is user state, not plugin state.
 */
export function skillsRoot({
  scope = 'user',
  workspace = process.cwd(),
  home = homedir()
} = {}) {
  return scope === 'project'
    ? resolve(workspace, '.claude', 'skills')
    : resolve(home, '.claude', 'skills')
}

export function manifestPath(root) {
  return join(root, MANIFEST_FILE)
}

/**
 * Manifest of what this plugin put on disk: `{ name: etag }` plus a timestamp.
 *
 * It is also the delete allowlist. Removal only ever touches names recorded
 * here, so a skill the developer wrote by hand — or one another tool installed —
 * is never swept away by a catalog that no longer lists it.
 */
export function readManifest(root) {
  const path = manifestPath(root)
  if (!existsSync(path)) return { skills: {}, lastSyncAt: 0 }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return {
      skills: parsed?.skills && typeof parsed.skills === 'object' ? parsed.skills : {},
      lastSyncAt: Number.isFinite(parsed?.lastSyncAt) ? parsed.lastSyncAt : 0
    }
  } catch {
    // A corrupt manifest must not authorize deleting anything.
    return { skills: {}, lastSyncAt: 0 }
  }
}

export function writeManifest(root, manifest) {
  mkdirSync(root, { recursive: true })
  writeFileSync(
    manifestPath(root),
    `${JSON.stringify({ skills: manifest.skills, lastSyncAt: manifest.lastSyncAt }, null, 2)}\n`,
    'utf8'
  )
}

/**
 * What has to happen for the catalog to match the manifest.
 *
 * Comparison is inequality, never order: an org skill that shadows a global one
 * can carry a lower `version`, and the etag is a hash anyway.
 */
export function planSync(catalog, manifest, { scopes = ['global'] } = {}) {
  const eligible = catalog.filter(skill => scopes.includes(skill.scope))
  const wanted = new Map(eligible.map(skill => [skill.name, skill]))

  const write = []
  const keep = []
  for (const [name, skill] of wanted) {
    if (manifest.skills[name] && manifest.skills[name] === skill.etag) keep.push(name)
    else write.push(skill)
  }

  // Only names this plugin recorded are removal candidates.
  const remove = Object.keys(manifest.skills).filter(name => !wanted.has(name))

  return { write, remove, keep }
}

/**
 * Rejects an asset path that would escape the skill directory.
 *
 * The platform already validates this on write. Re-checking here is not
 * redundant: this process is the one that actually creates files on a
 * developer's machine, and it should not be able to be talked into writing
 * outside its own directory by a bad response.
 */
export function isSafeAssetPath(path) {
  const value = String(path || '')
  if (!value || value.includes('\0')) return false
  if (value.startsWith('/') || value.startsWith('\\') || value.includes('\\')) return false
  if (/^[a-zA-Z]:/.test(value)) return false
  if (value.endsWith('/')) return false
  return !value.split('/').some(segment => segment === '..' || segment === '.')
}

/**
 * The SKILL.md body written to disk.
 *
 * The stored markdown already carries its own frontmatter — the catalog keeps
 * the file whole so the host parses the same frontmatter the author wrote. The
 * provenance banner goes after it: an operator who opens the file has to be able
 * to tell it is generated, and where it came from, before editing something the
 * next sync overwrites.
 */
export function renderSkillFile(skill) {
  const provenance = [
    '<!-- Synced from Voidr. Do not edit: the next sync overwrites this file.',
    `     skill: ${skill.name}  scope: ${skill.scope}  version: ${skill.version ?? '?'}`,
    `     etag: ${skill.etag}`,
    skill.scope === 'global'
      ? '     Curated by Voidr.'
      : '     Authored inside your organization, not by Voidr.',
    '-->'
  ].join('\n')

  const body = String(skill.markdown || '')
  const frontmatterEnd = body.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/)
  if (!frontmatterEnd) return `${provenance}\n\n${body}\n`

  const head = body.slice(0, frontmatterEnd[0].length)
  const rest = body.slice(frontmatterEnd[0].length)
  return `${head}\n${provenance}\n${rest.startsWith('\n') ? '' : '\n'}${rest}`
}

export function skillDirectory(root, name) {
  return join(root, `${SKILL_DIR_PREFIX}${name}`)
}

/** Writes one skill and its assets. Returns the paths written. */
export function materializeSkill(root, skill) {
  const directory = skillDirectory(root, skill.name)
  // Replace wholesale so a file dropped from the catalog does not linger.
  rmSync(directory, { recursive: true, force: true })
  mkdirSync(directory, { recursive: true })

  const written = [join(directory, 'SKILL.md')]
  writeFileSync(written[0], renderSkillFile(skill), 'utf8')

  for (const asset of skill.assets || []) {
    if (!isSafeAssetPath(asset?.path)) {
      throw new Error(`Refusing unsafe asset path "${asset?.path}" in skill ${skill.name}`)
    }
    const target = join(directory, asset.path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, String(asset.content ?? ''), 'utf8')
    written.push(target)
  }
  return written
}

/** Removes a synced skill directory. Refuses anything outside the prefix. */
export function removeSkill(root, name) {
  const directory = skillDirectory(root, name)
  if (!existsSync(directory)) return false
  const base = directory.slice(root.length + 1)
  if (!base.startsWith(SKILL_DIR_PREFIX)) return false
  if (!statSync(directory).isDirectory()) return false
  rmSync(directory, { recursive: true, force: true })
  return true
}

/** Synced directories currently on disk, for diagnostics. */
export function listSyncedDirectories(root) {
  if (!existsSync(root)) return []
  return readdirSync(root)
    .filter(entry => entry.startsWith(SKILL_DIR_PREFIX))
    .filter(entry => {
      try {
        return statSync(join(root, entry)).isDirectory()
      } catch {
        return false
      }
    })
    .sort()
}

/**
 * Runs one sync pass.
 *
 * `client` only has to expose `list()` and `get(name)`. Everything above is pure
 * enough to test without the network, and this is the one seam that needs it.
 */
export async function syncSkills({
  client,
  root,
  scopes = ['global'],
  now = Date.now(),
  minIntervalMs = 0,
  force = false
}) {
  const manifest = readManifest(root)
  if (!force && minIntervalMs > 0 && now - manifest.lastSyncAt < minIntervalMs) {
    return { skipped: 'throttled', written: [], removed: [], kept: [] }
  }

  const catalog = await client.list()
  const plan = planSync(catalog, manifest, { scopes })

  const written = []
  const failed = []
  for (const summary of plan.write) {
    try {
      const skill = await client.get(summary.name)
      materializeSkill(root, { ...summary, ...skill })
      written.push(summary.name)
      manifest.skills[summary.name] = summary.etag
    } catch (error) {
      // One bad skill must not abort the pass: the rest of the catalog is still
      // worth having, and the failed one simply keeps its previous state.
      failed.push({ name: summary.name, error: error?.message || String(error) })
    }
  }

  const removed = []
  for (const name of plan.remove) {
    removeSkill(root, name)
    delete manifest.skills[name]
    removed.push(name)
  }

  manifest.lastSyncAt = now
  writeManifest(root, manifest)

  return { skipped: null, written, removed, kept: plan.keep, failed }
}
