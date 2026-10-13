const OBJECT_ID = /^[a-fA-F0-9]{24}$/
const DRAFT_TOOL = 'mcp__voidr__echo_edit_overview_draft'
const DESCRIBE_TOOL = 'mcp__voidr__echo_get_overview_view'
const PROPOSE_TOOL = 'echo_propose_overview_change'

function overviewStudioDraft(events) {
  const hint = (events ?? []).findLast(event => event.type === 'voidr/project-context-hint')?.data
  const draftId = hint?.echoContext?.overviewDraftId
  return typeof draftId === 'string' && OBJECT_ID.test(draftId) ? draftId : null
}

export function echoOverviewStudioDenial(name, args, events) {
  const draftId = overviewStudioDraft(events)
  if (name === PROPOSE_TOOL && draftId) {
    return 'The person is editing this view in the overview studio, where there are no proposal cards. Change the draft with ' +
      DRAFT_TOOL + ' and draftId ' + draftId + '; the canvas updates live, the person can undo, and they save the view from the studio.'
  }
  if (name === DESCRIBE_TOOL && draftId && args?.draftId !== draftId) {
    return 'The person is in the overview studio. Read the draft they are editing: call ' + DESCRIBE_TOOL + ' with draftId ' + draftId + '.'
  }
  if (name !== DRAFT_TOOL) return null
  if (!draftId) return 'No overview studio is open. Propose overview changes with ' + PROPOSE_TOOL + ' instead.'
  if (args?.draftId !== draftId) return 'Edit the draft open in the studio: draftId ' + draftId + '.'
  return null
}
