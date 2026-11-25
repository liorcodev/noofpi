import {
  computed,
  createApp,
  defineComponent,
  h,
  reactive,
  ref,
  watch,
  type App,
  type CSSProperties,
  type VNode,
} from "vue";
import type {
  RouteLocationNormalized,
  RouteRecordNormalized,
  Router,
} from "vue-router";
import {
  DEV_ERRORS_ELEMENT_ID,
  parseDevErrors,
  toDevError,
  type DevError,
} from "../dev-errors";
import type { FetchMode } from "../fetch-mode";
import {
  isServerRendered,
  matchRouteRules,
  resolveFetchMode,
  type RouteRule,
  type RouteRules,
} from "../route-rules";
import { normalizeMiddleware, parseMiddlewareFile } from "./middleware";
import type { RequestLog } from "./inspector";
import type { RequestEntry } from "../requests";

export interface DevtoolsConfig {
  ssr: boolean;
  routeRules: RouteRules;
  doofpi: { fetch: FetchMode };
}

export interface RouteReport {
  path: string;
  pattern: string;
  layout: string;
  /** Global middleware first, then the page's named middleware; `missing` ones have no file in `app/middleware/` */
  middleware: { name: string; scope: "global" | "named"; missing: boolean }[];
  fetch: FetchMode;
  rendering: "server" | "client";
  rule: RouteRule;
}

/** What noofpi knows about a route: matched pattern, layout, middleware chain, fetch mode and rendering */
export function inspectRoute(
  route: Pick<RouteLocationNormalized, "path" | "matched" | "meta">,
  config: DevtoolsConfig,
  middlewareFiles: string[],
): RouteReport {
  const files = [...middlewareFiles].sort().map(parseMiddlewareFile);
  const known = new Set(files.map((file) => file.name));
  const { layout } = route.meta;
  return {
    path: route.path,
    pattern: route.matched.at(-1)?.path ?? "(no match)",
    layout:
      layout === false
        ? "none"
        : typeof layout === "string"
          ? layout
          : "default",
    middleware: [
      ...files
        .filter((file) => file.global)
        .map((file) => ({
          name: file.name,
          scope: "global" as const,
          missing: false,
        })),
      ...normalizeMiddleware(route.meta.middleware).map((name) => ({
        name,
        scope: "named" as const,
        missing: !known.has(name),
      })),
    ],
    fetch: resolveFetchMode(config.doofpi.fetch, config.routeRules, route.path),
    rendering: isServerRendered(config.ssr, config.routeRules, route.path)
      ? "server"
      : "client",
    rule: matchRouteRules(config.routeRules, route.path),
  };
}

export interface CspViolation {
  directive: string;
  blocked: string;
  source: string;
}

