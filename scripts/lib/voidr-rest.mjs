import { basicAuthorizationHeader } from './credentials.mjs'
import { describeNetworkFailure } from './network-trust.mjs'

export class VoidrRestClient {
  constructor({
    url = process.env.VOIDR_API_URL || 'https://api.voidr.co/v1',
    fetchImpl = globalThis.fetch
  } = {}) {
    this.url = String(url).replace(/\/+$/, '')
    this.fetch = fetchImpl
  }

  get(path) {
    return this.request('GET', path)
  }

  post(path, body) {
    return this.request('POST', path, body)
  }

  async request(method, path, body) {
    let response
    try {
      response = await this.fetch(`${this.url}/${String(path).replace(/^\/+/, '')}`, {
        method,
        headers: {
          accept: 'application/json',
          authorization: basicAuthorizationHeader(),
          ...(body === undefined ? {} : { 'content-type': 'application/json' })
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      })
    } catch (error) {
      throw new Error(describeNetworkFailure(error))
    }
    const text = await response.text()
    if (!response.ok) {
      const message =
        response.status === 401 || response.status === 403
          ? 'Voidr Service Account was rejected or lacks the required scope.'
          : `Voidr API returned HTTP ${response.status}.`
      throw new Error(message)
    }
    return text.trim() ? JSON.parse(text) : null
  }
}
