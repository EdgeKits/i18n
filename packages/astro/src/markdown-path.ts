/**
 * The middleware's `.md` normalisation, as a pure function. Markdown endpoints
 * (`/de/blog/x.md/`, `/blog/x.md`) are served in one locale, the project's
 * `markdownLocale`; this returns the single redirect target for such a path, or null
 * when there is nothing to redirect:
 *   - not a `.md` path, or the project has no `markdownLocale`: null (the middleware
 *     lets the request through untouched);
 *   - a leading segment that is a locale is replaced, any other leading segment is kept
 *     (`/foo.md` -> `/<markdownLocale>/foo.md`, never the homepage);
 *   - a trailing slash is dropped, in the same redirect;
 *   - a path already in canonical form: null.
 */

export const MARKDOWN_PATH = /\.md\/?$/

export type MarkdownOptions = {
  // True when the segment is a supported locale.
  isLocale: (segment: string) => boolean
  markdownLocale?: string
}

export function markdownRedirectTarget(pathname: string, options: MarkdownOptions): string | null {
  if (!options.markdownLocale || !MARKDOWN_PATH.test(pathname)) return null

  const segments = pathname.split('/').filter(Boolean)
  const first = segments[0]
  const contentSegments = first !== undefined && options.isLocale(first) ? segments.slice(1) : segments
  const target = `/${options.markdownLocale}/${contentSegments.join('/')}`

  return target === pathname ? null : target
}
