// Stands in for `cloudflare:workers` under Node in tests (tsconfig.test.json): enough for
// modules that read `env` and `waitUntil` at call time to load.
export const env = {}

export function waitUntil(promise: Promise<unknown>): void {
  void promise
}
