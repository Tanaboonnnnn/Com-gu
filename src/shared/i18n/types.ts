export const SUPPORTED_LOCALES = ['en', 'th'] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export function normalizeLocale(value: unknown): Locale {
  return value === 'th' ? 'th' : 'en';
}
