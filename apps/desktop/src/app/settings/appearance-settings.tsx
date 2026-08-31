import { useStore } from '@nanostores/react'

import { LanguageSwitcher } from '@/components/language-switcher'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { Palette } from '@/lib/icons'
import { $sessionListDensity, type SessionListDensity, setSessionListDensity } from '@/store/session-list-density'
import { $tabStripDefault, setTabStripDefault, type TabStripDefault } from '@/store/tabstrip-prefs'
import { $toolViewMode, setToolViewMode } from '@/store/tool-view'

import { ListRow, SectionHeading, SettingsContent } from './primitives'
import { APPEARANCE_SETTING_IDS } from './settings-search'
import { isAppearanceSettingVisible } from './settings-ui-policy'
import { useDeepLinkHighlight } from './use-deep-link-highlight'

const APPEARANCE_SEARCH_TARGETS = new Set<string>(
  Object.values(APPEARANCE_SETTING_IDS).filter(isAppearanceSettingVisible)
)
const appearanceSettingElementId = (id: string) => `setting-field-${id}`

export function AppearanceSettings() {
  const { t, isSavingLocale } = useI18n()
  const toolViewMode = useStore($toolViewMode)
  const sessionListDensity = useStore($sessionListDensity)
  const tabStripDefault = useStore($tabStripDefault)
  const a = t.settings.appearance

  useDeepLinkHighlight({
    elementId: appearanceSettingElementId,
    param: 'setting',
    ready: id => APPEARANCE_SEARCH_TARGETS.has(id)
  })

  const toolOptions = [
    { id: 'product', label: a.product },
    { id: 'technical', label: a.technical }
  ] as const

  const sessionDensityOptions = [
    { id: 'compact', label: a.sessionDensityCompact },
    { id: 'comfortable', label: a.sessionDensityComfortable },
    { id: 'detailed', label: a.sessionDensityDetailed }
  ] as const satisfies readonly { id: SessionListDensity; label: string }[]

  const tabStripOptions = [
    { id: 'auto', label: a.tabStripAuto },
    { id: 'always', label: a.tabStripAlways },
    { id: 'never', label: a.tabStripNever }
  ] as const satisfies readonly { id: TabStripDefault; label: string }[]

  return (
    <SettingsContent>
      <div>
        <SectionHeading icon={Palette} title={a.title} />
        <p className="max-w-2xl text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
          {a.intro}
        </p>

        <div className="mt-2">
          <ListRow
            action={<LanguageSwitcher />}
            description={isSavingLocale ? t.language.saving : t.language.description}
            id={appearanceSettingElementId(APPEARANCE_SETTING_IDS.language)}
            title={t.language.label}
          />

          <ListRow
            action={
              <SegmentedControl
                onChange={id => {
                  triggerHaptic('selection')
                  setSessionListDensity(id)
                }}
                options={sessionDensityOptions}
                value={sessionListDensity}
              />
            }
            description={a.sessionDensityDesc}
            title={a.sessionDensityTitle}
          />

          <ListRow
            action={
              <SegmentedControl
                onChange={id => {
                  triggerHaptic('selection')
                  setTabStripDefault(id)
                }}
                options={tabStripOptions}
                value={tabStripDefault}
              />
            }
            description={a.tabStripDesc}
            title={a.tabStripTitle}
          />

          <ListRow
            action={
              <SegmentedControl
                onChange={id => {
                  triggerHaptic('selection')
                  setToolViewMode(id)
                }}
                options={toolOptions}
                value={toolViewMode}
              />
            }
            description={a.toolViewDesc}
            id={appearanceSettingElementId(APPEARANCE_SETTING_IDS.toolView)}
            title={a.toolViewTitle}
          />
        </div>
      </div>
    </SettingsContent>
  )
}
