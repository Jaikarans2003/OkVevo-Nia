import { mergeTranslations, type TranslationOverride } from '@hermes/shared/i18n'

import { okvevoOverrides, rewriteRemainingHermes } from '../../../../brand/locales/desktop/okvevo-overrides'
import { ar } from './ar'
import { de } from './de'
import { en } from './en'
import { es } from './es'
import { fr } from './fr'
import { ja } from './ja'
import { ru } from './ru'
import type { BundledLocale, Translations } from './types'
import { zh } from './zh'
import { zhHant } from './zh-hant'

const overrides = okvevoOverrides(en) as TranslationOverride<Translations>

function withOkvevo(locale: Translations): Translations {
  return rewriteRemainingHermes(mergeTranslations(locale, overrides))
}

/** The catalogs compiled into the app. Runtime-registered languages (plugin
 *  packs, backend `.desktop.yaml` packs) are NOT here — resolve through
 *  `resolveTranslations()` in `./registry`, which layers them over these.
 *  English OkVevo wording is merged onto every locale. en.ts stays untouched. */
export const TRANSLATIONS: Record<BundledLocale, Translations> = {
  en: withOkvevo(en),
  zh: withOkvevo(zh),
  'zh-hant': withOkvevo(zhHant),
  ja: withOkvevo(ja),
  ar: withOkvevo(ar),
  ru: withOkvevo(ru),
  fr: withOkvevo(fr),
  de: withOkvevo(de),
  es: withOkvevo(es)
}

export const BUNDLED_LOCALES = Object.keys(TRANSLATIONS) as readonly BundledLocale[]

export function isBundledLocale(value: unknown): value is BundledLocale {
  return typeof value === 'string' && Object.hasOwn(TRANSLATIONS, value)
}
