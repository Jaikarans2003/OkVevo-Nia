/**
 * Maps electron-updater / timeout failures to a short code.
 * Raw OS text stays in the log; IPC and the overlay never receive it.
 */

export const BINARY_UPDATE_ERROR_CODES = [
  'UPD-SIGNATURE',
  'UPD-DOWNLOAD',
  'UPD-INSTALL-TIMEOUT',
  'UPD-UNKNOWN'
] as const

export type BinaryUpdateErrorCode = (typeof BINARY_UPDATE_ERROR_CODES)[number]

export function isBinaryUpdateErrorCode(value: string | null | undefined): value is BinaryUpdateErrorCode {
  return (
    value === 'UPD-SIGNATURE' ||
    value === 'UPD-DOWNLOAD' ||
    value === 'UPD-INSTALL-TIMEOUT' ||
    value === 'UPD-UNKNOWN'
  )
}

function unpack(input: unknown): { code: string; message: string } {
  if (input instanceof Error) {
    const code = 'code' in input && input.code != null ? String(input.code) : ''

    return { code, message: input.message }
  }

  if (typeof input === 'string') {
    return { code: '', message: input }
  }

  if (input && typeof input === 'object') {
    const rec = input as { code?: unknown; message?: unknown }

    return {
      code: rec.code != null ? String(rec.code) : '',
      message: rec.message != null ? String(rec.message) : ''
    }
  }

  return { code: '', message: String(input) }
}

export function formatRawUpdateError(input: unknown): string {
  if (input instanceof Error) {
    const code = 'code' in input && input.code != null ? String(input.code) : ''

    return [code, input.stack || input.message].filter(Boolean).join(' ')
  }

  if (typeof input === 'string') {
    return input
  }

  try {
    return JSON.stringify(input)
  } catch {
    return String(input)
  }
}

export function mapBinaryUpdateError(input: unknown): BinaryUpdateErrorCode {
  const { code, message } = unpack(input)
  const blob = `${code} ${message}`

  if (code === 'UPD-INSTALL-TIMEOUT') {
    return 'UPD-INSTALL-TIMEOUT'
  }

  if (
    code === 'ERR_UPDATER_INVALID_SIGNATURE' ||
    /not signed by the application owner/i.test(blob) ||
    /publisherNames/i.test(blob) ||
    /code object is not signed/i.test(blob) ||
    /codesign/i.test(blob)
  ) {
    return 'UPD-SIGNATURE'
  }

  if (
    code === 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND' ||
    /ERR_UPDATER_CHANNEL_FILE_NOT_FOUND/i.test(blob) ||
    /ERR_UPDATER_DOWNLOAD/i.test(blob) ||
    /net::/i.test(blob) ||
    /ENOTFOUND|ECONNRESET|ETIMEDOUT|ECONNREFUSED|ENETUNREACH|EAI_AGAIN/i.test(blob) ||
    /fetch failed/i.test(blob) ||
    /ERR_NETWORK/i.test(blob)
  ) {
    return 'UPD-DOWNLOAD'
  }

  return 'UPD-UNKNOWN'
}
