// Cuánto lleva pasando lo que está pasando.
//
// Lo que se fija aquí es que el número no mienta: que no aparezca antes de que
// haya algo que esperar, que lo que se promete salga de lo medido y no de una
// invención, y que una espera rarísima no arrastre lo que se le dice a nadie las
// veinte veces siguientes.

import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';

/** Un almacenamiento de mentira: estas pruebas no corren en un navegador. */
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as unknown as Storage;

const { beginActivity, countInto, elapsedSaid, pendingLine, remember, saySeconds, usuallyTakes } = await import(
  '../src/waiting.ts'
);

beforeEach(() => store.clear());

describe('lo que suele tardar', () => {
  it('no se sabe hasta que se ha medido', () => {
    // Y mientras no se sabe, no se dice: inventar un «suele tardar» es
    // exactamente la clase de promesa que hace desconfiar de todas las demás.
    assert.equal(usuallyTakes('modelo'), null);
  });

  it('es la mediana y no la media', () => {
    /*
     * Una llamada que un día se fue a noventa segundos porque la máquina estaba
     * ocupada no debe cambiar lo que se promete las veinte veces siguientes. La
     * mediana la ignora; la media la arrastra.
     */
    for (const took of [20_000, 21_000, 19_000, 90_000, 20_500]) remember('modelo', took);
    assert.equal(usuallyTakes('modelo'), 20_500);
  });

  it('olvida lo viejo: lo que tardaba hace un mes ya no es esta máquina', () => {
    for (let n = 0; n < 12; n += 1) remember('modelo', 5_000);
    for (let n = 0; n < 7; n += 1) remember('modelo', 30_000);
    assert.equal(usuallyTakes('modelo'), 30_000);
  });

  it('lo instantáneo no se recuerda: no era una espera', () => {
    remember('rápido', 120);
    assert.equal(usuallyTakes('rápido'), null);
  });

  it('cada espera se recuerda por su cuenta', () => {
    remember('modelo', 20_000);
    remember('enlaces', 2_000);
    assert.equal(usuallyTakes('modelo'), 20_000);
    assert.equal(usuallyTakes('enlaces'), 2_000);
  });

  it('sin almacenamiento se sigue contando, sólo se pierde la memoria', () => {
    const held = globalThis.localStorage;
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: () => {
        throw new Error('no hay');
      },
      setItem: () => {
        throw new Error('no hay');
      },
    } as unknown as Storage;
    assert.doesNotThrow(() => remember('modelo', 20_000));
    assert.equal(usuallyTakes('modelo'), null);
    (globalThis as unknown as { localStorage: Storage }).localStorage = held;
  });
});

describe('lo que se lee de una espera en curso', () => {
  it('antes del umbral no se dice nada: lo que tarda menos de un segundo no tarda', () => {
    assert.equal(elapsedSaid(300, 'modelo'), '');
    assert.equal(elapsedSaid(899, 'modelo'), '');
  });

  it('pasado el umbral, el número que subió', () => {
    assert.equal(elapsedSaid(6_000, null), '6 s');
  });

  it('y lo que suele tardar, cuando se ha medido', () => {
    for (const took of [20_000, 20_000, 20_000]) remember('modelo', took);
    assert.equal(elapsedSaid(6_000, 'modelo'), '6 s · suele tardar ~20 s');
  });

  it('pero se calla en cuanto deja de ser cierto', () => {
    /*
     * Repetir «suele tardar 20 s» en el segundo cuarenta es la máquina insistiendo
     * en algo que ya no pasa, y quien mira lo lee como burla. A partir de ahí sólo
     * queda el número, que es lo que hay.
     */
    for (const took of [20_000, 20_000, 20_000]) remember('modelo', took);
    assert.equal(elapsedSaid(40_000, 'modelo'), '40 s');
  });

  it('una espera sin nombre se cuenta igual, sólo que no se recuerda', () => {
    // Contar no puede equivocarse —el tiempo pasó— y nombrar sí.
    assert.equal(elapsedSaid(6_000, null), '6 s');
  });
});

