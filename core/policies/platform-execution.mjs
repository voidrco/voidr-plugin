const LOCAL_PLAYWRIGHT =
  /(?:^|[\s;&|])(?:npx\s+)?(?:\S*\/)?playwright\s+(?:test|install|install-deps|show-report|codegen)\b/i

const INSPECTION_LEAD =
  /^(?:ack|awk|bat|cat|code|comm|cut|diff|echo|egrep|fd|fgrep|find|git|grep|head|jq|less|ls|man|more|nl|open|printf|rg|sed|sort|tail|tee|tr|type|uniq|wc|which|yq)\b/i

export function localPlaywrightStages(command) {
  return String(command)
    .split(/\|\||&&|[;|&\n]/)
    .map(stage => stage.trim())
    .filter(Boolean)
    .filter(stage => LOCAL_PLAYWRIGHT.test(stage) && !INSPECTION_LEAD.test(stage))
}

export function platformExecutionDenial({ command, platformValidation, guidance = '' }) {
  if (!platformValidation || localPlaywrightStages(command).length === 0) return null
  return (
    'Local Playwright execution is disabled while validation uses the Voidr ' +
    'Platform. Dependency installation, builds, Git, and Voidr CLI deploy ' +
    'commands remain allowed. Deploy an immutable candidate and execute its ' +
    `explicit targets remotely as a SHADOW run.${guidance ? ` ${guidance}` : ''}`
  )
}
