import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ECHO_MCP_PREFIX = 'mcp__voidr__echo_'
const SKILL_ROOTS = [
  join(dirname(fileURLToPath(import.meta.url)), 'skills'),
  join(dirname(fileURLToPath(import.meta.url)), '../../skills')
].map(root => resolve(root) + sep)
const MEMBER_TOOLS = new Set([
  'ask_user_question',
  'render_widget',
  'todo_write',
  'skill',
  'read_image',
  'inspect_session_images',
  'materialize_session_image',
  'echo_render_deviations',
  'echo_render_regulatory_controls',
  'echo_render_deviation_group',
  'echo_propose_overview_change',
  'mcp__voidr__files_analyze_uploaded_file'
])
const DENIAL = 'Not available on Echo for this member. Use the Echo tools and bundled Echo references only; never run commands, edit files, browse the web or call non-Echo tools.'

function readsSkillReference(args) {
  const path = typeof args?.file_path === 'string' ? args.file_path : typeof args?.path === 'string' ? args.path : ''
  if (!path) return false
  const target = resolve(path)
  return SKILL_ROOTS.some(root => target.startsWith(root))
}

export function echoMemberToolDenial(name, args) {
  if (name.startsWith(ECHO_MCP_PREFIX) || MEMBER_TOOLS.has(name)) return null
  if (name === 'read' && readsSkillReference(args)) return null
  return DENIAL
}

export function registerEchoMemberPolicy(ctx) {
  const restricted = new Set()
  ctx.commands.register({
    name: 'echo-member-policy',
    description: 'Apply the server-resolved Echo member tool policy to this session',
    recordInput: false,
    handler: ({ agent, rawInput }) => {
      const value = rawInput.trim()
      if (value === 'restricted') restricted.add(agent.id)
      else if (value === 'full') restricted.delete(agent.id)
      else return { kind: 'error', text: 'Invalid Echo member policy' }
      return { kind: 'success', text: 'Echo member policy applied' }
    }
  })
  ctx.on('agent/disposed', ({ agent }) => { restricted.delete(agent.id) })
  return exec => restricted.has(exec.agent?.id) ? echoMemberToolDenial(exec.name, exec.arguments ?? exec.args) : null
}
