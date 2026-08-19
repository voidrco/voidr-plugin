import {
  forgetServiceAccountAccessToken,
  serviceAccountAccessToken
} from './credentials.mjs'
import { describeNetworkFailure } from './network-trust.mjs'

export class VoidrRestClient {
  constructor({
    url = process.env.VOIDR_API_URL || 'https://api.voidr.co/v1',
    fetchImpl = globalThis.fetch,
    accessToken = serviceAccountAccessToken
  } = {}) {
    this.url = String(url).replace(/\/+$/, '')
    this.fetch = fetchImpl
    this.accessToken = accessToken
  }

  get(path) {
    return this.request('GET', path)
  }

  post(path, body) {
    return this.request('POST', path, body)
  }

  async request(method, path, body) {
    // A rejected token is retried once with a fresh one: the cached token can
    // outlive a rotated Service Account, and the caller would otherwise read
    // it as a permission problem.
    const response = await this.send(method, path, body, await this.accessToken())
    if (response.status !== 401) return this.read(response)

    forgetServiceAccountAccessToken()
    return this.read(
      await this.send(method, path, body, await this.accessToken())
    )
  }

  async send(method, path, body, token) {
    try {
      return await this.fetch(
        `${this.url}/${String(path).replace(/^\/+/, '')}`,
        {
          method,
          headers: {
            accept: 'application/json',
            authorization: `Bearer ${token}`,
            ...(body === undefined ? {} : { 'content-type': 'application/json' })
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) })
        }
      )
    } catch (error) {
      throw new Error(describeNetworkFailure(error))
    }
  }

  async read(response) {
    const text = await response.text()
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error(
          'Voidr Service Account was rejected or lacks the required scope.'
        )
      }
      // The platform explains rejected payloads in the body; dropping it left
      // the agent guessing at which field it got wrong.
      const detail = text.trim().slice(0, 400)
      throw new Error(
        `Voidr API returned HTTP ${response.status}.${detail ? ` ${detail}` : ''}`
      )
    }
    return text.trim() ? JSON.parse(text) : null
  }
}
