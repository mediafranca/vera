// Constitución y estado efectivo del agente de biblioteca de esta Vera.
//
// Esta superficie no edita una personalidad paralela: elige páginas reales del
// corpus, construye una proyección versionada y decide qué revisión puede leer
// el runtime. Los secretos y la ejecución permanecen fuera.

import {
  api,
  type AgentAdministrationView,
  type ConstitutionRole,
  type LibrarianRuntimePermission,
  type LibrarianRuntimeView,
  type PageSummary,
  type TerritoryAdministrationView,
  type TerritoryPermission,
} from './api.ts';
import { configurationField, createConfigurationSurface } from './configuration-surface.ts';

function announceLibrarianIdentity(librarian: { agent: string; name: string } | null): void {
  if (librarian === null) return;
  document.dispatchEvent(new CustomEvent('vera:librarian-identity', {
    detail: { id: librarian.agent, name: librarian.name },
  }));
}

const ROLE_LABELS: Record<ConstitutionRole, string> = {
  identity: 'Identidad', purpose: 'Propósito', practice: 'Práctica', memory: 'Memoria', governance: 'Gobierno',
};

function control(label: string, action: () => Promise<void> | void, className = ''): HTMLButtonElement {
  const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
  button.className = className;
  button.onclick = () => void (async () => {
    button.disabled = true;
    try { await action(); } catch (error) { alert(error instanceof Error ? error.message : 'No se pudo completar.'); }
    finally { if (button.isConnected) button.disabled = false; }
  })();
  return button;
}

function sourceEditor(agent: AgentAdministrationView, refresh: () => Promise<void>): HTMLElement {
  const section = document.createElement('section'); section.className = 'agent-constitution-sources';
  const heading = document.createElement('h2'); heading.textContent = 'Páginas constitutivas';
  const explanation = document.createElement('p'); explanation.className = 'settings-note';
  explanation.textContent = `Páginas canónicas y editables que constituyen a ${agent.agent.name}; conservan enlaces, autoría, visibilidad e historia.`;
  const rows = document.createElement('div'); rows.className = 'agent-source-rows';
  const selected = new Map(agent.sources.map((source) => [source.page, source.role]));
  const selectedPages = agent.sources.map((source) => ({ id: source.page, title: source.title } as PageSummary));
  let choices = selectedPages;
  let pageCatalogue: Promise<PageSummary[]> | null = null;
  const loadChoices = async (): Promise<PageSummary[]> => {
    pageCatalogue ??= api.pages().then((pages) => [...pages].sort((a, b) => a.title.localeCompare(b.title, 'es')));
    choices = await pageCatalogue; return choices;
  };
  const rowFor = (page: PageSummary, chosenRole: ConstitutionRole): void => {
    const row = document.createElement('div'); row.className = 'agent-source-row';
    row.dataset['page'] = page.id;
    const title = document.createElement('a'); title.href = `/p/${encodeURIComponent(page.title)}`;
    title.textContent = page.title; title.className = 'agent-source-title';
    const role = document.createElement('select'); role.dataset['page'] = page.id;
    for (const [value, label] of Object.entries(ROLE_LABELS) as Array<[ConstitutionRole, string]>) {
      const option = document.createElement('option'); option.value = value; option.textContent = label;
      option.selected = chosenRole === value; role.append(option);
    }
    const remove = control('Quitar', () => { selected.delete(page.id); row.remove(); });
    remove.setAttribute('aria-label', `Quitar ${page.title} de la constitución`);
    row.append(title, role, remove); rows.append(row);
  };
  for (const source of agent.sources) {
    const page = choices.find((one) => one.id === source.page);
    if (page !== undefined) rowFor(page, source.role);
  }

  const finder = document.createElement('div'); finder.className = 'agent-source-finder';
  const search = document.createElement('input'); search.type = 'search';
  search.placeholder = 'buscar una página de Vera';
  search.setAttribute('aria-label', `Añadir página a ${agent.agent.name}`);
  const offered = document.createElement('div'); offered.className = 'agent-source-offered'; offered.hidden = true;
  const suggest = async (): Promise<void> => {
    offered.replaceChildren();
    const query = search.value.trim().toLocaleLowerCase('es');
    if (query.length < 2) { offered.hidden = true; return; }
    await loadChoices();
    if (search.value.trim().toLocaleLowerCase('es') !== query) return;
    const matches = choices.filter((page) => !selected.has(page.id) &&
      page.title.toLocaleLowerCase('es').includes(query)).slice(0, 12);
    for (const page of matches) {
      offered.append(control(page.title, () => {
        selected.set(page.id, 'practice'); rowFor(page, 'practice'); search.value = ''; offered.hidden = true;
      }));
    }
    offered.hidden = matches.length === 0;
  };
  search.addEventListener('input', () => { void suggest(); });
  finder.append(search, offered);
  const save = control('Guardar constitución', async () => {
    const sources = [...rows.querySelectorAll<HTMLElement>('.agent-source-row')].map((row) => ({
      page: row.dataset['page'] ?? '',
      role: row.querySelector<HTMLSelectElement>('select')?.value as ConstitutionRole,
    }));
    await api.setAgentConstitution(agent.agent.id, sources); await refresh();
  }, 'primary');
  section.append(heading, explanation, rows, finder, save); return section;
}

