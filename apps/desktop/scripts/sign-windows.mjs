/**
 * Authenticode-sign a Windows PE file with osslsigncode or signtool.
 *
 * Never uses electron-builder's winCodeSign 7-Zip path (signAndEditExecutable
 * stays false). Called from afterPack / afterAllArtifactBuild.
 *
 * Local unsigned `npm run pack` skips when WIN_CSC_* are unset, unless
 * NIA_REQUIRE_WIN_SIGN=1 (tagged CI).
 */
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export function windowsSigningReady(env = process.env) {
  return Boolean(String(env.WIN_CSC_LINK || '').trim() && String(env.WIN_CSC_KEY_PASSWORD || '').trim())
}

function looksLikeP12Path(value) {
  return fs.existsSync(value)
}

function decodeP12ToTemp(raw) {
  const value = String(raw || '').trim()
  if (!value) {
    throw new Error('WIN_CSC_LINK is empty')
  }

  if (looksLikeP12Path(value)) {
    return { p12Path: value, cleanup: () => {} }
  }

  const tempPath = path.join(os.tmpdir(), `nia-win-csc-${process.pid}.p12`)
  fs.writeFileSync(tempPath, Buffer.from(value, 'base64'))
  return {
    p12Path: tempPath,
    cleanup: () => {
      try {
        fs.rmSync(tempPath, { force: true })
      } catch {
        // best-effort
      }
    }
  }
}

async function which(bin) {
  try {
    await execFileAsync(process.platform === 'win32' ? 'where' : 'which', [bin])
    return true
  } catch {
    return false
  }
}

export async function signWindowsFile(filePath, env = process.env) {
  if (!windowsSigningReady(env)) {
    if (env.NIA_REQUIRE_WIN_SIGN === '1') {
      throw new Error('Windows Authenticode required but WIN_CSC_LINK / WIN_CSC_KEY_PASSWORD are missing.')
    }

    return { skipped: true }
  }

  if (!fs.existsSync(filePath)) {
    throw new Error(`Cannot sign missing file: ${filePath}`)
  }

  const password = String(env.WIN_CSC_KEY_PASSWORD)
  const { p12Path, cleanup } = decodeP12ToTemp(env.WIN_CSC_LINK)

  try {
    if (await which('osslsigncode')) {
      const outPath = `${filePath}.signed`
      await execFileAsync('osslsigncode', [
        'sign',
        '-pkcs12',
        p12Path,
        '-pass',
        password,
        '-n',
        'Nia',
        '-t',
        'http://timestamp.digicert.com',
        '-in',
        filePath,
        '-out',
        outPath
      ])
      fs.renameSync(outPath, filePath)
      return { skipped: false, tool: 'osslsigncode' }
    }

    if (process.platform === 'win32') {
      await execFileAsync('signtool', [
        'sign',
        '/f',
        p12Path,
        '/p',
        password,
        '/fd',
        'SHA256',
        '/td',
        'SHA256',
        '/tr',
        'http://timestamp.digicert.com',
        filePath
      ])
      return { skipped: false, tool: 'signtool' }
    }

    throw new Error('No osslsigncode/signtool on PATH; cannot Authenticode-sign.')
  } finally {
    cleanup()
  }
}
