// Minimal proof-of-concept: game URL is intentionally fixed and never supplied by a chat prompt.
const GAME_ORIGIN = 'https://oddbout.com';
const GAME_URL = GAME_ORIGIN + '/fighter.html';
const frame = document.querySelector('#game');
const status = document.querySelector('#status');
const start = document.querySelector('#start');
const back = document.querySelector('#back');
const expand = document.querySelector('#expand');
let loaded = false;
let watchdog;
function showLauncher(message) {
  clearTimeout(watchdog);
  frame.style.display = 'none';
  frame.removeAttribute('src');
  loaded = false;
  start.hidden = false;
  back.hidden = true;
  status.textContent = message || '게임 실행 준비 완료';
}
start.addEventListener('click', () => {
  start.disabled = true;
  start.hidden = true;
  back.hidden = false;
  frame.style.display = 'block';
  status.textContent = '게임을 불러오는 중…';
  frame.src = GAME_URL;
  watchdog = setTimeout(() => {
    if (!loaded) status.textContent = '게임 로딩 확인 시간이 초과되었습니다. iframe/CSP 및 로그인 상태를 확인하세요.';
  }, 15000);
});
frame.addEventListener('load', () => {
  loaded = true;
  clearTimeout(watchdog);
  start.disabled = false;
  // iframe load does not prove the game rendered or authenticated.
  status.textContent = '페이지 로드 이벤트 수신. 실제 게임 렌더링·입력은 별도 확인 필요.';
});
frame.addEventListener('error', () => {
  status.textContent = '게임 페이지 로드 오류';
  start.disabled = false;
});
back.addEventListener('click', () => showLauncher('런처로 돌아왔습니다.'));
expand.addEventListener('click', async () => {
  try {
    if (window.openai?.requestDisplayMode) {
      await window.openai.requestDisplayMode({ mode: 'fullscreen' });
    } else {
      status.textContent = 'ChatGPT fullscreen API를 사용할 수 없는 환경입니다.';
    }
  } catch {
    status.textContent = '전체화면 요청이 거부되었습니다.';
  }
});
window.addEventListener('pagehide', () => clearTimeout(watchdog));