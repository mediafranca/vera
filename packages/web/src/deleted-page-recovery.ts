/** Sólo la ausencia canónica; una caída de transporte no demuestra borrado. */
export const isMissingPageError = (error: unknown): boolean =>
  error instanceof Error && /no such page/i.test(error.message);

/**
 * Recompone la navegación cuando una dirección todavía nombra una página que
 * el corpus ya borró.
 *
 * La lista recibida debe ser la canónica cuando esté disponible. Por eso el
 * rastro no sólo pierde la identidad conocida de la página borrada: pierde
 * también cualquier paso que ya no figure entre las páginas vivas. Un historial
 * local viejo no puede resucitar lugares que el corpus dejó atrás.
 */
export function recoveryAfterPageDeletion<
  Page extends { id: string; title: string },
  Step extends { page: string },
>(
  pages: readonly Page[],
  trace: readonly Step[],
  deletedPage: string,
  activePage: string | null,
  fallbackTitles: readonly string[],
): { pages: Page[]; trace: Step[]; target: string | null; returned: boolean } {
  const living = new Set(pages.map((page) => page.id));
  const nextPages = pages.filter((page) => page.id !== deletedPage);
  const nextLiving = new Set(nextPages.map((page) => page.id));
  const nextTrace = trace.filter((step) => step.page !== deletedPage && nextLiving.has(step.page));

  if (activePage !== null && activePage !== deletedPage && nextLiving.has(activePage)) {
    return { pages: nextPages, trace: nextTrace, target: activePage, returned: true };
  }

  const walked = [...nextTrace].reverse().find((step) => living.has(step.page));
  if (walked !== undefined) {
    return { pages: nextPages, trace: nextTrace, target: walked.page, returned: true };
  }

  const fallback = fallbackTitles
    .map((title) => nextPages.find((page) => page.title === title))
    .find((page) => page !== undefined);
  return {
    pages: nextPages,
    trace: nextTrace,
    target: fallback?.id ?? null,
    returned: false,
  };
}
