/**
 * Sign Windows installer artifacts after electron-builder writes them.
 * rcedit already ran in afterPack; this covers the NSIS/MSI payload the
 * updater actually downloads.
 */
import { signWindowsFile } from './sign-windows.mjs'

export default async function afterAllArtifactBuild(context) {
  const paths = context?.artifactPaths ?? []

  for (const file of paths) {
    if (/\.(exe|msi)$/i.test(file)) {
      await signWindowsFile(file)
    }
  }

  return []
}
