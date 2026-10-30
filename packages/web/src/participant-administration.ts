// Padrón y gobierno de las identidades operativas de Vera.
//
// Es una superficie de sistema: las filas se derivan de las fuentes canónicas
// y los actos cambian identidad y autoridad, nunca una biografía del corpus.

import { api, type ParticipantIdentityView } from './api.ts';
import { participantProfilePath } from './activity-page.ts';

function button(label: string, action: () => void, className = ''): HTMLButtonElement {
  const control = document.createElement('button');
  control.type = 'button'; control.textContent = label; control.className = className;
  control.onclick = action;
  return control;
}

function summary(one: ParticipantIdentityView): string {
  const credentials = one.credentials.active + one.credentials.revoked;
  return `${one.activity} operaciones · ${credentials} credenciales · ${one.activeSessions} sesiones activas · ${one.permissions} permisos`;
}

function participantDialog(title: string, body: HTMLElement[], accept: string,
  submit: () => Promise<void>): HTMLDialogElement {
  const dialog = document.createElement('dialog'); dialog.className = 'participant-dialog';
  const form = document.createElement('form'); form.method = 'dialog';
  const heading = document.createElement('h2'); heading.textContent = title;
  const actions = document.createElement('div'); actions.className = 'participant-dialog-actions';
  const cancel = document.createElement('button'); cancel.value = 'cancel'; cancel.textContent = 'Cancelar';
  const confirm = document.createElement('button'); confirm.type = 'button'; confirm.className = 'primary'; confirm.textContent = accept;
  confirm.onclick = () => void (async () => {
    confirm.disabled = true;
    try { await submit(); dialog.close(); }
    catch (error) { alert(error instanceof Error ? error.message : 'No se pudo completar la acción.'); confirm.disabled = false; }
  })();
  actions.append(cancel, confirm); form.append(heading, ...body, actions); dialog.append(form);
  dialog.addEventListener('close', () => dialog.remove()); document.body.append(dialog); dialog.showModal();
  return dialog;
}

