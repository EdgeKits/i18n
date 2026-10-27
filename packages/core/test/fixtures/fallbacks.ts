// A compiled-fallback dictionary in the shape the CLI generates (`FALLBACK_<NAMESPACE>`),
// for tests only: the real file belongs to the consumer project.
export const FALLBACK_BLOG = {
  seo: {
    title: 'Blog',
    description: 'Notes from the build.',
  },
  heading: 'Blog',
  readMore: 'Read more',
  pagination: {
    previous: 'Previous',
    next: 'Next',
    pageLabel: 'Page {n}',
    ariaLabel: 'Blog pagination',
  },
} as const
