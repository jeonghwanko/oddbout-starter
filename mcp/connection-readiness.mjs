// @ts-check
// The kit's public project settings, and the generation and delivery states readiness never verifies. Read-only.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { validProjectUrl } from '../api/client.mjs';
import { isPublishableKey } from '../scripts/login.mjs';

/** @typedef {{ origin: string, apiBase: string, siteUrl: string, publishableKey: string, flags: string }} Project  deploy/creator-site.json, checked. */

/** @param {string} root @returns {Promise<Project | null>} */
export async function readProject(root) {
  try {
    const site = JSON.parse(await readFile(path.join(root, 'deploy/creator-site.json'), 'utf8'));
    const origin = new URL(site.apiBase).origin,
      page = new URL(site.siteUrl);
    if (
      !validProjectUrl(origin) ||
      site.apiBase !== `${origin}/functions/v1/ai-fighter` ||
      !isPublishableKey(site.publishableKey) ||
      !/^[A-Za-z0-9._-]+$/.test(site.publishableKey) ||
      page.protocol !== 'https:' ||
      page.username ||
      page.password ||
      page.search ||
      page.hash
    )
      return null;
    return { origin, apiBase: site.apiBase, siteUrl: page.href, publishableKey: site.publishableKey, flags: `--url ${origin} --key ${site.publishableKey}` };
  } catch {
    return null;
  }
}

/** @param {string | null} [choice] */
export function unverifiedCreation(choice) {
  return {
    generation: {
      status: choice === 'stop' ? 'stopped' : 'unverified',
      providerChoice: choice ?? null,
      accountMatch: 'unknown',
      imageBackend: 'unknown',
      nextAction: {
        actor: 'agent',
        code: 'check-generation-access',
        message:
          '현재 실행 경로의 도구 가용성과 사용자 제약을 확인한다. 실제 호출 trace·완료 출력 전에는 성공을 검증했다고 하지 않는다. 확인용 이미지를 새로 만들지 않는다.',
      },
    },
    delivery: {
      status: 'unverified',
      localSave: 'unchecked',
      librarySave: 'unchecked',
      parentDisplay: 'unverified',
      userSelection: 'unchecked',
      evidenceScope: 'not-observed-by-readiness',
      nextAction: {
        actor: 'agent',
        code: 'check-parent-delivery',
        message:
          '기존 결과를 회수해 대상 부모 대화의 실제 표시·원본 전달 경로를 확인한다. Library 저장·자식 표시·queued·creation:delivery 통과는 부모 표시 성공이 아니다.',
      },
    },
  };
}
