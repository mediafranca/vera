import { ask, type AskOptions } from './model.ts';

export const PICTOS_SYMBOLS = [
  'person', 'hand', 'bed', 'toothbrush', 'tooth', 'cup', 'water', 'food',
  'home', 'book', 'heart', 'arrow', 'place', 'object',
] as const;

export type PictosSymbol = typeof PICTOS_SYMBOLS[number];
export type PictosRole = 'agent' | 'action' | 'patient' | 'context';

export interface PictosElement {
  role: PictosRole;
  label: string;
  symbol: PictosSymbol;
}

export interface PictosPlan {
  title: string;
  speechAct: 'directive' | 'statement' | 'question' | 'expression';
  elements: PictosElement[];
  composition: string;
  description: string;
}

export interface GeneratedPictos {
  plan: PictosPlan;
  svg: string;
  content: string;
  modelText: string;
}

export function composePictos(plan: PictosPlan): GeneratedPictos {
  const svg = pictosSvg(plan);
  return {
    plan,
    svg,
    content: `\`\`\`svg\n${svg}\n\`\`\`\n\n**${plan.title}** — ${plan.description}`,
    modelText: '',
  };
}

export function validatePictosPlan(value: unknown): PictosPlan | null {
  try {
    return readPictosPlan(JSON.stringify(value));
  } catch {
    return null;
  }
}

const roles = new Set<PictosRole>(['agent', 'action', 'patient', 'context']);
const symbols = new Set<string>(PICTOS_SYMBOLS);

function cleanText(value: unknown, limit: number): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
  return cleaned === '' ? null : cleaned.slice(0, limit);
}

/** Encuentra el último objeto JSON completo sin confiar en vallas del modelo. */
export function lastJsonObject(text: string): Record<string, unknown> | null {
  for (let start = text.lastIndexOf('{'); start >= 0; start = text.lastIndexOf('{', start - 1)) {
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let at = start; at < text.length; at += 1) {
      const character = text[at] ?? '';
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') quoted = false;
        continue;
      }
      if (character === '"') quoted = true;
      else if (character === '{') depth += 1;
      else if (character === '}' && --depth === 0) {
        try {
          const parsed = JSON.parse(text.slice(start, at + 1)) as unknown;
          if (
            parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) &&
            'elements' in (parsed as Record<string, unknown>)
          ) {
            return parsed as Record<string, unknown>;
          }
        } catch { /* se sigue buscando hacia atrás */ }
        break;
      }
    }
    if (start === 0) break;
  }
  return null;
}

export function readPictosPlan(text: string): PictosPlan | null {
  const parsed = lastJsonObject(text);
  if (parsed === null || !Array.isArray(parsed['elements'])) return null;
  const title = cleanText(parsed['title'], 80);
  const composition = cleanText(parsed['composition'], 180);
  const description = cleanText(parsed['description'], 240);
  const speechAct = parsed['speechAct'];
  if (
    title === null || composition === null || description === null ||
    !['directive', 'statement', 'question', 'expression'].includes(String(speechAct))
  ) return null;
  const elements: PictosElement[] = [];
  const seenRoles = new Set<PictosRole>();
  for (const raw of parsed['elements'].slice(0, 4)) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const element = raw as Record<string, unknown>;
    const role = element['role'];
    const symbol = element['symbol'];
    const label = cleanText(element['label'], 40);
    if (!roles.has(role as PictosRole) || !symbols.has(String(symbol)) || label === null) return null;
    if (seenRoles.has(role as PictosRole)) return null;
    seenRoles.add(role as PictosRole);
    elements.push({ role: role as PictosRole, symbol: symbol as PictosSymbol, label });
  }
  if (elements.length < 2 || !seenRoles.has('action')) return null;
  const order: Record<PictosRole, number> = { agent: 0, action: 1, patient: 2, context: 3 };
  elements.sort((left, right) => order[left.role] - order[right.role]);
  return { title, speechAct: speechAct as PictosPlan['speechAct'], elements, composition, description };
}

const escapeXml = (text: string): string => text
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&apos;');

