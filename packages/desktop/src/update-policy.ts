export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000;

export interface UpdateEnvironment {
  readonly isPackaged: boolean;
  readonly platform: NodeJS.Platform;
  readonly portableRoot?: string;
  readonly releaseChannel?: 'stable' | 'legacy';
}

/** Sólo las instalaciones reemplazables y empaquetadas participan del canal estable. */
export function supportsAutomaticUpdates(environment: UpdateEnvironment): boolean {
  return environment.isPackaged
    && environment.releaseChannel !== 'legacy'
    && environment.portableRoot === undefined
    && (environment.platform === 'win32' || environment.platform === 'darwin');
}
