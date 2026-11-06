// @ts-check
/**
 * Merged tools (MCP 통합, 2026-11-05/06). The full edition (/mcp, /signin) listed 55 tools, about 14k tokens in every conversation and past
 * OpenAI's guidance (fewer than 20 functions at a turn's start). Tools of one kind become one tool with a selector (`view`, `kind`, `step`,
 * `action` or `write`): each member keeps its code, arguments and answers, and the selected member checks its own arguments.
 *
 * 1단계 merged read tools only. 2단계 (2026-11-06, after ChatGPT's app review 1.0.3 was approved and published) merged the write tools and
 * the reviewed registration tools too: 55 → 19. A merge never mixes reads with writes, or public tools with signed-in ones, so no read starts
 * asking for approval and no public tool for a sign-in. A merged write is as consequential as its most consequential member: destructive if
 * any member is, retry-safe (idempotent) only if every member is, open-world if any member is.
 * Until ChatGPT's portal showed get_my_fighters published (2단계 A, 24 tools), five reviewed reads stayed listed beside it: OpenAI's continuous
 * review drops a published app's tool as soon as a rescan misses it while a new tool still waits for its checks
 * (developers.openai.com/plugins/deploy/app-review, "Ongoing Maintenance"). The portal's rescan of 2026-11-06 published all 24 with no
 * findings, and 2단계 B unlisted those five (19 tools).
 *
 * Old names keep working, because ChatGPT's published app (1.0.3) and hosts holding an older list call them:
 * - a merged tool may keep its main member's name (upload_fighter_asset): a call without the selector is that member's call, as before;
 * - any other member's name becomes the merged tool's selector (`aliasCall`), and so does a merged tool's own earlier name (`formerly`).
 * Descriptions and instructions in the full edition name merged tools by selector (`renameTools`); a result is renamed only for a call that
 * used the new form, so a client that knows only the old names is never sent to one it does not have.
 *
 * The directory edition (/claude) lists its own tools under their own names: no merge, no alias.
 */
import { z } from 'zod';

/**
 * @typedef {import('./common.mjs').Register} Register
 * @typedef {import('./common.mjs').ToolOptions} ToolOptions
 * @typedef {import('./common.mjs').ToolContext} ToolContext
 * @typedef {{ name: string, key?: string, summary: string, title?: string, views: Record<string, string>, defaultView?: string,
 *   formerly?: string[] }} MergedTool
 * @typedef {{ title: string, description: string, inputSchema: z.ZodRawShape, run: (args: any, context: any) => any, options: ToolOptions }} Held
 * @typedef {(name: string, title: string, description: string, inputSchema: z.ZodRawShape, run: (args: any, context: any) => any,
 *   options?: ToolOptions) => void} RegisterAny
 */

/**
 * The merged tools. `key` names the selector (`view` unless said), `defaultView` the member a call without it reaches (a merged tool that
 * keeps a member's name defaults to that member), `formerly` an earlier name of the merged tool itself.
 * @type {readonly MergedTool[]}
 */
