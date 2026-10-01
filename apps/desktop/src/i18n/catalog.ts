import { ar } from '../../../../brand/locales/desktop/ar'
import { en } from '../../../../brand/locales/desktop/en'
import { ja } from '../../../../brand/locales/desktop/ja'
import { zh } from '../../../../brand/locales/desktop/zh'
import { zhHant } from '../../../../brand/locales/desktop/zh-hant'

import type { Locale, Translations } from './types'

export const TRANSLATIONS: Record<Locale, Translations> = {
  en,
  zh,
  'zh-hant': zhHant,
  ja,
  ar
}
