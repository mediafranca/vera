/**
 * Canjea la capacidad escrita en el fragmento por una cookie HttpOnly cercada.
 * El fragmento nunca viaja al servidor, al historial remoto ni a un referente.
 */
export async function activatePageShareFromLocation(): Promise<void> {
  const route = /^\/share\/([^/]+)$/.exec(window.location.pathname);
  if (route === null || window.location.hash === '') return;
  const proof = new URLSearchParams(window.location.hash.slice(1)).get('secret');
  if (proof === null || proof === '') throw new Error('el enlace privado no contiene su secreto');
  const response = await fetch(`/page-shares/${encodeURIComponent(decodeURIComponent(route[1] ?? ''))}/open`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ secret: proof }),
  });
  if (!response.ok) {
    const said = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(said?.error ?? 'el enlace privado ya no abre');
  }
  window.history.replaceState({}, '', window.location.pathname + window.location.search);
}

export const isPageShareRoute = (): boolean => /^\/share\/[^/]+$/.test(window.location.pathname);
