// @ts-check
// A tool result's text, shared by the workspace and cloud MCP servers. No imports: the kit ships it and the Edge bundle carries it.

/**
 * A result's text for a host that also reads its structured content: the JSON again doubled every result in the conversation (MCP 점검,
 * 2026-10-27; the contract schema is 24 KB), and the spec asks for that copy only as a SHOULD. A small result or a failure stays whole; a
 * large one says where its fields are. The cloud uses it for ChatGPT (the Apps SDK hands the model both) while other hosts keep the whole
 * JSON; the workspace always, since creation:tool prints structuredContent beside it (2026-11-03: get_fighter_spec creation was 146 KB).
 * @param {Record<string, unknown>} value
 */
export function compactText(value) {
  const text = JSON.stringify(value);
  if (text.length <= 1200 || value?.ok === false) return text;
  const parts = Object.entries(value).map(([key, item]) =>
    Array.isArray(item)
      ? `${key}[${item.length}]`
      : item && typeof item === 'object'
        ? `${key}{${Object.keys(item).slice(0, 8).join(',')}${Object.keys(item).length > 8 ? ',…' : ''}}`
        : // A page link for the user is whole or useless (siteUrl, 2026-11-03): a link cut at 40 characters opens nothing.
          `${key}=${(JSON.stringify(item) ?? String(item)).slice(0, key === 'siteUrl' ? 200 : 40)}`,
  );
  return `Full result in structuredContent (${text.length} characters): ${parts.join(', ')}`;
}
