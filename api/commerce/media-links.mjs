// @ts-check
/** @typedef {{kind:'youtube'|'twitch-video'|'twitch-clip'|'twitch-live',id:string,url:string}} ExternalVideo */
/** Parse identifiers only. Never fetch arbitrary URLs or accept caller-authored embed HTML.
 * @param {unknown} value @returns {ExternalVideo} */
export function parseMediaLink(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u0020\u007f]/.test(value)) throw new Error('unsupported-video-link');
  let u;
  try {
    u = new URL(value);
  } catch {
    throw new Error('unsupported-video-link');
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) throw new Error('unsupported-video-link');
  const host = u.hostname,
    parts = u.pathname.split('/').filter(Boolean);
  if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtube-nocookie.com'].includes(host)) {
    const id =
      host === 'youtu.be' && parts.length === 1
        ? parts[0]
        : u.pathname === '/watch'
          ? u.searchParams.get('v')
          : ['shorts', 'live', 'embed'].includes(parts[0]) && parts.length === 2
            ? parts[1]
            : null;
    if (id && /^[\w-]{11}$/.test(id)) return { kind: 'youtube', id, url: 'https://www.youtube.com/watch?v=' + id };
  }
  if (host === 'clips.twitch.tv' && parts.length === 1 && /^[A-Za-z0-9_-]{5,100}$/.test(parts[0]))
    return { kind: 'twitch-clip', id: parts[0], url: 'https://clips.twitch.tv/' + parts[0] };
  if (['twitch.tv', 'www.twitch.tv', 'm.twitch.tv'].includes(host)) {
    if (parts[0] === 'videos' && parts.length === 2 && /^\d{1,20}$/.test(parts[1]))
      return { kind: 'twitch-video', id: parts[1], url: 'https://www.twitch.tv/videos/' + parts[1] };
    if (parts[1] === 'clip' && parts.length === 3 && /^[A-Za-z0-9_-]{5,100}$/.test(parts[2]))
      return { kind: 'twitch-clip', id: parts[2], url: 'https://clips.twitch.tv/' + parts[2] };
    if (
      parts.length === 1 &&
      /^[A-Za-z0-9_]{3,25}$/.test(parts[0]) &&
      ![
        'directory',
        'downloads',
        'settings',
        'subscriptions',
        'inventory',
        'wallet',
        'videos',
        'search',
        'turbo',
        'jobs',
        'login',
        'signup',
        'p',
        'store',
      ].includes(parts[0].toLowerCase())
    ) {
      const id = parts[0].toLowerCase();
      return { kind: 'twitch-live', id, url: 'https://www.twitch.tv/' + id };
    }
  }
  throw new Error('unsupported-video-link');
}
/** Build a trusted official iframe address with the actual embedding domain.
 * @param {ExternalVideo} source @param {string} parent @param {boolean} [autoplay] */
export function mediaEmbedUrl(source, parent, autoplay = false) {
  const checked = parseMediaLink(source.url);
  if (checked.kind !== source.kind || checked.id !== source.id || !/^([a-z0-9-]+\.)*[a-z0-9-]+$/i.test(parent)) throw new Error('unsupported-video-link');
  if (source.kind === 'youtube')
    return `https://www.youtube-nocookie.com/embed/${source.id}?${new URLSearchParams({ autoplay: autoplay ? '1' : '0', playsinline: '1', loop: '1', playlist: source.id, rel: '0' })}`;
  const url = new URL(source.kind === 'twitch-clip' ? 'https://clips.twitch.tv/embed' : 'https://player.twitch.tv/');
  url.search = new URLSearchParams({
    [source.kind === 'twitch-clip' ? 'clip' : source.kind === 'twitch-video' ? 'video' : 'channel']:
      source.kind === 'twitch-video' ? 'v' + source.id : source.id,
    parent,
    autoplay: String(autoplay),
    muted: 'false',
  }).toString();
  return url.href;
}
