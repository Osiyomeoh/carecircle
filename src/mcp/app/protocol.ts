/**
 * The MCP Apps extension, implemented directly against the base SDK.
 *
 * MCP Apps (SEP-1865, spec dialect 2026-01-26) lets a server ship an interactive
 * view alongside a tool: the tool points at a `ui://` resource, the resource
 * returns self-contained HTML, and the host renders it in a sandboxed iframe that
 * talks back over the *same* JSON-RPC protocol via postMessage.
 *
 * We implement the wire format here rather than depending on
 * `@modelcontextprotocol/ext-apps`, because that package is built against the
 * newer `@modelcontextprotocol/server` split and we target `sdk@1.30.0`. The
 * surface we need is small and entirely declarative - metadata keys and a MIME
 * type - so a dependency would buy us nothing but a version conflict. The
 * constants below are taken from the published extension, not from prose.
 *
 * @see https://blog.modelcontextprotocol.io/posts/2025-11-21-mcp-apps/
 */

/** MIME type identifying an HTML payload as an MCP App view. */
export const APP_MIME_TYPE = 'text/html;profile=mcp-app';

/** Pre-standard metadata key. Older hosts only look here, so we emit both. */
export const LEGACY_RESOURCE_URI_KEY = 'ui/resourceUri';

/** Capability namespace a client uses to advertise MCP Apps support. */
export const APPS_EXTENSION_ID = 'io.modelcontextprotocol/ui';

/** Who may call a tool: the model, the app view, or both (the default). */
export type ToolVisibility = 'model' | 'app';

/**
 * Build the `_meta` that links a tool to its view.
 *
 * The extension moved from a flat `_meta["ui/resourceUri"]` to a nested
 * `_meta.ui.resourceUri`, and hosts in the wild read one or the other. Emitting
 * both is what the official helper does, and it costs two keys.
 */
export function appToolMeta(resourceUri: string, visibility?: ToolVisibility[]) {
  return {
    ui: { resourceUri, ...(visibility ? { visibility } : {}) },
    [LEGACY_RESOURCE_URI_KEY]: resourceUri,
  };
}

/**
 * Whether the connected client can actually render a view.
 *
 * Clients advertise MCP Apps under `capabilities.extensions`, listing the MIME
 * types they can draw. A client that says nothing is a voice surface or a plain
 * text client, and must still get a useful spoken answer - so this is read as a
 * progressive *enhancement* check, never as a gate on the tool existing.
 */
export function clientRendersApps(capabilities: unknown): boolean {
  const extensions = (capabilities as { extensions?: Record<string, unknown> } | null | undefined)
    ?.extensions;
  const ui = extensions?.[APPS_EXTENSION_ID] as { mimeTypes?: unknown } | undefined;
  return Array.isArray(ui?.mimeTypes) && ui.mimeTypes.includes(APP_MIME_TYPE);
}
