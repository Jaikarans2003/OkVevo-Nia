import { useStore } from '@nanostores/react'
import { atom } from 'nanostores'
import { useEffect } from 'react'

export type OkvevoAuthPublic = {
  signedIn: boolean
  uid: string | null
  email: string | null
}

export const $okvevoAuth = atom<OkvevoAuthPublic>({ signedIn: false, uid: null, email: null })

export function useOkvevoAuth(): OkvevoAuthPublic {
  const state = useStore($okvevoAuth)

  useEffect(() => {
    void window.hermesDesktop?.getOkvevoAuth?.().then(snap => {
      if (snap) {
        $okvevoAuth.set(snap)
      }
    })

    return window.hermesDesktop?.onOkvevoAuth?.(snap => $okvevoAuth.set(snap))
  }, [])

  return state
}