export const MERGED_TOOLS = Object.freeze(/** @type {MergedTool[]} */ ([
  // Reads.
  { name: 'browse_oddbout', title: 'ODDBOUT 둘러보기', summary: 'Read ODDBOUT\'s public records and guides: no sign-in, changes nothing. Choose a view.',
    views: { fighters: 'list_fighters', rankings: 'get_rankings', record: 'get_fighter_record', cup: 'get_cup', bout: 'read_bout',
      story: 'get_fighter_story', world: 'get_world', style_guide: 'get_style_guide', hosts: 'list_generation_hosts' } },
  { name: 'get_my_fighters', title: '내 선수와 계정', formerly: ['get_my_fighter_updates'],
    summary: 'Read the connected user\'s fighters, registrations and account: changes nothing. View list is the default.',
    views: { list: 'list_my_fighters', fighter: 'get_registered_fighter', submission: 'get_fighter_submission', profile_set: 'get_profile_set',
      career: 'get_career', inbox: 'get_workshop_inbox', readiness: 'check_creation_readiness', homepage: 'open_creator_homepage' }, defaultView: 'list' },
  { name: 'get_hosted_fighter', summary: 'Read what the user asked ODDBOUT to make, and the pictures he gave it. View job is the default.',
    views: { job: 'get_hosted_fighter', upload: 'get_picture_upload', link: 'report_picture_link' }, defaultView: 'job' },
  { name: 'check_creator_file', title: '제작 파일 확인', summary: 'Check the creator files this connection received or keeps. Choose a view.',
    views: { input: 'verify_creator_file_input', source: 'get_creator_source' } },
  // Writes.
  { name: 'request_hosted_fighter', key: 'step', defaultView: 'request',
    summary: 'Ask ODDBOUT to make a fighter, and pass on the user\'s answers while it does. Step request is the default.',
    views: { request: 'request_hosted_fighter', choose_look: 'choose_hosted_look', revise_motion: 'revise_hosted_motion', picture_ticket: 'start_picture_upload' } },
  { name: 'prepare_fighter_registration', key: 'kind', defaultView: 'package',
    summary: 'Prepare a private upload: a fighter package (the default), a profile set, or a creator source\'s delivery to a VM.',
    views: { package: 'prepare_fighter_registration', profile_set: 'prepare_profile_set', source_download: 'prepare_creator_source_download' } },
  { name: 'upload_fighter_asset', key: 'kind', defaultView: 'package',
    summary: 'Send one host-attached file: a package asset (the default), a profile-set picture, or a creator source to keep privately.',
    views: { package: 'upload_fighter_asset', profile_set: 'upload_profile_set_asset', creator_source: 'store_creator_source' } },
  { name: 'submit_fighter_registration', key: 'kind', defaultView: 'package',
    summary: 'Submit what the user approved for validation and registration: an uploaded package (the default), a profile set, or a hosted fighter.',
    views: { package: 'submit_fighter_registration', profile_set: 'submit_profile_set', hosted: 'register_hosted_fighter' } },
  { name: 'update_fighter', key: 'kind', title: '선수 고치기', summary: 'Edit the connected user\'s registered fighter: its profile or its fighting style. Choose a kind.',
    views: { profile: 'update_fighter_profile', style: 'update_fighter_style' } },
  { name: 'enter_fighter', key: 'action', defaultView: 'enter',
    summary: 'Enter the connected user\'s fighter into public play (the default) or withdraw it.', views: { enter: 'enter_fighter', withdraw: 'withdraw_fighter' } },
  { name: 'write_story', key: 'write', title: '사연과 공방 쓰기',
    summary: 'Write in ODDBOUT\'s stories as the connected user: a canon, a workshop note or its answer, a relation, a world or a world post. Public. Choose what to write.',
    views: { canon: 'update_fighter_canon', note: 'post_workshop_note', resolve: 'resolve_workshop_note', relation: 'set_fighter_relation',
      world: 'manage_world', world_post: 'write_world_post' } },
  { name: 'manage_career', key: 'action', title: '커리어 관리', summary: 'Run the connected user\'s career: enter a cup, make a career cup\'s prep or set the auto manager. Choose an action.',
    views: { enter: 'enter_cup', choose_prep: 'choose_career_prep', auto: 'set_career_auto' } },
]));

const BY_NAME = new Map(MERGED_TOOLS.map(merged => [merged.name, merged]));
/** @param {MergedTool} merged */
const keyOf = merged => merged.key ?? 'view';
/** Each member's merged tool and selector value. */
const MEMBERS = new Map(MERGED_TOOLS.flatMap(merged => Object.entries(merged.views).map(([view, member]) => [member, { tool: merged.name, key: keyOf(merged), view }])));
/**
 * The names that are no longer listed: other members, as their merged tool's selector, and merged tools' earlier names (`view` null: the
 * call keeps its own selector).
 * @type {Map<string, { tool: string, key: string, view: string | null }>}
 */
