/**
 * Electron 44 removed clipboard.readImage() and made clipboard I/O async
 * (W3C ClipboardItem model). Read the first image/* item as PNG bytes.
 */
import { clipboard, nativeImage } from 'electron'

export async function readClipboardPng(): Promise<Buffer | null> {
  const items = await clipboard.read()

  for (const item of items) {
    for (const type of item.types) {
      if (!type.startsWith('image/')) {
        continue
      }

      const payload = await item.getType(type)

      if (!(payload instanceof Blob)) {
        continue
      }

      const buf = Buffer.from(await payload.arrayBuffer())

      if (type === 'image/png') {
        return buf
      }

      const img = nativeImage.createFromBuffer(buf)

      if (!img.isEmpty()) {
        return img.toPNG()
      }
    }
  }

  return null
}
