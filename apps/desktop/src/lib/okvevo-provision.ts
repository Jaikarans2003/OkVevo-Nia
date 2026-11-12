/** Ask the desktop main process to apply OkVevo defaults to a new local profile. */
export async function provisionOkvevoProfile(name: string): Promise<void> {
  const provision = window.hermesDesktop?.provisionOkvevoProfile

  if (!provision) {
    return
  }

  await provision(name)
}
