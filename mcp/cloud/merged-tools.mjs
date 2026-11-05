// @ts-check
/**
 * Merged read tools (MCP 통합 1단계, 2026-11-05). The full edition (/mcp, /signin) listed 55 tools, about 14k tokens in every conversation and
 * past OpenAI's guidance (fewer than 20 functions at a turn's start). Read tools of one kind become one tool with a `view`: each member keeps
 * its code, arguments and answers, and a view checks its member's own arguments. Only read tools merge, and only with tools that need the
 * same sign-in (all public or all signed in), so no host's approval prompt or sign-in changes.
 *
 * Left as they are: the tools ChatGPT's app review covers (1.0.3, pending since 2026-10-24: docs/records/CLOUD-PLUGIN-REVIEW.md) — the
 * registration family, get_fighter_spec to the deletion tools — so the live tools behind that review keep their names and definitions; and
 * the directory edition (/claude), which lists its own tools under their own names.
 *
 * A member's own name still answers: a host that keeps an older list (ChatGPT until its tools are refreshed, a 2026-07-28 client for up to five
 * minutes) calls it, and the call becomes its merged tool's view (`aliasCall`). Texts in the full edition name the merged tool and view
 * instead (`renameTools`).
 */
import { z } from 'zod';

/**
 * @typedef {import('./common.mjs').Register} Register
 * @typedef {import('./common.mjs').ToolOptions} ToolOptions
 * @typedef {{ name: string, summary: string, title?: string, views: Record<string, string>, defaultView?: string }} MergedTool
 * @typedef {{ title: string, description: string, inputSchema: z.ZodRawShape, run: (args: any, context: any) => any, options: ToolOptions }} Held
 * @typedef {(name: string, title: string, description: string, inputSchema: z.ZodRawShape, run: (args: any, context: any) => any,
 *   options?: ToolOptions) => void} RegisterAny
 */

/**
 * The merged tools, each a view per member. A merged tool may keep a member's name (get_hosted_fighter): that member is its default view,
 * so a call without a view is the member's call as before.
 * @type {readonly MergedTool[]}
 */
export const MERGED_TOOLS = Object.freeze(/** @type {MergedTool[]} */ ([
  { name: 'browse_oddbout', title: 'ODDBOUT 둘러보기', summary: 'Read ODDBOUT\'s public records and guides: no sign-in, changes nothing. Choose a view.',
    views: { fighters: 'list_fighters', rankings: 'get_rankings', record: 'get_fighter_record', cup: 'get_cup', bout: 'read_bout',
      story: 'get_fighter_story', world: 'get_world', style_guide: 'get_style_guide', hosts: 'list_generation_hosts' } },
  { name: 'get_hosted_fighter', summary: 'Read what the user asked ODDBOUT to make, and the pictures he gave it. View job is the default.',
    views: { job: 'get_hosted_fighter', upload: 'get_picture_upload', link: 'report_picture_link' }, defaultView: 'job' },
  { name: 'get_my_fighter_updates', title: '내 선수 소식', summary: 'Read news about the connected user\'s fighters. Changes nothing. Choose a view.',
    views: { profile_set: 'get_profile_set', career: 'get_career', inbox: 'get_workshop_inbox' } },
  { name: 'check_creator_file', title: '제작 파일 확인', summary: 'Check the creator files this connection received or keeps. Choose a view.',
    views: { input: 'verify_creator_file_input', source: 'get_creator_source' } },
]));

const BY_NAME = new Map(MERGED_TOOLS.map(merged => [merged.name, merged]));
/** Each member's merged tool and view. */
const MEMBERS = new Map(MERGED_TOOLS.flatMap(merged => Object.entries(merged.views).map(([view, member]) => [member, { tool: merged.name, view }])));
/** The members whose names are not their merged tool's: calls to them become a view. */
export const ALIASES = new Map([...MEMBERS].filter(([member, { tool }]) => member !== tool));

/** How a text names a member in the full edition. @param {string} member */
export const toolRef = member => {
  const alias = ALIASES.get(member);
  return alias ? `${alias.tool}(view=${alias.view})` : member;
};
const ALIAS_NAMES = new RegExp(`\\b(${[...ALIASES.keys()].join('|')})\\b`, 'g');
/** A text with every merged-away member named as its merged tool and view. @param {string} text */
export const renameTools = text => text.replace(ALIAS_NAMES, toolRef);

/**
 * A tools/call to a member's own name, as its merged tool's view (any other request unchanged). A call that already names a view keeps the
 * member's: the member decides, as before.
 * @param {any} body
 */
export function aliasCall(body) {
  const alias = body?.method === 'tools/call' ? ALIASES.get(body.params?.name) : undefined;
  if (!alias) return body;
  const given = body.params.arguments;
  const args = given && typeof given === 'object' && !Array.isArray(given) ? given : {};
  return { ...body, params: { ...body.params, name: alias.tool, arguments: { ...args, view: alias.view } } };
}

