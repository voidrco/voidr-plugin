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
    'Blocked by Voidr policy: the checking loop for this work was set to the ' +
    'platform, and this runs the tests on this machine instead. On the platform ' +
    'a check is voidr_build, then voidr_release_deploy_validation, then a SHADOW ' +
    'execution through /voidr-execute. For a quick DOM question, voidr_explore ' +
    'is the local probe that still wires the environment and returns traces. If ' +
    'this work genuinely needs a direct run, ask the user to switch the mode and ' +
    'say why.'
  )
}
