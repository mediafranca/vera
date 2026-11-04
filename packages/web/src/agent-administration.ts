// Constitución y estado efectivo de los bibliotecarios de esta Vera.
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

function sourceEditor(agent: AgentAdministrationView, pages: PageSummary[], refresh: () => Promise<void>): HTMLElement {
  const section = document.createElement('section'); section.className = 'agent-constitution-sources';
  const heading = document.createElement('h3'); heading.textContent = 'Páginas constitutivas';
  const explanation = document.createElement('p'); explanation.className = 'settings-note';
  explanation.textContent = `Páginas canónicas y editables que constituyen a ${agent.agent.name}; conservan enlaces, autoría, visibilidad e historia.`;
  const rows = document.createElement('div'); rows.className = 'agent-source-rows';
  const selected = new Map(agent.sources.map((source) => [source.page, source.role]));
  const choices = [...pages].sort((a, b) => a.title.localeCompare(b.title, 'es'));
  const rowFor = (page: PageSummary, chosenRole: ConstitutionRole): void => {
    const row = document.createElement('label'); row.className = 'agent-source-row';
    row.dataset['page'] = page.id;
    const title = document.createElement('span'); title.textContent = page.title;
    const open = document.createElement('a'); open.href = `/p/${encodeURIComponent(page.title)}`;
    open.textContent = 'Abrir y editar'; open.className = 'agent-source-open';
    const role = document.createElement('select'); role.dataset['page'] = page.id;
    for (const [value, label] of Object.entries(ROLE_LABELS) as Array<[ConstitutionRole, string]>) {
      const option = document.createElement('option'); option.value = value; option.textContent = label;
      option.selected = chosenRole === value; role.append(option);
    }
    const remove = control('Quitar', () => { selected.delete(page.id); row.remove(); });
    remove.setAttribute('aria-label', `Quitar ${page.title} de la constitución`);
    row.append(title, open, role, remove); rows.append(row);
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
  const suggest = (): void => {
    offered.replaceChildren();
    const query = search.value.trim().toLocaleLowerCase('es');
    if (query.length < 2) { offered.hidden = true; return; }
    const matches = choices.filter((page) => !selected.has(page.id) &&
      page.title.toLocaleLowerCase('es').includes(query)).slice(0, 12);
    for (const page of matches) {
      offered.append(control(page.title, () => {
        selected.set(page.id, 'practice'); rowFor(page, 'practice'); search.value = ''; offered.hidden = true;
      }));
    }
    offered.hidden = matches.length === 0;
  };
  search.addEventListener('input', suggest);
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
  const heading = document.createElement('h3'); heading.textContent = 'Manifiestos';
  const actions = document.createElement('div'); actions.className = 'agent-manifest-actions';
  actions.append(control('Construir borrador', async () => { await api.buildAgentManifest(agent.agent.id); await refresh(); }, 'primary'));
  const list = document.createElement('ol');
  for (const manifest of agent.manifests) {
    const item = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = `v${manifest.version} · ${manifest.status} · ${manifest.digest.slice(0, 12)}`;
    item.append(label);
    if (manifest.status !== 'active' && manifest.status !== 'failed') {
      item.append(control(manifest.status === 'superseded' ? 'Volver a esta versión' : 'Activar', async () => {
        await api.activateAgentManifest(agent.agent.id, manifest.id); await refresh();
      }));
    }
    list.append(item);
  }
  if (agent.manifests.length === 0) {
    const empty = document.createElement('p'); empty.className = 'settings-note';
    empty.textContent = 'Aún no existe una revisión portable.'; section.append(heading, actions, empty); return section;
  }
  section.append(heading, actions, list); return section;
}

function runtimeState(agent: AgentAdministrationView): HTMLElement {
  const section = document.createElement('section'); section.className = 'agent-runtime-state';
  const heading = document.createElement('h3'); heading.textContent = 'Runtime efectivo';
  const explanation = document.createElement('p'); explanation.className = 'settings-note';
  explanation.textContent = 'El recibo declara qué revisión cargó realmente cada runtime. Vera no confunde activación con ejecución.';
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
  const held = document.createElement('label');
  const name = document.createElement('span'); name.textContent = label;
  held.append(name, input); return held;
}

async function runtimeConfigurationPanel(view: LibrarianRuntimeView, refresh: () => Promise<void>): Promise<HTMLElement> {
  const section = document.createElement('section'); section.className = 'agent-runtime-configuration';
  const heading = document.createElement('h2'); heading.textContent = 'Runtime de la bibliotecaria';
  const status = document.createElement('p'); status.className = `agent-runtime-badge is-${view.status}`;
  status.textContent = ({
    unconstituted: 'Aún no constituida', stopped: 'Detenido', ready: 'Listo',
    degraded: 'Configuración incompleta', working: 'Trabajando',
  } as Record<LibrarianRuntimeView['status'], string>)[view.status];
  section.append(heading, status);

  if (view.harness !== null) {
    const catalogue = document.createElement('section'); catalogue.className = 'librarian-tool-catalogue';
    const title = document.createElement('h3');
    title.textContent = `Herramientas · ${view.harness.version.replace('vera-librarian-harness:', 'harness v')}`;
    const note = document.createElement('p'); note.className = 'settings-note';
    note.textContent = 'Las lecturas se ejecutan dentro del territorio. Una corrección se guarda como propuesta; aplicarla exige confirmación humana. Este harness no contiene herramientas destructivas.';
    const list = document.createElement('ul');
    for (const capability of view.harness.capabilities) {
      const item = document.createElement('li');
      const name = document.createElement('strong'); name.textContent = capability.title;
      const mode = document.createElement('span');
      mode.textContent = capability.approval === 'confirm_each_call'
        ? 'confirmación en cada aplicación'
        : capability.projectedToModel ? 'disponible durante la conversación' : 'parte del oficio del runtime';
      item.append(name, mode); list.append(item);
    }
    catalogue.append(title, note, list); section.append(catalogue);
  }

  if (view.librarian === null) {
    const explanation = document.createElement('p'); explanation.className = 'settings-note';
    explanation.textContent = 'Esta biblioteca precede al smart default. Constituirla crea el agente, su vínculo con la persona dueña, el harness y un manifiesto inicial editable.';
    const name = document.createElement('input'); name.value = 'Lucienne'; name.required = true;
    section.append(explanation, field('Nombre editable', name), control('Constituir bibliotecaria', async () => {
      await api.constituteLibrarianRuntime(name.value); await refresh();
    }, 'primary'));
    return section;
  }

  const config = view.configuration;
  if (config === null) {
    const missing = document.createElement('p'); missing.className = 'settings-note';
    missing.textContent = 'La bibliotecaria existe, pero su runtime aún no tiene configuración.';
    section.append(missing); return section;
  }
  const modelCatalog = await api.processingModels().catch(() => ({ models: [] }));
  const form = document.createElement('form'); form.className = 'agent-runtime-form';
  const model = document.createElement('input'); model.value = config.model ?? '';
  model.placeholder = 'openai:gpt-5.6-luna o local:…'; model.setAttribute('list', 'librarian-models');
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
  const routine = document.createElement('input'); routine.type = 'checkbox'; routine.checked = config.routine.enabled;
  const hour = document.createElement('input'); hour.type = 'number'; hour.min = '0'; hour.max = '23';
  hour.value = String(config.routine.hour);
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
  const routineLabel = document.createElement('label'); routineLabel.append(routine, document.createTextNode('Ronda diaria activa'));
  form.append(
    models, field('Modelo de inferencia', model), field('Endpoint compatible con OpenAI', endpoint),
    field('Referencia del secreto', reference), field('Clave (sólo Desktop)', key),
    permissionList, activeLabel, routineLabel, field('Hora local de la ronda', hour),
  );
  form.append(control('Guardar configuración', async () => {
    if (desktop !== undefined && key.value.trim() !== '') {
      await desktop.save({ apiKey: key.value, endpoint: endpoint.value, model: model.value });
    }
    await api.configureLibrarianRuntime({
      enabled: enabled.checked,
      model: model.value.trim() || null,
      endpoint: endpoint.value.trim() || null,
      secretReference: reference.value.trim() || null,
      permissions: [...permissionControls].filter(([, box]) => box.checked).map(([permission]) => permission),
      routine: { enabled: routine.checked, hour: Number(hour.value), timezone: 'local' },
    });
    await refresh();
  }, 'primary'));
  if (config.enabled && config.permissions.includes('daily_round')) {
    form.append(control('Ejecutar ronda ahora', async () => { await api.runLibrarianRoutine(); await refresh(); }));
  }
  section.append(form);

  const history = document.createElement('ol'); history.className = 'agent-runtime-runs';
  for (const run of view.runs.slice(0, 8)) {
    const item = document.createElement('li');
    const label = document.createElement('strong'); label.textContent = run.kind === 'request' ? 'Solicitud' : 'Ronda';
    const meta = document.createElement('span');
    meta.textContent = ` ${run.status} · ${new Date(run.startedAt).toLocaleString('es-CL')} · ${run.model}`;
    item.append(label, meta);
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
  host.replaceChildren();
  const root = document.createElement('article'); root.className = 'agent-administration';
  const header = document.createElement('header'); header.className = 'special-page-header';
  const title = document.createElement('h1'); title.textContent = 'Bibliotecaria';
  header.append(title, control('← Volver', () => window.history.back()));
  const intro = document.createElement('p'); intro.className = 'agent-administration-intro';
  intro.textContent = 'La bibliotecaria es un oficio singular de esta Vera. Su identidad y sus prácticas son editables; el modelo y el runtime pueden cambiar sin reemplazarla.';
  const status = document.createElement('p'); status.className = 'settings-note'; status.textContent = 'Leyendo configuración…';
  const body = document.createElement('div'); body.className = 'agent-administration-body';
  root.append(header, intro, status, body); host.append(root);

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
        ? 'La bibliotecaria aún no está constituida.'
        : 'El agente solicitado no existe o ya no está activo.';
      if (embeddedRuntime !== null) body.append(embeddedRuntime);
      return;
    }

    title.textContent = librarianMode ? `${agent.agent.name} · Bibliotecaria` : `${agent.agent.name} · Agente`;
    intro.textContent = librarianMode
      ? 'Constitución, harness, runtime y territorio de la única bibliotecaria activa de esta Vera.'
      : 'Constitución y territorio de este participante agente. La bibliotecaria se administra en su panel singular.';
    status.textContent = agent.human === null ? 'Sin principal humano' : `Principal humano · ${agent.human.name}`;
    if (agent.human === null) {
      const warning = document.createElement('p'); warning.className = 'participant-directory-retained';
      warning.textContent = 'Pendiente · este agente necesita un principal humano antes de recibir constitución.';
      body.append(warning);
      if (embeddedRuntime !== null) body.append(embeddedRuntime);
      body.append(territoryPanel(territories, refresh, agent.agent.id, agent.agent.name));
      return;
    }
    const pages = await api.pages();
    body.append(sourceEditor(agent, pages, refresh), manifestHistory(agent, refresh), runtimeState(agent));
    if (embeddedRuntime !== null) body.append(embeddedRuntime);
    body.append(territoryPanel(territories, refresh, agent.agent.id, agent.agent.name));
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : 'No se pudo leer la administración de agentes.';
  }
}