describe('contar dentro de un elemento', () => {
  /** Lo mínimo de un elemento que `countInto` toca. Aquí no hay navegador. */
  function fake(): HTMLElement & { classes: Set<string> } {
    const classes = new Set<string>();
    return {
      textContent: '',
      classes,
      classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c) },
    } as unknown as HTMLElement & { classes: Set<string> };
  }

  it('al empezar sólo dice qué se espera, sin número', () => {
    const element = fake();
    const counting = countInto(element, 'transcribiendo…', 'voz', { now: () => 1_000, since: 1_000 });
    assert.equal(element.textContent, 'transcribiendo…');
    counting.close();
  });

  it('y pasado el umbral, qué se espera y cuánto lleva', () => {
    const element = fake();
    let at = 1_000;
    const counting = countInto(element, 'transcribiendo…', null, { now: () => at, since: 1_000 });
    at = 7_000;
    assert.equal(counting.elapsed(), 6_000);
    counting.close();
  });

  it('cuenta desde que empezó el trabajo y no desde que se pintó el aviso', () => {
    /*
     * Lo que se espera de una página empieza a esperarse al pedirla. Contando desde
     * el aviso, una espera de cuatro segundos se anunciaría como de tres, y la que
     * Vera recordara sería la que no ocurrió.
     */
    const element = fake();
    const counting = countInto(element, '', null, { now: () => 5_000, since: 1_000 });
    assert.equal(counting.elapsed(), 4_000);
    counting.close();
  });

  it('lo que falló no se recuerda: fallar rápido no es ser rápido', () => {
    /*
     * Si perder la conexión al segundo tres contara como una medida, unas cuantas
     * caídas convencerían a Vera de que el modelo contesta en tres segundos, y se
     * lo prometería a quien mire.
     */
    const element = fake();
    let at = 1_000;
    const counting = countInto(element, 'transcribiendo…', 'voz:falla', {
      now: () => at,
      since: 1_000,
    });
    at = 4_000;
    counting.close('failed');
    assert.equal(usuallyTakes('voz:falla'), null);
  });

  it('cambiar de paso después de un fallo tampoco lo recuerda como éxito', () => {
    const made = (): HTMLElement => ({
      textContent: '',
      className: '',
      classList: { add() {}, remove() {} },
      append() {},
      remove() {},
    }) as unknown as HTMLElement;
    const held = globalThis.document;
    (globalThis as unknown as { document: Document }).document = {
      documentElement: { dataset: {} },
      createElement: () => made(),
    } as unknown as Document;
    const host = { append() {} } as unknown as HTMLElement;
    let now = 0;
    const pending = pendingLine(host, () => now);
    pending.say('preguntando', 'modelo');
    now = 2_000;
    pending.say('el servidor sigue trabajando', null, 'failed');
    assert.equal(usuallyTakes('modelo'), null);
    pending.close();
    if (held === undefined) delete (globalThis as unknown as { document?: Document }).document;
    else (globalThis as unknown as { document: Document }).document = held;
  });

  it('lo que sí salió bien queda medido', () => {
    const element = fake();
    let at = 1_000;
    const counting = countInto(element, 'transcribiendo…', 'voz:bien', { now: () => at, since: 1_000 });
    at = 21_000;
    counting.close();
    assert.equal(usuallyTakes('voz:bien'), 20_000);
  });

  it('al cerrarse deja de escribir en el elemento', () => {
    // Una espera que sobrevive a su trabajo es la peor mentira disponible.
    const element = fake();
    const counting = countInto(element, 'preguntando…', null, { now: () => 1_000, since: 1_000 });
    assert.ok(element.classes.has('counting'));
    counting.close();
    assert.ok(!element.classes.has('counting'));
  });
});

describe('conciencia periférica del trabajo', () => {
  it('cada actividad se cierra una sola vez', () => {
    const close = beginActivity();
    assert.doesNotThrow(() => { close(); close(); });
  });
});

describe('decir un tiempo', () => {
  it('en segundos mientras quepan', () => {
    assert.equal(saySeconds(900), '1 s');
    assert.equal(saySeconds(20_400), '20 s');
    assert.equal(saySeconds(59_000), '59 s');
  });

  it('y en minutos cuando ya no', () => {
    // «94 s» obliga a dividir mentalmente; nadie mide una espera larga así.
    assert.equal(saySeconds(94_000), '1 min 34 s');
    assert.equal(saySeconds(120_000), '2 min');
  });
});
