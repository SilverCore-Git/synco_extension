/**
 * Construction du DOM sans jamais interpréter de HTML : tout texte (origine, raison, noms) passe par `textContent`
 * ou `createTextNode`. Les attributs sont limités à une liste fermée, ce qui exclut gestionnaires d'événements
 * (`onclick`…), `style`, `href`, `src` et `srcdoc`.
 */
export type Child = string | Node | null | false | undefined;

const ALLOWED_ATTRS = new Set([
  'id', 'class', 'type', 'role', 'title', 'disabled', 'hidden', 'lang', 'tabindex', 'autofocus',
  'aria-label', 'aria-live', 'aria-modal', 'aria-labelledby', 'aria-describedby', 'aria-hidden', 'aria-busy', 'aria-disabled',
]);

export interface Props {
  class?: string;
  text?: string;
  attrs?: Record<string, string | boolean>;
  on?: Record<string, (event: Event) => void>;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = doc.createElement(tag);
  if (props.class) el.setAttribute('class', props.class);
  if (props.text !== undefined) el.textContent = props.text;
  for (const [name, value] of Object.entries(props.attrs ?? {})) {
    if (!ALLOWED_ATTRS.has(name) && !name.startsWith('data-')) throw new Error(`attribut interdit : ${name}`);
    if (value === false) continue;
    el.setAttribute(name, value === true ? '' : value);
  }
  for (const [type, handler] of Object.entries(props.on ?? {})) el.addEventListener(type, handler);
  for (const child of children) {
    if (child === null || child === false || child === undefined) continue;
    el.appendChild(typeof child === 'string' ? doc.createTextNode(child) : child);
  }
  return el;
}

/** Remplace tout le contenu de `root` (sans passer par innerHTML). */
export function mount(root: Element, ...children: Node[]): void {
  root.replaceChildren(...children);
}
