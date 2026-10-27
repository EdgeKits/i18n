# Localized forms (island-free, errors-as-codes edge pattern)

This is **Workflow B**. It is intentionally decoupled from the i18n setup. Use it when the user
asks to create or localize a form. It assumes `@edgekits/astro-i18n` is already adopted
(Workflow A).

From the package it uses only `fetchTranslations`, `LocaleSchema` and the `Locale` type, all from
`@edgekits/astro-i18n/runtime` (pages, components and Astro Actions run in workerd). Everything
else below is **project code the agent adds**: the error codes, the error mapper, the schema
contract and the `enhanceForm` controller. Paths use a `@/*` → `src/*` alias; in a project
without one, use relative imports. The field components are [Starwind](https://starwind.dev)'s
(`Input`, `Label`, `Select`, toasts); native elements work the same, see the last section.

The reference stack is **island-free Astro + a vanilla `enhanceForm` controller + zod on
the server + a hand-rolled client schema mirror + Astro Actions** — **no React, no
react-hook-form, no shadcn, and no zod in the browser**. (Zod v4 JIT-compiles parsers via
`new Function()`, which a no-`'unsafe-eval'` CSP blocks — Lighthouse logs a blocked-eval
issue — and it costs ~20 KB of first-screen JS.) The browser ships only the small
controller plus a ~70-line schema contract. The **localization pattern is stack-agnostic**:
it also works with native inputs, a plain `<form>` + API route, or any UI kit — only the
field markup changes. The island-free stack is the default, not a ban: when the user asks for
React, a form library or another framework, use it; errors-as-codes and no zod in the browser
still hold.

Two invariants make a form localized and zero-framework:

1. **errors-as-codes** — validation/server layers emit stable CODES, never human text.
2. **island-free client** — a `.astro` form + an inline `<script>` that wires `enhanceForm`,
   which maps codes → localized strings into DOM error slots and submits via `astro:actions`.

```
client mirror / server zod  ──emit──▶  CODE ('INVALID_EMAIL')
                                  │
resolveFieldMessages(codes, t.messages.errors.ui)  ──▶  "Invalid email address." (localized)
                                  │
                      painted into  <div data-error-for="email">
```

---

## Step 1 — Error codes (`src/domain/messages/`)

`src/domain/messages/error-codes.ts`:

```ts
// Keys MUST match keys in locales/<locale>/messages.json (errors.ui / errors.server).

export const SERVER_ERROR_CODES = {
  INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
} as const
export type ServerErrorCode = (typeof SERVER_ERROR_CODES)[keyof typeof SERVER_ERROR_CODES]

export const UI_ERROR_CODES = {
  INVALID_EMAIL: 'INVALID_EMAIL',
  REQUIRED: 'REQUIRED',
  // ...add one per validation case your forms need.
} as const
export type UiErrorCode = (typeof UI_ERROR_CODES)[keyof typeof UI_ERROR_CODES]

export const ERROR_MESSAGE_CODES = { ...SERVER_ERROR_CODES, ...UI_ERROR_CODES } as const
export type ErrorMessageCode = (typeof ERROR_MESSAGE_CODES)[keyof typeof ERROR_MESSAGE_CODES]
```

`src/domain/messages/common-codes.ts`:

```ts
export const COMMON_MESSAGE_CODES = {
  PENDING: 'PENDING',
  SUBSCRIPTION_SUCCEED: 'SUBSCRIPTION_SUCCEED',
} as const
export type CommonMessageCode = (typeof COMMON_MESSAGE_CODES)[keyof typeof COMMON_MESSAGE_CODES]
```

`src/domain/messages/guards.ts`:

```ts
import { ERROR_MESSAGE_CODES, type ErrorMessageCode } from './error-codes'
export function isErrorMessageCode(value: string): value is ErrorMessageCode {
  return Object.values(ERROR_MESSAGE_CODES).includes(value as ErrorMessageCode)
}
```

`src/domain/messages/index.ts` re-exports all three. **Browser-safety note:** import the
deep paths (`@/domain/messages/error-codes`, `@/domain/messages/guards`) from client
`<script>` blocks — the barrel is fine in `.astro` frontmatter / server code, but deep
imports keep the browser bundle minimal and avoid accidentally pulling server-only modules.

---

## Step 2 — Translations for the codes (`messages` namespace)

Every code must have a key in **every** locale's `messages.json`. Default locale defines
the schema (`I18n.Schema['messages']`).

```json
// locales/en/messages.json
{
  "errors": {
    "ui": {
      "INVALID_EMAIL": "Invalid email address.",
      "REQUIRED": "This field is required.",
      "MISSING_TRANSLATED_UI": "Sorry, this page is not yet fully available in your selected language.",
      "MISSING_TRANSLATED_CONTENT": "Sorry, this article is not yet available in your selected language."
    },
    "server": { "INTERNAL_SERVER_ERROR": "Something went wrong. Please try again." }
  },
  "common": { "PENDING": "Please wait", "SUBSCRIPTION_SUCCEED": "Thanks!" }
}
```

Add a per-form namespace for labels/titles, e.g. `contact.json`:

```json
// locales/en/contact.json
{
  "title": "Contact us",
  "fields": { "name": "Your name", "email": "Email", "message": "Message" },
  "submit": "Send"
}
```

After editing locales: `npx edgekits-i18n seed` (local KV; production is `npx edgekits-i18n migrate`).

---

## Step 3 — Validation schemas (zod on the server, a hand-rolled mirror in the browser)

Validation runs twice, but with **different implementations**:

- **Server (source of truth)** — the Astro Action validates with **zod** (codes as
  `message`). Zod stays a server-only dependency.
- **Client (UX only)** — `enhanceForm` validates with a small **hand-rolled mirror**
  implementing the same rules against the `ClientSchema` contract from
  `src/ui/forms/client-schema.ts` (Step 6a). **No zod import in any `<script>` block.**

Why the split, rather than one zod schema validated twice:

1. **CSP.** Zod v4 JIT-compiles object parsers via `new Function()` at module-init time.
   Under a `script-src` without `'unsafe-eval'` every page load logs a blocked-eval issue
   (Lighthouse Best Practices drops below 100) and zod silently falls back to its slow
   interpreted path.
2. **Bundle.** Zod was ~20 KB of the deepest chunk in the landing page's critical request
   chain.
3. The mirror is UX-only; anything that slips past it is rejected by the action's zod.

Server schema example. Astro's FormData parsing turns an empty (or missing) field into `null`,
so zod reports a type error, not "too short": without a code on `z.string()`, that error carries
zod's English `invalid_type` text, which no locale translates. Give the type error the
`REQUIRED` code too:

```ts
// src/domain/contact/schema.ts  (server-side; codes as messages)
import { z } from 'astro/zod'
import { ERROR_MESSAGE_CODES } from '@/domain/messages/error-codes'

// An empty field arrives as null: the type error is REQUIRED, like the empty string.
const required = () => z.string({ message: ERROR_MESSAGE_CODES.REQUIRED }).trim().min(1, { message: ERROR_MESSAGE_CODES.REQUIRED, abort: true })

export const ContactFormSchema = z.object({
  name: required(),
  email: required().pipe(z.email({ message: ERROR_MESSAGE_CODES.INVALID_EMAIL })),
  message: required(),
})
export type ContactFormData = z.infer<typeof ContactFormSchema>
```

A checkbox field is `z.boolean()`: Astro turns its presence (`on`) into `true` and its absence
into `false`; refine it with a code (`.refine((v) => v, { message: CONSENT_REQUIRED })`) when it
must be checked.

The client mirror for this schema is written inline in the form's `<script>` (Step 7) on
top of the `client-schema.ts` helpers — **same field names, same CODES**, so the
errors-as-codes contract is identical on both sides.

> **Caveat (the drizzle trap), still applies.** If your canonical schema is derived from a
> drizzle table (`createInsertSchema(...)`) or otherwise pulls server-only code, keep it
> server-side. The client mirror is hand-rolled anyway, so neither drizzle nor zod can leak
> into the browser bundle.

---

## Step 4 — Server (Astro Action)

```ts
// src/actions/contact.ts
import { ActionError, defineAction } from 'astro:actions'
import { env } from 'cloudflare:workers'

import { LocaleSchema } from '@edgekits/astro-i18n/runtime'
import { ERROR_MESSAGE_CODES, isErrorMessageCode } from '@/domain/messages'
import { ContactFormSchema } from '@/domain/contact/schema'

export const contact = {
  send: defineAction({
    // FormData on both paths: the no-JS native POST and the enhanced submit (Step 7).
    accept: 'form',
    input: ContactFormSchema.extend({
      locale: LocaleSchema, // the UI locale, for locale-aware server logic (emails, etc.)
    }),
    handler: async (input, context) => {
      try {
        // ...do work with env bindings (DB, email provider, ...)
        return { ok: true }
      } catch (error) {
        // Domain errors throw an Error whose message IS a code.
        if (error instanceof Error && isErrorMessageCode(error.message)) {
          throw new ActionError({ message: error.message, code: 'BAD_REQUEST' })
        }
        throw new ActionError({ message: ERROR_MESSAGE_CODES.INTERNAL_SERVER_ERROR, code: 'INTERNAL_SERVER_ERROR' })
      }
    },
  }),
}
```

Register in `src/actions/index.ts` (`export const server = { contact }`).

`accept: 'form'` is required: without it Astro 7 answers the native no-JS POST (a FormData body)
with 415 `UNSUPPORTED_MEDIA_TYPE`; with it, Astro coerces the FormData against the schema
(strings stay strings, a checkbox's `on` becomes `true`, an empty or missing field `null`). The
JS path then sends FormData too (`new FormData(form)`, Step 7), never a JSON object.

> Two error channels, handled differently by the client:
>
> - **Zod input errors** (a field failed the action's own `input` schema) →
>   `isInputError(error).fields` — `enhanceForm` auto-maps these to `[data-error-for=<field>]`.
> - **Thrown `ActionError`** (`BAD_REQUEST` with a CODE, or `INTERNAL_SERVER_ERROR`) → these
>   are NOT input errors; they flow to your `onActionError(error, helpers)` callback, where
>   you decide inline (`helpers.setErrors` / `setFormError`) vs `toast`.

> Not using Astro Actions? Any handler works — the only contract is "return/throw CODES,
> never localized text". An API route can `return new Response(JSON.stringify({ code }), {status:400})`;
> in `enhanceForm` give a custom `action` thunk that adapts the response to `{ data?, error? }`.

### Step 4b — Post/Redirect/Get for the native path (`src/middleware.ts`)

Without JS, Astro renders the page as the response to the POST: a reload re-posts the form (the
action runs twice), and the result lands at the top of the page, out of view. The fix is one
pure function plus a two-line middleware.

```ts
// src/ui/forms/native-post.ts
/** The part of `getActionContext(context)` this rule reads, typed without `astro:actions`. */
export interface FormActionContext<R extends { error?: unknown }, S> {
  action?: { calledFrom: 'rpc' | 'form'; name: string; handler: () => Promise<R> }
  setActionResult: (actionName: string, actionResult: S) => void
  serializeActionResult: (result: R) => S
}

/**
 * Post/Redirect/Get for a native (no-JS) form post. Success is a 303 back to the page at the
 * form's fragment with `?sent=1`, so a reload is a GET and cannot submit twice. An error renders
 * in place, as Astro does by default: the page reads it through `Astro.getActionResult`.
 * RPC calls (the enhanced submit) and every other action pass through untouched.
 */
export async function redirectAfterNativePost<R extends { error?: unknown }, S>(actionContext: FormActionContext<R, S>, actionName: string, fragment: string, requestContext: { url: URL; redirect: (path: string, status: 303) => Response }, next: () => Promise<Response>): Promise<Response> {
  const { action } = actionContext
  if (action?.calledFrom !== 'form' || action.name !== actionName) return next()

  const result = await action.handler()
  if (!result.error) {
    return requestContext.redirect(`${requestContext.url.pathname}?sent=1#${fragment}`, 303)
  }

  // Setting the result here also stops Astro from running the action again.
  actionContext.setActionResult(action.name, actionContext.serializeActionResult(result))
  return next()
}
```

```ts
// src/middleware.ts
import { getActionContext } from 'astro:actions'
import { defineMiddleware, sequence } from 'astro:middleware'

import { redirectAfterNativePost } from '@/ui/forms/native-post'

const contactFormPost = defineMiddleware((ctx, next) => redirectAfterNativePost(getActionContext(ctx), 'contact.send', 'contact', ctx, next))

export const onRequest = sequence(contactFormPost)
```

- The rule is a pure function because `astro:actions` resolves only inside workerd; the
  middleware is the thin adapter. With `middleware: 'manual'` the i18n middleware stays the
  first entry of this sequence; in `auto` mode the integration registers it ahead of this file.
- Cookies the handler sets ride on the 303.
- The JS path is untouched: the enhanced submit calls the action by RPC
  (`calledFrom: 'rpc'`), which the function passes through.
- The function is testable under Node with stubs: a form call whose handler resolves without
  `error` returns the 303 and never calls `next` or `setActionResult`; one with `error` calls
  `setActionResult` once and returns `next()`; an RPC call or another action returns `next()`.

---

## Step 5 — Pure error mapper (`src/ui/forms/error-mapper.ts`)

Framework-free code → localized text: drop unmapped codes, dedupe, keep order. Shared by
the controller (and any other caller). Copy verbatim:

```ts
type ErrorLike = { message?: string }

export function mapErrorToI18n(issue: ErrorLike | undefined, tErrors: Record<string, string>): string | null {
  if (!issue?.message) return null
  return tErrors[issue.message] ?? null
}

/** Resolve raw error CODES to a deduped list of localized messages (no React, no DOM). */
export function resolveFieldMessages(codes: Array<string | undefined>, tErrors: Record<string, string>): string[] {
  const localized = codes.map((code) => mapErrorToI18n(code ? { message: code } : undefined, tErrors)).filter((message): message is string => Boolean(message))
  return [...new Set(localized)]
}
```

`tErrors` is always `t.messages.errors.ui`. The markup for the messages lives in the
controller's `renderMessages`, below.

---

## Step 6 — The schema contract + the generic controller (`src/ui/forms/`)

Two files; copy both verbatim into any project using the pattern.

### 6a — `src/ui/forms/client-schema.ts` (the zod-free schema contract)

`enhanceForm` consumes anything exposing a zod-compatible `safeParse()`. This module
defines that contract (`ClientSchema`) plus the helpers hand-rolled mirrors are built from:

```ts
export interface SchemaIssue {
  /** Field path, first element is the field name `enhanceForm` paints. */
  path: Array<string | number>
  /** An ERROR_MESSAGE_CODES value (localized later via `tErrors`). */
  message: string
}

export interface ClientSchemaError {
  issues: SchemaIssue[]
}

export type SafeParseResult<T> = { success: true; data: T } | { success: false; error: ClientSchemaError }

export interface ClientSchema<T> {
  safeParse(values: unknown): SafeParseResult<T>
}

/** Close to Zod v4's default `z.email()` pattern; instant feedback only, the server's zod decides. */
export const EMAIL_REGEX = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/

export function isEmail(value: unknown): value is string {
  return typeof value === 'string' && EMAIL_REGEX.test(value)
}

/** Coerce to string with a fallback (FormData values may be File/undefined). */
export function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

/** `undefined`/`null` -> [], scalar -> [scalar] (FormData yields a scalar for a single checkbox). */
export function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value == null ? [] : [value]
}

