/**
 * Desktop bundles ship precompiled renderer assets. Returning false here tells
 * electron-builder to skip the node_modules collector/install step, which
 * avoids workspace dependency graph explosions and keeps packaging
 * deterministic across environments.
 *
 * The Python agent is extraResources/agent-snapshot.tar.gz — extracted at first
 * launch and whenever the install stamp changes. venv + python-deps still run
 * locally via the bundled install script. Packaged apps do not clone GitHub.
 */
export default async function beforeBuild() {
  return false
}
