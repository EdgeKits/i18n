// `format.ts` reads `import.meta.env?.PROD`: a bundler (Vite) replaces it in a consumer's
// build; under plain Node it is absent, which counts as "not production". Declared here
// for the core's own typecheck only; tsc emits no copy of this file.
interface ImportMeta {
  readonly env?: { readonly PROD?: boolean }
}
