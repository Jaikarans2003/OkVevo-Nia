import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const signedOut = { signedIn: false, uid: null, email: null }
const signedIn = { signedIn: true, uid: 'u1', email: 'a@b.c' }

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  Reflect.deleteProperty(window, 'hermesDesktop')
})

test('a newer auth push wins over a stale get', async () => {
  let resolveGet: (snap: typeof signedOut) => void = () => undefined
  const getPromise = new Promise<typeof signedOut>(resolve => {
    resolveGet = resolve
  })
  const listeners: Array<(snap: typeof signedIn) => void> = []

  Object.defineProperty(window, 'hermesDesktop', {
    configurable: true,
    value: {
      getOkvevoAuth: () => getPromise,
      onOkvevoAuth: (callback: (snap: typeof signedIn) => void) => {
        listeners.push(callback)

        return () => undefined
      }
    }
  })

  const { $okvevoAuth } = await import('./okvevo-auth')

  expect(listeners).toHaveLength(1)
  listeners[0](signedIn)
  expect($okvevoAuth.get()).toEqual(signedIn)

  resolveGet(signedOut)
  await getPromise
  await Promise.resolve()

  expect($okvevoAuth.get()).toEqual(signedIn)
})

test('signedIn flip invalidates the model-options catalog', async () => {
  const listeners: Array<(snap: typeof signedIn) => void> = []

  Object.defineProperty(window, 'hermesDesktop', {
    configurable: true,
    value: {
      onOkvevoAuth: (callback: (snap: typeof signedIn) => void) => {
        listeners.push(callback)

        return () => undefined
      }
    }
  })

  const { queryClient } = await import('@/lib/query-client')
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  const { $okvevoAuth } = await import('./okvevo-auth')

  expect($okvevoAuth.get().signedIn).toBe(false)
  listeners[0](signedIn)

  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['model-options'] })
})
