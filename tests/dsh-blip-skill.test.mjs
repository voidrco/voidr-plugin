import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { loadDshPluginSkills } from '../adapters/dsh/plugin-skills.mjs'
import { apply } from '../adapters/dsh/index.mjs'
import { interactiveTestDevelopmentPrompt } from '../core/workflow/interactive-test-development.mjs'

function walk(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    assert.notEqual(entry.name, '__pycache__')
    const path = join(prefix, entry.name)
    return entry.isDirectory() ? walk(join(directory, entry.name), path) : [path]
  })
}

test('routes Blip incidents to the Service renderer without bypassing organization permissions', () => {
  const prompt = interactiveTestDevelopmentPrompt()
  assert.match(prompt, /explicit Blip incident[\s\S]*load blip-incident-remediation before investigative work/)
  assert.match(prompt, /tenant-bound Service evidence_reports_create layer/)
  assert.match(prompt, /does not authorize another organization or missing provider permissions/)
  assert.match(prompt, /Do not bind a test-authoring workspace or use the legacy offline Python renderer/)
})

test('registers the Blip skill with a readable packaged resource base', () => {
  const skill = loadDshPluginSkills().find(entry => entry.name === 'blip-incident-remediation')
  assert.ok(skill)
  assert.equal(skill.provider, 'voidr-plugin')
  assert.equal(skill.resourceBase.path, dirname(skill.path))
  const registered = []
  apply({ skills: { register(value) { registered.push(value) } },
    systemPrompt: { section() {}, variable() {} }, commands: { register() {} },
    tools: { register() {} }, on() {} })
  assert.ok(registered.find(entry => entry.name === skill.name))
  const files = walk(skill.resourceBase.path)
  for (const path of files.filter(file => file.endsWith('.md'))) {
    const content = readFileSync(join(skill.resourceBase.path, path), 'utf8')
    for (const match of content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const link = match[1].split('#')[0]
      if (!link || /^(?:[a-z]+:|\/)/i.test(link)) continue
      assert.ok(readFileSync(resolve(dirname(join(skill.resourceBase.path, path)), link)).length)
    }
  }
  for (const file of ['scripts/render_blip_postmortem.py', 'scripts/requirements-dsh.txt',
    'assets/blip-cover-pages.pdf', 'assets/blip-content-page.pdf',
    'assets/Lexend-Regular.ttf', 'assets/Lexend-Bold.ttf', 'agents/openai.yaml'])
    assert.ok(readFileSync(join(skill.resourceBase.path, file)).length, file)
})

test('maps collected Zendesk tickets to tenant-discovered read tools instead of remote MCP dispatch', () => {
  const skill = loadDshPluginSkills().find(entry => entry.name === 'blip-incident-remediation')
  const mapping = JSON.parse(readFileSync(join(skill.resourceBase.path, 'scripts/dsh-compatibility.json'), 'utf8'))
  const route = mapping.providerRoutes.zendesk
  assert.equal(route.kind, 'collected-voidr-dataset')
  assert.equal(route.adapter, 'zendesk-api-v1')
  assert.deepEqual(route.legacyAdapters, ['zendesk-browser-v1'])
  assert.equal(route.storage, 'clickhouse')
  assert.equal(route.connector, 'discover-id-or-slug-in-authorized-organization')
  assert.deepEqual(route.readTools, ['custom_connectors_zendesk_evidence', 'custom_connectors_search_tickets', 'custom_connectors_ticket_attachment'])
  assert.deepEqual(route.pagination, { input: 'offset', next: 'nextOffset' })
  assert.deepEqual(route.legacyPagination, { input: 'textOffset', next: 'textWindow.nextOffset' })
  assert.equal(route.fallback.tool, 'custom_connectors_zendesk_live')
  assert.equal(route.fallback.sameAuthorizedConnector, true)
  assert.equal(route.fallback.bypassPermissionDenials, false)
  assert.equal(route.fallback.discloseSource, true)
  assert.equal(route.liveSource, false)
  assert.equal(route.initialOnlyAvailable, false)
  assert.equal(mapping.remoteInvocation.provider, 'grafana')
  assert.ok(readFileSync(resolve(skill.resourceBase.path, route.reference)).length)
})

test('preserves canonical investigation and offline assets while updating presentation', {
  skip: !process.env.BLIP_CANONICAL_SKILL,
}, () => {
  const skill = loadDshPluginSkills().find(entry => entry.name === 'blip-incident-remediation')
  const canonical = process.env.BLIP_CANONICAL_SKILL
  const original = readFileSync(join(canonical, 'SKILL.md'), 'utf8')
  const installed = readFileSync(skill.path, 'utf8')
  const investigation = content => {
    const start=content.indexOf('Trate o ticket ou registro interno como input canônico.')
    const end=content.indexOf(content.includes('## Entrega para decisão')?'## Entrega para decisão':'## Formato obrigatório da entrega')
    assert.ok(start>=0 && end>start)
    return content.slice(start,end)
  }
  assert.equal(investigation(installed), investigation(original))
  assert.equal(installed.slice(installed.indexOf('## Continuidade')),original.slice(original.indexOf('## Continuidade')))
  function originals(directory, prefix = '') {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
      if (entry.name === '__pycache__') return []
      const path = join(prefix, entry.name)
      return entry.isDirectory() ? originals(join(directory, entry.name), path) : [path]
    })
  }
  for (const file of originals(canonical).filter(file => !['SKILL.md','references/blip-pdf-visual-standard.md','references/blip-postmortem-format.md'].includes(file)))
    assert.deepEqual(readFileSync(join(skill.resourceBase.path, file)), readFileSync(join(canonical, file)), file)
})

// Active instructions must not send Assistant investigations into legacy shell rendering.
test('keeps investigation gates while using decision-first partial PDF delivery', () => {
 const skill = loadDshPluginSkills().find(entry => entry.name === 'blip-incident-remediation');
 const content = readFileSync(skill.path, 'utf8');
 for (const token of ['Escada causal obrigatória','DIAGNÓSTICO PARCIAL','decisionSummary','evidence_reports_create','upload','tempo e tokens']) assert.ok(content.includes(token),token);
 assert.ok(!content.includes('Os títulos e a ordem do template são literais'));
 const guidance = readFileSync(join(process.cwd(),'skills/voidr-evidence-report/references/information-design.md'),'utf8');
 for(const token of ['denominadores','correlação não demonstra causa','Space Grotesk Light','Inter Light/Medium']) assert.ok(guidance.includes(token),token);
 assert.match(guidance,/Dois percursos/);
 assert.match(guidance,/Não invente responsáveis, prazos/);
});