function manifestHistory(agent: AgentAdministrationView, refresh: () => Promise<void>): HTMLElement {
  const section = document.createElement('section'); section.className = 'agent-manifest-history';
  const heading = document.createElement('h2'); heading.textContent = 'Manifiestos';
  const explanation = document.createElement('p'); explanation.className = 'settings-note';
  explanation.textContent = 'Las páginas constitutivas son las fuentes vivas y editables. Un manifiesto es su compilación versionada e inmutable: el runtime carga una versión concreta y puede volver a una anterior.';
  const actions = document.createElement('div'); actions.className = 'agent-manifest-actions';
  actions.append(control('Construir borrador', async () => { await api.buildAgentManifest(agent.agent.id); await refresh(); }, 'primary'));
  const list = document.createElement('ol');
  for (const manifest of agent.manifests) {
    const item = document.createElement('li');
    const details = document.createElement('details'); details.className = 'agent-manifest';
    const summary = document.createElement('summary');
    const label = document.createElement('strong');
    label.textContent = `Versión ${manifest.version} · ${manifest.status}`;
    const when = document.createElement('time'); when.dateTime = new Date(manifest.createdAt).toISOString();
    when.textContent = new Date(manifest.createdAt).toLocaleString('es-CL');
    summary.append(label, when); details.append(summary);
    const digest = document.createElement('code'); digest.textContent = manifest.digest;
    const digestLabel = document.createElement('p'); digestLabel.append('Huella: ', digest); details.append(digestLabel);
    const sources = document.createElement('ul'); sources.className = 'agent-manifest-sources';
    for (const source of manifest.sources ?? []) {
      const sourceItem = document.createElement('li');
      const link = document.createElement('a'); link.href = `/p/${encodeURIComponent(source.title)}`; link.textContent = source.title;
      const meta = document.createElement('span'); meta.textContent = `${ROLE_LABELS[source.role]} · revisión ${source.revision}`;
      sourceItem.append(link, meta); sources.append(sourceItem);
    }
    details.append(sources); item.append(details);
    if (manifest.status !== 'active' && manifest.status !== 'failed') {
        details.append(control(manifest.status === 'superseded' ? 'Volver a esta versión' : 'Activar', async () => {
        await api.activateAgentManifest(agent.agent.id, manifest.id); await refresh();
      }));
    }
    list.append(item);
  }
  if (agent.manifests.length === 0) {
    const empty = document.createElement('p'); empty.className = 'settings-note';
    empty.textContent = 'Aún no existe una revisión portable.'; section.append(heading, explanation, actions, empty); return section;
  }
  section.append(heading, explanation, actions, list); return section;
}

