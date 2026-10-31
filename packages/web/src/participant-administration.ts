// Padrón y gobierno de las identidades operativas de Vera.
//
// Las personas son la autoridad humana. Los agentes aparecen en una faceta
// propia y nombran siempre a su principal. Cada gesto se proyecta primero en
// esta vista y se concilia después con el servidor, conservando foco y scroll.

import { api, type ParticipantIdentityView } from './api.ts';
import { participantProfilePath } from './activity-page.ts';

type ParticipantKind = ParticipantIdentityView['kind'];

function button(label: string, action: () => void, className = ''): HTMLButtonElement {
  const control = document.createElement('button');
  control.type = 'button'; control.textContent = label; control.className = className;
  control.onclick = action;
  return control;
}

function summary(one: ParticipantIdentityView): string {
  const credentials = one.credentials.active + one.credentials.revoked;
  const said = (amount: number, singular: string, plural = `${singular}s`): string =>
    `${amount} ${amount === 1 ? singular : plural}`;
  return `${said(one.activity, 'operación', 'operaciones')} · ${said(credentials, 'credencial', 'credenciales')} · ${said(one.activeSessions, 'sesión activa', 'sesiones activas')} · ${said(one.permissions, 'permiso')}`;
}

function participantDialog(
  title: string,
  body: HTMLElement[],
  accept: string,
  submit: () => void,
  validate?: () => string | null,
): HTMLDialogElement {
  const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const dialog = document.createElement('dialog'); dialog.className = 'participant-dialog';
  const form = document.createElement('form'); form.method = 'dialog';
  const heading = document.createElement('h2'); heading.textContent = title;
  const actions = document.createElement('div'); actions.className = 'participant-dialog-actions';
  const cancel = document.createElement('button'); cancel.value = 'cancel'; cancel.textContent = 'Cancelar';
  const confirm = document.createElement('button'); confirm.type = 'button'; confirm.className = 'primary'; confirm.textContent = accept;
  confirm.onclick = () => {
    const issue = validate?.() ?? null;
    if (issue !== null) { alert(issue); return; }
    dialog.close(); submit();
  };
  actions.append(cancel, confirm); form.append(heading, ...body, actions); dialog.append(form);
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (returnTo?.isConnected === true) returnTo.focus({ preventScroll: true });
  });
  document.body.append(dialog); dialog.showModal();
  return dialog;
}

const copyDirectory = (people: ParticipantIdentityView[]): ParticipantIdentityView[] =>
  structuredClone(people);

