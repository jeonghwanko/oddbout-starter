// @ts-check
// Classify only observable transport failures. Never return raw messages (URLs/tokens may be present).
/** @param {any} error  Anything thrown; only its codes and messages are read. @returns {string} */
export function transportCode(error) {
  const seen = new Set(),
    queue = [error],
    messages = [],
    codes = [];
  while (queue.length && seen.size < 12) {
    const item = queue.shift();
    if (!item || seen.has(item)) continue;
    seen.add(item);
    messages.push(String(item.message ?? ''));
    codes.push(item.code, item.name);
    if (item.cause) queue.push(item.cause);
    if (Array.isArray(item.errors)) queue.push(...item.errors.slice(0, 8));
  }
  const message = messages.join(' ');
  const preserved = [...codes, ...messages].find(value => value !== 'api-unreachable' && isTransportCode(value));
  if (preserved) return preserved;
  if (/\b(?:CONNECT|tunnel|proxy)\b[^\n]{0,160}\b403\b/i.test(message)) return 'network-connect-forbidden';
  if (codes.some(code => ['TimeoutError', 'AbortError', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'].includes(code))) return 'network-timeout';
  if (codes.some(code => ['ENOTFOUND', 'EAI_AGAIN'].includes(code))) return 'network-dns-failed';
  return 'api-unreachable';
}

/** @type {(code: string) => boolean} */
export const isTransportCode = code => ['network-connect-forbidden', 'network-timeout', 'network-dns-failed', 'api-unreachable'].includes(code);

/** @param {string} code */
export function connectionAction(code) {
  if (code === 'client-account-changed')
    return {
      actor: 'agent',
      code: 'check-workspace-owner',
      message:
        '실행 중인 작업 공간의 계정이 바뀌었다. 제출을 멈추고 작업 소유자를 확인한다. 다른 사용자라면 전용 작업 공간을 사용하며 기존 패키지를 자동 제출하지 않는다.',
    };
  if (code === 'network-connect-forbidden')
    return {
      actor: 'environment-preparer',
      code: 'prepare-workspace-network',
      message:
        '클라우드 연결 프록시가 CONNECT 요청을 차단했다. 환경 준비자가 해당 호스트의 공식 네트워크 설정·관리자 정책을 확인한다. Work 기본 클라우드와 사용자 지정 Codex 환경을 구분하고, Republish는 해당 환경이 지원할 때만 안내한다. 키트는 네트워크 설정을 변경할 수 없다. Google 재로그인으로 해결하지 않는다.',
    };
  if (isTransportCode(code))
    return {
      actor: 'environment-preparer',
      code: 'check-workspace-connectivity',
      message:
        'VM에서 서비스까지 연결하지 못했다. 네트워크·DNS·시간 제한을 확인하고 복구 후 기존 작업을 다시 조회한다. 원인이 불명확하면 허용목록 누락이나 계정 오류로 단정하지 않는다.',
    };
  if (['authentication-required', 'client-sign-in-required', 'api-http-401'].includes(code))
    return {
      actor: 'user',
      code: 'sign-in-again',
      message:
        '본인 Google 계정으로 다시 로그인한다: npm run login (브라우저가 다른 기기에 있으면 npm run login -- --device). 콜백 주소나 토큰을 대화로 보내지 않는다.',
    };
  if (['forbidden', 'access-denied', 'api-http-403'].includes(code))
    return {
      actor: 'service-operator',
      code: 'check-service-access',
      message: '서비스가 요청을 거부했다. VM CONNECT 차단과 구분하여 계정·서비스 정책을 확인한다. 자동 재로그인이나 보안 설정 우회는 하지 않는다.',
    };
  return {
    actor: 'agent',
    code: 'recheck-connection',
    message: '응답을 확인한 뒤 같은 작업 공간의 연결 상태를 다시 조회한다. 새 생성이나 등록으로 연결을 시험하지 않는다.',
  };
}
