import {
  getCurrentScope,
  inject,
  onScopeDispose,
  shallowRef,
  toValue,
  type InjectionKey,
  type MaybeRefOrGetter,
} from "vue";
import {
  HEAD_ATTRS_ATTR,
  HEAD_TAG_ATTR,
  resolveHead,
  type HeadConfig,
  type HeadInput,
  type ResolvedHead,
} from "../head";

export interface HeadManager {
  /** Registers an entry; returns a function that removes it */
  add: (input: MaybeRefOrGetter<HeadInput>) => () => void;
  /** The config defaults merged with every registered entry (reactive) */
  resolve: () => ResolvedHead;
}

export const HEAD_KEY: InjectionKey<HeadManager> = Symbol("noofpi:head");

export function createHeadManager(defaults?: HeadConfig): HeadManager {
  const entries = shallowRef<{ input: MaybeRefOrGetter<HeadInput> }[]>([]);
  return {
    add(input) {
      const entry = { input };
      entries.value = [...entries.value, entry];
      return () => {
        entries.value = entries.value.filter((other) => other !== entry);
      };
    },
    resolve: () =>
      resolveHead(
        defaults,
        entries.value.map((entry) => toValue(entry.input)),
      ),
  };
}

/**
 * Sets the title, meta tags, links and `<html>` / `<body>` attributes of the current page. Call it inside
 * `setup()`; the entry is removed when the component unmounts. Pass a getter to react to data:
 * `useHead(() => ({ title: user.value.name }))`. The title fills the `%s` of the config's `head.title`.
 * Entries of a deeper component win, and tags with the same identity (`name`, `property`, ...) replace earlier ones.
 */
export function useHead(input: MaybeRefOrGetter<HeadInput>): void {
  const head = inject(HEAD_KEY, null);
  if (!head)
    throw new Error("[noofpi] useHead() must be called inside setup()");
  const remove = head.add(input);
  if (getCurrentScope()) onScopeDispose(remove);
}

function setAttrs(element: HTMLElement, attrs: Record<string, string>) {
  const previous = element.getAttribute(HEAD_ATTRS_ATTR)?.split(" ") ?? [];
  for (const name of previous)
    if (name && !(name in attrs)) element.removeAttribute(name);
  for (const [name, value] of Object.entries(attrs))
    element.setAttribute(name, value);
  element.setAttribute(HEAD_ATTRS_ATTR, Object.keys(attrs).join(" "));
}

/** Browser only: writes the resolved head into the document, replacing what noofpi wrote before */
export function applyHeadToDocument(head: ResolvedHead): void {
  document.title = head.title;
  for (const stale of document.head.querySelectorAll(`[${HEAD_TAG_ATTR}]`))
    stale.remove();
  const tags: [string, Record<string, string>][] = [
    ...head.meta.map((attrs): [string, Record<string, string>] => [
      "meta",
      attrs,
    ]),
    ...head.link.map((attrs): [string, Record<string, string>] => [
      "link",
      attrs,
    ]),
  ];
  // The shell ships a viewport; a page-level one replaces it
  if (head.meta.some((attrs) => attrs.name === "viewport"))
    document.head
      .querySelector(`meta[name="viewport"]:not([${HEAD_TAG_ATTR}])`)
      ?.remove();
  for (const [name, attrs] of tags) {
    const element = document.createElement(name);
    for (const [key, value] of Object.entries(attrs))
      element.setAttribute(key, value);
    element.setAttribute(HEAD_TAG_ATTR, "");
    document.head.append(element);
  }
  setAttrs(document.documentElement, head.htmlAttrs);
  setAttrs(document.body, head.bodyAttrs);
}
