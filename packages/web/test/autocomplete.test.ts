// La máquina de estados del autocompletado. Entra texto y cursor, sale qué está
// abierto y qué se busca.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  COMMANDS,
  actionOf,
  completionFor,
  detectTrigger,
  matchingCommands,
  queryOf,
  today,
  type Open,
} from '../src/autocomplete.ts';

describe('detectTrigger', () => {
  it('dos corchetes abren la búsqueda de páginas', () => {
    assert.deepEqual(detectTrigger('ver [[', 6), { trigger: 'pagina', queryStart: 6 });
  });

  it('dos paréntesis abren la de bloques', () => {
    assert.deepEqual(detectTrigger('ver ((', 6), { trigger: 'bloque', queryStart: 6 });
  });

  it('una almohadilla abre la de etiquetas', () => {
    assert.deepEqual(detectTrigger('sobre #', 7), { trigger: 'etiqueta', queryStart: 7 });
  });

  it('#[[ es una etiqueta, no una página', () => {
    // Es como se escribe una etiqueta que lleva espacios.
    assert.deepEqual(detectTrigger('#[[', 3), { trigger: 'etiqueta', queryStart: 3 });
  });

  it('una almohadilla pegada a una palabra no abre nada', () => {
    // Si no, `C#3` y cualquier ancla de URL abrirían una búsqueda.
    assert.equal(detectTrigger('C#', 2), null);
    assert.equal(detectTrigger('https://x.cl/a#', 15), null);
  });

  it('la barra abre comandos sólo donde podría empezar uno', () => {
    assert.deepEqual(detectTrigger('/', 1), { trigger: 'comando', queryStart: 1 });
    assert.deepEqual(detectTrigger('texto /', 7), { trigger: 'comando', queryStart: 7 });
    assert.equal(detectTrigger('ruta/', 5), null, 'una ruta lleva barras y no es un comando');
  });

  it('el texto corriente no abre nada', () => {
    assert.equal(detectTrigger('una frase normal', 16), null);
  });

  it('estar dentro de una referencia ya escrita también busca', () => {
    // El caso de corregir: se vuelve sobre un enlace mal escrito, se pone el
    // cursor dentro y tiene que ofrecer. Antes sólo se reconocía el instante
    // justo después de teclear el disparador, que es el que menos dura.
    assert.deepEqual(detectTrigger('ver [[Casi]]', 10), { trigger: 'pagina', queryStart: 6 });
    assert.deepEqual(detectTrigger('ver ((abc))', 9), { trigger: 'bloque', queryStart: 6 });
    assert.deepEqual(detectTrigger('#[[dos palabras]]', 6), { trigger: 'etiqueta', queryStart: 3 });
  });

  it('una referencia ya cerrada deja de buscar', () => {
    assert.equal(detectTrigger('ver [[Casiopea]] y más', 22), null);
  });

  it('un corchete de otra línea no abre nada', () => {
    // Sin el tope de la línea, cualquier `[[` huérfano del corpus convertiría el
    // resto del bloque en una consulta abierta.
    assert.equal(detectTrigger('ver [[\notra línea', 17), null);
  });
});

describe('queryOf', () => {
  const pagina: Open = { trigger: 'pagina', queryStart: 2 };

  it('es lo que hay entre el disparador y el cursor', () => {
    assert.equal(queryOf(pagina, '[[Trav', 6), 'Trav');
  });

  it('se cierra si el cursor sale por delante del disparador', () => {
    assert.equal(queryOf(pagina, '[[Trav', 1), null);
  });

  it('una página admite espacios', () => {
    assert.equal(queryOf(pagina, '[[Viaje a España', 16), 'Viaje a España');
  });

  it('una etiqueta no', () => {
    const etiqueta: Open = { trigger: 'etiqueta', queryStart: 1 };
    assert.equal(queryOf(etiqueta, '#uno dos', 8), null);
    assert.equal(queryOf(etiqueta, '#uno', 4), 'uno');
  });

  it('un comando tampoco', () => {
    const comando: Open = { trigger: 'comando', queryStart: 1 };
    assert.equal(queryOf(comando, '/cita algo', 10), null);
  });

  it('el corchete de cierre la termina', () => {
    assert.equal(queryOf(pagina, '[[Trav]]', 8), null);
  });

  it('un salto de línea la termina', () => {
    assert.equal(queryOf(pagina, '[[Trav\nmás', 10), null);
  });
});

