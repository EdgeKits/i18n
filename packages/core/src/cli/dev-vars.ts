import { parseEnv } from 'node:util'

/**
 * A `.dev.vars` file's variables, in the dotenv syntax wrangler reads it with: quoted
 * values, `#` comments (inline too, outside quotes), `export ` prefixes, CRLF. Node's own
 * `util.parseEnv` does the parsing. The BOM and the `export ` prefixes are removed first:
 * Node's parser keeps a BOM in the first key, and the prefix is handled here rather than
 * left to whichever Node release runs the CLI.
 */
export function parseDevVars(content: string): Record<string, string> {
  const source = content.replace(/^\uFEFF/, '').replace(/^[ \t]*export[ \t]+/gm, '')
  const parsed = parseEnv(source) as Record<string, string | undefined>
  return Object.fromEntries(
    Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
}
