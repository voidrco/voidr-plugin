import tls from 'node:tls'

const TLS_TRUST_ERROR_CODES = new Set([
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_UNTRUSTED'
])

const TLS_TRUST_ERROR_MESSAGES = [
  'self-signed certificate in certificate chain',
  'self signed certificate in certificate chain',
  'unable to verify the first certificate',
  'unable to verify leaf signature',
  'unable to get issuer certificate',
  'unable to get local issuer certificate'
]

export function applySystemCaTrust({ tlsImpl = tls } = {}) {
  if (
    typeof tlsImpl.getCACertificates !== 'function' ||
    typeof tlsImpl.setDefaultCACertificates !== 'function'
  ) {
    return { status: 'unsupported' }
  }
  try {
    const system = tlsImpl.getCACertificates('system')
    if (!Array.isArray(system) || system.length === 0) {
      return { status: 'empty' }
    }
    const defaults = tlsImpl.getCACertificates('default')
    tlsImpl.setDefaultCACertificates([...new Set([...defaults, ...system])])
    return { status: 'applied', systemCertificates: system.length }
  } catch (error) {
    return { status: 'failed', reason: error?.message || String(error) }
  }
}

export function describeNetworkFailure(error, target = 'the Voidr API') {
  const cause = error?.cause ?? error
  const code = cause?.code ? String(cause.code) : ''
  const detail = code || cause?.message || error?.message || 'unknown network error'
  if (TLS_TRUST_ERROR_CODES.has(code)) {
    return (
      `Could not reach ${target} (${detail}). This machine appears to be behind a ` +
      'TLS-inspecting corporate proxy and this Node.js runtime does not trust its ' +
      'certificate authority. Update Node.js to a version that can read the system ' +
      'certificate store, or export the corporate root CA to a .pem file, set the ' +
      'NODE_EXTRA_CA_CERTS environment variable to its path, and restart the editor.'
    )
  }
  return `Could not reach ${target} (${detail}).`
}

export function tlsTrustFailureFrom(value) {
  if (value === undefined || value === null) return null
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  const upper = text.toUpperCase()
  for (const code of TLS_TRUST_ERROR_CODES) {
    if (upper.includes(code)) return code
  }
  const lower = text.toLowerCase()
  return TLS_TRUST_ERROR_MESSAGES.find(message => lower.includes(message)) || null
}

export function tlsTrustRecoveryGuidance(failure) {
  return [
    `The previous tool failed because Node.js does not trust a certificate authority in the TLS chain (${failure}). On a corporate machine, this is usually the company proxy certificate authority.`,
    'Treat this as certificate trust failure, not invalid Voidr credentials. Do not sign in again or rotate credentials.',
    'Check node --version. Before the next Voidr CLI or network command, enable the operating system certificate store in the current shell and retry the exact failed command once.',
    'On PowerShell with Node.js 22.19 or newer, run: $env:NODE_USE_SYSTEM_CA = "1"',
    'On Node.js 22.15 through 22.18, append --use-system-ca to the current NODE_OPTIONS without replacing existing options.',
    'On macOS or Linux with Node.js 22.19 or newer, run: export NODE_USE_SYSTEM_CA=1',
    'If the retry still fails, ask the user for the corporate root CA as a PEM file, set NODE_EXTRA_CA_CERTS to that file in the same environment, restart the editor, and retry.',
    'Never set NODE_TLS_REJECT_UNAUTHORIZED=0. Do not persist an environment variable at user or machine scope without explicit user approval.'
  ].join('\n')
}