/** Type-guarded enum membership check. */
export function oneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
}

export function ok<T>(data: T): SafeParseResult<T> {
  return { success: true, data }
}

export function fail<T>(issues: SchemaIssue[]): SafeParseResult<T> {
  return { success: false, error: { issues } }
}
```

The client regex is a UX approximation, not a copy of the server's check: the server (zod) is
the authority, and the two may disagree on edge cases. That is fine, because an address the
mirror lets through and zod rejects comes back as an input error and renders the same way.

> **Gotcha:** mirror value types must be `type` aliases, not `interface`s — only type
> aliases get the implicit index signature required by `TValues extends Record<string, unknown>`.

### 6b — `src/ui/forms/enhance.ts` (the controller)

`enhanceForm(form, schema, action, options)` replicates react-hook-form + zodResolver in
vanilla TS and is **form-agnostic** — field-specific behaviour goes in the `onSuccess` /
`onActionError` callbacks:

```ts
import { isInputError } from 'astro:actions'

import { resolveFieldMessages } from './error-mapper'
import type { ClientSchema, ClientSchemaError } from './client-schema'

/**
 * enhanceForm — framework-free progressive enhancement for Astro action forms.
 *   - client-side safeParse on submit (hand-rolled mirror, see client-schema.ts; blocks the request when invalid)
 *   - per-field validation on focusout, re-validation of touched fields on input
 *   - submit via the astro:actions client; isInputError(error).fields auto-mapped to slots
 *   - pending state (disables submit, sets data-pending / aria-busy)
 *   - focus the first invalid field; dirty tracking (submit disabled until a value changes)
 *
 * Error rendering contract (markup owns the slots):
 *   - each field error renders into  <* data-error-for="<name>">  inside the form
 *   - a non-field / form-level error renders into  data-error-for="_form"
 *   - aria-invalid is toggled on [name="<name>"], data-invalid on its closest [data-slot="field"]
 *
 * No-JS fallback: the <form> carries method="POST" + action={actions.x}; the page renders
 * Astro.getActionResult(actions.x) or, after Step 4b, the 303's `?sent=1`. This controller preventDefault()s only when JS is present.
 */