describe('completionFor', () => {
  it('reemplaza el resto del título viejo al corregir desde dentro', () => {
    // Con el cursor en medio de `[[Casi|opea]]`, escribir el título entero tenía
    // que dejar una sola referencia y no `[[Casiopea]]opea]]`.
    assert.deepEqual(
      completionFor({ trigger: 'pagina', queryStart: 2 }, 'Casiopea', '[[Casiopea]]', 6),
      { buffer: '[[Casiopea]]', cursor: 12 },
    );
  });

  it('no se lleva por delante una referencia ajena', () => {
    assert.deepEqual(
      completionFor({ trigger: 'pagina', queryStart: 2 }, 'Uno', '[[U y [[Dos]]', 3),
      { buffer: '[[Uno]] y [[Dos]]', cursor: 7 },
    );
  });

  it('una página se escribe entre corchetes y salta el cierre que ya estaba', () => {
    // El autopar dejó `]]` delante del cursor; escribir otro daría `]]]]`.
    const open: Open = { trigger: 'pagina', queryStart: 2 };
    assert.deepEqual(completionFor(open, 'Travesías', '[[Trav]]', 6), {
      buffer: '[[Travesías]]',
      cursor: 13,
    });
  });

  it('un bloque hace lo mismo con paréntesis', () => {
    const open: Open = { trigger: 'bloque', queryStart: 2 };
    assert.deepEqual(completionFor(open, 'block:7', '((blo))', 5), {
      buffer: '((block:7))',
      cursor: 11,
    });
  });

  it('una etiqueta sin espacios va suelta', () => {
    const open: Open = { trigger: 'etiqueta', queryStart: 1 };
    assert.deepEqual(completionFor(open, 'diseño', '#dis', 4), {
      buffer: '#diseño',
      cursor: 7,
    });
  });

  it('una etiqueta con espacios necesita corchetes', () => {
    const open: Open = { trigger: 'etiqueta', queryStart: 1 };
    const result = completionFor(open, 'diseño de interacción', '#dis', 4);
    assert.equal(result.buffer, '#[[diseño de interacción]]');
  });

  it('un comando se come su propia barra', () => {
    // `/cita` tiene que dejar una cita, no `/> `.
    const open: Open = { trigger: 'comando', queryStart: 1 };
    assert.deepEqual(completionFor(open, 'cita', '/cit', 4), { buffer: '> ', cursor: 2 });
  });

  it('un comando deja el cursor donde se escribe', () => {
    const open: Open = { trigger: 'comando', queryStart: 1 };
    const result = completionFor(open, 'codigo', '/cod', 4);
    assert.equal(result.buffer, '```\n\n```');
    assert.equal(result.cursor, 4, 'dentro del cercado, no al final');
  });

  it('/hoy deja el día de hoy enlazado a su diario', () => {
    const open: Open = { trigger: 'comando', queryStart: 1 };
    const result = completionFor(open, 'hoy', '/ho', 3);

    // Enlace y no texto: dentro de un mes «hoy» sería falso y el enlace sigue
    // llevando al día en que se escribió.
    assert.equal(result.buffer, `[[${today()}]]`);
    assert.equal(result.cursor, result.buffer.length, 'queda terminado, no a medias');
  });

  it('/hoy se resuelve al usarse y no al definirse', () => {
    const open: Open = { trigger: 'comando', queryStart: 1 };
    const command = COMMANDS.find((entry) => entry.name === 'hoy');

    // Si fuese una constante, el día en que se cargó la aplicación se quedaría
    // pegado: quien deja Vera abierta toda la semana escribiría el lunes cada vez.
    assert.equal(typeof command?.inserts, 'function');
    assert.equal(completionFor(open, 'hoy', '/ho', 3).buffer, `[[${today()}]]`);
  });

  it('/fecha no escribe nada por sí solo', () => {
    const open: Open = { trigger: 'comando', queryStart: 1 };

    // Lo que deja es el sitio limpio: el día lo elige el calendario después, y
    // hasta que se elija no ha pasado nada.
    assert.deepEqual(completionFor(open, 'fecha', '/fec', 4), { buffer: '', cursor: 0 });
    assert.equal(actionOf('fecha'), 'elegir-fecha');
  });

  it('conserva lo que había alrededor', () => {
    // `[[` ocupa los índices 6 y 7, así que la consulta empieza en el 8.
    const open: Open = { trigger: 'pagina', queryStart: 8 };
    const result = completionFor(open, 'Otra', 'antes [[Ot]] después', 10);
    assert.equal(result.buffer, 'antes [[Otra]] después');
  });
});

describe('matchingCommands', () => {
  it('sin consulta agrupa el formato en una sola entrada', () => {
    assert.ok(matchingCommands('').length > 8);
    assert.ok(matchingCommands('').some((command) => command.name === 'formato'));
    assert.ok(!matchingCommands('').some((command) => command.name === 'titulo'));
  });

  it('filtra por nombre', () => {
    // «cita» encuentra también a `/zotero`, que dice servir para citar. Es lo
    // que se quiere: quien busca «cita» está buscando las dos cosas.
    assert.deepEqual(matchingCommands('cita').map((c) => c.name), ['formato', 'cita', 'zotero']);
  });

  it('filtra también por lo que hace', () => {
    assert.ok(matchingCommands('diagrama').some((c) => c.name === 'mermaid'));
    assert.ok(matchingCommands('wikitext').some((c) => c.name === 'mediawiki'));
  });

  it('una consulta que no encaja no ofrece nada', () => {
    assert.deepEqual(matchingCommands('zzzz'), []);
  });

  it('conserva accesibles los comandos de formato por su nombre', () => {
    assert.ok(matchingCommands('titulo').some((command) => command.name === 'titulo'));
  });

  it('ofrece los bloques ejecutables explícitos', () => {
    assert.deepEqual(
      matchingCommands('aislado').map((command) => command.name),
      ['html', 'svg', 'p5js'],
    );
  });

  it('ofrece plantillas portables para clips y mapas', () => {
    const clip = matchingCommands('fragmento de YouTube').find((command) => command.name === 'clip');
    const map = matchingCommands('mapa 2D').find((command) => command.name === 'mapa');
    assert.match(String(clip?.inserts), /desde: 00:00[\s\S]*hasta: 00:30/);
    assert.match(String(map?.inserts), /página: \[\[\]\][\s\S]*alcance: 2[\s\S]*alto: 640/);
  });
});
