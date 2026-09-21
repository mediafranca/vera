export interface DatedActivity {
  at: number;
  kind: string;
}

export interface ActivityDay<T extends DatedActivity> {
  key: string;
  at: number;
  createdPages: number;
  items: T[];
}

/** La fecha civil del navegador: la actividad se lee en los días de quien mira. */
export function activityDayKey(at: number): string {
  const date = new Date(at);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function activityDayLabel(at: number): string {
  return new Intl.DateTimeFormat('es-CL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(at));
}

/** Agrupa una secuencia descendente sin perder el orden canónico del registro. */
export function groupActivityDays<T extends DatedActivity>(items: readonly T[]): ActivityDay<T>[] {
  const days: ActivityDay<T>[] = [];
  for (const item of items) {
    const key = activityDayKey(item.at);
    let day = days[days.length - 1];
    if (day?.key !== key) {
      day = { key, at: item.at, createdPages: 0, items: [] };
      days.push(day);
    }
    day.items.push(item);
    if (item.kind === 'create_page') day.createdPages += 1;
  }
  return days;
}