/** Every route of the app (a page per file in `app/pages`) with what noofpi resolves for it, sorted by path */
export function listRoutes(
  records: Pick<RouteRecordNormalized, "path" | "meta">[],
  config: DevtoolsConfig,
  middlewareFiles: string[],
): RouteReport[] {
  return records
    .map((record) =>
      inspectRoute(
        {
          path: record.path,
          matched: [record] as unknown as RouteLocationNormalized["matched"],
          meta: record.meta,
        },
        config,
        middlewareFiles,
      ),
    )
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** What the server transferred to the browser for the first render */
export interface PayloadSnapshot {
  data: Record<string, unknown>;
  errors: Record<string, unknown>;
  state?: Record<string, unknown>;
  locale?: string;
  error?: unknown;
}

export interface PayloadEntryReport {
  key: string;
  /** Pretty-printed JSON of the value */
  json: string;
  /** Size of the compact JSON in bytes */
  bytes: number;
}

export interface PayloadReport {
  data: PayloadEntryReport[];
  errors: PayloadEntryReport[];
  state: PayloadEntryReport[];
  locale?: string;
  error?: PayloadEntryReport;
  /** Total size of the entries in bytes */
  bytes: number;
}

const byteLength = (text: string) => new TextEncoder().encode(text).length;

function payloadEntry(key: string, value: unknown): PayloadEntryReport {
  const compact = JSON.stringify(value) ?? "undefined";
  return {
    key,
    json: JSON.stringify(value, null, 2) ?? "undefined",
    bytes: byteLength(compact),
  };
}

/** The payload as the overlay lists it: each key with its value and size, largest first */
export function describePayload(payload: PayloadSnapshot): PayloadReport {
  const entries = (values: Record<string, unknown> | undefined) =>
    Object.entries(values ?? {})
      .map(([key, value]) => payloadEntry(key, value))
      .sort((a, b) => b.bytes - a.bytes);
  const data = entries(payload.data);
  const errors = entries(payload.errors);
  const state = entries(payload.state);
  const error =
    payload.error === undefined
      ? undefined
      : payloadEntry("error", payload.error);
  return {
    data,
    errors,
    state,
    ...(payload.locale ? { locale: payload.locale } : {}),
    ...(error ? { error } : {}),
    bytes: [...data, ...errors, ...state, ...(error ? [error] : [])].reduce(
      (sum, entry) => sum + entry.bytes,
      0,
    ),
  };
}

export const formatBytes = (bytes: number): string =>
  bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;

/** One line per request for the overlay: what was requested, and how and when it came back */
export function describeRequest(
  entry: RequestEntry,
  origin: string,
): { request: string; detail: string } {
  const url = entry.url.startsWith(origin)
    ? entry.url.slice(origin.length)
    : entry.url;
  const result =
    entry.error !== undefined
      ? `failed: ${entry.error}`
      : entry.status === undefined
        ? "pending"
        : String(entry.status);
  return {
    request: `${entry.method} ${url}`,
    detail: [
      entry.side,
      entry.mode,
      entry.transport,
      result,
      ...(entry.ms === undefined ? [] : [`${entry.ms}ms`]),
    ].join(" · "),
  };
}

const MAX_VIOLATIONS = 50;
const MAX_ERRORS = 50;

const colors = {
  bg: "rgba(24,24,27,.96)",
  fg: "#e4e4e7",
  dim: "#a1a1aa",
  accent: "#42d392",
  alert: "#f87171",
  line: "rgba(255,255,255,.08)",
  card: "rgba(255,255,255,.035)",
};

const sans = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";
const mono = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace";

const panelStyle: CSSProperties = {
  position: "fixed",
  right: "12px",
  bottom: "52px",
  zIndex: "2147483647",
  width: "380px",
  height: "min(70vh, 460px)",
  maxHeight: "70vh",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  boxSizing: "border-box",
  background: colors.bg,
  backdropFilter: "blur(12px)",
  color: colors.fg,
  font: `12px/1.5 ${sans}`,
  borderRadius: "14px",
  border: "1px solid rgba(66,211,146,.28)",
  boxShadow:
    "0 16px 48px rgba(0,0,0,.55), 0 0 32px rgba(66,211,146,.1), inset 0 1px 0 rgba(255,255,255,.06)",
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "10px",
  padding: "12px 14px",
  background:
    "linear-gradient(120deg, rgba(34,70,57,.9) 0%, rgba(24,24,27,0) 75%)",
  borderBottom: `1px solid ${colors.line}`,
  flexShrink: "0",
};

const bodyStyle: CSSProperties = {
  flex: "1 1 auto",
  minHeight: "0",
  overflow: "auto",
  padding: "10px 12px 12px",
  display: "flex",
  flexDirection: "column",
  gap: "10px",
};

const closeStyle: CSSProperties = {
  display: "grid",
  placeItems: "center",
  width: "24px",
  height: "24px",
  padding: "0",
  background: "rgba(255,255,255,.06)",
  border: `1px solid ${colors.line}`,
  borderRadius: "50%",
  color: colors.dim,
  cursor: "pointer",
  font: `16px/1 ${sans}`,
};

const sectionStyle: CSSProperties = {
  background: colors.card,
  border: `1px solid ${colors.line}`,
  borderRadius: "10px",
  padding: "8px 10px 10px",
};

const sectionTitleStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "6px",
  marginBottom: "6px",
  color: colors.accent,
  fontSize: "10px",
  fontWeight: "700",
  letterSpacing: ".1em",
  textTransform: "uppercase",
};

