# Changelog

All notable changes to this package are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the package uses
[Semantic Versioning](https://semver.org/).

## Unreleased

- Extracted from `@edgekits/astro-i18n` 0.1.8.
- The instance carries the generated `NAMESPACE_KEYS` (for `@edgekits/tanstack-i18n`'s
  `isNamespaceList`).
- Fixed: after a failed KV read the fetcher no longer writes the served fallback to the edge
  cache (it was cached immutable for a year under the requested locale's URL).
