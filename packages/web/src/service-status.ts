// Un servicio observado desde Vera.
//
// Este componente no sabe dónde vive el servicio ni en qué pestaña se muestra.
// Tampoco hace peticiones por su cuenta: recibe un estado normalizado y lo
// presenta. Separar sondeo y dibujo permite poner la misma señal en una lista,
// una portada o una ficha detallada sin que cada vista invente su propia idea de
// «está arriba».

import { icon } from './icons.ts';

export type ServiceCondition =
  | 'checking'
  | 'available'
  | 'degraded'
  | 'unavailable'
  | 'unknown';

export interface ServiceStatus {
  /** Nombre humano. Por ejemplo: «Vera MCP». */
  service: string;
  condition: ServiceCondition;
  /** Una explicación breve y pública; nunca un log ni una credencial. */
  detail?: string;
  checkedAt?: Date;
  latencyMs?: number;
}

export interface ServiceStatusPresentation {
  label: string;
  detail: string;
  icon: 'check' | 'refresh-cw' | 'x';
}

const PRESENTATIONS: Record<ServiceCondition, ServiceStatusPresentation> = {
  checking: {
    label: 'Comprobando',
    detail: 'Vera está comprobando el servicio.',
    icon: 'refresh-cw',
  },
  available: {
    label: 'Disponible',
    detail: 'El servicio responde normalmente.',
    icon: 'check',
  },
  degraded: {
    label: 'Disponible con problemas',
    detail: 'El servicio responde, pero requiere atención.',
    icon: 'check',
  },
  unavailable: {
    label: 'No disponible',
    detail: 'El servicio no responde en este momento.',
    icon: 'x',
  },
  unknown: {
    label: 'Sin comprobar',
    detail: 'Todavía no hay una comprobación reciente.',
    icon: 'refresh-cw',
  },
};

export function serviceStatusPresentation(condition: ServiceCondition): ServiceStatusPresentation {
  return PRESENTATIONS[condition];
}

function readableTime(when: Date): string {
  return new Intl.DateTimeFormat('es-CL', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(when);
}

/** La señal pequeña que puede acompañar el nombre de un servicio. */
export function createServiceStatusIndicator(status: ServiceStatus): HTMLElement {
  const presentation = serviceStatusPresentation(status.condition);
  const indicator = document.createElement('span');
  indicator.className = 'service-status-indicator';
  indicator.dataset['state'] = status.condition;
  indicator.setAttribute('role', 'status');
  indicator.setAttribute('aria-label', `${status.service}: ${presentation.label}`);

  const mark = document.createElement('span');
  mark.className = 'service-status-mark';
  mark.innerHTML = icon(presentation.icon);

  const label = document.createElement('span');
  label.className = 'service-status-label';
  label.textContent = presentation.label;
  indicator.append(mark, label);
  return indicator;
}

export interface ServiceStatusViewer {
  element: HTMLElement;
  update(status: ServiceStatus): void;
}

export interface ServiceStatusViewerOptions {
  /** Se conecta al sondeo real cuando se decida dónde vive la ficha. */
  onCheck?: () => void | Promise<void>;
}

/** La ficha completa: estado, explicación y evidencia temporal legible. */
export function createServiceStatusViewer(
  initial: ServiceStatus,
  options: ServiceStatusViewerOptions = {},
): ServiceStatusViewer {
  const root = document.createElement('section');
  root.className = 'service-status-viewer';

  const head = document.createElement('div');
  head.className = 'service-status-head';
  const title = document.createElement('h4');
  title.className = 'service-status-name';
  const statusSlot = document.createElement('div');
  statusSlot.className = 'service-status-slot';
  head.append(title, statusSlot);

  const detail = document.createElement('p');
  detail.className = 'service-status-detail';

  const facts = document.createElement('dl');
  facts.className = 'service-status-facts';
  const checkedTerm = document.createElement('dt');
  checkedTerm.textContent = 'Última comprobación';
  const checkedValue = document.createElement('dd');
  const latencyTerm = document.createElement('dt');
  latencyTerm.textContent = 'Respuesta';
  const latencyValue = document.createElement('dd');
  facts.append(checkedTerm, checkedValue, latencyTerm, latencyValue);

  root.append(head, detail, facts);

  if (options.onCheck !== undefined) {
    const check = document.createElement('button');
    check.type = 'button';
    check.className = 'service-status-check';
    check.innerHTML = `${icon('refresh-cw')}<span>Volver a comprobar</span>`;
    check.addEventListener('click', async () => {
      check.disabled = true;
      try {
        await options.onCheck?.();
      } finally {
        check.disabled = false;
      }
    });
    root.append(check);
  }

  const update = (status: ServiceStatus): void => {
    const presentation = serviceStatusPresentation(status.condition);
    root.dataset['state'] = status.condition;
    root.setAttribute('aria-label', `${status.service}: ${presentation.label}`);
    title.textContent = status.service;
    statusSlot.replaceChildren(createServiceStatusIndicator(status));
    detail.textContent = status.detail?.trim() || presentation.detail;
    checkedValue.textContent = status.checkedAt === undefined
      ? 'Sin comprobar'
      : readableTime(status.checkedAt);
    latencyValue.textContent = status.latencyMs === undefined
      ? 'Sin medición'
      : `${Math.round(status.latencyMs)} ms`;
  };

  update(initial);
  return { element: root, update };
}