function runtimeState(agent: AgentAdministrationView): HTMLElement {
  const section = document.createElement('section'); section.className = 'agent-runtime-state';
  const heading = document.createElement('h2'); heading.textContent = 'Ejecuciones observadas · sólo lectura';
  const explanation = document.createElement('p'); explanation.className = 'settings-note';
  explanation.textContent = `Los recibos son dos caminos de ejecución de ${agent.agent.name}: el runtime interno de Vera y el agente externo de OpenClaw. Vera no confunde activación con ejecución. Cotito no es un runtime de ${agent.agent.name}: es otro participante y sólo puede aparecer como posible sucesor del oficio.`;
  section.append(heading, explanation);
  if (agent.runtimes.length === 0) {
    const empty = document.createElement('p'); empty.className = 'agent-runtime-empty';
    empty.textContent = 'Sin recibo del runtime'; section.append(empty); return section;
  }
  const list = document.createElement('ul'); list.className = 'agent-runtime-list';
  for (const receipt of agent.runtimes) {
    const item = document.createElement('li');
    const identity = document.createElement('strong'); identity.textContent = receipt.runtime.label;
    const state = document.createElement('span');
    state.className = `agent-runtime-badge is-${receipt.alignment} is-${receipt.status}`;
    state.textContent = receipt.alignment === 'divergent'
      ? `divergente · v${receipt.manifest.version}`
      : receipt.status === 'ready' ? `al día · v${receipt.manifest.version}` : `${receipt.status} · v${receipt.manifest.version}`;
    const when = document.createElement('time'); when.dateTime = new Date(receipt.reportedAt).toISOString();
    when.textContent = new Date(receipt.reportedAt).toLocaleString('es-CL');
    item.append(identity, state, when);
    if (receipt.detail !== null) {
      const detail = document.createElement('p'); detail.textContent = receipt.detail; item.append(detail);
    }
    list.append(item);
  }
  section.append(list); return section;
}

interface DesktopLibrarianSecretBridge {
  status(): Promise<{ available: boolean; secureStorage: boolean }>;
  save(input: { apiKey: string; endpoint: string; model: string }): Promise<{ available: boolean }>;
  clear(): Promise<{ available: boolean }>;
}

function field(label: string, input: HTMLInputElement | HTMLSelectElement): HTMLLabelElement {
  return configurationField(label, input, 'effective');
}

