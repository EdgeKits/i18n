import assert from 'node:assert/strict'
import test from 'node:test'

import { MAX_RETRIES, purgeTranslationsCache, retryWaitMs } from '../src/cli/purge.ts'

/**
 * Audit 2026-10-12 A10-1: the purge client retries HTTP 429 a bounded number of times,
 * honouring Retry-After, then gives up on the chunk (the caller then leaves
 * .i18n-hashes.json unwritten). fetch and the wait are injected: no network, no real sleep.
 */

const URLS = ['https://example.com/a', 'https://example.com/b']

function fakeFetch(responses: Array<() => Response>) {
  const calls: string[] = []
  const fetch = async (input: string) => {
    calls.push(input)
    const next = responses.shift()
    assert.ok(next, 'more fetch calls than scripted responses')
    return next()
  }
  return { fetch, calls }
}

const status =
  (code: number, headers: Record<string, string> = {}) =>
  () =>
    new Response('{}', { status: code, headers })

function recorder() {
  const waits: number[] = []
  return { waits, sleep: async (ms: number) => void waits.push(ms) }
}

test('429 forever: gives up after MAX_RETRIES retries and returns false', async () => {
  const { fetch, calls } = fakeFetch(Array.from({ length: MAX_RETRIES + 1 }, () => status(429)))
  const { waits, sleep } = recorder()

  assert.equal(await purgeTranslationsCache('zone', 'token', URLS, { fetch, sleep }), false)
  assert.equal(calls.length, MAX_RETRIES + 1, 'the first try plus MAX_RETRIES retries')
  assert.deepEqual(waits, [2000, 4000, 8000, 16000, 30000], 'exponential from 2 s, capped at 30 s')
})

test('Retry-After is honoured, then the chunk goes through', async () => {
  const { fetch, calls } = fakeFetch([status(429, { 'Retry-After': '3' }), status(200)])
  const { waits, sleep } = recorder()

  assert.equal(await purgeTranslationsCache('zone', 'token', URLS, { fetch, sleep }), true)
  assert.equal(calls.length, 2)
  assert.deepEqual(waits, [3000])
})

test('retries are counted per chunk: a later chunk gets the full budget again', async () => {
  const urls = Array.from({ length: 150 }, (_, i) => `https://example.com/${i}`)
  const responses = [
    ...Array.from({ length: MAX_RETRIES }, () => status(429)),
    status(200), // chunk 1, after MAX_RETRIES retries
    ...Array.from({ length: MAX_RETRIES }, () => status(429)),
    status(200), // chunk 2, after MAX_RETRIES retries
  ]
  const { fetch, calls } = fakeFetch(responses)
  const { sleep } = recorder()

  assert.equal(await purgeTranslationsCache('zone', 'token', urls, { fetch, sleep }), true)
  assert.equal(calls.length, 2 * (MAX_RETRIES + 1))
})

test('retryWaitMs: Retry-After seconds when numeric, else 2 s doubling; always capped at 30 s', () => {
  assert.equal(retryWaitMs('0', 1), 0)
  assert.equal(retryWaitMs('7', 4), 7000)
  assert.equal(retryWaitMs('120', 1), 30000)
  assert.equal(retryWaitMs(null, 1), 2000)
  assert.equal(retryWaitMs('Wed, 21 Oct 2026 07:28:00 GMT', 2), 4000, 'an HTTP date falls back to backoff')
  assert.equal(retryWaitMs('-5', 3), 8000)
  assert.equal(retryWaitMs(null, 5), 30000)
})
