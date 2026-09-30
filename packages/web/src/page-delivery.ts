/** La primera copia legible de una página, venga del aparato o del corpus. */
export interface FirstReadable<T> {
  page: T;
  source: 'retained' | 'canonical';
  /** La entrega canónica que sigue validando una copia retenida. */
  validation: Promise<T> | null;
}

type LocalCandidate<T> =
  | { source: 'retained'; state: 'ready'; page: T }
  | { source: 'retained'; state: 'missing' }
  | { source: 'retained'; state: 'failed'; error: unknown };

type RemoteCandidate<T> =
  | { source: 'canonical'; state: 'ready'; page: T }
  | { source: 'canonical'; state: 'failed'; error: unknown };

type Candidate<T> = LocalCandidate<T> | RemoteCandidate<T>;

/**
 * Hace competir la memoria local con el corpus.
 *
 * IndexedDB no merece bloquear la red: en algunos navegadores puede tardar o
 * quedar esperando una transacción antigua. A la vez, una copia local no debe
 * esperar al corpus para poder leerse. Se inician ambas y gobierna la primera
 * que realmente tenga una página; si es la local, la canónica continúa como
 * validación en segundo plano.
 */
export async function firstReadable<T>(
  retained: Promise<T | null>,
  canonical: Promise<T>,
): Promise<FirstReadable<T>> {
  const local: Promise<LocalCandidate<T>> = retained.then(
    (page) => page === null
      ? { source: 'retained', state: 'missing' }
      : { source: 'retained', state: 'ready', page },
    (error: unknown) => ({ source: 'retained', state: 'failed', error }),
  );
  const remote: Promise<RemoteCandidate<T>> = canonical.then(
    (page) => ({ source: 'canonical', state: 'ready', page }),
    (error: unknown) => ({ source: 'canonical', state: 'failed', error }),
  );
  const validate = (): Promise<T> => remote.then((candidate) => {
    if (candidate.state === 'ready') return candidate.page;
    throw candidate.error;
  });

  const first = await Promise.race([local, remote]);
  if (first.state === 'ready') {
    return first.source === 'retained'
      ? { page: first.page, source: 'retained', validation: validate() }
      : { page: first.page, source: 'canonical', validation: null };
  }

  const second = await (first.source === 'retained' ? remote : local);
  if (second.state === 'ready') {
    return second.source === 'retained'
      ? { page: second.page, source: 'retained', validation: validate() }
      : { page: second.page, source: 'canonical', validation: null };
  }

  if (first.source === 'canonical' && first.state === 'failed') throw first.error;
  if (second.source === 'canonical' && second.state === 'failed') throw second.error;
  throw first.state === 'failed' ? first.error : new Error('page unavailable');
}
