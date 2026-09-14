let timer: number | undefined;

const corners = ['bottom-right', 'bottom-left', 'top-left', 'top-right'] as const;
type Corner = typeof corners[number];

function corner(): Corner {
  const remembered = window.localStorage.getItem('vera:system-overlay-corner');
  return corners.includes(remembered as Corner) ? remembered as Corner : 'bottom-right';
}

/** Un solo lugar para la voz transitoria del sistema, cualquiera sea su origen. */
export function systemNotice(message: string): void {
  let element = document.querySelector<HTMLElement>('.toast');
  if (element === null) {
    element = document.createElement('div');
    element.className = 'toast';
    element.setAttribute('role', 'status');
    element.setAttribute('aria-live', 'polite');
  }
  element.dataset['corner'] = corner();
  const active = document.querySelector<HTMLElement>('.librarian-active-overlay');
  (active ?? document.body).append(element);
  element.textContent = message;
  element.hidden = false;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    if (element !== null) element.hidden = true;
  }, 3_000);
}