type Tone = "accent" | "neutral" | "alert";

const tones: Record<Tone, { bg: string; fg: string; border: string }> = {
  accent: {
    bg: "rgba(66,211,146,.14)",
    fg: "#6ee7b7",
    border: "rgba(66,211,146,.35)",
  },
  neutral: {
    bg: "rgba(255,255,255,.06)",
    fg: "#d4d4d8",
    border: colors.line,
  },
  alert: {
    bg: "rgba(248,113,113,.14)",
    fg: "#fca5a5",
    border: "rgba(248,113,113,.4)",
  },
};

const chipStyle = (tone: Tone): CSSProperties => ({
  display: "inline-block",
  padding: "1px 7px",
  borderRadius: "999px",
  background: tones[tone].bg,
  color: tones[tone].fg,
  border: `1px solid ${tones[tone].border}`,
  fontSize: "10px",
  fontWeight: "600",
  letterSpacing: ".03em",
  whiteSpace: "nowrap",
});

const buttonStyle: CSSProperties = {
  position: "fixed",
  right: "12px",
  bottom: "12px",
  zIndex: "2147483647",
  display: "inline-flex",
  alignItems: "center",
  gap: "8px",
  height: "34px",
  boxSizing: "border-box",
  padding: "0 14px 0 12px",
  background:
    "linear-gradient(135deg, rgba(34,70,57,.92) 0%, rgba(24,24,27,.92) 70%)",
  backdropFilter: "blur(8px)",
  color: colors.fg,
  font: "600 12px/1 ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
  letterSpacing: ".02em",
  border: "1px solid rgba(66,211,146,.4)",
  borderRadius: "999px",
  boxShadow:
    "0 6px 20px rgba(0,0,0,.35), 0 0 18px rgba(66,211,146,.18), inset 0 1px 0 rgba(255,255,255,.08)",
  cursor: "grab",
  touchAction: "none",
  userSelect: "none",
};

const dotStyle = (color: string): CSSProperties => ({
  width: "8px",
  height: "8px",
  borderRadius: "50%",
  background: color,
  boxShadow: `0 0 0 3px ${color}33, 0 0 10px ${color}`,
  flexShrink: "0",
});

const badgeStyle: CSSProperties = {
  padding: "3px 7px",
  borderRadius: "999px",
  background: "rgba(248,113,113,.16)",
  border: "1px solid rgba(248,113,113,.4)",
  color: "#fca5a5",
  fontSize: "10px",
  fontWeight: "700",
  letterSpacing: ".04em",
};

const alertColor = colors.alert;

type Tab = "errors" | "route" | "routes" | "payload" | "doofpi" | "csp";

const TABS: { id: Tab; label: string }[] = [
  { id: "errors", label: "Errors" },
  { id: "route", label: "Route" },
  { id: "routes", label: "Routes" },
  { id: "payload", label: "Payload" },
  { id: "doofpi", label: "doofpi" },
  { id: "csp", label: "CSP" },
];

const tabsStyle: CSSProperties = {
  display: "flex",
  gap: "2px",
  padding: "6px 10px 0",
  borderBottom: `1px solid ${colors.line}`,
  flexShrink: "0",
  overflowX: "auto",
};

const tabStyle = (active: boolean): CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  gap: "5px",
  padding: "5px 9px",
  background: "none",
  border: "0",
  borderBottom: `2px solid ${active ? colors.accent : "transparent"}`,
  color: active ? colors.fg : colors.dim,
  font: `600 11px/1.4 ${sans}`,
  cursor: "pointer",
  whiteSpace: "nowrap",
});

