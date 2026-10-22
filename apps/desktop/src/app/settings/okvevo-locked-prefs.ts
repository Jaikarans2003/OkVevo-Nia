/**
 * Boot-time side-effect module: force-applies the OkVevo-locked desktop prefs
 * before React mounts, so leftover localStorage/config.yaml cannot resurrect
 * hidden settings. Also pins the pet surfaces off on every launch.
 */
import { $petInfo, setPetInfo } from '@/store/pet'
import { $petGallery } from '@/store/pet-gallery'

import { applyLockedDesktopPrefs } from './settings-ui-policy'

applyLockedDesktopPrefs()

$petGallery.listen(gallery => {
  if (gallery?.enabled) {
    $petGallery.set({ ...gallery, enabled: false })
  }
})

$petInfo.listen(info => {
  if (info.enabled) {
    setPetInfo({ enabled: false })
  }
})
