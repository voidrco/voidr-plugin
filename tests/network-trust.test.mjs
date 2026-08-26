import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applySystemCaTrust,
  describeNetworkFailure,
  tlsTrustFailureFrom,
  tlsTrustRecoveryGuidance
} from '../scripts/lib/network-trust.mjs'

test('system CA trust reports unsupported runtimes without touching TLS', () => {
  const result = applySystemCaTrust({ tlsImpl: {} })
  assert.equal(result.status, 'unsupported')
})

test('system CA trust merges system certificates into the TLS defaults', () => {
  const calls = []
  const tlsImpl = {
    getCACertificates: type =>
      type === 'system' ? ['corp-root', 'shared'] : ['bundled', 'shared'],
    setDefaultCACertificates: certificates => calls.push(certificates)
  }
  const result = applySystemCaTrust({ tlsImpl })
  assert.equal(result.status, 'applied')
  assert.equal(result.systemCertificates, 2)
  assert.deepEqual(calls, [['bundled', 'shared', 'corp-root']])
})

test('system CA trust skips machines with an empty system store', () => {
  const tlsImpl = {
    getCACertificates: type => (type === 'system' ? [] : ['bundled']),
    setDefaultCACertificates: () => {
      throw new Error('must not be called')
    }
  }
  assert.equal(applySystemCaTrust({ tlsImpl }).status, 'empty')
})

test('system CA trust surfaces read failures instead of throwing', () => {
  const tlsImpl = {
    getCACertificates: () => {
      throw new Error('store unavailable')
    },
    setDefaultCACertificates: () => {}
  }
  const result = applySystemCaTrust({ tlsImpl })
  assert.equal(result.status, 'failed')
  assert.match(result.reason, /store unavailable/)
})

test('TLS interception failures explain the corporate proxy remediation', () => {
  const error = new TypeError('fetch failed')
  error.cause = Object.assign(new Error('self-signed certificate in certificate chain'), {
    code: 'SELF_SIGNED_CERT_IN_CHAIN'
  })
  const message = describeNetworkFailure(error)
  assert.match(message, /SELF_SIGNED_CERT_IN_CHAIN/)
  assert.match(message, /NODE_EXTRA_CA_CERTS/)
  assert.match(message, /corporate proxy/)
})

test('other network failures expose the underlying error code', () => {
  const error = new TypeError('fetch failed')
  error.cause = Object.assign(new Error('connect timed out'), { code: 'ETIMEDOUT' })
  assert.equal(
    describeNetworkFailure(error),
    'Could not reach the Voidr API (ETIMEDOUT).'
  )
})

test('network failures honor a custom target label', () => {
  const error = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })
  assert.equal(
    describeNetworkFailure(error, 'the Voidr MCP endpoint'),
    'Could not reach the Voidr MCP endpoint (ECONNRESET).'
  )
})

test('TLS trust failures are recognized in nested tool results', () => {
  assert.equal(
    tlsTrustFailureFrom({
      content: [{ text: 'request failed: SELF_SIGNED_CERT_IN_CHAIN' }]
    }),
    'SELF_SIGNED_CERT_IN_CHAIN'
  )
  assert.equal(
    tlsTrustFailureFrom('unable to get local issuer certificate'),
    'unable to get local issuer certificate'
  )
  assert.equal(tlsTrustFailureFrom({ error: 'ETIMEDOUT' }), null)
})

test('TLS recovery guidance keeps verification enabled and retries safely', () => {
  const guidance = tlsTrustRecoveryGuidance('SELF_SIGNED_CERT_IN_CHAIN')
  assert.match(guidance, /NODE_USE_SYSTEM_CA/)
  assert.match(guidance, /NODE_EXTRA_CA_CERTS/)
  assert.match(guidance, /retry the exact failed command once/)
  assert.match(guidance, /Never set NODE_TLS_REJECT_UNAUTHORIZED=0/)
  assert.match(guidance, /explicit user approval/)
})
