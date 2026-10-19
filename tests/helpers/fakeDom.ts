/** DOM minimal pour tester les vues sans navigateur. `innerHTML` y lève une erreur : toute tentative est un échec. */
export class FakeNode {
  parent: FakeElement | null = null;
}

export class FakeText extends FakeNode {
  constructor(public data: string) {
    super();
  }
}

export class FakeElement extends FakeNode {
  attrs = new Map<string, string>();
  children: (FakeElement | FakeText)[] = [];
  listeners = new Map<string, ((e: unknown) => void)[]>();
  hidden = false;
  disabled = false;

  constructor(public tagName: string) {
    super();
  }

  get textContent(): string {
    return this.children.map((c) => (c instanceof FakeText ? c.data : c.textContent)).join('');
  }
  set textContent(value: string) {
    this.children = [new FakeText(String(value))];
  }
  set innerHTML(_value: string) {
    throw new Error('innerHTML interdit');
  }
  set outerHTML(_value: string) {
    throw new Error('outerHTML interdit');
  }
  setAttribute(name: string, value: string) {
    this.attrs.set(name, value);
  }
  getAttribute(name: string) {
    return this.attrs.get(name) ?? null;
  }
  appendChild<T extends FakeElement | FakeText>(child: T): T {
    child.parent = this;
    this.children.push(child);
    return child;
  }
  replaceChildren(...nodes: (FakeElement | FakeText)[]) {
    this.children = [];
    for (const n of nodes) this.appendChild(n);
  }
  addEventListener(type: string, cb: (e: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), cb]);
  }
  click() {
    for (const cb of this.listeners.get('click') ?? []) cb({});
  }
  /** Tous les descendants (dont soi-même) qui vérifient le prédicat. */
  findAll(pred: (el: FakeElement) => boolean): FakeElement[] {
    const out: FakeElement[] = pred(this) ? [this] : [];
    for (const c of this.children) if (c instanceof FakeElement) out.push(...c.findAll(pred));
    return out;
  }
}

export class FakeDocument {
  createElement(tag: string) {
    return new FakeElement(tag);
  }
  createTextNode(data: string) {
    return new FakeText(data);
  }
}

export const fakeDoc = () => new FakeDocument() as unknown as Document;
export const asEl = (e: unknown) => e as FakeElement;
export const byText = (root: FakeElement, text: string, tag?: string) =>
  root.findAll((e) => (!tag || e.tagName === tag) && e.children.length > 0 && e.children.every((c) => c instanceof FakeText) && e.textContent === text);
export const buttonByText = (root: FakeElement, text: string) => {
  const found = root.findAll((e) => e.tagName === 'button' && e.textContent === text);
  if (found.length !== 1) throw new Error(`bouton « ${text} » : ${found.length} trouvé(s)`);
  return found[0]!;
};
