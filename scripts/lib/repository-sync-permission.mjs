const GITHUB_SYNC_TOOLS = new Set([
  'voidr_repository_sync_github',
  'test_plans_sync_repository_diff'
])

export function repositorySyncPermissionPrompt(toolName, toolArgs = {}) {
  const normalizedName = String(toolName || '')
  const publishesRemotely =
    normalizedName === 'voidr_workspace_publish_tests' &&
    toolArgs?.pushToRemote !== false
  if (!GITHUB_SYNC_TOOLS.has(normalizedName) && !publishesRemotely) return null
  return (
    'Sincronizar o commit local deste teste com o repositório no GitHub agora? ' +
    'Se você negar, LIVE continua publicado e o commit permanece somente nesta máquina.'
  )
}