const codeStyle: CSSProperties = {
  margin: "4px 0 0",
  padding: "6px 8px",
  maxHeight: "160px",
  overflow: "auto",
  background: "rgba(0,0,0,.3)",
  borderRadius: "6px",
  fontFamily: mono,
  fontSize: "11px",
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
};

const POSITION_KEY = "__noofpi_devtools_position";
const DRAG_THRESHOLD = 4;
const EDGE = 4;
const BUTTON_SIZE = { width: 140, height: 34 };
const PANEL_WIDTH = 380;
const PANEL_GAP = 10;

interface Position {
  right: number;
  bottom: number;
}

/** Keeps the button fully inside the viewport (also after the window shrinks) */
function clampPosition({ right, bottom }: Position): Position {
  return {
    right: Math.max(
      EDGE,
      Math.min(right, window.innerWidth - BUTTON_SIZE.width - EDGE),
    ),
    bottom: Math.max(
      EDGE,
      Math.min(bottom, window.innerHeight - BUTTON_SIZE.height - EDGE),
    ),
  };
}

function loadPosition(): Position {
  try {
    const saved = JSON.parse(localStorage.getItem(POSITION_KEY) ?? "null");
    if (typeof saved?.right === "number" && typeof saved?.bottom === "number") {
      return clampPosition(saved);
    }
  } catch {
    // storage unavailable or corrupt: fall back to the default corner
  }
  return { right: 12, bottom: 12 };
}

function savePosition(position: Position) {
  try {
    localStorage.setItem(POSITION_KEY, JSON.stringify(position));
  } catch {
    // storage unavailable: the position just won't be remembered
  }
}

/** The panel opens next to the button: above it in the lower half of the screen, below it in the upper half */
function panelPlacement({ right, bottom }: Position): CSSProperties {
  const maxRight = Math.max(EDGE, window.innerWidth - PANEL_WIDTH - EDGE);
  const horizontal = { right: `${Math.min(right, maxRight)}px` };
  return bottom > window.innerHeight / 2
    ? {
        ...horizontal,
        top: `${window.innerHeight - bottom + PANEL_GAP}px`,
        bottom: "auto",
      }
    : { ...horizontal, bottom: `${bottom + BUTTON_SIZE.height + PANEL_GAP}px` };
}

