#!/usr/bin/env node

import { emitKeypressEvents } from 'node:readline'
import { validateAndStoreServiceAccount } from './lib/service-account-import.mjs'

const options = parseArgs(process.argv.slice(2))
const clientId =
  options['client-id'] || (await readVisibleValue('Client ID: '))
if (!clientId) fail('Client ID is required.')

const clientSecret =
  process.env.VOIDR_CLIENT_SECRET || (await readHiddenSecret('Client secret: '))
if (!clientSecret) fail('Client secret is required.')

try {
  const result = await validateAndStoreServiceAccount({
    clientId,
    clientSecret,
    organizationId: options['org-id'],
    organizationName: options['org-name'],
    tokenUrl: options['token-url']
  })
  process.stdout.write(`${JSON.stringify(result)}\n`)
} catch (error) {
  fail(error instanceof Error ? error.message : 'Voidr connection failed.')
}

async function readHiddenSecret(prompt) {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) {
    fail(
      'A terminal is required for secret input. Run this command directly in a terminal.'
    )
  }

  process.stdout.write(prompt)
  emitKeypressEvents(process.stdin)
  process.stdin.setRawMode(true)
  process.stdin.resume()

  return new Promise(resolveSecret => {
    let secret = ''
    function onKeypress(character, key) {
      if (key?.ctrl && key.name === 'c') {
        cleanup()
        process.stdout.write('\n')
        process.exit(130)
      }
      if (key?.name === 'return' || key?.name === 'enter') {
        cleanup()
        process.stdout.write('\n')
        resolveSecret(secret)
        return
      }
      if (key?.name === 'backspace') {
        secret = secret.slice(0, -1)
        return
      }
      if (!key?.ctrl && !key?.meta && character) secret += character
    }
    function cleanup() {
      process.stdin.off('keypress', onKeypress)
      process.stdin.setRawMode(false)
      process.stdin.pause()
    }
    process.stdin.on('keypress', onKeypress)
  })
}

function parseArgs(args) {
  const parsed = {}
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]
    if (!token.startsWith('--')) fail(`Unexpected argument: ${token}`)
    const key = token.slice(2)
    const value = args[index + 1]
    if (!value || value.startsWith('--')) fail(`Missing value for --${key}`)
    parsed[key] = value
    index += 1
  }
  return parsed
}

function readVisibleValue(prompt) {
  if (!process.stdin.isTTY) {
    fail(
      'A terminal is required for Client ID input. Run this command directly in a terminal.'
    )
  }
  process.stdout.write(prompt)
  process.stdin.setEncoding('utf8')
  process.stdin.resume()
  return new Promise(resolveValue => {
    process.stdin.once('data', chunk => {
      process.stdin.pause()
      resolveValue(String(chunk).trim())
    })
  })
}

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}