export async function renderParticipantAdministration(host: HTMLElement): Promise<void> {
  host.replaceChildren();
  const root = document.createElement('article'); root.className = 'participant-administration';
  const header = document.createElement('header'); header.className = 'special-page-header';
  const title = document.createElement('h1'); title.textContent = 'Participantes';
  const back = button('← Volver', () => window.history.back()); header.append(title, back);
  const introduction = document.createElement('p'); introduction.className = 'participant-administration-intro';
  introduction.textContent = 'Las personas gobiernan su presencia y su trabajo. Cada agente depende de una persona principal, que define su constitución, sus alcances y su continuidad.';
  const roleAdministration = document.createElement('p'); roleAdministration.className = 'participant-administration-related';
  const roleLink = document.createElement('a'); roleLink.href = '/personas'; roleLink.textContent = 'Administrar roles e invitaciones de la instancia';
  roleAdministration.append(roleLink);
  const status = document.createElement('p'); status.className = 'settings-note'; status.textContent = 'Leyendo el padrón…';
  const body = document.createElement('div'); body.className = 'participant-administration-body';
  root.append(header, introduction, roleAdministration, status, body); host.append(root);

  let people: ParticipantIdentityView[];
  try { people = (await api.participants()).participants; }
  catch (error) { status.textContent = error instanceof Error ? error.message : 'No se pudo leer el padrón.'; return; }

  let activeKind: ParticipantKind = 'human';
  const facets = document.createElement('nav'); facets.className = 'participant-facets';
  facets.setAttribute('aria-label', 'Clases de participantes');
  const tools = document.createElement('section'); tools.className = 'participant-administration-tools';
  const search = document.createElement('input'); search.type = 'search'; search.placeholder = 'Buscar participante';
  search.setAttribute('aria-label', 'Buscar participante');
  const declare = button('', () => openDeclaration(), 'primary');
  tools.append(search, declare);
  const list = document.createElement('div'); list.className = 'participant-directory';
  body.append(facets, tools, list);

  const redraw = (focusParticipant?: string, focusAction?: string): void => {
    const scroll = document.scrollingElement?.scrollTop ?? 0;
    drawFacets(); draw();
    requestAnimationFrame(() => {
      window.scrollTo({ top: scroll });
      if (focusParticipant !== undefined && focusAction !== undefined) {
        list.querySelector<HTMLButtonElement>(
          `[data-participant="${CSS.escape(focusParticipant)}"] [data-action="${CSS.escape(focusAction)}"]`,
        )?.focus({ preventScroll: true });
      }
    });
  };

  const commit = <T>(
    apply: () => void,
    request: () => Promise<T>,
    accept: (result: T) => void = () => undefined,
    focusParticipant?: string,
    focusAction?: string,
  ): void => {
    const before = copyDirectory(people);
    apply(); redraw(focusParticipant, focusAction);
    void request().then((result) => {
      accept(result); redraw(focusParticipant, focusAction);
    }).catch((error: unknown) => {
      people = before; redraw(focusParticipant, focusAction);
      alert(error instanceof Error ? error.message : 'No se pudo completar la acción.');
    });
  };

  const replace = (participant: ParticipantIdentityView): void => {
    const index = people.findIndex((one) => one.id === participant.id);
    if (index >= 0) people[index] = participant;
    else people.push(participant);
  };

  function openDeclaration(): void {
    const name = document.createElement('input');
    name.placeholder = activeKind === 'human' ? 'Nombre de la persona' : 'Nombre del agente';
    name.autocomplete = activeKind === 'human' ? 'name' : 'off';
    const principal = document.createElement('select');
    principal.setAttribute('aria-label', 'Principal humano del agente');
    for (const human of people.filter((one) => one.kind === 'human' && one.status === 'active')) {
      const option = document.createElement('option'); option.value = human.id; option.textContent = human.name; principal.append(option);
    }
    const contents: HTMLElement[] = [name];
    if (activeKind === 'agent') {
      const explanation = document.createElement('p'); explanation.className = 'settings-note';
      explanation.textContent = 'El agente actúa bajo la autoridad de una persona principal.';
      contents.push(explanation, principal);
    }
    participantDialog(
      activeKind === 'human' ? 'Declarar persona' : 'Declarar agente',
      contents,
      'Declarar',
      () => {
        const heldKind = activeKind;
        const heldName = name.value.trim();
        const heldPrincipal = heldKind === 'agent' ? principal.value : undefined;
        const temporary = `local:${crypto.randomUUID()}`;
        const principalView = heldPrincipal === undefined ? null : people.find((one) => one.id === heldPrincipal) ?? null;
        commit(
          () => people.push({
            id: temporary, name: heldName, kind: heldKind, status: 'active', canonical: temporary,
            aliases: [], roles: [], activity: 0, credentials: { active: 0, revoked: 0 },
            activeSessions: 0, authenticators: 0, permissions: 0, canErase: true, retainedBy: [],
            principal: principalView === null ? null : {
              id: principalView.id, name: principalView.name, status: principalView.status,
            },
          }),
          () => api.declareParticipant(heldName, heldKind, heldPrincipal),
          ({ participant }) => {
            people = people.filter((one) => one.id !== temporary);
            replace(participant);
          },
          temporary,
          'rename',
        );
      },
      () => name.value.trim() === '' ? 'La identidad necesita un nombre.'
        : activeKind === 'agent' && principal.value === '' ? 'Un agente necesita un principal humano.' : null,
    );
    name.focus();
  }

  const drawFacets = (): void => {
    facets.replaceChildren();
    for (const [value, label] of [['human', 'Personas'], ['agent', 'Agentes']] as const) {
      const amount = people.filter((one) => one.kind === value).length;
      const control = button(`${label} · ${amount}`, () => {
        activeKind = value; search.value = ''; redraw();
      }, value === activeKind ? 'participant-facet selected' : 'participant-facet');
      control.setAttribute('aria-pressed', String(value === activeKind));
      facets.append(control);
    }
  };

  const action = (
    participant: string,
    name: string,
    label: string,
    run: () => void,
    className = '',
  ): HTMLButtonElement => {
    const control = button(label, run, className); control.dataset['action'] = name;
    control.setAttribute('aria-label', `${label}: ${people.find((one) => one.id === participant)?.name ?? participant}`);
    return control;
  };

  const draw = (): void => {
    list.replaceChildren();
    declare.textContent = activeKind === 'human' ? 'Declarar persona' : 'Declarar agente';
    const term = search.value.trim().toLocaleLowerCase();
    const visible = people.filter((one) => one.kind === activeKind &&
      (term === '' || one.name.toLocaleLowerCase().includes(term) || one.id.toLocaleLowerCase().includes(term)));
    status.textContent = activeKind === 'human'
      ? `${visible.length} personas · autoridad humana y presencia propia`
      : `${visible.length} agentes · cada agente responde ante su principal humano`;

    for (const one of visible) {
      const card = document.createElement('section'); card.className = 'participant-directory-card';
      card.dataset['participant'] = one.id;
      const identity = document.createElement('div'); identity.className = 'participant-directory-identity';
      const heading = document.createElement('h2');
      const profile = document.createElement('a'); profile.href = participantProfilePath(one.id); profile.textContent = one.name; heading.append(profile);
      const relation = document.createElement('p'); relation.className = 'participant-directory-relation';
      if (one.kind === 'agent') {
        relation.textContent = one.principal === null
          ? 'Necesita una persona principal para recibir constitución y autoridad.'
          : `Principal humano · ${one.principal.name}`;
      } else {
        const governed = people.filter((agent) => agent.kind === 'agent' && agent.principal?.id === one.id);
        relation.textContent = governed.length === 0
          ? 'Presencia humana · todavía sin agentes constituidos.'
          : `Agentes bajo su gobierno · ${governed.map((agent) => agent.name).join(', ')}`;
      }
      const badges = document.createElement('p'); badges.className = 'participant-directory-badges';
      for (const word of [one.status === 'active' ? 'activo' : 'suspendido', ...one.roles]) {
        const badge = document.createElement('span'); badge.textContent = word; badges.append(badge);
      }
      const facts = document.createElement('p'); facts.className = 'participant-directory-summary'; facts.textContent = summary(one);
      identity.append(heading, relation, badges, facts);
      if (one.kind === 'human') {
        const continuity = document.createElement('p'); continuity.className = 'participant-directory-continuity';
        const passkeys = `${one.authenticators} ${one.authenticators === 1 ? 'passkey' : 'passkeys'}`;
        continuity.textContent = one.activeSessions > 0
          ? `${passkeys} · su sesión puede abrir el QR para añadir otro dispositivo`
          : `${passkeys} · el QR aparece dentro de su propia sesión humana`;
        identity.append(continuity);
      }
      if (one.aliases.length > 0) {
        const aliases = document.createElement('p'); aliases.className = 'settings-note';
        aliases.textContent = `Identidades históricas: ${one.aliases.map((alias) => alias.name).join(', ')}`; identity.append(aliases);
      }

      const actions = document.createElement('div'); actions.className = 'participant-directory-actions';
      actions.append(action(one.id, 'rename', 'Renombrar', () => {
        const name = document.createElement('input'); name.value = one.name;
        participantDialog(`Renombrar ${one.name}`, [name], 'Guardar nombre', () => {
          const next = name.value.trim();
          if (next === one.name) { redraw(one.id, 'rename'); return; }
          commit(
            () => { one.name = next; },
            () => api.renameParticipant(one.id, next),
            ({ participant }) => replace(participant),
            one.id,
            'rename',
          );
        }, () => name.value.trim() === '' ? 'El nombre necesita texto.' : null);
        name.select();
      }));

      const candidates = people.filter((candidate) => candidate.id !== one.id && candidate.kind === one.kind);
      if (candidates.length > 0) actions.append(action(one.id, 'merge', 'Fusionar…', () => {
        const explanation = document.createElement('p'); explanation.textContent = 'La identidad elegida será la canónica. Esta fila quedará como alias histórico y la autoría conserva su procedencia.';
        const target = document.createElement('select');
        for (const candidate of candidates) {
          const option = document.createElement('option'); option.value = candidate.id; option.textContent = candidate.name; target.append(option);
        }
        const reason = document.createElement('textarea'); reason.placeholder = 'Razón de la fusión';
        participantDialog(`Fusionar ${one.name}`, [explanation, target, reason], 'Confirmar fusión', () => {
          const targetId = target.value; const destination = people.find((candidate) => candidate.id === targetId)!;
          commit(
            () => {
              people = people.filter((candidate) => candidate.id !== one.id);
              destination.aliases.push({ id: one.id, name: one.name, status: 'suspended' });
            },
            () => api.reconcileParticipant(one.id, targetId, reason.value.trim()),
            () => undefined,
            targetId,
            'rename',
          );
        }, () => reason.value.trim() === '' ? 'La fusión necesita una razón auditable.' : null);
      }));

      if (one.status === 'active' && !one.roles.includes('root_custodian')) actions.append(action(one.id, 'suspend', 'Suspender', () => {
        const warning = document.createElement('p'); warning.textContent = 'La suspensión revoca sus accesos activos y conserva su identidad e historia.';
        participantDialog(`Suspender ${one.name}`, [warning], 'Suspender accesos', () => {
          commit(
            () => {
              one.status = 'suspended'; one.credentials.active = 0;
              one.activeSessions = 0; one.authenticators = 0; one.permissions = 0;
            },
            () => api.suspendParticipant(one.id),
            ({ participant }) => replace(participant),
          );
        });
      }));

      if (one.canErase) actions.append(action(one.id, 'erase', 'Eliminar identidad vacía', () => {
        const warning = document.createElement('p');
        warning.textContent = `Vera comprobó que esta identidad carece de autoría, operaciones, exposiciones, decisiones y reconciliaciones. La eliminación retira también ${one.credentials.active + one.credentials.revoked} credenciales, ${one.activeSessions} sesiones activas y ${one.permissions} permisos.`;
        participantDialog(`Eliminar ${one.name}`, [warning], 'Eliminar definitivamente', () => {
          commit(
            () => { people = people.filter((candidate) => candidate.id !== one.id); },
            () => api.eraseParticipant(one.id),
          );
        });
      }, 'danger'));
      else if (!one.roles.includes('root_custodian')) {
        const retained = document.createElement('p'); retained.className = 'participant-directory-retained';
        retained.textContent = `Conserva ${one.retainedBy.join(', ') || 'historia'}.`;
        actions.append(retained);
      }
      card.append(identity, actions); list.append(card);
    }
    if (visible.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = term === ''
        ? `Todavía no hay ${activeKind === 'human' ? 'personas' : 'agentes'}.`
        : 'Ningún participante coincide.';
      list.append(empty);
    }
  };

  search.oninput = draw;
  redraw();
}
