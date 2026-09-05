import { useStore } from '@nanostores/react'
import { atom } from 'nanostores'

import { queryClient } from '@/lib/query-client'

export type OkvevoAuthPublic = {
  signedIn: boolean
  uid: string | null
  email: string | null
}

export const $okvevoAuth = atom<OkvevoAuthPublic>({ signedIn: false, uid: null, email: null })

let authGeneration = 0

function applyOkvevoAuth(snap: OkvevoAuthPublic): void {
  const wasSignedIn = $okvevoAuth.get().signedIn

  $okvevoAuth.set(snap)

  if (wasSignedIn !== snap.signedIn) {
    void queryClient.invalidateQueries({ queryKey: ['model-options'] })
  }
}

const desktop = typeof window !== 'undefined' ? window.hermesDesktop : undefined

if (desktop) {
  if (desktop.getOkvevoAuth) {
    const started = ++authGeneration

    void desktop.getOkvevoAuth().then(snap => {
      if (!snap || started !== authGeneration) {
        return
      }

      applyOkvevoAuth(snap)
    })
  }

  desktop.onOkvevoAuth?.(snap => {
    authGeneration += 1
    applyOkvevoAuth(snap)
  })
}

export function useOkvevoAuth(): OkvevoAuthPublic {
  return useStore($okvevoAuth)
}
