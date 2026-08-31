import { useStore } from '@nanostores/react'
import { useEffect } from 'react'

import { LanguageSwitcher } from '@/components/language-switcher'
import { Button } from '@/components/ui/button'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { Palette } from '@/lib/icons'
import { $backdrop, setBackdrop } from '@/store/backdrop'
import { $composerPopoutGesturesEnabled, setComposerPopoutGesturesEnabled } from '@/store/composer-popout'
import { $embedAllowed, $embedMode, clearEmbedAllowed, type EmbedMode, setEmbedMode } from '@/store/embed-consent'
import { $introSplash, setIntroSplash } from '@/store/intro-splash'
import { $reactionsEnabled, setReactionsEnabled } from '@/store/reactions-enabled'
import { $reasoningCollapsedByDefault, setReasoningCollapsedByDefault } from '@/store/reasoning-disclosure'
import { $sessionListDensity, type SessionListDensity, setSessionListDensity } from '@/store/session-list-density'
import { $tabStripDefault, setTabStripDefault, type TabStripDefault } from '@/store/tabstrip-prefs'
import { $retiredTips, $tipsEnabled, resetTips, setTipsEnabled } from '@/store/tips'
import { $toolViewMode, setToolViewMode } from '@/store/tool-view'
import { $toursEnabled, setToursEnabled } from '@/store/tours'
import {
  $translucency,
  beginTranslucencyPeek,
  endTranslucencyPeek,
  GLASS_IS_WINDOWS,
  GLASS_SCOPES,
  GLASS_SUPPORTED,
  glassMaterialForPicker,
  glassMaterialsFor,
  pulseTranslucencyPeek,
  resetTranslucencyPeek,
  setTranslucency,
  setTranslucencyFade,
  setTranslucencyMaterial,
  setTranslucencyMode,
  setTranslucencyScope,
  TRANSLUCENCY_MAX,
  TRANSLUCENCY_MIN,
  TRANSLUCENCY_STEP,
  TRANSLUCENCY_SUPPORTED
} from '@/store/translucency'
import { $vibeHeartsEnabled, setVibeHeartsEnabled } from '@/store/vibe-hearts-enabled'

import { PetSettings } from './pet-settings'
import { ListRow, SectionHeading, SettingsContent, ToggleRow } from './primitives'
import { APPEARANCE_SETTING_IDS } from './settings-search'
import { TerminalFontSetting } from './terminal-font-setting'
import { useDeepLinkHighlight } from './use-deep-link-highlight'

const APPEARANCE_SEARCH_TARGETS = new Set<string>(Object.values(APPEARANCE_SETTING_IDS))
const appearanceSettingElementId = (id: string) => `setting-field-${id}`

// Keys a range input treats as a step, so the peek can flash the live window
// for keyboard adjustment the way a pointer drag holds it open.
const SLIDER_STEP_KEYS = new Set([
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'End',
  'Home',
  'PageDown',
  'PageUp'
])

interface TranslucencySliderProps {
  label: string
  onChange: (value: number) => void
  value: number
}

/**
 * One 0–100 lever, used up to twice: Clear's window opacity, and under Glass
 * the tint plus an optional native fade.
 *
 * Peek while the hand is on it — the overlay (scrim + near-opaque card) ghosts
 * so the window behind IS the live preview. The pointer pair covers
 * mouse/touch drags; the keyboard path pulses per step instead, and blur ends
 * any residual hold.
 */
function TranslucencySlider({ label, onChange, value }: TranslucencySliderProps) {
  return (
    <>
      <input
        aria-label={label}
        className="h-1 w-40 cursor-pointer appearance-none rounded-full bg-(--ui-stroke-tertiary)"
        max={TRANSLUCENCY_MAX}
        min={TRANSLUCENCY_MIN}
        onBlur={endTranslucencyPeek}
        onChange={event => {
          triggerHaptic('selection')
          onChange(Number(event.target.value))
        }}
        onKeyDown={event => {
          if (SLIDER_STEP_KEYS.has(event.key)) {
            pulseTranslucencyPeek()
          }
        }}
        onLostPointerCapture={endTranslucencyPeek}
        onPointerDown={beginTranslucencyPeek}
        onPointerUp={endTranslucencyPeek}
        step={TRANSLUCENCY_STEP}
        style={{ accentColor: 'var(--dt-primary)' }}
        type="range"
        value={value}
      />
      <span className="w-9 text-right text-[length:var(--conversation-caption-font-size)] tabular-nums text-(--ui-text-tertiary)">
        {value}%
      </span>
    </>
  )
}

interface GlassRowProps {
  children: React.ReactNode
  label: string
}

/** A labelled control in the Glass sub-panel: tint, fade, frost, area. */
function GlassRow({ children, label }: GlassRowProps) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-12 text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
        {label}
      </span>
      {children}
    </div>
  )
}