async function runtimeConfigurationPanel(view: LibrarianRuntimeView, refresh: () => Promise<void>): Promise<HTMLElement> {
  const section = document.createElement('section'); section.className = 'agent-runtime-configuration';
  const heading = document.createElement('h2'); heading.textContent = 'Runtime del agente de biblioteca';
  const status = document.createElement('p'); status.className = `agent-runtime-badge is-${view.status}`;
  status.textContent = ({
    unconstituted: 'Sin constituir', stopped: 'Detenido', ready: 'Listo',
    degraded: 'Configuración incompleta', working: 'Trabajando',
  } as Record<LibrarianRuntimeView['status'], string>)[view.status];
  section.append(heading, status);

  if (view.harness !== null) {
    const catalogue = document.createElement('section'); catalogue.className = 'librarian-tool-catalogue';
    const title = document.createElement('h2');
    title.textContent = `Catálogo del harness · sólo lectura · ${view.harness.version.replace('vera-librarian-harness:', 'v')}`;
    const note = document.createElement('p'); note.className = 'settings-note';
    note.textContent = 'Esta lista describe las capacidades de la revisión activa; no se editan desde aquí. Extenderlas exige implementar, probar y activar una nueva revisión del harness. El territorio y las aprobaciones siguen gobernando cada uso.';
    const list = document.createElement('ul');
    for (const capability of view.harness.capabilities) {
      const item = document.createElement('li');
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      const name = document.createElement('strong'); name.textContent = capability.title;
      const mode = document.createElement('span');
      mode.textContent = capability.approval === 'confirm_each_call'
        ? 'confirmación en cada aplicación'
        : capability.projectedToModel ? 'disponible durante la conversación' : 'parte del oficio del runtime';
      summary.append(name, mode); details.append(summary);
      const metadata = document.createElement('p');
      metadata.textContent = `${capability.name} · revisión ${capability.revision} · ${capability.readOnly ? 'lectura' : capability.destructive ? 'puede retirar contenido' : capability.mutatesCorpus ? 'puede escribir' : 'propone sin escribir'}`;
      const input = document.createElement('p'); input.textContent = `Entrada: ${capability.input}`;
      details.append(metadata, input); item.append(details); list.append(item);
    }
    catalogue.append(title, note, list); section.append(catalogue);
  }

  if (view.librarian === null) {
    const explanation = document.createElement('p'); explanation.className = 'settings-note';
    explanation.textContent = 'Esta biblioteca precede al nombre inicial. Constituir el oficio crea el agente, su vínculo con la persona dueña, el harness y un manifiesto inicial editable.';
    const name = document.createElement('input'); name.value = 'Lucienne'; name.required = true;
    section.append(explanation, field('Nombre inicial', name), control('Constituir agente de biblioteca', async () => {
      const next = await api.constituteLibrarianRuntime(name.value);
      announceLibrarianIdentity(next.librarian);
      await refresh();
    }, 'primary'));
    return section;
  }

  const identity = document.createElement('section'); identity.className = 'agent-runtime-identity';
  const identityHeading = document.createElement('h2'); identityHeading.textContent = 'Identidad y oficio';
  const identityNote = document.createElement('p'); identityNote.className = 'settings-note';
  identityNote.textContent = 'Lucienne es sólo el nombre inicial. Cambiarlo conserva el oficio, la constitución, el harness, el territorio y la historia del participante.';
  const identityForm = document.createElement('form'); identityForm.className = 'agent-runtime-identity-form';
  const participantName = document.createElement('input'); participantName.value = view.librarian.name;
  participantName.className = 'agent-name-input';
  participantName.required = true; participantName.minLength = 2; participantName.autocomplete = 'off';
  const saveName = control('Guardar nombre', async () => {
    const renamed = await api.renameParticipant(view.librarian!.agent, participantName.value.trim());
    announceLibrarianIdentity({ agent: renamed.participant.id, name: renamed.participant.name });
    await refresh();
  }, 'primary');
  identityForm.onsubmit = (event) => { event.preventDefault(); saveName.click(); };
  identityForm.append(field('Nombre', participantName), saveName);
  identity.append(identityHeading, identityNote, identityForm);
  const designation = document.createElement('section'); designation.className = 'agent-runtime-identity agent-runtime-designation';
  const designationHeading = document.createElement('h3'); designationHeading.textContent = 'Designación';
  const designationNote = document.createElement('p'); designationNote.className = 'settings-note';
  designationNote.textContent = 'Designar a otro agente cambia quién ocupa el oficio. No transfiere conversaciones, manifiestos, autoría, credenciales ni territorio; cada identidad conserva su historia.';
  designation.append(designationHeading, designationNote);
  if (view.eligible.length === 0) {
    const unavailable = document.createElement('p'); unavailable.className = 'settings-note';
    unavailable.textContent = 'No hay otro agente activo, con la misma persona principal y un manifiesto vigente, que pueda ser designado.';
    designation.append(unavailable);
  } else {
    const designationForm = document.createElement('form'); designationForm.className = 'agent-runtime-identity-form';
    const successor = document.createElement('select');
    for (const candidate of view.eligible) {
      const option = document.createElement('option'); option.value = candidate.agent; option.textContent = candidate.name;
      successor.append(option);
    }
    const designate = control('Designar agente', async () => {
      const candidate = view.eligible.find((one) => one.agent === successor.value);
      if (candidate === undefined) return;
      const accepted = confirm(`¿Designar a ${candidate.name} como agente de biblioteca en reemplazo de ${view.librarian!.name}? Las identidades y sus historias permanecerán separadas.`);
      if (!accepted) return;
      const next = await api.designateLibrarianRuntime(candidate.agent);
      announceLibrarianIdentity(next.librarian);
      await refresh();
    }, 'primary');
    designationForm.onsubmit = (event) => { event.preventDefault(); designate.click(); };
    designationForm.append(field('Agente sucesor', successor), designate);
    designation.append(designationForm);
  }
  const prior = view.history.filter((entry) => entry.status === 'replaced');
  if (prior.length > 0) {
    const priorHeading = document.createElement('h4'); priorHeading.textContent = 'Ocupantes anteriores';
    const priorList = document.createElement('ul'); priorList.className = 'librarian-occupant-history';
    for (const entry of prior) {
      const item = document.createElement('li');
      const when = new Date(entry.designatedAt).toLocaleDateString('es-CL');
      item.textContent = `${entry.name} · designado ${when}`; priorList.append(item);
    }
    designation.append(priorHeading, priorList);
  }
  identity.append(designation); section.append(identity);

  const config = view.configuration;
  if (config === null) {
    const missing = document.createElement('p'); missing.className = 'settings-note';
    missing.textContent = 'El agente de biblioteca existe, pero su runtime aún no tiene configuración.';
    section.append(missing); return section;
  }
  const modelCatalog = await api.processingModels().catch(() => ({ models: [] }));
  const form = document.createElement('form'); form.className = 'agent-runtime-form';
  const adapter = document.createElement('select');
  for (const [value, label] of [
    ['external_agent', 'OpenClaw · harness Codex'],
    ['embedded_model', 'Vera · modelo embebido'],
  ] as const) {
    const option = document.createElement('option'); option.value = value; option.textContent = label;
    option.selected = config.adapter === value; adapter.append(option);
  }
  const externalAgent = document.createElement('input'); externalAgent.value = config.externalAgent ?? '';
  externalAgent.placeholder = 'lucienne';
  const model = document.createElement('input'); model.value = config.model ?? '';
  model.placeholder = 'openai:gpt-5.6-sol, anthropic:… o google:…'; model.setAttribute('list', 'librarian-models');
  const models = document.createElement('datalist'); models.id = 'librarian-models';
  for (const offered of modelCatalog.models) {
    const option = document.createElement('option'); option.value = offered.id;
    option.label = `${offered.name} · ${offered.location === 'external' ? 'externo' : 'en este equipo'}`;
    models.append(option);
  }
  const endpoint = document.createElement('input'); endpoint.type = 'url';
  endpoint.value = config.endpoint ?? ''; endpoint.placeholder = 'https://api.openai.com/v1';
  const reference = document.createElement('input'); reference.value = config.secretReference ?? 'VERA_LIBRARIAN_API_KEY';
  reference.pattern = '[A-Z][A-Z0-9_]{2,63}';
  const enabled = document.createElement('input'); enabled.type = 'checkbox'; enabled.checked = config.enabled;
  const dialectic = document.createElement('input'); dialectic.type = 'checkbox'; dialectic.checked = config.dialectic.enabled;
  const routine = document.createElement('input'); routine.type = 'checkbox'; routine.checked = config.routine.enabled;
  const hour = document.createElement('input'); hour.type = 'number'; hour.min = '0'; hour.max = '23';
  hour.value = String(config.routine.hour);
  const contextBudget = document.createElement('input'); contextBudget.type = 'number';
  contextBudget.min = '8000'; contextBudget.max = '60000'; contextBudget.step = '1000';
  contextBudget.value = String(config.context.budgetCharacters);
  const contextDepth = document.createElement('input'); contextDepth.type = 'number';
  contextDepth.min = '0'; contextDepth.max = '2'; contextDepth.value = String(config.context.neighbourDepth);
  const contextSearch = document.createElement('input'); contextSearch.type = 'number';
  contextSearch.min = '0'; contextSearch.max = '20'; contextSearch.value = String(config.context.searchLimit);
  const key = document.createElement('input'); key.type = 'password'; key.autocomplete = 'new-password';
  key.placeholder = view.secret.available ? 'clave guardada; deja vacío para conservarla' : 'clave de inferencia';
  const desktop = (window as unknown as { veraLibrarianSecret?: DesktopLibrarianSecretBridge }).veraLibrarianSecret;
  if (desktop === undefined) key.hidden = true;

  const permissionList = document.createElement('fieldset');
  const legend = document.createElement('legend'); legend.textContent = 'Permisos del runtime'; permissionList.append(legend);
  const permissionControls = new Map<LibrarianRuntimePermission, HTMLInputElement>();
  const labels: Record<LibrarianRuntimePermission, string> = {
    read_request_context: 'Leer el contexto que la persona envía',
    reply: 'Responder en la conversación y en la página',
    daily_round: 'Ejecutar la ronda bibliotecaria',
  };
  for (const permission of Object.keys(labels) as LibrarianRuntimePermission[]) {
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox';
    checkbox.checked = config.permissions.includes(permission); permissionControls.set(permission, checkbox);
    const label = document.createElement('label'); label.append(checkbox, document.createTextNode(labels[permission]));
    permissionList.append(label);
  }
  const activeLabel = document.createElement('label'); activeLabel.append(enabled, document.createTextNode('Runtime activo'));
  const dialecticLabel = document.createElement('label');
  dialecticLabel.append(dialectic, document.createTextNode('Dialéctica bibliotecaria activa'));
  const dialecticNote = document.createElement('p'); dialecticNote.className = 'settings-note';
  dialecticNote.textContent = `Ante una delegación de lectura o juicio, ${view.librarian.name} pide primero una tentativa. La persona puede franquear ese umbral de forma explícita.`;
  const routineLabel = document.createElement('label'); routineLabel.append(routine, document.createTextNode('Ronda diaria activa'));
  const contract = document.createElement('section'); contract.className = 'agent-runtime-contract';
  const contractHeading = document.createElement('h3'); contractHeading.textContent = 'Contrato de respuesta';
  const contractText = document.createElement('p'); contractText.className = 'settings-note';
  contractText.textContent = 'Cada turno recibe la página y el bloque de origen, más una vecindad y búsqueda acotadas de la biblioteca. La respuesta separa el recibo breve de los bloques nativos y declara si es de Lucienne, Herbert por Lucienne, Lucienne a partir de Herbert o Herbert con Lucienne.';
  contract.append(contractHeading, contractText);
  const effective = document.createElement('p'); effective.className = 'settings-note agent-runtime-effective';
  const describeEffectiveRuntime = (): void => {
    const target = adapter.value === 'external_agent'
      ? `OpenClaw · agente ${externalAgent.value.trim() || 'sin elegir'} · harness Codex`
      : 'Vera · inferencia embebida';
    effective.textContent = `Configuración efectiva: ${target} · proveedor/modelo ${model.value.trim() || 'sin elegir'}. No existe fallback implícito.`;
    externalAgent.closest('label')?.toggleAttribute('hidden', adapter.value !== 'external_agent');
  };
  adapter.addEventListener('change', describeEffectiveRuntime);
  externalAgent.addEventListener('input', describeEffectiveRuntime);
  model.addEventListener('input', describeEffectiveRuntime);
  form.append(
    models, field('Runtime de ejecución', adapter), field('Agente de OpenClaw', externalAgent),
    field('Proveedor y modelo', model), field('Endpoint de inferencia (sólo modo embebido)', endpoint),
    field('Referencia del secreto', reference), field('Clave (sólo Desktop)', key),
    effective, contract, field('Presupuesto de contexto (caracteres)', contextBudget),
    field('Profundidad de vecindad', contextDepth), field('Resultados de búsqueda', contextSearch),
    permissionList, activeLabel, dialecticLabel, dialecticNote, routineLabel, field('Hora local de la ronda', hour),
  );
  describeEffectiveRuntime();
  form.append(control('Guardar configuración', async () => {
    if (desktop !== undefined && key.value.trim() !== '') {
      await desktop.save({ apiKey: key.value, endpoint: endpoint.value, model: model.value });
    }
    await api.configureLibrarianRuntime({
      enabled: enabled.checked,
      adapter: adapter.value === 'external_agent' ? 'external_agent' : 'embedded_model',
      externalAgent: adapter.value === 'external_agent' ? externalAgent.value.trim() || null : null,
      model: model.value.trim() || null,
      endpoint: endpoint.value.trim() || null,
      secretReference: reference.value.trim() || null,
      permissions: [...permissionControls].filter(([, box]) => box.checked).map(([permission]) => permission),
      dialectic: { enabled: dialectic.checked },
      routine: { enabled: routine.checked, hour: Number(hour.value), timezone: 'local' },
      context: {
        budgetCharacters: Number(contextBudget.value), neighbourDepth: Number(contextDepth.value),
        searchLimit: Number(contextSearch.value),
      },
    });
    await refresh();
  }, 'primary'));
  if (config.enabled && config.permissions.includes('daily_round')) {
    form.append(control('Ejecutar ronda ahora', async () => { await api.runLibrarianRoutine(); await refresh(); }));
  }
  section.append(form);

  const history = document.createElement('ol'); history.className = 'agent-runtime-runs';
  const elapsed = (milliseconds: number | null): string => milliseconds === null ? '—' : `${(milliseconds / 1000).toFixed(1)} s`;
  for (const run of view.runs.slice(0, 8)) {
    const item = document.createElement('li');
    const label = document.createElement('strong'); label.textContent = run.kind === 'request' ? 'Solicitud' : 'Ronda';
    const meta = document.createElement('span');
    meta.textContent = ` · ${run.agent.name} · ${run.status} · ${new Date(run.startedAt).toLocaleString('es-CL')} · ${run.model}`;
    item.append(label, meta);
    if (run.kind === 'request') {
      const timing = document.createElement('p'); timing.className = 'settings-note';
      timing.textContent = `Cola ${elapsed(run.queueMilliseconds)} · trabajo ${elapsed(run.workMilliseconds)} · total ${elapsed(run.totalMilliseconds)}`;
      item.append(timing);
    }
    if (run.error !== null) { const error = document.createElement('p'); error.textContent = run.error; item.append(error); }
    else if (run.output !== null) { const output = document.createElement('p'); output.textContent = run.output; item.append(output); }
    history.append(item);
  }
  if (view.runs.length > 0) section.append(history);
  return section;
}

