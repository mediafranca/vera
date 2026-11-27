export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000;

export interface UpdateEnvironment {
  readonly isPackaged: boolean;
  readonly platform: NodeJS.Platform;
  readonly portableRoot?: string;
  readonly releaseChannel?: 'stable' | 'legacy';
}

const numericVersion = (version: string): number[] | null => {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version.trim());
  return match === null ? null : match.slice(1, 4).map(Number);
};

/** Compara releases estables sin convertir etiquetas inválidas en novedades. */
export function isNewerVersion(current: string, candidate: string): boolean {
  const installed = numericVersion(current);
  const available = numericVersion(candidate);
  if (installed === null || available === null) return false;
  for (let index = 0; index < installed.length; index += 1) {
    if (available[index]! > installed[index]!) return true;
    if (available[index]! < installed[index]!) return false;
  }
  return false;
}

/** Sólo las instalaciones reemplazables y empaquetadas participan del canal estable. */
export function supportsAutomaticUpdates(environment: UpdateEnvironment): boolean {
  return environment.isPackaged
    && environment.releaseChannel !== 'legacy'
    && environment.portableRoot === undefined
    && (environment.platform === 'win32' || environment.platform === 'darwin');
}
