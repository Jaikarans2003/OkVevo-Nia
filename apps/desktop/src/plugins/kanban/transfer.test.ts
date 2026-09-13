import { beforeEach, describe, expect, it, vi } from 'vitest'

import { en } from './i18n'

const { hostMock, exportBoard, importBoard } = vi.hoisted(() => ({
  hostMock: { notify: vi.fn(), notifyError: vi.fn() },
  exportBoard: vi.fn(),
  importBoard: vi.fn()
}))

vi.mock('@hermes/plugin-sdk', () => ({
  host: hostMock
}))

vi.mock('./api', () => ({
  exportBoard,
  importBoard
}))

import { runExportBoardFlow, runImportBoardFlow } from './transfer'

const os = {
  pickSavePath: vi.fn(),
  pickOpenPath: vi.fn()
}

beforeEach(() => {
  hostMock.notify.mockReset()
  hostMock.notifyError.mockReset()
  exportBoard.mockReset()
  importBoard.mockReset()
  os.pickSavePath.mockReset()
  os.pickOpenPath.mockReset()
})

describe('kanban board transfer toasts', () => {
  it('routes export failures through notifyError', async () => {
    os.pickSavePath.mockResolvedValue('/tmp/board.tar.gz')
    exportBoard.mockRejectedValue(new Error('ENOENT: archive'))

    await expect(runExportBoardFlow(os as never, en, 'core')).resolves.toBeNull()

    expect(hostMock.notifyError).toHaveBeenCalledWith(expect.any(Error), en.couldNotExport)
    expect(hostMock.notify).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'error' }))
  })

  it('routes import failures through notifyError', async () => {
    os.pickOpenPath.mockResolvedValue('/tmp/board.tar.gz')
    importBoard.mockRejectedValue(new Error('corrupt archive'))

    await expect(runImportBoardFlow(os as never, en)).resolves.toBeNull()

    expect(hostMock.notifyError).toHaveBeenCalledWith(expect.any(Error), en.couldNotImport)
    expect(hostMock.notify).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'error' }))
  })
})
