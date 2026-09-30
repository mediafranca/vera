let timer: number | undefined;

/** Un solo lugar para la voz transitoria del sistema, cualquiera sea su origen. */
export function systemNotice(message: string): void {
  let element = document.querySelector<HTMLElement>('.toast');
  if (element === null) {
    element = document.createElement('div');
    element.className = 'toast';
    element.setAttribute('role', 'status');
    element.setAttribute('aria-live', 'polite');
  }
  document.body.append(element);
  element.textContent = message;
  element.hidden = false;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    if (element !== null) element.hidden = true;
  }, 3_000);
}
