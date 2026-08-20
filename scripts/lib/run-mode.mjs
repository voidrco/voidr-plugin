import { isShellTool, collectStringValues } from './protections.mjs'

// The user is asked, in /voidr-generate 0b, where the checking loop should run.
// Asking was not enough: observed live, the answer was "Na plataforma
// (sugerido)" at 19:12 and `npx playwright test modules/_smoke/...` ran at 19:16,
// four minutes later, with no platform step in between. The skill says to carry
// the answer through, and says a smoke spec run by hand while the mode is
// platform is the local loop taken without asking. Both sentences were present
// and neither bound anything.
//
// So the answer is enforced where it was made. This rule needs session state,
// which is why it does not live in protections.mjs: those rules hold whatever
// the session has agreed to, and this one exists only because something was
// agreed.

const LOCAL_RUN = /\bplaywright\s+test\b|\bplaywright\s+--\w/i

// Same per-stage reading the worker rule uses, so naming the command in a note
// or grepping for it is not running it.
const INSPECTION_LEAD =
  /^(?:ack|awk|bat|cat|code|comm|cut|diff|echo|egrep|fd|fgrep|find|git|grep|head|jq|less|ls|man|more|nl|open|printf|rg|sed|sort|tail|tee|tr|type|uniq|wc|which|yq)\b/i

function stagesThatRunLocally(shellText) {
  return String(shellText)
    .split(/\|\||&&|[;|&\n]/)
    .map(stage => stage.trim())
    .filter(Boolean)
    .filter(stage => LOCAL_RUN.test(stage) && !INSPECTION_LEAD.test(stage))
}

export function findRunModeDenial({ rawToolName, toolArgs, state }) {
  if (state?.checkMode !== 'platform') return null
  if (!isShellTool(rawToolName)) return null
  if (!stagesThatRunLocally(collectStringValues(toolArgs).join('\n')).length) {
    return null
  }
  return (
    'Blocked by Voidr policy: the checking loop for this work was set to run ' +
    'through the flow, and this invokes Playwright directly. Use voidr_explore ' +
    'for an inspection probe — it runs on this machine too, but with the ' +
    "selected environment's baseUrl and credentials, and it returns stdout and " +
    'traces as evidence — and voidr_build for the build gate. If a direct run ' +
    'is genuinely what this needs, ask the user to switch the mode and say why.'
  )
}