function symbolDrawing(symbol: PictosSymbol): string {
  switch (symbol) {
    case 'person': return '<circle cx="60" cy="36" r="13"/><path d="M60 51v47M36 72l24-16 24 16M60 98l-20 35M60 98l20 35"/>';
    case 'hand': return '<path d="M35 91c16-3 20-21 24-40 1-7 10-6 10 1v23-36c0-7 10-7 10 0v34-27c0-7 10-7 10 0v31-20c0-7 10-7 10 0v33c0 28-17 43-40 43-19 0-31-13-37-28-3-8 4-13 13-14z"/>';
    case 'bed': return '<path d="M20 95h100v25H20zM20 62v72M120 82v52M25 77h38c10 0 18 8 18 18H25zM81 77h23c9 0 16 8 16 18H81z"/>';
    case 'toothbrush': return '<path d="M24 105l83-55M99 45l20-13M103 51l20-13M107 57l20-13"/>';
    case 'tooth': return '<path d="M43 31c12-8 22 1 31 1 9 0 19-9 31-1 20 14 6 37 2 52-7 28-12 48-23 48-9 0-6-31-14-31s-5 31-14 31c-11 0-16-20-23-48-4-15-18-38 10-52z"/>';
    case 'cup': return '<path d="M31 49h67v64H31zM98 62h12c24 0 24 37 0 37H98"/>';
    case 'water': return '<path d="M70 22c0 0-35 42-35 70a35 35 0 0 0 70 0c0-28-35-70-35-70z"/>';
    case 'food': return '<circle cx="69" cy="78" r="43"/><circle cx="69" cy="78" r="26"/><path d="M20 27v103M11 27v31h18V27M119 27v103M119 27c-16 11-16 35 0 44"/>';
    case 'home': return '<path d="M18 69l52-43 52 43M30 61v70h80V61M58 131V91h25v40"/>';
    case 'book': return '<path d="M18 37c22-7 39 0 52 13v82c-13-13-30-20-52-13zM122 37c-22-7-39 0-52 13v82c13-13 30-20 52-13z"/>';
    case 'heart': return '<path d="M70 128S18 95 18 57c0-30 38-38 52-12 14-26 52-18 52 12 0 38-52 71-52 71z"/>';
    case 'arrow': return '<path d="M20 78h91M82 45l33 33-33 33"/>';
    case 'place': return '<path d="M70 133S31 91 31 61a39 39 0 0 1 78 0c0 30-39 72-39 72z"/><circle cx="70" cy="61" r="13"/>';
    case 'object': return '<rect x="28" y="29" width="84" height="99" rx="9"/><path d="M45 50h50M45 71h50M45 92h35"/>';
  }
}

/** El modelo elige el plan; Vera es la única que escribe el SVG. */
export function pictosSvg(plan: PictosPlan): string {
  const card = 170;
  const width = plan.elements.length * card;
  const groups = plan.elements.map((element, index) => {
    const x = index * card;
    return `<g id="${element.role}-${index + 1}" data-role="${element.role}" transform="translate(${x + 15} 38)">` +
      `<title>${escapeXml(element.role)}: ${escapeXml(element.label)}</title>` +
      `<rect class="card" width="140" height="172" rx="8"/>` +
      `<g class="symbol">${symbolDrawing(element.symbol)}</g>` +
      `<text class="role" x="70" y="151" text-anchor="middle">${escapeXml(element.role)}</text>` +
      `<text class="label" x="70" y="166" text-anchor="middle">${escapeXml(element.label)}</text></g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 240" role="img" aria-labelledby="title description">` +
    `<title id="title">${escapeXml(plan.title)}</title>` +
    `<desc id="description">${escapeXml(plan.description)}</desc>` +
    '<style>.card{fill:none;stroke:var(--rule,currentColor);stroke-width:1}.symbol{fill:none;stroke:currentColor;stroke-width:6;stroke-linecap:round;stroke-linejoin:round}.role{fill:var(--accent,currentColor);font:600 10px system-ui;text-transform:uppercase}.label{fill:currentColor;font:13px system-ui}</style>' +
    groups + '</svg>';
}

export function pictosPrompt(utterance: string): string {
  return `Convierte una frase en un plan pictográfico mínimo. Esta es una exploración generativa: elige una lectura visual clara, no expliques alternativas.\n\n` +
    `Devuelve exclusivamente un objeto JSON con esta forma:\n` +
    `{"title":"título breve","speechAct":"directive|statement|question|expression","elements":[{"role":"agent|action|patient|context","label":"concepto breve","symbol":"símbolo"}],"composition":"decisión espacial breve","description":"descripción accesible completa"}\n\n` +
    `Usa entre 2 y 4 elementos. Símbolos permitidos: ${PICTOS_SYMBOLS.join(', ')}. ` +
    `Incluye siempre una acción; agente y paciente pueden omitirse sólo si la frase realmente no los tiene. ` +
    `No repitas roles. Los elementos deben estar en orden agente, acción, paciente, contexto. ` +
    `No incluyas SVG, Markdown ni texto fuera del JSON. Contesta enteramente en el idioma de la frase.\n\n` +
    `Ejemplo para «Haz la cama»: {"title":"Hacer la cama","speechAct":"directive","elements":[{"role":"agent","label":"persona","symbol":"person"},{"role":"action","label":"hacer","symbol":"hand"},{"role":"patient","label":"cama","symbol":"bed"}],"composition":"La persona actúa sobre la cama","description":"Una persona hace una cama"}\n\n` +
    `Frase: ${utterance}`;
}

export async function generatePictos(
  utterance: string,
  options: Pick<AskOptions, 'model'> = {},
): Promise<GeneratedPictos | { error: string }> {
  const prompt = pictosPrompt(utterance);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const answered = await ask(prompt, {
      ...options,
      maxTokens: 260,
      timeoutMs: 60_000,
      temperature: 0.82,
      seed: Math.floor(Math.random() * 2_147_483_647),
    });
    if ('error' in answered) return { error: answered.error };
    const plan = readPictosPlan(answered.text);
    if (plan === null) continue;
    return { ...composePictos(plan), modelText: answered.text };
  }
  return { error: 'el modelo no devolvió un plan pictográfico legible en dos intentos' };
}