type FormValues = Record<string, unknown>

export interface ActionErrorLike {
  code?: string
  message?: string
}
type ActionFn<TData> = (input: never) => Promise<{ data?: TData; error?: ActionErrorLike }>

export interface FormErrorHelpers {
  /** Render error CODES into field slots (e.g. { email: 'EMAIL_ALREADY_EXISTS' }). */
  setErrors: (errors: Record<string, string | string[]>) => void
  /** Render a single form-level error code into the _form slot. */
  setFormError: (code: string) => void
  /** Clear every rendered error + invalid markers. */
  clearErrors: () => void
}

export interface EnhanceFormOptions<TValues extends FormValues, TData> {
  /** Map an error CODE → localized string (= t.messages.errors.ui). */
  tErrors: Record<string, string>
  /** Map validated values into the action input (a FormData for an `accept: 'form'` action). */
  transform?: (values: TValues) => unknown
  onSuccess?: (data: TData, values: TValues) => void | Promise<void>
  /** Non-input action errors (domain ActionErrors). Use helpers, or toast and render nothing. */
  onActionError?: (error: ActionErrorLike, helpers: FormErrorHelpers) => void | Promise<void>
  /** Override value collection. Default: FormData; a name="x[]" ⇒ array x. */
  getValues?: (form: HTMLFormElement) => TValues
  validateOnBlur?: boolean // default true
  revalidateOnInput?: boolean // default true
  focusError?: boolean // default true
  disableUntilDirty?: boolean // default true
}