/**
 * The member a call reaches: a merged tool's view's member, else the tool itself (also for a view it does not have).
 * @param {unknown} name @param {unknown} args
 */
export function memberOf(name, args) {
  const merged = typeof name === 'string' ? BY_NAME.get(name) : undefined;
  if (!merged) return name;
  const view = args && typeof args === 'object' && 'view' in args ? /** @type {{ view: unknown }} */ (args).view : merged.defaultView;
  return typeof view === 'string' && Object.hasOwn(merged.views, view) ? merged.views[view] : name;
}

/** Whether a schema may be left out (optional, or with a default). @param {z.ZodType} schema */
const optional = schema => schema.safeParse(undefined).success;
/** A view's arguments for its line in the description: `a, b?`. @param {z.ZodRawShape} shape */
const argumentsOf = shape => Object.entries(shape).map(([key, schema]) => `${key}${optional(/** @type {z.ZodType} */ (schema)) ? '?' : ''}`).join(', ');

/**
 * The full edition's `register`: a merged tool's members wait for `finish`, which registers each merged tool once its members are known (the
 * tool families list some only with the arena key or hosted generation); every other tool registers at once. Descriptions name merged tools.
 * @param {RegisterAny} registerTool
 * @returns {{ register: Register, finish: () => void }}
 */
export function mergingRegister(registerTool) {
  /** @type {Map<string, Held>} */
  const held = new Map();
  /** @type {RegisterAny} */
  const hold = (name, title, description, inputSchema, run, options = {}) => {
    const renamed = renameTools(description);
    if (MEMBERS.has(name)) held.set(name, { title, description: renamed, inputSchema, run, options });
    else registerTool(name, title, renamed, inputSchema, run, options);
  };
  const finish = () => {
    for (const merged of MERGED_TOOLS) {
      const views = Object.entries(merged.views).flatMap(([view, member]) => {
        const entry = held.get(member);
        return entry ? [{ view, member, entry }] : [];
      });
      if (!views.length) continue;
      const options = views.map(({ entry }) => entry.options);
      if (options.some(option => option.write || option.publish || option.profile)) throw Error(`${merged.name}: only read tools merge`);
      const publicTool = options.every(option => option.publicTool === true);
      if (!publicTool && options.some(option => option.publicTool === true)) throw Error(`${merged.name}: its members need different sign-ins`);
      const names = /** @type {[string, ...string[]]} */ (views.map(({ view }) => view));
      const viewSchema = z.enum(names);
      /** @type {Record<string, z.ZodType>} */
      const shape = { view: merged.defaultView && names.includes(merged.defaultView) ? viewSchema.default(merged.defaultView) : viewSchema };
      for (const { member, entry } of views) {
        for (const [key, schema] of Object.entries(entry.inputSchema)) {
          if (key === 'view') throw Error(`${member}: a merged member cannot take "view"`);
          const loose = /** @type {z.ZodType} */ (schema).optional();
          if (shape[key] && JSON.stringify(z.toJSONSchema(shape[key])) !== JSON.stringify(z.toJSONSchema(loose))) {
            throw Error(`${merged.name}: ${member} takes ${key} in another shape than an earlier view`);
          }
          shape[key] ??= loose;
        }
      }
      const lines = views.map(({ view, member, entry }) => `view=${view}${member === merged.name ? '' : ` (was ${member})`}`
        + `${Object.keys(entry.inputSchema).length ? ` [${argumentsOf(entry.inputSchema)}]` : ''}: ${entry.description}`);
      const own = held.get(merged.name);
      const diagnostic = new Set(views.filter(({ entry }) => entry.options.diagnostic === true).map(({ view }) => view));
      registerTool(merged.name, merged.title ?? own?.title ?? merged.name, `${merged.summary}\n${lines.join('\n')}`, shape,
        async (/** @type {Record<string, unknown>} */ args, /** @type {unknown} */ context) => {
          const { view, ...rest } = args;
          const chosen = views.find(candidate => candidate.view === view) ?? views[0];
          // Each view checks its member's own arguments: the merged schema leaves them all optional.
          const parsed = z.object(chosen.entry.inputSchema).safeParse(rest);
          if (!parsed.success) {
            return { ok: false, code: 'invalid-arguments', view: chosen.view,
              issues: parsed.error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })),
              next: `view=${chosen.view} takes ${argumentsOf(chosen.entry.inputSchema) || 'no arguments'}.` };
          }
          return chosen.entry.run(parsed.data, context);
        }, {
          publicTool, openWorld: options.some(option => option.openWorld === true),
          files: [...new Set(options.flatMap(option => option.files ?? []))],
          diagnostic: diagnostic.size ? args => diagnostic.has(String(args.view)) : false,
          logAs: args => String(memberOf(merged.name, args)),
        });
    }
  };
  return { register: /** @type {Register} */ (/** @type {unknown} */ (hold)), finish };
}