export const ALIASES = new Map(/** @type {[string, { tool: string, key: string, view: string | null }][]} */ ([
  ...[...MEMBERS].filter(([member, { tool }]) => member !== tool),
  ...MERGED_TOOLS.flatMap(merged => (merged.formerly ?? []).map(name => [name, { tool: merged.name, key: keyOf(merged), view: null }])),
]));

/** How a text names a member in the full edition. @param {string} member */
export const toolRef = member => {
  const alias = ALIASES.get(member);
  return !alias ? member : alias.view === null ? alias.tool : `${alias.tool}(${alias.key}=${alias.view})`;
};
const ALIAS_NAMES = new RegExp(`\\b(${[...ALIASES.keys()].join('|')})\\b`, 'g');
/** A text with every merged-away name written as its merged tool and selector. @param {string} text */
export const renameTools = text => text.replace(ALIAS_NAMES, toolRef);
/** A result with every string renamed (`renameTools`), for a caller that uses the new names. @param {unknown} value @returns {any} */
export const renameDeep = value => typeof value === 'string' ? renameTools(value)
  : Array.isArray(value) ? value.map(renameDeep)
  : value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype
    ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, renameDeep(entry)])) : value;

/**
 * A tools/call to a name that is no longer listed, as its merged tool (any other request unchanged).
 * @param {any} body
 */
export function aliasCall(body) {
  const alias = body?.method === 'tools/call' ? ALIASES.get(body.params?.name) : undefined;
  if (!alias) return body;
  const given = body.params.arguments;
  const args = given && typeof given === 'object' && !Array.isArray(given) ? given : {};
  return { ...body, params: { ...body.params, name: alias.tool, arguments: alias.view === null ? args : { ...args, [alias.key]: alias.view } } };
}

/**
 * The member a call reaches: the selected member of a merged tool (its default without a selector), else the tool itself (also for a
 * selector value the tool does not have).
 * @param {unknown} name @param {unknown} args
 */
export function memberOf(name, args) {
  const merged = typeof name === 'string' ? BY_NAME.get(name) : undefined;
  if (!merged) return name;
  const key = keyOf(merged);
  const given = args && typeof args === 'object' && key in args ? /** @type {Record<string, unknown>} */ (args)[key] : undefined;
  const view = given ?? merged.defaultView;
  return typeof view === 'string' && Object.hasOwn(merged.views, view) ? merged.views[view] : name;
}

