// Loads tsx with tsconfig.test.json, whose `paths` map the integration's virtual
// config to the test fixture. Used by `npm test` in place of `--import tsx`.
import { fileURLToPath } from 'node:url'
import { register } from 'tsx/esm/api'

register({ tsconfig: fileURLToPath(new URL('../tsconfig.test.json', import.meta.url)) })
