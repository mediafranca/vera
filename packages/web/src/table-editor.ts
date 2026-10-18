import {
  writeMarkdownTable,
  type MarkdownTable,
  type TableAlignment,
} from '@vera/core';
import { icon } from './icons.ts';
import { resolveFormat, resolveLink, type FormatOutcome } from './keys.ts';

export interface TableCellAddress {
  row: number;
  column: number;
}

interface TableEditorOptions {
  initial?: TableCellAddress;
  save: (source: string | null) => Promise<boolean>;
}

/** Un pegado de planilla sólo es tabular si trae más de una celda. */
export function tabularClipboard(text: string): string[][] | null {
  const clean = text.replace(/\r/g, '').replace(/\n$/, '');
  if (!clean.includes('\t') && !clean.includes('\n')) return null;
  return clean.split('\n').map((row) => row.split('\t'));
}

function cloneTable(table: MarkdownTable): MarkdownTable {
  return {
    header: [...table.header],
    alignments: [...table.alignments],
    rows: table.rows.map((row) => [...row]),
  };
}

/** Monta el editor sobre el mismo bloque; guardar sigue siendo una sola edición. */
export function mountMarkdownTableEditor(
  body: HTMLElement,
  original: MarkdownTable,
  options: TableEditorOptions,
): void {
  const table = cloneTable(original);
  let active: TableCellAddress = {
    row: Math.max(0, Math.min(options.initial?.row ?? 0, table.rows.length)),
    column: Math.max(0, Math.min(options.initial?.column ?? 0, table.header.length - 1)),
  };
  let activeInput: HTMLInputElement | null = null;
  let saving = false;
  let dirty = false;

  const rowAt = (row: number): string[] => row === 0 ? table.header : table.rows[row - 1]!;
  const focus = (address: TableCellAddress, atEnd = false): void => {
    const input = body.querySelector<HTMLInputElement>(
      `.table-cell-input[data-row="${address.row}"][data-column="${address.column}"]`,
    );
    if (input === null) return;
    input.focus({ preventScroll: true });
    const caret = atEnd ? input.value.length : 0;
    input.setSelectionRange(caret, caret);
  };

  const updateActive = (input: HTMLInputElement): void => {
    activeInput = input;
    active = {
      row: Number(input.dataset['row'] ?? 0),
      column: Number(input.dataset['column'] ?? 0),
    };
    const status = body.querySelector<HTMLElement>('.table-editor-status');
    if (status !== null) {
      status.textContent = active.row === 0
        ? `encabezado · columna ${active.column + 1}`
        : `fila ${active.row} · columna ${active.column + 1}`;
    }
    body.querySelector<HTMLButtonElement>('[data-table-action="remove-row"]')!.disabled = active.row === 0;
    body.querySelector<HTMLButtonElement>('[data-table-action="remove-column"]')!.disabled = table.header.length === 1;
    for (const button of body.querySelectorAll<HTMLButtonElement>('[data-table-align]')) {
      button.setAttribute('aria-pressed', String(button.dataset['tableAlign'] === table.alignments[active.column]));
    }
  };

  const apply = (outcome: FormatOutcome): void => {
    if (activeInput === null) return;
    activeInput.value = outcome.buffer;
    rowAt(active.row)[active.column] = outcome.buffer;
    dirty = true;
    activeInput.setSelectionRange(outcome.selectionStart, outcome.selectionEnd);
    activeInput.focus();
  };

  const finish = async (): Promise<void> => {
    if (saving) return;
    saving = true;
    body.querySelector<HTMLButtonElement>('.table-editor-done')?.setAttribute('aria-busy', 'true');
    const saved = await options.save(dirty ? writeMarkdownTable(table) : null);
    if (!saved) {
      saving = false;
      body.querySelector<HTMLButtonElement>('.table-editor-done')?.removeAttribute('aria-busy');
      activeInput?.focus();
    }
  };

  const button = (
    label: string,
    title: string,
    action: () => void,
    data?: { action?: string; align?: TableAlignment },
  ): HTMLButtonElement => {
    const control = document.createElement('button');
    control.type = 'button';
    control.className = 'table-editor-action';
    control.textContent = label;
    control.title = title;
    control.setAttribute('aria-label', title);
    if (data?.action !== undefined) control.dataset['tableAction'] = data.action;
    if (data?.align !== undefined) control.dataset['tableAlign'] = data.align;
    control.addEventListener('mousedown', (event) => event.preventDefault());
    control.addEventListener('click', (event) => {
      event.stopPropagation();
      action();
    });
    return control;
  };

  const render = (nextFocus?: TableCellAddress): void => {
    body.innerHTML = '';
    body.classList.add('editing', 'table-editing');

    const editor = document.createElement('div');
    editor.className = 'table-editor';
    editor.setAttribute('aria-label', 'editor visual de tabla Markdown');

    const tools = document.createElement('div');
    tools.className = 'table-editor-tools';
    tools.setAttribute('role', 'toolbar');
    tools.setAttribute('aria-label', 'acciones de la tabla');

    const format = document.createElement('div');
    format.className = 'table-editor-tool-group';
    const formatWith = (marker: string): void => {
      if (activeInput === null) return;
      apply(resolveFormat(
        marker,
        activeInput.value,
        activeInput.selectionStart ?? 0,
        activeInput.selectionEnd ?? activeInput.value.length,
      ));
    };
    format.append(
      button('B', 'negrita en la celda', () => formatWith('**')),
      button('I', 'cursiva en la celda', () => formatWith('*')),
      button('</>', 'código en la celda', () => formatWith('`')),
      button('↗', 'enlace en la celda', () => {
        if (activeInput === null) return;
        apply(resolveLink(
          activeInput.value,
          activeInput.selectionStart ?? 0,
          activeInput.selectionEnd ?? activeInput.value.length,
        ));
      }),
    );

    const structure = document.createElement('div');
    structure.className = 'table-editor-tool-group';
    structure.append(
      button('+ fila', 'añadir fila después de la actual', () => {
        const after = active.row === 0 ? 0 : active.row;
        table.rows.splice(after, 0, Array.from({ length: table.header.length }, () => ''));
        dirty = true;
        active = { row: after + 1, column: active.column };
        render(active);
      }, { action: 'add-row' }),
      button('− fila', 'eliminar la fila actual', () => {
        if (active.row === 0) return;
        table.rows.splice(active.row - 1, 1);
        dirty = true;
        active = { row: Math.min(active.row, table.rows.length), column: active.column };
        render(active);
      }, { action: 'remove-row' }),
      button('+ columna', 'añadir columna después de la actual', () => {
        const at = active.column + 1;
        table.header.splice(at, 0, '');
        table.alignments.splice(at, 0, 'left');
        for (const row of table.rows) row.splice(at, 0, '');
        dirty = true;
        active = { row: active.row, column: at };
        render(active);
      }, { action: 'add-column' }),
      button('− columna', 'eliminar la columna actual', () => {
        if (table.header.length === 1) return;
        table.header.splice(active.column, 1);
        table.alignments.splice(active.column, 1);
        for (const row of table.rows) row.splice(active.column, 1);
        dirty = true;
        active = { row: active.row, column: Math.min(active.column, table.header.length - 1) };
        render(active);
      }, { action: 'remove-column' }),
    );

    const alignment = document.createElement('div');
    alignment.className = 'table-editor-tool-group table-editor-alignment';
    for (const [value, label, title] of [
      ['left', '≡←', 'alinear columna a la izquierda'],
      ['center', '≡', 'centrar columna'],
      ['right', '→≡', 'alinear columna a la derecha'],
    ] as const) {
      alignment.append(button(label, title, () => {
        table.alignments[active.column] = value;
        dirty = true;
        render(active);
      }, { align: value }));
    }
    const status = document.createElement('span');
    status.className = 'table-editor-status';
    status.setAttribute('aria-live', 'polite');
    tools.append(format, structure, alignment, status);

    const scroll = document.createElement('div');
    scroll.className = 'table-editor-scroll';
    const grid = document.createElement('table');
    grid.className = 'table-editor-grid';
    const thead = document.createElement('thead');
    const tbody = document.createElement('tbody');

    const appendRow = (values: string[], row: number, parent: HTMLTableSectionElement): void => {
      const tr = document.createElement('tr');
      values.forEach((value, column) => {
        const cell = document.createElement(row === 0 ? 'th' : 'td');
        cell.dataset['align'] = table.alignments[column] ?? 'left';
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'table-cell-input';
        input.value = value;
        input.spellcheck = true;
        input.dataset['row'] = String(row);
        input.dataset['column'] = String(column);
        input.setAttribute('aria-label', row === 0
          ? `encabezado, columna ${column + 1}`
          : `fila ${row}, columna ${column + 1}`);
        input.addEventListener('focus', () => updateActive(input));
        input.addEventListener('input', () => {
          rowAt(row)[column] = input.value;
          dirty = true;
        });
        input.addEventListener('paste', (event) => {
          const pasted = tabularClipboard(event.clipboardData?.getData('text/plain') ?? '');
          if (pasted === null) return;
          event.preventDefault();
          const neededColumns = column + Math.max(...pasted.map((one) => one.length));
          while (table.header.length < neededColumns) {
            table.header.push('');
            table.alignments.push('left');
            for (const held of table.rows) held.push('');
          }
          const neededRows = row + pasted.length - 1;
          while (table.rows.length < neededRows) {
            table.rows.push(Array.from({ length: table.header.length }, () => ''));
          }
          pasted.forEach((held, rowOffset) => held.forEach((content, columnOffset) => {
            rowAt(row + rowOffset)[column + columnOffset] = content;
          }));
          dirty = true;
          active = { row: row + pasted.length - 1, column: column + (pasted.at(-1)?.length ?? 1) - 1 };
          render(active);
        });
        input.addEventListener('keydown', (event) => {
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b') {
            event.preventDefault(); formatWith('**'); return;
          }
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'i') {
            event.preventDefault(); formatWith('*'); return;
          }
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
            event.preventDefault();
            apply(resolveLink(
              input.value,
              input.selectionStart ?? 0,
              input.selectionEnd ?? input.value.length,
            ));
            return;
          }
          if (event.key === 'Escape') {
            event.preventDefault(); event.stopPropagation(); void finish(); return;
          }
          if (event.key !== 'Tab' && event.key !== 'Enter') return;
          event.preventDefault();
          const totalRows = table.rows.length + 1;
          if (event.key === 'Enter') {
            let nextRow = row + 1;
            if (nextRow >= totalRows) {
              table.rows.push(Array.from({ length: table.header.length }, () => ''));
              dirty = true;
              nextRow = totalRows;
              active = { row: nextRow, column };
              render(active);
            } else focus({ row: nextRow, column });
            return;
          }
          let flat = row * table.header.length + column + (event.shiftKey ? -1 : 1);
          if (flat < 0) flat = 0;
          if (flat >= totalRows * table.header.length) {
            table.rows.push(Array.from({ length: table.header.length }, () => ''));
            dirty = true;
            active = { row: totalRows, column: 0 };
            render(active);
            return;
          }
          focus({ row: Math.floor(flat / table.header.length), column: flat % table.header.length }, true);
        });
        cell.append(input);
        tr.append(cell);
      });
      parent.append(tr);
    };

    appendRow(table.header, 0, thead);
    table.rows.forEach((row, index) => appendRow(row, index + 1, tbody));
    grid.append(thead, tbody);
    scroll.append(grid);

    const foot = document.createElement('div');
    foot.className = 'derived-source-foot table-editor-foot';
    const done = document.createElement('button');
    done.type = 'button';
    done.className = 'derived-source-toggle table-editor-done';
    done.innerHTML = icon('eye');
    done.title = 'guardar y ver tabla';
    done.setAttribute('aria-label', 'guardar y ver la tabla');
    done.addEventListener('mousedown', (event) => event.preventDefault());
    done.addEventListener('click', (event) => {
      event.stopPropagation();
      void finish();
    });
    foot.append(done);
    editor.append(tools, scroll, foot);
    body.append(editor);
    updateActive(body.querySelector<HTMLInputElement>(
      `.table-cell-input[data-row="${active.row}"][data-column="${active.column}"]`,
    )!);
    requestAnimationFrame(() => focus(nextFocus ?? active, true));
  };

  render(active);
}
