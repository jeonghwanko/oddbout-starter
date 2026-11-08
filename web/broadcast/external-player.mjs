import { parseMediaLink, mediaEmbedUrl } from './media-links.mjs';

// Official players keep their own controls. A provider frame loading is not proof that video played.
export function mountExternal(container, source, { autoplay = false } = {}) {
  const checked = parseMediaLink(source.url),
    twitch = checked.kind.startsWith('twitch');
  const frame = document.createElement('iframe');
  frame.title = twitch ? 'Twitch video' : 'YouTube video';
  frame.className = 'external-video';
  frame.allow = 'autoplay; fullscreen; picture-in-picture';
  frame.allowFullscreen = true;
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  const link = document.createElement('a');
  link.href = checked.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.className = 'external-original';
  const url = mediaEmbedUrl(checked, location.hostname, autoplay);
  const resize = () => {
    // Twitch requires a 400x300 player. Offer its full player instead of cropping controls on a small screen.
    const tooNarrow = twitch && container.clientWidth < 400;
    frame.hidden = tooNarrow;
    link.textContent = tooNarrow ? 'Open on Twitch to play' : `Open on ${twitch ? 'Twitch' : 'YouTube'} ↗`;
    if (tooNarrow) frame.removeAttribute('src');
    else if (frame.getAttribute('src') !== url) frame.src = url;
  };
  container.replaceChildren(frame, link);
  container.hidden = false;
  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  return () => {
    observer.disconnect();
    frame.removeAttribute('src');
    container.replaceChildren();
    container.hidden = true;
  };
}
