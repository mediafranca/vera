// La identidad operativa como una superficie navegable de sistema.
//
// No es una página del corpus: se deriva de participación, credenciales y
// registro. Una página semántica puede enlazarse explícitamente sin adquirir por
// eso permisos ni autoridad sobre la autoría histórica.

import type { ParticipantProfileView } from './api.ts';
import { participantActivityPath, participantProfilePath } from './activity-page.ts';

export { participantProfilePath };

export function participantProfileTitle(name: string): string {
  return `Participante:${name}`;
}

function fact(label: string, value: string): HTMLDivElement {
  const row = document.createElement('div');
  const term = document.createElement('dt');
  term.textContent = label;
  const description = document.createElement('dd');
  description.textContent = value;
  row.append(term, description);
  return row;
}

export function renderParticipantProfile(view: ParticipantProfileView): HTMLElement {
  const root = document.createElement('article');
  root.className = 'participant-profile';

  const header = document.createElement('header');
  header.className = 'participant-profile-header';
  const eyebrow = document.createElement('p');
  eyebrow.className = 'participant-profile-eyebrow';
  eyebrow.textContent = 'Identidad de sistema';
  const title = document.createElement('h1');
  title.textContent = participantProfileTitle(view.participant.name);
  const explanation = document.createElement('p');
  explanation.className = 'participant-profile-explanation';
  explanation.textContent = 'Identidad operativa de Vera. Esta ficha se deriva del sistema y no se edita como contenido.';
  header.append(eyebrow, title, explanation);

  const facts = document.createElement('dl');
  facts.className = 'participant-profile-facts';
  facts.append(
    fact('Naturaleza', view.participant.kind === 'agent' ? 'agente' : 'persona'),
    fact('Estado', view.participant.status === 'active' ? 'activo' : 'suspendido'),
    fact('Identidad estable', view.participant.id),
  );
  root.append(header, facts);

  if (view.aliases.length > 0 || view.nameHistory.length > 0) {
    const history = document.createElement('section');
    const historyTitle = document.createElement('h2'); historyTitle.textContent = 'Historia de identidad';
    const list = document.createElement('ul'); list.className = 'participant-profile-links';
    for (const alias of view.aliases) {
      const item = document.createElement('li');
      const when = alias.reconciliation === null ? ''
        : ` · reconciliada ${new Date(alias.reconciliation.reconciled_at).toLocaleString()}`;
      item.textContent = `${alias.historical?.name ?? 'Identidad histórica'} · ${alias.historical?.id ?? 'sin identificador'}${when}`;
      if (alias.reconciliation?.reason) item.title = alias.reconciliation.reason;
      list.append(item);
    }
    for (const change of view.nameHistory) {
      const item = document.createElement('li');
      item.textContent = `${change.formerName} → ${change.newName} · ${new Date(change.changedAt).toLocaleString()}`;
      list.append(item);
    }
    history.append(historyTitle, list); root.append(history);
  }

  const semantic = document.createElement('section');
  const semanticTitle = document.createElement('h2');
  semanticTitle.textContent = 'Identidad semántica';
  semantic.append(semanticTitle);
  if (view.semanticPages.length === 0) {
    const absent = document.createElement('p');
    absent.textContent = `No hay una página de contenido vinculada. La relación se declara allí con “identidad participante:: ${view.participant.id}”.`;
    semantic.append(absent);
  } else {
    const list = document.createElement('ul');
    list.className = 'participant-profile-links';
    for (const page of view.semanticPages) {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.href = `/p/${encodeURIComponent(page.id)}`;
      link.textContent = page.title;
      item.append(link);
      list.append(item);
    }
    semantic.append(list);
  }
  root.append(semantic);

  if (view.authorization !== null) {
    const authorization = document.createElement('section');
    const heading = document.createElement('h2');
    heading.textContent = 'Autoridad humana';
    authorization.append(heading);
    if (view.authorization.authorizedBy.length === 0) {
      const none = document.createElement('p');
      none.textContent = 'No hay una autorización humana registrada.';
      authorization.append(none);
    } else {
      const sentence = document.createElement('p');
      sentence.append('Autorizado por ');
      view.authorization.authorizedBy.forEach((person, index) => {
        if (index > 0) sentence.append(index === view.authorization!.authorizedBy.length - 1 ? ' y ' : ', ');
        const link = document.createElement('a');
        link.href = participantProfilePath(person.id);
        link.textContent = person.name;
        sentence.append(link);
      });
      sentence.append('.');
      authorization.append(sentence);
    }
    const credentials = document.createElement('p');
    credentials.className = 'participant-profile-credentials';
    credentials.textContent = `${view.authorization.credentials.active} credenciales activas · ${view.authorization.credentials.revoked} revocadas`;
    authorization.append(credentials);
    root.append(authorization);
  }

  const activity = document.createElement('section');
  const activityTitle = document.createElement('h2');
  activityTitle.textContent = 'Actividad';
  const activityLink = document.createElement('a');
  activityLink.className = 'participant-profile-activity';
  activityLink.href = participantActivityPath(view.participant.id);
  activityLink.textContent = 'Ver sus contribuciones en el registro canónico';
  activity.append(activityTitle, activityLink);
  root.append(activity);

  return root;
}