const Devtools = defineComponent({
  name: "NoofpiDevtools",
  props: {
    router: { type: Object as () => Router, required: true },
    config: { type: Object as () => DevtoolsConfig, required: true },
    middlewareFiles: { type: Array as () => string[], required: true },
    violations: {
      type: Object as () => { list: CspViolation[] },
      required: true,
    },
    requests: { type: Object as () => RequestLog, required: false },
    payload: { type: Object as () => PayloadSnapshot, required: false },
    errors: {
      type: Object as () => { list: DevError[] },
      required: true,
    },
  },
  setup(props) {
    const open = ref(false);
    const tab = ref<Tab>("route");
    // A new error opens the panel on it, so it is not missed
    watch(
      () => props.errors.list.length,
      (length, previous = 0) => {
        if (length > previous) {
          open.value = true;
          tab.value = "errors";
        }
      },
      { immediate: true },
    );
    const pos = reactive(loadPosition());
    let drag: {
      x: number;
      y: number;
      right: number;
      bottom: number;
    } | null = null;
    let moved = false;
    const report = computed(() =>
      inspectRoute(
        props.router.currentRoute.value,
        props.config,
        props.middlewareFiles,
      ),
    );
    const routes = computed(() =>
      listRoutes(props.router.getRoutes(), props.config, props.middlewareFiles),
    );
    const payloadReport = computed(() =>
      describePayload(props.payload ?? { data: {}, errors: {} }),
    );

    const onPointerDown = (event: PointerEvent) => {
      drag = {
        x: event.clientX,
        y: event.clientY,
        right: pos.right,
        bottom: pos.bottom,
      };
      moved = false;
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!drag) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (!moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      moved = true;
      Object.assign(
        pos,
        clampPosition({ right: drag.right - dx, bottom: drag.bottom - dy }),
      );
    };
    const onPointerUp = () => {
      if (drag && moved) savePosition(pos);
      drag = null;
    };
    // A drag ends with a click on the button; it must not toggle the panel
    const onToggle = () => {
      if (moved) return void (moved = false);
      open.value = !open.value;
    };

    const chip = (text: string, tone: Tone = "neutral") =>
      h("span", { style: chipStyle(tone) }, text);
    const none = () =>
      h("div", { style: { color: colors.dim, fontStyle: "italic" } }, "none");
    const row = (label: string, value: string | VNode | (string | VNode)[]) =>
      h("div", { style: { display: "flex", gap: "10px", padding: "2px 0" } }, [
        h("span", { style: { color: colors.dim, flex: "0 0 68px" } }, label),
        h(
          "span",
          {
            style: { fontFamily: mono, wordBreak: "break-all", minWidth: "0" },
          },
          value,
        ),
      ]);
    const section = (title: string, children: VNode[], count?: number) =>
      h("section", { style: sectionStyle }, [
        h("div", { style: sectionTitleStyle }, [
          h("span", title),
          ...(count === undefined
            ? []
            : [chip(String(count), count ? "accent" : "neutral")]),
        ]),
        ...children,
      ]);
    const requestStatus = (entry: RequestEntry) =>
      entry.error !== undefined ||
      (entry.status !== undefined && entry.status >= 400)
        ? colors.alert
        : entry.status === undefined
          ? colors.dim
          : colors.accent;

    const show = (name: Tab, nodes: VNode[]) =>
      tab.value === name ? nodes : [];

    const tabBar = (counts: Record<Tab, number | undefined>) =>
      h(
        "div",
        { style: tabsStyle, role: "tablist" },
        // The Errors tab only exists while there are errors
        TABS.filter(({ id }) => id !== "errors" || counts.errors).map(
          ({ id, label }) =>
            h(
              "button",
              {
                type: "button",
                role: "tab",
                "aria-selected": tab.value === id,
                style: tabStyle(tab.value === id),
                "data-noofpi-devtools": `tab-${id}`,
                onClick: () => (tab.value = id),
              },
              [
                label,
                ...(counts[id] === undefined
                  ? []
                  : [
                      chip(
                        String(counts[id]),
                        counts[id]
                          ? id === "csp" || id === "errors"
                            ? "alert"
                            : "accent"
                          : "neutral",
                      ),
                    ]),
              ],
            ),
        ),
      );

    const errorsPanel = (): VNode[] => [
      h(
        "button",
        {
          type: "button",
          style: {
            ...closeStyle,
            width: "auto",
            padding: "2px 10px",
            borderRadius: "999px",
            font: `600 11px/1.4 ${sans}`,
            alignSelf: "flex-end",
          },
          onClick: () => {
            props.errors.list = [];
            tab.value = "route";
          },
        },
        "Clear",
      ),
      ...props.errors.list
        .map((error, index) =>
          h(
            "section",
            {
              style: {
                ...sectionStyle,
                borderColor: tones.alert.border,
                background: tones.alert.bg,
              },
              key: index,
            },
            [
              h("div", { style: { display: "flex", gap: "6px" } }, [
                chip(error.source, "alert"),
                chip(error.name),
                ...(error.info ? [chip(error.info)] : []),
              ]),
              h(
                "div",
                {
                  style: {
                    margin: "6px 0",
                    fontFamily: mono,
                    fontWeight: "600",
                    wordBreak: "break-word",
                  },
                },
                error.message,
              ),
              ...(error.stack
                ? [
                    h("details", [
                      h(
                        "summary",
                        { style: { cursor: "pointer", color: colors.dim } },
                        "stack trace",
                      ),
                      h("pre", { style: codeStyle }, error.stack),
                    ]),
                  ]
                : []),
            ],
          ),
        )
        .reverse(),
    ];

    const routesPanel = (): VNode[] => {
      const current = props.router.currentRoute.value.matched.at(-1)?.path;
      return [
        section(
          "App routes",
          routes.value.length
            ? routes.value.map((entry) => {
                const navigable = !entry.path.includes(":");
                return h(
                  "div",
                  {
                    style: {
                      margin: "4px 0",
                      padding: "2px 0 2px 8px",
                      borderLeft: `2px solid ${entry.path === current ? colors.accent : colors.line}`,
                    },
                  },
                  [
                    h(
                      navigable ? "a" : "span",
                      {
                        style: {
                          fontFamily: mono,
                          wordBreak: "break-all",
                          color: colors.fg,
                          ...(navigable ? { cursor: "pointer" } : {}),
                        },
                        ...(navigable
                          ? {
                              onClick: () => void props.router.push(entry.path),
                            }
                          : {}),
                      },
                      entry.path,
                    ),
                    h(
                      "div",
                      {
                        style: {
                          display: "flex",
                          flexWrap: "wrap",
                          gap: "4px",
                          marginTop: "2px",
                        },
                      },
                      [
                        chip(
                          `${entry.rendering} render`,
                          entry.rendering === "server" ? "accent" : "neutral",
                        ),
                        chip(`${entry.fetch} fetch`),
                        chip(`layout: ${entry.layout}`),
                        ...(entry.middleware.some((m) => m.scope === "named")
                          ? [
                              chip(
                                `middleware: ${entry.middleware
                                  .filter((m) => m.scope === "named")
                                  .map((m) => m.name)
                                  .join(", ")}`,
                              ),
                            ]
                          : []),
                      ],
                    ),
                  ],
                );
              })
            : [none()],
          routes.value.length,
        ),
      ];
    };

    const payloadEntries = (title: string, entries: PayloadEntryReport[]) =>
      section(
        title,
        entries.length
          ? entries.map((entry) =>
              h("details", { style: { margin: "4px 0" } }, [
                h(
                  "summary",
                  { style: { cursor: "pointer", fontFamily: mono } },
                  [
                    entry.key,
                    " ",
                    h(
                      "span",
                      { style: { color: colors.dim } },
                      formatBytes(entry.bytes),
                    ),
                  ],
                ),
                h("pre", { style: codeStyle }, entry.json),
              ]),
            )
          : [none()],
        entries.length,
      );

    const payloadPanel = (): VNode[] => {
      const p = payloadReport.value;
      return [
        section("Transferred to the browser", [
          row("size", formatBytes(p.bytes)),
          row("locale", p.locale ?? "-"),
          h(
            "div",
            {
              style: { color: colors.dim, fontSize: "11px", marginTop: "4px" },
            },
            "What the server embedded in the HTML for the first render. Client-side navigations fetch fresh data.",
          ),
        ]),
        payloadEntries("useAsyncData / loaders", p.data),
        payloadEntries("useState", p.state),
        payloadEntries("Errors", p.errors),
        ...(p.error ? [payloadEntries("Error page", [p.error])] : []),
      ];
    };
    return () => {
      const r = report.value;
      const count = props.violations.list.length;
      const errorCount = props.errors.list.length;
      const requests = props.requests?.list ?? [];
      const at = clampPosition(pos);
      const nodes: VNode[] = [
        h(
          "button",
          {
            type: "button",
            title: "Drag to move",
            style: {
              ...buttonStyle,
              right: `${at.right}px`,
              bottom: `${at.bottom}px`,
            },
            "data-noofpi-devtools": "toggle",
            onPointerdown: onPointerDown,
            onPointermove: onPointerMove,
            onPointerup: onPointerUp,
            onPointercancel: onPointerUp,
            onClick: onToggle,
          },
          [
            h("span", {
              style: dotStyle(count || errorCount ? alertColor : colors.accent),
            }),
            h("span", "noofpi"),
            ...(errorCount
              ? [
                  h(
                    "span",
                    { style: badgeStyle },
                    `${errorCount} ${errorCount === 1 ? "error" : "errors"}`,
                  ),
                ]
              : []),
            ...(count
              ? [h("span", { style: badgeStyle }, `${count} CSP`)]
              : []),
          ],
        ),
      ];
      if (open.value) {
        nodes.push(
          h(
            "div",
            {
              style: { ...panelStyle, ...panelPlacement(at) },
              "data-noofpi-devtools": "panel",
            },
            [
              h("div", { style: headerStyle }, [
                h("span", { style: dotStyle(colors.accent) }),
                h(
                  "span",
                  {
                    style: {
                      flex: "1",
                      fontSize: "14px",
                      fontWeight: "700",
                      letterSpacing: ".02em",
                    },
                  },
                  [
                    h("span", { style: { color: colors.accent } }, "noofpi"),
                    h(
                      "span",
                      { style: { color: colors.dim, fontWeight: "500" } },
                      " devtools",
                    ),
                  ],
                ),
                h(
                  "button",
                  {
                    type: "button",
                    "aria-label": "Close devtools",
                    style: closeStyle,
                    onClick: () => (open.value = false),
                  },
                  "\u00d7",
                ),
              ]),
              tabBar({
                errors: errorCount,
                route: undefined,
                routes: routes.value.length,
                payload:
                  payloadReport.value.data.length +
                  payloadReport.value.state.length +
                  payloadReport.value.errors.length,
                doofpi: requests.length,
                csp: count,
              }),
              h("div", { style: bodyStyle }, [
                ...show("route", [
                  section("Route", [
                    row("path", r.path),
                    row("pattern", r.pattern),
                    row("layout", r.layout),
                    row(
                      "mode",
                      h("span", { style: { display: "flex", gap: "6px" } }, [
                        chip(
                          `${r.rendering} render`,
                          r.rendering === "server" ? "accent" : "neutral",
                        ),
                        chip(`${r.fetch} fetch`, "accent"),
                      ]),
                    ),
                  ]),
                  section(
                    "Middleware chain",
                    r.middleware.length
                      ? r.middleware.map((m, index) =>
                          h(
                            "div",
                            {
                              style: {
                                display: "flex",
                                alignItems: "center",
                                gap: "8px",
                                padding: "2px 0",
                              },
                            },
                            [
                              h(
                                "span",
                                { style: { color: colors.dim, width: "14px" } },
                                String(index + 1),
                              ),
                              chip(
                                m.scope,
                                m.scope === "global" ? "neutral" : "accent",
                              ),
                              h(
                                "span",
                                { style: { fontFamily: mono } },
                                m.name,
                              ),
                              ...(m.missing ? [chip("missing", "alert")] : []),
                            ],
                          ),
                        )
                      : [none()],
                    r.middleware.length,
                  ),
                  section("Route rules", [
                    Object.keys(r.rule).length
                      ? h(
                          "div",
                          {
                            style: {
                              fontFamily: mono,
                              wordBreak: "break-all",
                            },
                          },
                          JSON.stringify(r.rule),
                        )
                      : none(),
                  ]),
                ]),
                ...show("routes", routesPanel()),
                ...show("payload", payloadPanel()),
                ...show("doofpi", [
                  ...(requests.length
                    ? [
                        h(
                          "button",
                          {
                            type: "button",
                            style: {
                              ...closeStyle,
                              width: "auto",
                              padding: "2px 10px",
                              borderRadius: "999px",
                              font: `600 11px/1.4 ${sans}`,
                              alignSelf: "flex-end",
                            },
                            onClick: () => (props.requests!.list = []),
                          },
                          "Clear",
                        ),
                      ]
                    : []),
                  section(
                    "doofpi requests",
                    requests.length
                      ? requests.map((entry) => {
                          const { request, detail } = describeRequest(
                            entry,
                            window.location.origin,
                          );
                          return h(
                            "div",
                            {
                              style: {
                                margin: "4px 0",
                                padding: "2px 0 2px 8px",
                                borderLeft: `2px solid ${requestStatus(entry)}`,
                              },
                            },
                            [
                              h(
                                "div",
                                {
                                  style: {
                                    fontFamily: mono,
                                    wordBreak: "break-all",
                                  },
                                },
                                request,
                              ),
                              h(
                                "div",
                                {
                                  style: {
                                    color: colors.dim,
                                    fontSize: "11px",
                                  },
                                },
                                detail,
                              ),
                            ],
                          );
                        })
                      : [none()],
                    requests.length,
                  ),
                ]),
                ...show("csp", [
                  section(
                    "CSP violations",
                    count
                      ? props.violations.list.map((v) =>
                          h(
                            "div",
                            {
                              style: {
                                display: "flex",
                                gap: "8px",
                                padding: "2px 0",
                                alignItems: "baseline",
                              },
                            },
                            [
                              chip(v.directive, "alert"),
                              h(
                                "span",
                                {
                                  style: {
                                    fontFamily: mono,
                                    wordBreak: "break-all",
                                    minWidth: "0",
                                  },
                                },
                                `${v.blocked} ${v.source}`.trim(),
                              ),
                            ],
                          ),
                        )
                      : [none()],
                    count,
                  ),
                ]),
                ...show("errors", errorsPanel()),
              ]),
            ],
          ),
        );
      }
      return nodes;
    };
  },
});