const TERRITORY_PERMISSIONS: Array<[TerritoryPermission, string]> = [
  ['read', 'leer'], ['contribute', 'contribuir'], ['edit', 'editar'],
  ['publish', 'publicar'], ['administer', 'administrar'],
];

function territoryPanel(
  view: TerritoryAdministrationView,
  refresh: () => Promise<void>,
  participant: string,
  participantName: string,
): HTMLElement {
  const section = document.createElement('section'); section.className = 'territory-administration';
  const heading = document.createElement('h2'); heading.textContent = `Territorio de ${participantName}`;
  const note = document.createElement('p'); note.className = 'settings-note';
  note.textContent = 'El territorio se aplica por igual al sitio, la API y MCP. Una exclusión domina cualquier inclusión; la persona dueña conserva la custodia salvo que otra persona humana quede a cargo.';
  section.append(heading, note);
  const policies = view.policies.filter((policy) => policy.participant === participant);
  for (const policy of policies) {
    const card = document.createElement('details'); card.className = 'territory-policy';
    card.id = `territorio-${policy.participant}`;
    if (policy.participantKind === 'agent') card.open = true;
    const summary = document.createElement('summary');
    const title = document.createElement('strong'); title.textContent = policy.participantName;
    const kind = document.createElement('span');
    kind.textContent = `${policy.participantKind === 'agent' ? 'agente' : 'persona'} · ${policy.mode === 'all' ? 'toda la biblioteca' : 'selección'}`;
    summary.append(title, kind); card.append(summary);
    const form = document.createElement('div'); form.className = 'territory-form';
    const mode = document.createElement('select');
    for (const [value, label] of [['selected', 'Superficies seleccionadas'], ['all', 'Toda la biblioteca']] as const) {
      const option = document.createElement('option'); option.value = value; option.textContent = label;
      option.selected = policy.mode === value; mode.append(option);
    }
    const general = document.createElement('input'); general.type = 'checkbox'; general.checked = policy.includeGeneral;
    const generalLabel = document.createElement('label');
    generalLabel.append(general, document.createTextNode(' Incluir páginas de la biblioteca general'));
    form.append(field('Alcance base', mode), generalLabel);

    const rows = document.createElement('div'); rows.className = 'territory-surfaces';
    for (const surface of view.surfaces) {
      const existing = policy.rules.find((rule) => rule.kind === surface.kind && rule.surface === surface.id);
      const row = document.createElement('div'); row.className = 'territory-surface';
      row.dataset['kind'] = surface.kind; row.dataset['surface'] = surface.id;
      const identity = document.createElement('div');
      const name = document.createElement('strong'); name.textContent = surface.name;
      const meta = document.createElement('span');
      meta.textContent = `${surface.kind === 'shared' ? 'espacio compartido' : 'sitio público'} · ${surface.pages.length} páginas`;
      identity.append(name, meta);
      const disposition = document.createElement('select'); disposition.className = 'territory-disposition';
      for (const [value, label] of [['inherit', 'Sin regla'], ['included', 'Incluida'], ['excluded', 'Excluida']] as const) {
        const option = document.createElement('option'); option.value = value; option.textContent = label;
        option.selected = (existing?.disposition ?? 'inherit') === value; disposition.append(option);
      }
      const permissions = document.createElement('fieldset');
      for (const [permission, label] of TERRITORY_PERMISSIONS) {
        const box = document.createElement('input'); box.type = 'checkbox'; box.value = permission;
        box.checked = existing?.permissions.includes(permission) ?? (permission !== 'administer');
        const held = document.createElement('label'); held.append(box, document.createTextNode(label));
        permissions.append(held);
      }
      const sync = (): void => {
        for (const box of permissions.querySelectorAll<HTMLInputElement>('input')) {
          box.disabled = disposition.value !== 'included';
        }
      };
      disposition.addEventListener('change', sync); sync();
      row.append(identity, disposition, permissions); rows.append(row);
    }
    form.append(rows, control('Guardar territorio', async () => {
      const rules = [...rows.querySelectorAll<HTMLElement>('.territory-surface')].flatMap((row) => {
        const disposition = row.querySelector<HTMLSelectElement>('.territory-disposition')?.value ?? 'inherit';
        if (disposition === 'inherit') return [];
        return [{
          kind: row.dataset['kind'] as 'shared' | 'public', surface: row.dataset['surface'] ?? '',
          disposition: disposition as 'included' | 'excluded',
          permissions: disposition === 'included'
            ? [...row.querySelectorAll<HTMLInputElement>('fieldset input:checked')].map((box) => box.value as TerritoryPermission)
            : [],
        }];
      });
      await api.updateTerritory(policy.participant, {
        mode: mode.value as 'selected' | 'all', includeGeneral: general.checked, rules,
      });
      await refresh();
    }, 'primary'));
    card.append(form); section.append(card);
  }
  if (policies.length === 0) {
    const pending = document.createElement('p'); pending.className = 'settings-note';
    pending.textContent = 'Pendiente · este agente todavía no tiene una política territorial propia.';
    section.append(pending);
  }
  return section;
}

