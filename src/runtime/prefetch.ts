/** The same-origin path (`/users/5?tab=1`) of the page a link points to, or `undefined` when it is not a client-side navigation */
export function linkPrefetchTarget(
  target: EventTarget | null,
  origin: string,
): string | undefined {
  const anchor = (target as Element | null)?.closest?.("a[href]") as
    HTMLAnchorElement | null | undefined;
  if (
    !anchor ||
    anchor.hasAttribute("download") ||
    anchor.hasAttribute("data-no-prefetch") ||
    (anchor.target && anchor.target !== "_self")
  )
    return undefined;
  let url: URL;
  try {
    url = new URL(anchor.href, origin);
  } catch {
    return undefined;
  }
  if (url.origin !== origin) return undefined;
  return url.pathname + url.search;
}

/**
 * Browser only: calls `prefetch` with the path of a link the user is about to follow (hover, focus, touch).
 * One delegated listener covers `<NoofpiLink>` and plain `<a>`; `data-no-prefetch` on a link opts it out.
 */
export function listenForPrefetch(
  prefetch: (href: string) => Promise<unknown>,
): () => void {
  // Data saver mode: no speculative requests
  const connection = (
    navigator as Navigator & { connection?: { saveData?: boolean } }
  ).connection;
  if (connection?.saveData) return () => {};
  const onIntent = (event: Event) => {
    const href = linkPrefetchTarget(event.target, location.origin);
    if (href) prefetch(href).catch(() => {});
  };
  const events = ["mouseover", "focusin", "touchstart"] as const;
  for (const name of events)
    document.addEventListener(name, onIntent, { passive: true });
  return () => {
    for (const name of events) document.removeEventListener(name, onIntent);
  };
}