export function mountDevtools(options: {
  router: Router;
  config: DevtoolsConfig;
  /** Keys of the `app/middleware` glob */
  middlewareFiles: string[];
  /** Requests recorded by the doofpi clients */
  requests?: RequestLog;
  /** What the server transferred for the first render (before the app clears it) */
  payload?: PayloadSnapshot;
  /** The app, whose uncaught errors (`app.config.errorHandler`) are shown in the overlay */
  app?: App;
}): () => void {
  const { app: target, ...componentOptions } = options;
  const violations = reactive<{ list: CspViolation[] }>({ list: [] });
  const onViolation = (event: SecurityPolicyViolationEvent) => {
    violations.list = [
      ...violations.list,
      {
        directive: event.effectiveDirective,
        blocked: event.blockedURI || "inline",
        source: event.sourceFile
          ? `${event.sourceFile}:${event.lineNumber}`
          : "",
      },
    ].slice(-MAX_VIOLATIONS);
  };
  document.addEventListener("securitypolicyviolation", onViolation);

  // Errors the server reported while rendering this page come with the HTML; the rest is caught here
  const errors = reactive<{ list: DevError[] }>({ list: [] });
  const addError = (error: DevError) => {
    errors.list = [...errors.list, error].slice(-MAX_ERRORS);
  };
  const serverErrors = document.getElementById(DEV_ERRORS_ELEMENT_ID);
  if (serverErrors) {
    errors.list = parseDevErrors(serverErrors.textContent ?? "");
    serverErrors.remove();
  }
  const onError = (event: ErrorEvent) => {
    if (event.error || event.message)
      addError(toDevError(event.error ?? event.message, "window"));
  };
  const onRejection = (event: PromiseRejectionEvent) =>
    addError(toDevError(event.reason, "promise"));
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  options.router.onError((error) => addError(toDevError(error, "router")));
  if (target) {
    const previous = target.config.errorHandler;
    target.config.errorHandler = (error, instance, info) => {
      addError(toDevError(error, "vue", info));
      // Vue only logs the error itself when no handler is set
      if (previous) previous(error, instance, info);
      else console.error(error);
    };
  }

  const host = document.createElement("div");
  host.id = "__noofpi_devtools";
  document.body.append(host);
  const app = createApp({
    render: () =>
      h(Devtools, {
        ...componentOptions,
        violations,
        errors,
      }),
  });
  app.mount(host);
  return () => {
    document.removeEventListener("securitypolicyviolation", onViolation);
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    app.unmount();
    host.remove();
  };
}
