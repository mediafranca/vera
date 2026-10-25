// La representación interactiva de una tarea.
//
// La tarea sigue viviendo en el texto del bloque; este módulo sólo mantiene una
// única traducción visible de sus tres estados. Lo comparten el outliner y las
// apariciones derivadas de consultas para que una casilla no cambie de lenguaje
// según dónde se lea.

import { nextState, writeTask, type Task, type TaskState } from '@vera/core';

const TASK_CLASS: Record<TaskState, string> = {
  'por hacer': 'todo',
  haciendo: 'doing',
  hecho: 'done',
};

function checked(state: TaskState): 'true' | 'false' | 'mixed' {
  return state === 'hecho' ? 'true' : state === 'por hacer' ? 'false' : 'mixed';
}

/** Pone una fila y su control en un estado, sin recrear ninguno de los dos. */
export function showTaskState(row: HTMLElement, box: HTMLButtonElement, state: TaskState): void {
  row.classList.remove('task-todo', 'task-doing', 'task-done');
  row.classList.add('task', `task-${TASK_CLASS[state]}`);
  box.title = `${state} · pulsar para pasar a ${nextState(state)}`;
  box.setAttribute('aria-label', box.title);
  box.setAttribute('aria-checked', checked(state));
}

/** Quita de una fila una tarea que dejó de serlo al editar su fuente. */
export function clearTaskState(row: HTMLElement): void {
  row.classList.remove('task', 'task-todo', 'task-doing', 'task-done');
}

/**
 * Crea la casilla y hace optimista —pero no ficticio— su pulso.
 *
 * La respuesta visual ocurre antes de esperar a la red. Mientras se guarda no
 * se acepta un segundo pulso; si el corpus rechaza el cambio, vuelve exactamente
 * al estado anterior. @guarantee PressingAnswersNowOrReturns.
 */
export function taskToggle(
  row: HTMLElement,
  task: Task,
  persist: (content: string) => Promise<boolean>,
  applied?: (state: TaskState, content: string) => void,
): HTMLButtonElement {
  const box = document.createElement('button');
  box.type = 'button';
  box.className = 'task-box';
  box.setAttribute('role', 'checkbox');

  let state = task.state;
  let pending = false;
  showTaskState(row, box, state);

  box.addEventListener('click', (event) => {
    event.stopPropagation();
    if (pending) return;

    const before = state;
    const next = nextState(before);
    const content = writeTask(next, task.said);
    state = next;
    pending = true;
    showTaskState(row, box, state);
    box.setAttribute('aria-busy', 'true');
    box.setAttribute('aria-disabled', 'true');

    void persist(content).then((saved) => {
      pending = false;
      box.removeAttribute('aria-busy');
      box.removeAttribute('aria-disabled');
      if (saved) {
        applied?.(state, content);
        return;
      }
      state = before;
      showTaskState(row, box, state);
    }).catch(() => {
      pending = false;
      box.removeAttribute('aria-busy');
      box.removeAttribute('aria-disabled');
      state = before;
      showTaskState(row, box, state);
    });
  });

  return box;
}