export function AppearanceSettings() {
  const { t, isSavingLocale } = useI18n()
  const toolViewMode = useStore($toolViewMode)
  const reasoningCollapsedByDefault = useStore($reasoningCollapsedByDefault)
  const sessionListDensity = useStore($sessionListDensity)
  const tabStripDefault = useStore($tabStripDefault)
  const embedMode = useStore($embedMode)
  const embedAllowed = useStore($embedAllowed)
  const composerPopoutGesturesEnabled = useStore($composerPopoutGesturesEnabled)
  const translucency = useStore($translucency)
  const glassMode = translucency.mode === 'glass' && GLASS_SUPPORTED
  const reactionsEnabled = useStore($reactionsEnabled)
  const tipsEnabled = useStore($tipsEnabled)
  const toursEnabled = useStore($toursEnabled)
  const retiredTips = useStore($retiredTips)
  const vibeHeartsEnabled = useStore($vibeHeartsEnabled)
  const backdrop = useStore($backdrop)
  const introSplash = useStore($introSplash)
  const a = t.settings.appearance

  // A pointer held on the intensity slider when this overlay closes (Escape
  // mid-drag) never delivers its pointerup here, which would strand the peek
  // counter above zero and ghost the NEXT settings overlay. Unmount drops
  // every outstanding hold.
  useEffect(() => resetTranslucencyPeek, [])

  // Shared by the mode/frost/area pickers: apply the choice, then show it
  // through the overlay it just altered (a pulse, not a hold — see the peek
  // notes on the slider itself).
  const pickTranslucency =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      triggerHaptic('selection')
      set(value)

      if (translucency.intensity > 0) {
        pulseTranslucencyPeek()
      }
    }

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

  const embedOptions = [
    { id: 'ask', label: a.embedsAsk },
    { id: 'always', label: a.embedsAlways },
    { id: 'off', label: a.embedsOff }
  ] as const satisfies readonly { id: EmbedMode; label: string }[]

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

          <TerminalFontSetting />

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

          {/* Linux has neither half of this setting (see TRANSLUCENCY_SUPPORTED),
              so the row is absent there rather than offering a dead lever. */}
          {TRANSLUCENCY_SUPPORTED && (
            <ListRow
              action={
                <div
                  className="flex items-center gap-3"
                  // Arms the peek for the overlay this row lives in — the
                  // ghosting rules in styles.css scope to it, so no other
                  // overlay pays for an opacity transition it never uses.
                  data-translucency-peek-scope=""
                >
                  {GLASS_SUPPORTED && (
                    <SegmentedControl
                      onChange={pickTranslucency(setTranslucencyMode)}
                      options={[
                        { id: 'clear' as const, label: a.translucencyModeClear },
                        { id: 'glass' as const, label: a.translucencyModeGlass }
                      ]}
                      value={translucency.mode}
                    />
                  )}
                  {/* Clear has one lever and it belongs beside the mode. Glass
                      has four controls, so they move into the labelled panel
                      below rather than crowding this line with an unlabelled
                      slider that means something different. */}
                  {!glassMode && (
                    <TranslucencySlider
                      label={a.translucencyTitle}
                      onChange={setTranslucency}
                      value={translucency.intensity}
                    />
                  )}
                </div>
              }
              below={
                glassMode ? (
                  <div className="mt-3 flex flex-col gap-2.5" data-translucency-peek-scope="">
                    <GlassRow label={a.translucencyTintTitle}>
                      <TranslucencySlider
                        label={a.translucencyTintTitle}
                        onChange={setTranslucency}
                        value={translucency.intensity}
                      />
                    </GlassRow>
                    <GlassRow label={a.translucencyFadeTitle}>
                      <TranslucencySlider
                        label={a.translucencyFadeTitle}
                        onChange={setTranslucencyFade}
                        value={translucency.fade}
                      />
                    </GlassRow>
                    <GlassRow label={a.translucencyFrostTitle}>
                      <SegmentedControl
                        onChange={pickTranslucency(setTranslucencyMaterial)}
                        // Windows renders four rungs as three backdrops, so it
                        // is offered three; a frost saved on a Mac highlights
                        // the rung that renders the same backdrop here.
                        options={glassMaterialsFor(GLASS_IS_WINDOWS).map(material => ({
                          id: material,
                          label: a.translucencyFrost[material]
                        }))}
                        value={glassMaterialForPicker(translucency.material, GLASS_IS_WINDOWS)}
                      />
                    </GlassRow>
                    <GlassRow label={a.translucencyScopeTitle}>
                      <SegmentedControl
                        onChange={pickTranslucency(setTranslucencyScope)}
                        options={GLASS_SCOPES.map(scope => ({
                          id: scope,
                          label: a.translucencyScope[scope]
                        }))}
                        value={translucency.scope}
                      />
                    </GlassRow>
                  </div>
                ) : undefined
              }
              description={glassMode ? a.translucencyGlassDesc : a.translucencyDesc}
              id={appearanceSettingElementId(APPEARANCE_SETTING_IDS.translucency)}
              title={a.translucencyTitle}
            />
          )}

          <ListRow
            action={
              <SegmentedControl
                onChange={id => {
                  triggerHaptic('selection')
                  setBackdrop(id === 'on')
                }}
                options={[
                  { id: 'off', label: t.common.off },
                  { id: 'on', label: t.common.on }
                ]}
                value={backdrop ? 'on' : 'off'}
              />
            }
            description={a.backdropDesc}
            id={appearanceSettingElementId(APPEARANCE_SETTING_IDS.backdrop)}
            title={a.backdropTitle}
          />

          <ListRow
            action={
              <SegmentedControl
                onChange={id => {
                  triggerHaptic('selection')
                  setIntroSplash(id === 'on')
                }}
                options={[
                  { id: 'off', label: t.common.off },
                  { id: 'on', label: t.common.on }
                ]}
                value={introSplash ? 'on' : 'off'}
              />
            }
            description={a.introSplashDesc}
            id={appearanceSettingElementId(APPEARANCE_SETTING_IDS.introSplash)}
            title={a.introSplashTitle}
          />

          <ToggleRow
            checked={composerPopoutGesturesEnabled}
            description={a.composerPopoutDesc}
            label={a.composerPopoutTitle}
            onChange={setComposerPopoutGesturesEnabled}
          />

          <ListRow
            action={
              <SegmentedControl
                onChange={id => {
                  triggerHaptic('selection')
                  setReactionsEnabled(id === 'on')
                }}
                options={[
                  { id: 'off', label: t.common.off },
                  { id: 'on', label: t.common.on }
                ]}
                value={reactionsEnabled ? 'on' : 'off'}
              />
            }
            description={a.reactionsDesc}
            title={a.reactionsTitle}
          />

          <ListRow
            action={
              <div className="flex flex-col items-end gap-1.5">
                <SegmentedControl
                  onChange={id => {
                    triggerHaptic('selection')
                    setTipsEnabled(id === 'on')
                  }}
                  options={[
                    { id: 'off', label: t.common.off },
                    { id: 'on', label: t.common.on }
                  ]}
                  value={tipsEnabled ? 'on' : 'off'}
                />
                {/* The ✕ on a tip is permanent, so this is the only way back.
                    It appears once there is something to bring back. */}
                {retiredTips.length > 0 && (
                  <Button
                    onClick={() => {
                      triggerHaptic('selection')
                      resetTips()
                    }}
                    size="inline"
                    variant="text"
                  >
                    {a.tipsReset(retiredTips.length)}
                  </Button>
                )}
              </div>
            }
            description={a.tipsDesc}
            title={a.tipsTitle}
          />

          <ListRow
            action={
              <SegmentedControl
                onChange={id => {
                  triggerHaptic('selection')
                  setToursEnabled(id === 'on')
                }}
                options={[
                  { id: 'off', label: t.common.off },
                  { id: 'on', label: t.common.on }
                ]}
                value={toursEnabled ? 'on' : 'off'}
              />
            }
            description={a.toursDesc}
            title={a.toursTitle}
          />

          <ListRow
            action={
              <SegmentedControl
                onChange={id => {
                  triggerHaptic('selection')
                  setVibeHeartsEnabled(id === 'on')
                }}
                options={[
                  { id: 'off', label: t.common.off },
                  { id: 'on', label: t.common.on }
                ]}
                value={vibeHeartsEnabled ? 'on' : 'off'}
              />
            }
            description={a.vibeHeartsDesc}
            title={a.vibeHeartsTitle}
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

          <ListRow
            action={
              <SegmentedControl
                onChange={id => {
                  triggerHaptic('selection')
                  setReasoningCollapsedByDefault(id === 'on')
                }}
                options={[
                  { id: 'off', label: t.common.off },
                  { id: 'on', label: t.common.on }
                ]}
                value={reasoningCollapsedByDefault ? 'on' : 'off'}
              />
            }
            description={a.reasoningCollapsedDesc}
            title={a.reasoningCollapsedTitle}
          />

          <ListRow
            action={
              <div className="flex flex-col items-end gap-1.5">
                <SegmentedControl
                  onChange={id => {
                    triggerHaptic('selection')
                    setEmbedMode(id)
                  }}
                  options={embedOptions}
                  value={embedMode}
                />
                {embedAllowed.length > 0 && (
                  <Button
                    onClick={() => {
                      triggerHaptic('selection')
                      clearEmbedAllowed()
                    }}
                    size="inline"
                    variant="text"
                  >
                    {a.embedsReset(embedAllowed.length)}
                  </Button>
                )}
              </div>
            }
            description={a.embedsDesc}
            id={appearanceSettingElementId(APPEARANCE_SETTING_IDS.embeds)}
            title={a.embedsTitle}
          />
        </div>
      </div>

      <div className="mt-6">
        <PetSettings />
      </div>
    </SettingsContent>
  )
}
