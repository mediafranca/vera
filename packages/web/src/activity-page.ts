// El registro canónico, vuelto legible sin copiarlo a otra base.

import { api, type Change, type DeletedPageActivity } from './api.ts';
import { activityDayLabel, groupActivityDays } from './activity-days.ts';

export function isActivityPage(properties: readonly { key: string; value: string }[]): boolean {
  return properties.some(
    (one) => one.key === 'special-kind' && one.value.trim().toLowerCase() === 'activity',
  );
}

type Restore = (changes: readonly Change[]) => Promise<boolean>;
type ActivityTab = 'changes' | 'deletions';

const ACTIVITY_PAGE = 'VERA: Registro de Actividad';

export function participantActivityPath(participant: string): string {
  return `/p/${encodeURIComponent(ACTIVITY_PAGE)}?participant=${encodeURIComponent(participant)}`;
}

function moment(at: number): string {
  return new Intl.DateTimeFormat('es-CL', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(at));
}

function deletedRow(one: DeletedPageActivity, restore: Restore, refresh: () => void): HTMLElement {
  const row = document.createElement('article');
  row.className = 'activity-deletion';
  const text = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = one.title;
  const detail = document.createElement('small');
  detail.textContent = `${moment(one.deletedAt)} · ${one.by} · ${one.blocks} ${one.blocks === 1 ? 'bloque' : 'bloques'}`;
  text.append(title, detail);
  row.append(text);

  if (one.restorable) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'activity-restore';
    button.textContent = 'restaurar';
    button.onclick = async () => {
      if (!window.confirm(`Se restaurará «${one.title}» con ${one.blocks} bloques. La restauración quedará registrada como una nueva actividad.`)) return;
      button.disabled = true;
      button.textContent = 'restaurando…';
      if (await restore(one.changes)) refresh();
      else {
        button.disabled = false;
        button.textContent = 'restaurar';
      }
    };
    row.append(button);
  } else {
    const refusal = document.createElement('small');
    refusal.className = 'activity-refusal';
    refusal.textContent = one.refusal ?? 'no se puede restaurar';
    row.append(refusal);
  }
  return row;
}

function linkedSummary(
  summary: string,
  page: { id: string; title: string },
  block: string | null,
): HTMLElement {
  const line = document.createElement('span');
  const named = `«${page.title}»`;
  const at = summary.indexOf(named);
  const link = document.createElement('a');
  // La identidad evita que una copia local con un título antiguo o ambiguo
  // intercepte el enlace. El título sigue siendo lo que se lee.
  link.href = `/p/${encodeURIComponent(page.id)}${block === null ? '' : `#${encodeURIComponent(block)}`}`;
  link.textContent = named;
  link.title = `Abrir ${page.title}`;
  if (at < 0) {
    line.append(summary, ' · ', link);
  } else {
    line.append(summary.slice(0, at), link, summary.slice(at + named.length));
  }
  return line;
}

function activityRow(one: Awaited<ReturnType<typeof api.activity>>['activity'][number]): HTMLLIElement {
  const item = document.createElement('li');
  if (one.kind === 'create_page') item.classList.add('activity-page-created');
  const author = document.createElement('a');
  author.className = 'activity-by';
  author.href = participantActivityPath(one.participant);
  author.textContent = `${one.participantKind === 'agent' ? 'agente ' : ''}${one.by}`;
  const action = document.createElement('span');
  action.className = 'activity-action';
  action.append(author, ' ');
  if (one.page !== null) action.append(linkedSummary(one.summary, one.page, one.block));
  else action.append(one.summary);
  item.append(action);
  if (one.excerpt !== null) {
    const excerpt = document.createElement('p');
    excerpt.className = 'activity-excerpt';
    excerpt.textContent = one.excerpt;
    item.append(excerpt);
  }
  return item;
}

function activityDay(
  at: number,
  first: boolean,
): { details: HTMLDetailsElement; list: HTMLOListElement; update: (created: number, total: number) => void } {
  const details = document.createElement('details');
  details.className = 'activity-day';
  details.open = first;
  const summary = document.createElement('summary');
  const date = document.createElement('span');
  date.textContent = activityDayLabel(at);
  const count = document.createElement('small');
  summary.append(date, count);
  const list = document.createElement('ol');
  list.className = 'activity-list';
  details.append(summary, list);
  const update = (created: number, total: number): void => {
    const pages = created === 0 ? '' : `${created} ${created === 1 ? 'página creada' : 'páginas creadas'} · `;
    count.textContent = `${pages}${total} ${total === 1 ? 'cambio' : 'cambios'}`;
  };
  return { details, list, update };
}