export async function renderParticipantAdministration(host: HTMLElement): Promise<void> {
  host.replaceChildren();
  const root = document.createElement('article'); root.className = 'participant-administration';
  const header = document.createElement('header'); header.className = 'special-page-header';
  const title = document.createElement('h1'); title.textContent = 'Participantes';
  const back = button('← Volver', () => window.history.back()); header.append(title, back);
  const introduction = document.createElement('p'); introduction.className = 'participant-administration-intro';
  introduction.textContent = 'Padrón de identidades humanas y agentes. Las credenciales, sesiones, permisos y roles pertenecen a una identidad; no crean otra.';
  const roleAdministration = document.createElement('p'); roleAdministration.className = 'participant-administration-related';
  const roleLink = document.createElement('a'); roleLink.href = '/personas'; roleLink.textContent = 'Administrar roles e invitaciones de la instancia';
  roleAdministration.append(roleLink);
  const status = document.createElement('p'); status.className = 'settings-note'; status.textContent = 'Leyendo el padrón…';
  const body = document.createElement('div'); body.className = 'participant-administration-body';
  root.append(header, introduction, roleAdministration, status, body); host.append(root);

  let people: ParticipantIdentityView[];
  try { people = (await api.participants()).participants; }
  catch (error) { status.textContent = error instanceof Error ? error.message : 'No se pudo leer el padrón.'; return; }
  status.textContent = `${people.length} identidades canónicas · ${people.filter((one) => one.kind === 'human').length} personas · ${people.filter((one) => one.kind === 'agent').length} agentes`;

  const tools = document.createElement('section'); tools.className = 'participant-administration-tools';
  const search = document.createElement('input'); search.type = 'search'; search.placeholder = 'Buscar participante';
  search.setAttribute('aria-label', 'Buscar participante');
  const kind = document.createElement('select'); kind.setAttribute('aria-label', 'Filtrar por naturaleza');
  for (const [value, label] of [['', 'Todos'], ['human', 'Personas'], ['agent', 'Agentes']] as const) {
    const option = document.createElement('option'); option.value = value; option.textContent = label; kind.append(option);
  }
  const declare = button('Declarar participante', () => {
    const name = document.createElement('input'); name.placeholder = 'Nombre'; name.autocomplete = 'name';
    const nature = document.createElement('select');
    for (const [value, label] of [['human', 'Persona'], ['agent', 'Agente']] as const) {
      const option = document.createElement('option'); option.value = value; option.textContent = label; nature.append(option);
    }
    participantDialog('Declarar identidad', [name, nature], 'Declarar', async () => {
      if (name.value.trim() === '') throw new Error('la identidad necesita un nombre');
      await api.declareParticipant(name.value.trim(), nature.value as 'human' | 'agent');
      await renderParticipantAdministration(host);
    });
    name.focus();
  }, 'primary');
  tools.append(search, kind, declare); body.append(tools);

  const list = document.createElement('div'); list.className = 'participant-directory'; body.append(list);
  const draw = (): void => {
    list.replaceChildren();
    const term = search.value.trim().toLocaleLowerCase();
    const visible = people.filter((one) => (kind.value === '' || one.kind === kind.value) &&
      (term === '' || one.name.toLocaleLowerCase().includes(term) || one.id.toLocaleLowerCase().includes(term)));
    for (const one of visible) {
      const card = document.createElement('section'); card.className = 'participant-directory-card';
      const identity = document.createElement('div'); identity.className = 'participant-directory-identity';
      const heading = document.createElement('h2');
      const profile = document.createElement('a'); profile.href = participantProfilePath(one.id); profile.textContent = one.name; heading.append(profile);
      const badges = document.createElement('p'); badges.className = 'participant-directory-badges';
      for (const word of [one.kind === 'human' ? 'persona' : 'agente', one.status === 'active' ? 'activo' : 'suspendido', ...one.roles]) {
        const badge = document.createElement('span'); badge.textContent = word; badges.append(badge);
      }
      const facts = document.createElement('p'); facts.className = 'participant-directory-summary'; facts.textContent = summary(one);
      identity.append(heading, badges, facts);
      if (one.aliases.length > 0) {
        const aliases = document.createElement('p'); aliases.className = 'settings-note';
        aliases.textContent = `Identidades históricas: ${one.aliases.map((alias) => alias.name).join(', ')}`; identity.append(aliases);
      }
      const actions = document.createElement('div'); actions.className = 'participant-directory-actions';
      actions.append(button('Renombrar', () => {
        const name = document.createElement('input'); name.value = one.name;
        participantDialog(`Renombrar ${one.name}`, [name], 'Guardar nombre', async () => {
          if (name.value.trim() === '') throw new Error('el nombre no puede quedar vacío');
          await api.renameParticipant(one.id, name.value.trim()); await renderParticipantAdministration(host);
        }); name.select();
      }));
      const candidates = people.filter((candidate) => candidate.id !== one.id && candidate.kind === one.kind);
      if (candidates.length > 0) actions.append(button('Fusionar…', () => {
        const explanation = document.createElement('p'); explanation.textContent = 'La identidad elegida será la canónica. Esta fila quedará como alias histórico; no se reescribe ni borra autoría.';
        const target = document.createElement('select');
        for (const candidate of candidates) { const option = document.createElement('option'); option.value = candidate.id; option.textContent = candidate.name; target.append(option); }
        const reason = document.createElement('textarea'); reason.placeholder = 'Razón de la fusión';
        participantDialog(`Fusionar ${one.name}`, [explanation, target, reason], 'Confirmar fusión', async () => {
          if (reason.value.trim() === '') throw new Error('la fusión necesita una razón auditable');
          await api.reconcileParticipant(one.id, target.value, reason.value.trim()); await renderParticipantAdministration(host);
        });
      }));
      if (one.status === 'active' && !one.roles.includes('root_custodian')) actions.append(button('Suspender', () => {
        const warning = document.createElement('p'); warning.textContent = 'Se revocarán sus accesos activos. La identidad y toda su historia seguirán visibles.';
        participantDialog(`Suspender ${one.name}`, [warning], 'Suspender accesos', async () => {
          await api.suspendParticipant(one.id); await renderParticipantAdministration(host);
        });
      }));
      if (one.canErase) actions.append(button('Eliminar identidad vacía', () => {
        const warning = document.createElement('p'); warning.textContent = `Vera comprobó que esta identidad no tiene autoría, operaciones, exposiciones, decisiones ni reconciliaciones. Se retirarán también ${one.credentials.active + one.credentials.revoked} credenciales, ${one.activeSessions} sesiones activas, ${one.permissions} permisos y sus matrículas o invitaciones de acceso. Esta eliminación es definitiva.`;
        participantDialog(`Eliminar ${one.name}`, [warning], 'Eliminar definitivamente', async () => {
          await api.eraseParticipant(one.id); await renderParticipantAdministration(host);
        });
      }, 'danger'));
      else if (!one.roles.includes('root_custodian')) {
        const retained = document.createElement('p'); retained.className = 'participant-directory-retained';
        retained.textContent = `No se puede borrar: conserva ${one.retainedBy.join(', ') || 'historia'}.`;
        actions.append(retained);
      }
      card.append(identity, actions); list.append(card);
    }
    if (visible.length === 0) { const empty = document.createElement('p'); empty.textContent = 'Ningún participante coincide.'; list.append(empty); }
  };
  search.oninput = draw; kind.onchange = draw; draw();
}
