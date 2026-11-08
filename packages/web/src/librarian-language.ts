// El oficio y quien lo ocupa no son el mismo nombre.
//
// «Agente de biblioteca» nombra la institución dentro de Vera. Cuando una
// persona pide, espera o conversa, se encuentra con el participante efectivo:
// Lucienne, Aster o quien ocupe el oficio en ese momento.

export interface LibrarianActor {
  name: string;
  subject: string;
  object: string;
  queueOwner: string;
  requestLabel: string;
  kicker: string;
}

export function librarianActor(effectiveName?: string | null): LibrarianActor {
  const held = effectiveName?.trim() ?? '';
  if (held === '') {
    return {
      name: 'Agente de biblioteca',
      subject: 'El agente de biblioteca',
      object: 'el agente de biblioteca',
      queueOwner: 'del agente de biblioteca',
      requestLabel: 'Solicitar al agente de biblioteca',
      kicker: 'Vera · agente de biblioteca',
    };
  }
  return {
    name: held,
    subject: held,
    object: held,
    queueOwner: `de ${held}`,
    requestLabel: `Solicitar a ${held}`,
    kicker: `${held} · agente de biblioteca`,
  };
}