export async function renderActivityPage(
  restore: Restore,
  report: (message: string) => void,
  initialTab: ActivityTab = 'changes',
): Promise<HTMLElement> {
  const root = document.createElement('section');
  root.className = 'activity-register';
  const loading = document.createElement('p');
  loading.textContent = 'leyendo el registro…';
  root.append(loading);

  let currentTab = initialTab;
  const participant = new URL(window.location.href).searchParams.get('participant');
  const refresh = (): void => {
    void renderActivityPage(restore, report, currentTab).then((fresh) => root.replaceWith(fresh));
  };

  try {
    const view = await api.activity(undefined, participant);
    root.replaceChildren();

    if (view.participant !== null) {
      const heading = document.createElement('h2');
      heading.className = 'activity-participant';
      heading.textContent = `Contribuciones de ${view.participant.name}`;
      const identity = document.createElement('small');
      identity.textContent = `${view.participant.kind === 'agent' ? 'agente' : 'persona'} · ${view.participant.id}`;
      heading.append(identity);
      root.append(heading);
    }

    const tabs = document.createElement('div');
    tabs.className = 'activity-tabs';
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Secciones del registro de actividad');
    const changesTab = document.createElement('button');
    changesTab.type = 'button';
    changesTab.id = 'activity-tab-changes';
    changesTab.setAttribute('role', 'tab');
    changesTab.setAttribute('aria-controls', 'activity-panel-changes');
    changesTab.textContent = 'Creaciones y ediciones';
    const deletionsTab = document.createElement('button');
    deletionsTab.type = 'button';
    deletionsTab.id = 'activity-tab-deletions';
    deletionsTab.setAttribute('role', 'tab');
    deletionsTab.setAttribute('aria-controls', 'activity-panel-deletions');
    deletionsTab.textContent = `Eliminaciones (${view.deletedPages.length})`;
    tabs.append(changesTab, deletionsTab);

    const changesPanel = document.createElement('section');
    changesPanel.id = 'activity-panel-changes';
    changesPanel.className = 'activity-panel';
    changesPanel.setAttribute('role', 'tabpanel');
    changesPanel.setAttribute('aria-labelledby', changesTab.id);
    const deletionsPanel = document.createElement('section');
    deletionsPanel.id = 'activity-panel-deletions';
    deletionsPanel.className = 'activity-panel';
    deletionsPanel.setAttribute('role', 'tabpanel');
    deletionsPanel.setAttribute('aria-labelledby', deletionsTab.id);

    const select = (tab: ActivityTab): void => {
      currentTab = tab;
      const changesSelected = tab === 'changes';
      changesTab.setAttribute('aria-selected', String(changesSelected));
      deletionsTab.setAttribute('aria-selected', String(!changesSelected));
      changesTab.tabIndex = changesSelected ? 0 : -1;
      deletionsTab.tabIndex = changesSelected ? -1 : 0;
      changesPanel.hidden = !changesSelected;
      deletionsPanel.hidden = changesSelected;
    };
    changesTab.onclick = () => select('changes');
    deletionsTab.onclick = () => select('deletions');

    if (view.deletedPages.length === 0) {
      const none = document.createElement('p');
      none.className = 'activity-empty';
      none.textContent = 'No hay páginas borradas en el registro.';
      deletionsPanel.append(none);
    } else {
      const deleted = document.createElement('div');
      deleted.className = 'activity-deletions';
      for (const one of view.deletedPages) deleted.append(deletedRow(one, restore, refresh));
      deletionsPanel.append(deleted);
    }

    const daysHost = document.createElement('div');
    daysHost.className = 'activity-days';
    const days = new Map<string, {
      list: HTMLOListElement;
      created: number;
      total: number;
      update: (created: number, total: number) => void;
    }>();
    const append = (items: typeof view.activity): void => {
      for (const group of groupActivityDays(items)) {
        let day = days.get(group.key);
        if (day === undefined) {
          const made = activityDay(group.at, days.size === 0);
          day = { list: made.list, created: 0, total: 0, update: made.update };
          days.set(group.key, day);
          daysHost.append(made.details);
        }
        for (const one of group.items) day.list.append(activityRow(one));
        day.created += group.createdPages;
        day.total += group.items.length;
        day.update(day.created, day.total);
      }
    };
    append(view.activity);
    changesPanel.append(daysHost);
    if (view.nextBefore !== null) {
      const older = document.createElement('button');
      older.type = 'button';
      older.className = 'activity-older';
      older.textContent = 'mostrar actividad anterior';
      let cursor = view.nextBefore;
      older.onclick = async () => {
        older.disabled = true;
        older.textContent = 'leyendo…';
        try {
          const next = await api.activity(cursor, participant);
          append(next.activity);
          if (next.nextBefore === null) older.remove();
          else {
            cursor = next.nextBefore;
            older.disabled = false;
            older.textContent = 'mostrar actividad anterior';
          }
        } catch {
          older.disabled = false;
          older.textContent = 'volver a intentar';
        }
      };
      changesPanel.append(older);
    }
    root.append(tabs, changesPanel, deletionsPanel);
    select(initialTab);
  } catch {
    loading.textContent = 'No se pudo leer el registro de actividad.';
    report('sin conexión con el registro de actividad');
  }
  return root;
}
