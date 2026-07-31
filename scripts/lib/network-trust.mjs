import tls from 'node:tls'

const TLS_TRUST_ERROR_CODES = new Set([
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_UNTRUSTED'
])

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