export async function renderAgentAdministration(host: HTMLElement): Promise<void> {
  const { root, title, introduction, body } = createConfigurationSurface(host, {
    title: 'Agente de biblioteca',
    introduction: 'Agente de biblioteca es un oficio singular de esta Vera. Su nombre y sus prácticas son editables; el modelo y el runtime pueden cambiar sin reemplazar su identidad.',
    className: 'agent-administration',
  });
  const boundary = root.querySelector<HTMLElement>('.configuration-surface-boundary');
  if (boundary !== null) boundary.textContent = 'Esta administración ocupa una página completa porque no es una página del corpus ni tiene un nodo focal para el mapa. Las páginas constitutivas enlazadas abajo sí conservan mapa, procedencia, historia y edición.';
  const status = document.createElement('p'); status.className = 'agent-administration-loading'; status.textContent = 'Cargando identidad, constitución y runtimes…';
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  body.classList.add('agent-administration-body'); body.append(status);

  const refresh = async (): Promise<void> => renderAgentAdministration(host);
  try {
    const [{ agents }, runtime, territories] = await Promise.all([
      api.agentAdministration(), api.librarianRuntime(), api.territories(),
    ]);
    const requested = new URL(window.location.href).searchParams.get('participante');
    const participant = requested ?? runtime.librarian?.agent ?? null;
    const agent = participant === null ? null : agents.find((one) => one.agent.id === participant) ?? null;
    const librarianMode = requested === null;
    const embeddedRuntime = librarianMode ? await runtimeConfigurationPanel(runtime, refresh) : null;

    if (agent === null) {
      status.textContent = librarianMode
        ? 'El agente de biblioteca aún no está constituido.'
        : 'El agente solicitado no existe o ya no está activo.';
      if (embeddedRuntime !== null) body.append(embeddedRuntime);
      return;
    }

    title.textContent = librarianMode ? `${agent.agent.name} · Agente de biblioteca` : `${agent.agent.name} · Agente`;
    introduction.textContent = librarianMode
      ? 'Identidad, constitución, harness, runtime y territorio del único agente de biblioteca activo de esta Vera.'
      : 'Constitución y territorio de este participante agente. El agente de biblioteca se administra en su panel singular.';
    status.className = 'settings-note agent-principal';
    status.textContent = agent.human === null ? 'Sin principal humano' : `Principal humano · ${agent.human.name}`;
    if (agent.human === null) {
      const warning = document.createElement('p'); warning.className = 'participant-directory-retained';
      warning.textContent = 'Pendiente · este agente necesita un principal humano antes de recibir constitución.';
      body.append(warning);
      if (embeddedRuntime !== null) body.append(embeddedRuntime);
      body.append(territoryPanel(territories, refresh, agent.agent.id, agent.agent.name));
      return;
    }
    const identity = embeddedRuntime?.querySelector<HTMLElement>(':scope > .agent-runtime-identity') ?? null;
    const tools = embeddedRuntime?.querySelector<HTMLElement>(':scope > .librarian-tool-catalogue') ?? null;
    const runs = embeddedRuntime?.querySelector<HTMLOListElement>(':scope > .agent-runtime-runs') ?? null;
    if (identity !== null) body.append(identity);
    body.append(sourceEditor(agent, refresh), manifestHistory(agent, refresh));
    if (embeddedRuntime !== null) body.append(embeddedRuntime, runtimeState(agent));
    body.append(territoryPanel(territories, refresh, agent.agent.id, agent.agent.name));
    if (tools !== null) body.append(tools);
    if (runs !== null) {
      const activity = document.createElement('section'); activity.className = 'agent-runtime-activity';
      const heading = document.createElement('h2'); heading.textContent = 'Actividad reciente';
      activity.append(heading, runs); body.append(activity);
    }
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : 'No se pudo leer la administración de agentes.';
  }
}
