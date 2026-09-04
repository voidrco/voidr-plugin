import { isShellTool, collectStringValues } from './protections.mjs'
import { platformExecutionDenial } from '../../core/policies/platform-execution.mjs'

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

export function findRunModeDenial({ rawToolName, toolArgs, state }) {
  if (state?.checkMode !== 'platform') return null
  if (!isShellTool(rawToolName)) return null
  return platformExecutionDenial({
    command: collectStringValues(toolArgs).join('\n'),
    platformValidation: true,
    guidance:
      'Use voidr_build, voidr_release_deploy_validation, and a SHADOW execution through /voidr-execute. For a quick DOM question, use voidr_explore.'
  })
}
