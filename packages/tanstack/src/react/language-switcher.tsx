import type { Locale } from '@edgekits/i18n-core'
import { useEffect, useRef, useState } from 'react'

import { useI18n, useI18nCookie } from './provider.tsx'

export type LanguageSwitcherProps = {
  // The component is headless: every class comes from here. A slot left out renders no
  // `class` attribute; `itemActive` is appended to `item` on the active entry.
  classes?: Partial<
    Record<'root' | 'trigger' | 'triggerIcon' | 'dropdown' | 'item' | 'itemActive' | 'itemLabel', string>
  >
  // The component's own words: the package fetches nothing and assumes no namespace.
  // `trigger` is the toggle's aria-label.
  texts?: { trigger?: string }
  // Runs after the lang cookie is written, instead of a full reload: pass
  // `() => router.invalidate()` to re-run the route loaders in place.
  afterChange?: (locale: Locale) => unknown
}

const join = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(' ') || undefined

/**
 * The languages of the root provider as a menu. Selecting one writes the lang cookie (the
 * only place it is born; the middleware never sets it), then calls `afterChange` or
 * reloads the page. Renders nothing with fewer than two languages.
 */
export function LanguageSwitcher({ classes = {}, texts, afterChange }: LanguageSwitcherProps) {
  const { locale, languages } = useI18n()
  const cookie = useI18nCookie()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const onClick = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('click', onClick)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('click', onClick)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const entries = Object.entries(languages).flatMap(([code, language]) => (language ? [{ code, language }] : []))
  if (entries.length < 2) return null

  if (!cookie) {
    throw new Error('[@edgekits/tanstack-i18n] LanguageSwitcher needs `cookie` on an I18nProvider above it')
  }

  const select = (next: Locale) => {
    // Not httpOnly: the server reads the value through `parseLocale`, never trusts it.
    document.cookie = `${cookie.name}=${next}; path=/; max-age=${cookie.maxAge}; SameSite=Lax; Secure`
    setOpen(false)
    if (afterChange) afterChange(next)
    else window.location.reload()
  }

  return (
    <div ref={root} className={classes.root} data-ls-root="" data-open={open ? 'true' : 'false'}>
      <button
        type="button"
        data-ls-trigger=""
        className={classes.trigger}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={texts?.trigger ?? 'Switch language'}
        onClick={() => setOpen(!open)}
      >
        <svg
          className={classes.triggerIcon}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <ellipse cx="12" cy="12" rx="4" ry="9" />
          <path d="M3 12h18" />
        </svg>
      </button>

      <div data-ls-dropdown="" className={classes.dropdown} role="menu" hidden={!open}>
        {entries.map(({ code, language }) => {
          const isActive = code === locale
          // The label is the language's own name: `lang` lets a screen reader say it in
          // that language.
          return (
            <button
              key={code}
              type="button"
              className={join(classes.item, isActive && classes.itemActive)}
              data-ls-item=""
              data-lang={code}
              data-active={isActive ? 'true' : undefined}
              aria-current={isActive ? 'true' : undefined}
              role="menuitem"
              disabled={isActive}
              onClick={() => select(code)}
            >
              <span className={classes.itemLabel} lang={code}>
                {language.name}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