export interface FormController extends FormErrorHelpers {
  setPending: (pending: boolean) => void
  destroy: () => void
}

const FORM_LEVEL_KEY = '_form'

export function enhanceForm<TValues extends FormValues, TData>(form: HTMLFormElement, schema: ClientSchema<TValues>, action: ActionFn<TData>, options: EnhanceFormOptions<TValues, TData>): FormController {
  const { tErrors, transform, onSuccess, onActionError, getValues = defaultGetValues<TValues>, validateOnBlur = true, revalidateOnInput = true, focusError = true, disableUntilDirty = true } = options

  const touched = new Set<string>()
  const initialSnapshot = serialize(getValues(form))
  let pending = false

  function slotFor(name: string): HTMLElement | null {
    return form.querySelector<HTMLElement>(`[data-error-for="${cssEscape(name)}"]`)
  }

  function paintField(name: string, messages: string[]): void {
    const slot = slotFor(name)
    if (slot) renderMessages(slot, messages)
    const invalid = messages.length > 0
    form.querySelectorAll<HTMLElement>(`[name="${cssEscape(name)}"]`).forEach((el) => {
      el.toggleAttribute('aria-invalid', invalid)
      el.closest<HTMLElement>('[data-slot="field"]')?.toggleAttribute('data-invalid', invalid)
    })
  }

  function setErrors(errors: Record<string, string | string[]>): void {
    for (const [name, codes] of Object.entries(errors)) {
      paintField(name, resolveFieldMessages(Array.isArray(codes) ? codes : [codes], tErrors))
    }
  }
  function setFormError(code: string): void {
    paintField(FORM_LEVEL_KEY, resolveFieldMessages([code], tErrors))
  }
  function clearErrors(): void {
    form.querySelectorAll<HTMLElement>('[data-error-for]').forEach((slot) => {
      const name = slot.getAttribute('data-error-for')
      if (name) paintField(name, [])
    })
  }
  const helpers: FormErrorHelpers = { setErrors, setFormError, clearErrors }

  function issuesByField(error: ClientSchemaError): Map<string, string[]> {
    const byField = new Map<string, string[]>()
    for (const issue of error.issues) {
      const head = issue.path[0]
      const key = head === undefined ? FORM_LEVEL_KEY : String(head)
      const list = byField.get(key)
      if (list) list.push(issue.message)
      else byField.set(key, [issue.message])
    }
    return byField
  }

  function validate(): { ok: boolean; byField: Map<string, string[]> } {
    const result = schema.safeParse(getValues(form))
    if (result.success) return { ok: true, byField: new Map() }
    return { ok: false, byField: issuesByField(result.error) }
  }

  function focusFirstInvalid(byField: Map<string, string[]>): void {
    if (!focusError) return
    for (const el of Array.from(form.querySelectorAll<HTMLElement>('[name]'))) {
      const name = el.getAttribute('name')
      if (name && byField.has(name)) {
        el.focus()
        return
      }
    }
  }

  function submitButtons(): HTMLButtonElement[] {
    return Array.from(form.querySelectorAll<HTMLButtonElement>('button[type="submit"], button:not([type])'))
  }
  function isDirty(): boolean {
    return serialize(getValues(form)) !== initialSnapshot
  }
  function syncSubmitDisabled(): void {
    const disabled = pending || (disableUntilDirty && !isDirty())
    submitButtons().forEach((btn) => {
      btn.disabled = disabled
    })
  }
  function setPending(next: boolean): void {
    pending = next
    form.toggleAttribute('data-pending', next)
    form.setAttribute('aria-busy', String(next))
    syncSubmitDisabled()
  }

  async function handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault()
    if (pending) return
    const parsed = schema.safeParse(getValues(form))
    if (!parsed.success) {
      const byField = issuesByField(parsed.error)
      clearErrors()
      for (const [name, codes] of byField) paintField(name, resolveFieldMessages(codes, tErrors))
      focusFirstInvalid(byField)
      return
    }
    clearErrors()
    setPending(true)
    try {
      const input = (transform ? transform(parsed.data) : parsed.data) as never
      const { data, error } = await action(input)
      if (error) {
        if (isInputError(error as Parameters<typeof isInputError>[0])) {
          const fields = (error as { fields?: Record<string, string[]> }).fields
          if (fields) {
            setErrors(fields)
            focusFirstInvalid(new Map(Object.entries(fields)))
          }
          return
        }
        await onActionError?.(error, helpers)
        return
      }
      if (data !== undefined) await onSuccess?.(data, parsed.data)
    } catch (error) {
      await onActionError?.(error as ActionErrorLike, helpers)
    } finally {
      setPending(false)
    }
  }

  function fieldName(target: EventTarget | null): string | null {
    if (!(target instanceof HTMLElement)) return null
    return target.getAttribute('name') || null
  }
  function repaintField(name: string): void {
    const { byField } = validate()
    paintField(name, resolveFieldMessages(byField.get(name) ?? [], tErrors))
  }
  function handleFocusOut(event: FocusEvent): void {
    if (!validateOnBlur) return
    const name = fieldName(event.target)
    if (!name) return
    touched.add(name)
    repaintField(name)
  }
  function handleInput(event: Event): void {
    syncSubmitDisabled()
    if (!revalidateOnInput) return
    const name = fieldName(event.target)
    if (!name || !touched.has(name)) return
    repaintField(name)
  }

  form.addEventListener('submit', handleSubmit)
  form.addEventListener('focusout', handleFocusOut)
  form.addEventListener('input', handleInput)
  syncSubmitDisabled()

  return {
    setErrors,
    setFormError,
    clearErrors,
    setPending,
    destroy() {
      form.removeEventListener('submit', handleSubmit)
      form.removeEventListener('focusout', handleFocusOut)
      form.removeEventListener('input', handleInput)
    },
  }
}

