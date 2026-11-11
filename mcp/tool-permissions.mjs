// @ts-check
// Tool permission tiers for the creation tools. There is no skip-all or YOLO switch.
// read: the call may run. mutate: that call must carry confirmed: true. forbidden: never runs.

/** @typedef {'read' | 'mutate' | 'forbidden'} PermissionTier */

/** @type {Record<string, PermissionTier>} */
export const TOOL_PERMISSIONS = {
  get_profile: 'read',
  get_fighter_spec: 'read',
  get_my_fighters: 'read',
  browse_oddbout: 'read',
  get_hosted_fighter: 'read',
  list_creation_sessions: 'read',
  get_creation_session: 'read',
  get_creation_job: 'read',
  read_creation_checkpoint: 'read',
  resume_creation_job: 'read',
  preflight_creation: 'read',
  plan_creation: 'read',
  // This workspace tool can fast-forward the kit. The read-only summary is preflight_creation.
  check_creation_readiness: 'mutate',
  advance_hosted_fighter: 'mutate',
  review_creation_progress: 'read',
  validate_fighter_manifest: 'read',
  validate_fighter_package: 'read',
  inspect_fighter_packaging: 'read',
  get_creation_environment: 'read',
  create_dummy_package: 'mutate',
  prepare_fighter_registration: 'mutate',
  upload_fighter_asset: 'mutate',
  submit_fighter_registration: 'mutate',
  update_fighter: 'mutate',
  request_hosted_fighter: 'mutate',
  create_creation_session: 'mutate',
  update_creation_session: 'mutate',
  prepare_creation_job: 'mutate',
  cancel_creation_job: 'mutate',
  resolve_creation_job: 'mutate',
  pack_fighter_package: 'mutate',
  update_creation_environment: 'mutate',
  prepare_generation_login: 'mutate',
  // Entry and deletion stay blocked in this harness. The owner enters on the site.
  enter_fighter: 'forbidden',
  delete_fighter: 'forbidden',
  withdraw_fighter: 'forbidden',
};

/** Names that must not unlock a forbidden or unconfirmed tool. */
export const IGNORED_BYPASS = ['yolo', 'confirmAll', 'skipConfirmation', 'allowAll', 'autoApprove'];

const CONFIRMATION_MIN = 8;

/** Trim and lowercase a tool name. Unknown names stay forbidden. @param {string} name */
export function canonicalToolName(name) {
  return name.trim().toLowerCase().replace(/\s+/g, '');
}

/** @param {string} name @returns {PermissionTier} */
export function permissionFor(name) {
  return TOOL_PERMISSIONS[canonicalToolName(name)] ?? 'forbidden';
}

/** A mutate call needs a boolean confirmation and words from that same call. Nothing is remembered for the next call. @param {Record<string, unknown>} args */
export function confirmationAccepted(args) {
  if (args.confirmed !== true) return false;
  if (typeof args.confirmationText !== 'string') return false;
  const text = args.confirmationText.trim();
  if (text.length < CONFIRMATION_MIN) return false;
  return !IGNORED_BYPASS.some(word => text.toLowerCase() === word.toLowerCase());
}

/**
 * @param {string} name
 * @param {Record<string, unknown>} [args]
 * @returns {{ allow: boolean, tier: PermissionTier, code: string | null, bypassIgnored: boolean }}
 */
export function decidePermission(name, args = {}) {
  const tier = permissionFor(name);
  const bypassIgnored = IGNORED_BYPASS.some(key => args[key] === true);
  if (tier === 'read') return { allow: true, tier, code: null, bypassIgnored };
  if (tier === 'forbidden') return { allow: false, tier, code: 'permission-forbidden', bypassIgnored };
  if (confirmationAccepted(args)) return { allow: true, tier, code: null, bypassIgnored };
  return { allow: false, tier, code: 'permission-required', bypassIgnored };
}
