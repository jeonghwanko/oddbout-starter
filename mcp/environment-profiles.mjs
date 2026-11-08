// @ts-check
// Declarative destinations only. A profile is never a script or a network permission.
import { createHash, verify, createPublicKey } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

const host = z
  .string()
  .max(253)
  .regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/)
  .refine(value => !/(^|\.)(localhost|local|internal|test|invalid|example)$/.test(value));
export const profileSchema = z
  .object({
    schemaVersion: z.literal(1),
    revision: z.number().int().positive(),
    id: z.literal('oddbout-creation'),
    coverage: z.literal('bootstrap-only'),
    profiles: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
            label: z.string().min(1).max(100),
            provider: z.enum(['codex', 'grok']),
            capabilities: z
              .array(z.enum(['gpt-image', 'grok-image', 'grok-video']))
              .min(1)
              .max(3),
            destinations: z
              .array(z.object({ host, port: z.literal(443), purpose: z.string().min(1).max(160), stage: z.enum(['login', 'generation', 'download']) }).strict())
              .min(1)
              .max(40),
            unresolved: z.array(z.string().min(1).max(200)).min(1).max(10),
            sources: z.array(z.string().url().startsWith('https://')).max(10),
          })
          .strict(),
      )
      .min(1)
      .max(8),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.profiles.map(p => p.id)).size !== value.profiles.length) ctx.addIssue({ code: 'custom', message: 'duplicate-profile' });
    for (const p of value.profiles)
      if (new Set(p.destinations.map(d => d.host)).size !== p.destinations.length) ctx.addIssue({ code: 'custom', message: 'duplicate-destination' });
  });
/**
 * @typedef {import('zod').infer<typeof profileSchema>} Profile
 * @typedef {{ bundled: Profile, trustedKeys?: Record<string, string>, minimumRevision?: number }} TrustOptions  `trustedKeys` maps a key ID to its PEM.
 */

// Canonical JSON makes the approval bind to content, independent of whitespace/key order.
/** @param {unknown} value @returns {string} */
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map(k => `${JSON.stringify(k)}:${canonical(/** @type {Record<string, unknown>} */ (value)[k])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
/** @type {(value: unknown) => string} */
export const profileHash = value =>
  createHash('sha256')
    .update(canonical(profileSchema.parse(value)))
    .digest('hex');
export async function bundledProfiles() {
  return profileSchema.parse(JSON.parse(await readFile(new URL('../deploy/creation-environments.json', import.meta.url), 'utf8')));
}

/** No trust-on-first-use: new content needs an independently installed Ed25519 public key. @param {unknown} input  Checked here. @param {TrustOptions} options */
export function verifyProfileEnvelope(input, { bundled, trustedKeys = {}, minimumRevision = bundled.revision }) {
  const envelope = z
    .object({ profile: profileSchema, keyId: z.string().max(100).optional(), signature: z.string().max(256).optional() })
    .strict()
    .parse(input);
  const hash = profileHash(envelope.profile);
  if (envelope.profile.revision < minimumRevision) throw Error('profile-rollback-rejected');
  if (hash === profileHash(bundled)) return { profile: envelope.profile, hash, trust: 'bundled-content' };
  const pem = trustedKeys[/** @type {string} */ (envelope.keyId)];
  if (!pem || !envelope.signature) throw Error('profile-signature-required');
  const key = createPublicKey(pem);
  if (key.asymmetricKeyType !== 'ed25519' || !verify(null, Buffer.from(canonical(envelope.profile)), key, Buffer.from(envelope.signature, 'base64')))
    throw Error('profile-signature-invalid');
  return { profile: envelope.profile, hash, trust: 'signed-release' };
}

/** Fixed configured source, bounded response, no redirects and no credentials. @param {string} url @param {TrustOptions & { fetchImpl?: typeof fetch }} options */
export async function fetchProfileEnvelope(url, options) {
  const target = new URL(url);
  host.parse(target.hostname);
  if (target.protocol !== 'https:' || (target.port && target.port !== '443') || target.username || target.password || target.search || target.hash)
    throw Error('profile-source-invalid');
  const response = await (options.fetchImpl ?? fetch)(target, { redirect: 'error', signal: AbortSignal.timeout(8000), credentials: 'omit' });
  if (!response.ok || !response.body) throw Error('profile-download-failed');
  let size = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 65536) throw Error('profile-too-large');
    chunks.push(chunk);
  }
  return verifyProfileEnvelope(JSON.parse(Buffer.concat(chunks).toString('utf8')), options);
}

/** @param {string} output */
export async function publishEnvironmentProfiles(output) {
  const profile = await bundledProfiles();
  const dir = path.join(output, 'creation-environments');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'v1.json'), JSON.stringify({ profile }, null, 2) + '\n', { flag: 'wx' });
  return { path: 'creation-environments/v1.json', revision: profile.revision, hash: profileHash(profile) };
}
