import { t, type Locale, type MessageKey } from '../shared/i18n/index.js';

function keyOf(value: string | undefined): MessageKey | null {
  return value ? (value as MessageKey) : null;
}

export function applyStaticTranslations(root: ParentNode, locale: Locale): void {
  if (root.nodeType === Node.DOCUMENT_NODE) (root as Document).documentElement.lang = locale;

  for (const node of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = keyOf(node.dataset.i18n);
    if (key) node.textContent = t(locale, key);
  }

  for (const node of root.querySelectorAll<HTMLElement>('[data-i18n-title]')) {
    const key = keyOf(node.dataset.i18nTitle);
    if (key) node.title = t(locale, key);
  }

  for (const node of root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-i18n-placeholder]')) {
    const key = keyOf(node.dataset.i18nPlaceholder);
    if (key) node.placeholder = t(locale, key);
  }
}
