// ---------------------------------------------------------------------------
// Cloudflare Cache Purge API
// ---------------------------------------------------------------------------

/**
 * Purge a list of URLs from Cloudflare's edge cache via the Purge API.
 *
 * Handles Cloudflare's rate limits automatically:
 *   - Max 100 URLs per request (max operations per request)
 *   - Max 800 URLs per second on Free plan (8 chunks of 100)
 *   - HTTP 429: up to MAX_RETRIES retries per chunk, waiting `Retry-After` seconds when
 *     the response sends it, otherwise 2 s, 4 s, 8 s… (every wait capped at
 *     MAX_RETRY_WAIT_MS); then the chunk counts as failed.
 *
 * Reference: https://developers.cloudflare.com/cache/how-to/purge-cache/
 *
 * `deps` replaces `fetch` and the wait in tests.
 *
 * @returns true if all chunks succeeded, false if any chunk failed
 */
export async function purgeTranslationsCache(
  zoneId: string,
  apiToken: string,
  urls: string[],
  deps: PurgeDeps = {},
): Promise<boolean> {
  if (!urls.length) return true

  const { fetch: fetchFn = fetch, sleep: wait = sleep } = deps

  // Cloudflare limit: max 100 URLs per single purge request
  const CHUNK_SIZE = 100

  // Cloudflare Free plan limit: 800 URLs/sec = 8 chunks of 100 per second
  // Pro and above: 1500 URLs/sec — CHUNK_SIZE * MAX_CHUNKS_PER_SEC covers Free plan
  const MAX_CHUNKS_PER_SEC = 8

  console.log(`[i18n] Purging cache for ${urls.length} URL(s)...`)

  // 429 retries of the current chunk; reset when a chunk goes through.
  let retries = 0

  for (let i = 0; i < urls.length; i += CHUNK_SIZE) {
    const chunk = urls.slice(i, i + CHUNK_SIZE)
    const currentChunkIndex = Math.floor(i / CHUNK_SIZE) + 1

    try {
      const response = await fetchFn(`https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ files: chunk }),
      })

      // Rate limit hit — wait and retry the same chunk, a bounded number of times
      if (response.status === 429) {
        if (retries >= MAX_RETRIES) {
          console.error(
            `[i18n] [Chunk ${currentChunkIndex}] Still rate-limited after ${MAX_RETRIES} retries; ` +
              `giving up on ${chunk.length} URL(s):\n` +
              chunk.map((url) => `  - ${url}`).join('\n'),
          )
          return false
        }
        retries++
        const waitMs = retryWaitMs(response.headers.get('retry-after'), retries)
        console.warn(
          `[i18n] [Chunk ${currentChunkIndex}] Rate limit hit, retry ${retries}/${MAX_RETRIES} in ${waitMs}ms...`,
        )
        await wait(waitMs)
        i -= CHUNK_SIZE // retry same chunk
        continue
      }

      if (!response.ok) {
        const errorData = await response.text()
        console.error(`[i18n] [Chunk ${currentChunkIndex}] Cloudflare API error:`, errorData)
        return false
      }

      retries = 0
      console.log(`[i18n] [Chunk ${currentChunkIndex}] Purged ${chunk.length} URL(s).`)

      // After sending MAX_CHUNKS_PER_SEC chunks (= 800 URLs), pause for 1 second
      // to stay within the Free plan rate limit before the next batch
      if (currentChunkIndex % MAX_CHUNKS_PER_SEC === 0 && i + CHUNK_SIZE < urls.length) {
        console.log(`[i18n] Reached 800 URL/sec limit. Waiting 1000ms before next batch...`)
        await wait(1000)
      }
    } catch (error) {
      console.error(`[i18n] [Chunk ${currentChunkIndex}] Network error calling Cloudflare API:`, error)
      return false
    }
  }

  return true
}

export type PurgeDeps = {
  fetch?: (input: string, init: RequestInit) => Promise<Response>
  sleep?: (ms: number) => Promise<void>
}

export const MAX_RETRIES = 5
export const MAX_RETRY_WAIT_MS = 30_000

/**
 * The wait before 429 retry number `attempt` (1-based): `Retry-After` in seconds when
 * the header holds a non-negative number, otherwise 2 s doubled per attempt. Either way
 * capped at MAX_RETRY_WAIT_MS, so a large header cannot stall the run.
 */
export function retryWaitMs(retryAfter: string | null, attempt: number): number {
  const seconds = retryAfter === null || retryAfter.trim() === '' ? NaN : Number(retryAfter)
  const ms = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : 2000 * 2 ** (attempt - 1)
  return Math.min(ms, MAX_RETRY_WAIT_MS)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
