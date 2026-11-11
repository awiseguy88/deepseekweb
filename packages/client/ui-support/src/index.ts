/**
 * Node half of the support-request plugin. The browser half in `src/client/`
 * owns every contribution; this entry exists so the package appears as an
 * ordinary Loader row.
 * @module @deepseek-ai/dsh-client-ui-support
 */

/** Loader-visible no-op body; the browser half carries the feature. */
export function apply(): void {}
