const WIDGET_TOOLS = new Set([
  'render_widget',
  'echo_render_deviations',
  'echo_render_deviation_group',
  'echo_render_regulatory_controls'
])

export function contextChannel(events) {
  return (events ?? []).findLast(event => event.type === 'voidr/project-context-hint')?.data?.channel ?? null
}

export function whatsappChannelDenial(name, events) {
  if (!WIDGET_TOOLS.has(name) || contextChannel(events) !== 'whatsapp') return null
  return 'This conversation is on WhatsApp, which only shows text. Answer with a short text summary of the numbers instead. When the person wants to see the dashboard, call mcp__voidr__echo_share_overview to send them a link to it.'
}