/** Collect form values: FormData, with name="x[]" collapsed to array x. */
function defaultGetValues<TValues extends FormValues>(form: HTMLFormElement): TValues {
  const data = new FormData(form)
  const out: FormValues = {}
  for (const key of new Set(data.keys())) {
    const isArray = key.endsWith('[]')
    const name = isArray ? key.slice(0, -2) : key
    const all = data.getAll(key)
    out[name] = isArray ? all : all.length > 1 ? all : all[0]
  }
  return out as TValues
}

function serialize(values: FormValues): string {
  const keys = Object.keys(values).sort()
  return JSON.stringify(
    keys.map((key) => {
      const value = values[key]
      return [key, value instanceof File ? value.name : value]
    }),
  )
}

/** Mirrors shadcn FieldError markup: empty ⇒ hidden; one ⇒ text; many ⇒ bulleted list. */
function renderMessages(slot: HTMLElement, messages: string[]): void {
  if (messages.length === 0) {
    slot.replaceChildren()
    slot.removeAttribute('role')
    slot.removeAttribute('data-slot')
    slot.hidden = true
    return
  }
  slot.hidden = false
  slot.setAttribute('role', 'alert')
  slot.setAttribute('data-slot', 'field-error')
  slot.classList.add('text-destructive', 'text-sm', 'font-normal') // the project's error styling
  if (messages.length === 1) {
    slot.textContent = messages[0] ?? ''
    return
  }
  const ul = document.createElement('ul')
  ul.className = 'ml-4 flex list-disc flex-col gap-1'
  for (const message of messages) {
    const li = document.createElement('li')
    li.textContent = message
    ul.appendChild(li)
  }
  slot.replaceChildren(ul)
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value)
  return value.replace(/["\\]/g, '\\$&')
}
```

Key contract points to remember when writing the markup:

- **error slots** — one `<div data-error-for="<field>" hidden>` per field, plus one
  `<div data-error-for="_form" hidden>` for form-level errors. The controller fills/clears
  them and toggles `role="alert"` / `data-slot="field-error"`.
- **`[name]` + `[data-slot="field"]`** — every input has a `name` (the schema key); wrap
  each field in `<div role="group" data-slot="field">` so `aria-invalid` / `data-invalid`
  land correctly.
- **array fields** — use `name="x[]"` (e.g. hidden inputs from a multi-select); FormData
  collapses them to an array under `x`. For a control that has no real `[name]` input (a
  custom widget), put `name="x"` on a `<button type="button">` so the controller can paint
  its invalid state — `type=button` keeps it out of FormData.

---

## Step 7 — The form (`.astro`, island-free)

Native/Starwind markup + a bundled `<script>` wiring `enhanceForm`. This is the whole form
— no React, no hydration directive.

```astro
---
// src/components/forms/ContactForm.astro
import { actions, isInputError } from 'astro:actions'
import SpinnerIcon from '@tabler/icons/outline/loader-2.svg'
import { Input } from '@/components/starwind/input'
import { Label } from '@/components/starwind/label'
import { isErrorMessageCode } from '@/domain/messages'
import { resolveFieldMessages } from '@/ui/forms/error-mapper'
import type { Locale } from '@edgekits/astro-i18n/runtime'

interface Props {
  t: Pick<I18n.Schema, 'contact' | 'messages'>
  locale: Locale
}
const { t, locale } = Astro.props
const { contact, messages } = t

// No-JS: with JS this result is null (form is intercepted); without JS the native POST
// runs and we render its inline errors server-side. Codes go through the same
// mapper as on the client: the page prints localized text, never a raw code.
// Success is the 303 from Step 4b, so it is read from the URL, not from the result.
const result = Astro.getActionResult(actions.contact.send)
const sent = Astro.url.searchParams.get('sent') === '1'
const tUi = messages.errors.ui as Record<string, string>
const noJsError = (field: string) => resolveFieldMessages(result?.error && isInputError(result.error) ? (result.error.fields[field] ?? []) : [], tUi)[0] ?? ''
const formError = result?.error && !isInputError(result.error) ? result.error : undefined
const noJsFormError = formError ? (formError.code === 'BAD_REQUEST' && isErrorMessageCode(formError.message) && tUi[formError.message]) || messages.errors.server.INTERNAL_SERVER_ERROR : ''

// Strings the client controller needs (keeps i18n out of the bundle).
const clientConfig = {
  tErrors: messages.errors.ui,
  serverErrorMessage: messages.errors.server.INTERNAL_SERVER_ERROR,
  successMessage: messages.common.SUBSCRIPTION_SUCCEED,
}
const fields = ['name', 'email', 'message'] as const
---

<div id="contact">
  {
    sent ? (
      <p class="text-primary">{messages.common.SUBSCRIPTION_SUCCEED}</p>
    ) : (
      <form method="POST" action={actions.contact.send + '#contact'} data-contact-form data-config={JSON.stringify(clientConfig)} novalidate class="mx-auto flex w-full max-w-md flex-col gap-7">
        <input type="hidden" name="locale" value={locale} />

        {fields.map((name) => (
          <div role="group" data-slot="field" class="flex w-full flex-col gap-3">
            <Label for={name} class="text-foreground/80">
              {contact.fields[name]}
            </Label>
            <Input id={name} name={name} aria-invalid={noJsError(name) ? 'true' : undefined} />
            <div data-error-for={name} class={noJsError(name) ? 'text-destructive text-sm font-normal' : ''} role={noJsError(name) ? 'alert' : undefined} hidden={!noJsError(name)}>
              {noJsError(name)}
            </div>
          </div>
        ))}

        <div data-error-for="_form" class={noJsFormError ? 'text-destructive text-sm font-normal' : ''} role={noJsFormError ? 'alert' : undefined} hidden={!noJsFormError}>
          {noJsFormError}
        </div>

        <button type="submit" class="primary-button disabled:cursor-not-allowed">
          <span data-pending-hide>{contact.submit}</span>
          <span data-pending-show class="items-center gap-2">
            <SpinnerIcon class="size-4 animate-spin" stroke-width="1" />
            {messages.common.PENDING}...
          </span>
        </button>
      </form>
    )
  }
</div>

<style>
  [data-pending-show] {
    display: none;
  }
  [data-contact-form][data-pending] [data-pending-hide] {
    display: none;
  }
  [data-contact-form][data-pending] [data-pending-show] {
    display: inline-flex;
  }
</style>

<script>
  import { actions } from 'astro:actions'

  import { enhanceForm } from '@/ui/forms/enhance'
  import { fail, isEmail, ok, str, type ClientSchema, type SchemaIssue } from '@/ui/forms/client-schema'
  import { toast } from '@/components/starwind/toast/toast-manager'
  import { ERROR_MESSAGE_CODES } from '@/domain/messages/error-codes'
  import { isErrorMessageCode } from '@/domain/messages/guards'

  interface ContactConfig {
    tErrors: Record<string, string>
    serverErrorMessage: string
    successMessage: string
  }

  // Hand-rolled client mirror of the server schema (Step 3) — same fields, same CODES.
  // No zod here: its `new Function()` JIT trips a no-'unsafe-eval' CSP and bloats the
  // bundle. NOTE: `type`, not `interface` — only type aliases get the implicit index
  // signature required by enhanceForm's `TValues extends Record<string, unknown>`.
  type ContactValues = {
    name: string
    email: string
    message: string
  }

  const ClientContactSchema: ClientSchema<ContactValues> = {
    safeParse(values) {
      const v = (values ?? {}) as Record<string, unknown>
      const issues: SchemaIssue[] = []
      const name = str(v.name).trim()
      const email = str(v.email).trim()
      const message = str(v.message).trim()
      if (!name) issues.push({ path: ['name'], message: ERROR_MESSAGE_CODES.REQUIRED })
      if (!email) issues.push({ path: ['email'], message: ERROR_MESSAGE_CODES.REQUIRED })
      else if (!isEmail(email)) issues.push({ path: ['email'], message: ERROR_MESSAGE_CODES.INVALID_EMAIL })
      if (!message) issues.push({ path: ['message'], message: ERROR_MESSAGE_CODES.REQUIRED })
      if (issues.length > 0) return fail(issues)
      return ok({ name, email, message })
    },
  }

  function initContactForms(): void {
    document.querySelectorAll<HTMLFormElement>('[data-contact-form]').forEach((form) => {
      if (form.dataset.enhanced) return
      form.dataset.enhanced = 'true'

      const config = JSON.parse(form.dataset.config ?? '{}') as ContactConfig

      enhanceForm<ContactValues, { ok: true }>(form, ClientContactSchema, actions.contact.send, {
        tErrors: config.tErrors,
        // The action takes FormData (`accept: 'form'`), the same body as the no-JS POST;
        // the hidden `locale` input travels with it.
        transform: () => new FormData(form),
        onSuccess: () => {
          toast.success(config.successMessage)
          form.reset()
        },
        onActionError: (error, helpers) => {
          if (error.code === 'BAD_REQUEST' && isErrorMessageCode(error.message)) {
            helpers.setFormError(error.message) // or helpers.setErrors({ email: error.message })
          } else {
            toast.error(config.serverErrorMessage)
          }
        },
      })
    })
  }

  initContactForms()
  document.addEventListener('astro:page-load', initContactForms)
</script>
```

The `#contact` fragment on the form's `action` never reaches the server: the browser keeps it
and applies it to the response, so the native POST (and the 303 after a success) opens the page
at the form; with JS on, `enhanceForm` intercepts the submit and the attribute is never read.

> **Toasts** are localized at the source: the `.astro` reads `t.messages.common[code]` /
> `t.messages.errors.server[code]` and passes the already-localized strings via
> `data-config`, so the client never needs translation files. Toast manager:
> `@/components/starwind/toast/toast-manager` (the `Toaster` is mounted once in BaseLayout).

---

## Step 8 — Render from an Astro page (fetch + pass props, no hydration)

The page fetches the form namespace + `messages` and passes the typed slice + `uiLocale`.
There is **no `client:*` directive** — it's a plain component include.

```astro
---
// src/components/ContactSection.astro
import ContactForm from '@/components/forms/ContactForm.astro'
import { fetchTranslations } from '@edgekits/astro-i18n/runtime'

const { translationLocale, uiLocale } = Astro.locals
const t = await fetchTranslations(translationLocale, ['contact', 'messages'])
---

<ContactForm t={t} locale={uiLocale} />
```

> `t` is typed `Pick<I18n.Schema, 'contact' | 'messages'>` — fully typed end to end.
> `I18n.Schema` is a global namespace (no import needed).

---

## Multi-step flows (e.g. subscribe → segment → done)

A typical split (edgekits.dev's newsletter works this way): an orchestrator component owning
the form/segment/done sections and the no-JS action result, one component per step that owns
its markup and client controller. Form components live in their **domain** folder
(`src/domain/<domain>/components/`), not in `components/layout/`; domain enums the forms share
with actions sit next to them in `src/domain/<domain>/`.

For a flow that needs state between steps (an id from step 1 used by step 2), keep it DOM-
driven and island-free:

- Render each step as a sibling section under one root (`data-flow-root`), all but the first
  `hidden`. Give each its own `<form>` + `enhanceForm`.
- In step 1's `onSuccess(data)`, stash the carry-over value into a hidden input in step 2
  (`stepTwoIdInput.value = String(data.id)`) and reveal step 2 (`section.removeAttribute('hidden')`).
- Step 2's `transform` reads that hidden input to build its action payload.
- Such later steps are **JS-only by nature** (revealed by JS); the no-JS path typically ends
  after step 1 (e.g. a cookie is set and the next render shows the done state). That's fine —
  document it; don't try to force a no-JS multi-step.

---

## Custom field widgets (select, multi-select)

When a field isn't a native input:

- **Starwind `Select`** — `<Select name="..." defaultValue="...">` auto-creates a hidden
  `<select name>` (so the value enters FormData) and dispatches a bubbling
  `starwind-select:change` you can listen to (e.g. to toggle a conditional field).
- **Custom multi-select** (a project component) — mirrors the
  selection into hidden `name="x[]"` inputs (FormData ⇒ array) and puts `name="x"` on its
  `type=button` trigger so `enhanceForm` paints aria-invalid/data-invalid on it. Keep focus
  on the trigger and track the active option with `aria-activedescendant` — moving DOM focus
  into the list would fire the trigger's `focusout` and flash a "required" error on open.
- A control that renders **only while hidden** (inside a `display:none` step) can't be
  measured by JS that runs on load; re-trigger any width/layout measurement when the step is
  revealed (e.g. `window.dispatchEvent(new Event('resize'))`).
- **Label association (a11y / DevTools "no label" audit)** — both widgets' triggers are
  `<button>`s, which ARE labelable elements: give the trigger an `id` and point the field's
  `<Label for>` at it. `MultiSelect` accepts an `id` prop for exactly this; for Starwind
  `Select`, pass `id` + `aria-label={fieldLabel}` to `SelectTrigger` (the `aria-label`
  overrides its generic "Select field" default so AT announces the real field name).
  Watch out for widget scripts that _generate_ trigger ids — they must keep an
  author-provided id (`el.id = el.id || generated`), or the label association silently
  breaks in the live DOM.

---

## Adapting to ANY other field kit / backend

The pattern is invariant — only the markup and the client schema change:

- **Native inputs / different UI lib:** swap `Input`/`Label` for your elements; keep the
  `name` + `data-slot="field"` wrapper + `[data-error-for]` slot per field.
- **Non-Astro-Actions backend:** pass `enhanceForm` an `action` thunk that calls your
  endpoint and returns `{ data }` on success or `{ error: { code, message } }` on a 4xx;
  treat `code` exactly like an `ActionError` message.
- **React/other framework (if a project still has islands):** you can still import
  `resolveFieldMessages` and render `tErrors[code]` yourself; `enhanceForm` is DOM-based and
  meant for `.astro`, but the codes/translations layers are identical.

What must NOT change: validation/server layers emit **codes**, the `messages` namespace holds
the localized text for every code in every locale, and the page passes `t` + `locale` into
the form. That is what makes the form localized with zero client-side i18n bundles — now with
zero client-side framework JS too.