/** Whether a schema may be left out (optional, or with a default). @param {z.ZodType} schema */
const optional = schema => schema.safeParse(undefined).success;
/** A member's arguments for its line in the description: `a, b?`. @param {z.ZodRawShape} shape */
const argumentsOf = shape => Object.entries(shape).map(([key, schema]) => `${key}${optional(/** @type {z.ZodType} */ (schema)) ? '?' : ''}`).join(', ');
/** @param {z.ZodType} schema */
const shapeKey = schema => JSON.stringify(z.toJSONSchema(schema.optional()));

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
    // A tool that was not merged has no old name to be called by, so its results name merged tools as its description does
    // (2단계 B, 2026-11-06: get_fighter_spec's creation steps still named the profile-set and submission tools by their old names).
    else registerTool(name, title, renamed, inputSchema,
      async (/** @type {any} */ args, /** @type {ToolContext} */ context) => renameDeep(await run(args, context)), options);
  };
  const finish = () => {
    for (const merged of MERGED_TOOLS) {
      const key = keyOf(merged);
      const views = Object.entries(merged.views).flatMap(([view, member]) => {
        const entry = held.get(member);
        return entry ? [{ view, member, entry }] : [];
      });
      if (!views.length) continue;
      const options = views.map(({ entry }) => entry.options);
      const write = options[0].write === true;
      if (options.some(option => (option.write === true) !== write)) throw Error(`${merged.name}: its members mix reads and writes`);
      if (options.some(option => option.profile)) throw Error(`${merged.name}: a profile tool does not merge`);
      const publicTool = options.every(option => option.publicTool === true);
      if (!publicTool && options.some(option => option.publicTool === true)) throw Error(`${merged.name}: its members need different sign-ins`);
      const names = /** @type {[string, ...string[]]} */ (views.map(({ view }) => view));
      const hasDefault = merged.defaultView !== undefined && names.includes(merged.defaultView);
      // No zod default: a call that leaves the selector out is told apart from one that names it (see `rename` below).
      /** @type {Record<string, z.ZodType>} */
      const shape = { [key]: hasDefault ? z.enum(names).optional() : z.enum(names) };
      /** @type {Map<string, Map<string, z.ZodType>>} */
      const variants = new Map();
      for (const { member, entry } of views) {
        for (const [name, schema] of Object.entries(entry.inputSchema)) {
          if (name === key) throw Error(`${member}: a merged member cannot take "${key}"`);
          const forms = variants.get(name) ?? new Map();
          forms.set(shapeKey(/** @type {z.ZodType} */ (schema)), /** @type {z.ZodType} */ (schema));
          variants.set(name, forms);
        }
      }
      // An argument several members take in different shapes is any of them here; the selected member checks its own.
      for (const [name, forms] of variants) {
        const schemas = [...forms.values()];
        shape[name] = (schemas.length === 1 ? schemas[0] : z.union(/** @type {[z.ZodType, z.ZodType, ...z.ZodType[]]} */ (schemas))).optional();
      }
      const lines = views.map(({ view, member, entry }) => `${key}=${view}${view === merged.defaultView ? ' (default)' : ''}`
        + `${member === merged.name ? '' : ` (was ${member})`}`
        + `${Object.keys(entry.inputSchema).length ? ` [${argumentsOf(entry.inputSchema)}]` : ''}: ${entry.description}`);
      const own = held.get(merged.name);
      const diagnostic = new Set(views.filter(({ entry }) => entry.options.diagnostic === true).map(({ view }) => view));
      const keepsMemberName = Object.values(merged.views).includes(merged.name);
      /** @param {Record<string, unknown>} args */
      const selected = args => /** @type {string} */ (args[key] ?? merged.defaultView);
      registerTool(merged.name, merged.title ?? own?.title ?? merged.name, `${merged.summary}\n${lines.join('\n')}`, shape,
        async (/** @type {Record<string, unknown>} */ args, /** @type {ToolContext} */ context) => {
          const { [key]: given, ...rest } = args;
          const chosen = views.find(candidate => candidate.view === selected(args)) ?? views[0];
          // Each member checks its own arguments: the merged schema leaves them all optional.
          const parsed = z.object(chosen.entry.inputSchema).safeParse(rest);
          if (!parsed.success) {
            return { ok: false, code: 'invalid-arguments', [key]: chosen.view,
              issues: parsed.error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })),
              next: `${key}=${chosen.view} takes ${argumentsOf(chosen.entry.inputSchema) || 'no arguments'}.` };
          }
          const value = await chosen.entry.run(parsed.data, context);
          // Results name merged tools only for a caller that used the new form: a new tool name, or the selector itself. A call by an old
          // name (an alias, or a kept member name without its selector) comes from a client that may know only the old names.
          const rename = !context?.legacy && (!keepsMemberName || given !== undefined);
          return rename ? renameDeep(value) : value;
        }, {
          write, publicTool,
          publish: options.some(option => option.publish === true),
          idempotent: options.every(option => option.idempotent ?? !write),
          openWorld: options.some(option => option.openWorld === true),
          files: [...new Set(options.flatMap(option => option.files ?? []))],
          diagnostic: diagnostic.size ? args => diagnostic.has(selected(args)) : false,
          logAs: args => String(memberOf(merged.name, args)),
        });
    }
  };
  return { register: /** @type {Register} */ (/** @type {unknown} */ (hold)), finish };
}
