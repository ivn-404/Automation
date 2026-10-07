/**
 * Browser-side click capture (string script — no DOM types in Node TS).
 * Reports iframe vs host, canvas vs DOM, overlay interception.
 */

export const INSTALL_CLICK_CAPTURE_FN = `(() => {
  const w = window;
  const ATTRS = ['id','class','role','name','type','placeholder','title','aria-label','data-testid','data-test','href'];

  const pointFromEvent = (event) => {
    if (event.touches && event.touches.length > 0) {
      return { x: event.touches[0].clientX, y: event.touches[0].clientY };
    }
    if (event.changedTouches && event.changedTouches.length > 0) {
      return { x: event.changedTouches[0].clientX, y: event.changedTouches[0].clientY };
    }
    if (typeof event.clientX === 'number' && typeof event.clientY === 'number') {
      return { x: event.clientX, y: event.clientY };
    }
    return null;
  };

  const canvasHit = (clientX, clientY) => {
    const canvases = Array.from(document.querySelectorAll('canvas'));
    for (let i = canvases.length - 1; i >= 0; i--) {
      const rect = canvases[i].getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) continue;
      return {
        hit: true,
        nx: Math.round(((clientX - rect.left) / rect.width) * 10000) / 10000,
        ny: Math.round(((clientY - rect.top) / rect.height) * 10000) / 10000,
        box: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      };
    }
    return { hit: false };
  };

  const collectAttrs = (el) => {
    const out = {};
    if (!el || !el.getAttribute) return out;
    for (const key of ATTRS) {
      const value = el.getAttribute(key);
      if (value) out[key] = value;
    }
    return out;
  };

  const elementInfo = (el) => {
    if (!el || el === document.documentElement || el === document.body) return null;
    const tagName = (el.tagName || '').toLowerCase();
    if (!tagName) return null;
    const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    const text = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 80);
    return {
      tagName,
      id: el.id || '',
      className: typeof el.className === 'string' ? el.className : '',
      text,
      role: el.getAttribute && el.getAttribute('role') || '',
      name: el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('name') || ''),
      attributes: collectAttrs(el),
      boundingBox: rect ? { x: rect.left, y: rect.top, width: rect.width, height: rect.height } : undefined,
    };
  };

  const overlayAt = (clientX, clientY) => {
    const stack = document.elementsFromPoint ? document.elementsFromPoint(clientX, clientY) : [];
    for (const el of stack) {
      if (!el || el === document.documentElement || el === document.body) continue;
      const style = window.getComputedStyle(el);
      const opacity = Number(style.opacity);
      const hidden = style.visibility === 'hidden' || style.display === 'none';
      const transparent = opacity === 0;
      const loading = (el.className || '').toString().indexOf('loading') !== -1;
      const fullBleed = el.getBoundingClientRect && el.getBoundingClientRect().width >= window.innerWidth * 0.9;
      if (loading || ((hidden || transparent) && fullBleed) || (style.pointerEvents !== 'none' && (transparent || hidden))) {
        const cls = (el.className || '').toString().trim().split(/\\s+/)[0];
        return {
          detected: true,
          selector: el.tagName.toLowerCase() + (cls ? '.' + cls : ''),
          visibility: hidden ? 'hidden' : style.visibility,
          opacity: style.opacity,
          pointerEvents: style.pointerEvents,
          interceptPossible: style.pointerEvents !== 'none',
        };
      }
    }
    return { detected: false, interceptPossible: false };
  };

  const handler = (event) => {
    const pt = pointFromEvent(event);
    if (!pt) return;
    const canvas = canvasHit(pt.x, pt.y);
    const top = document.elementFromPoint ? document.elementFromPoint(pt.x, pt.y) : null;
    const inIframe = window !== window.top;
    let surface = 'host-dom';
    if (inIframe && canvas.hit) surface = 'iframe-canvas';
    else if (inIframe) surface = 'iframe-dom';
    else if (canvas.hit) surface = 'host-canvas';
    const payload = {
      surface,
      inGameIframe: inIframe,
      pageUrl: location.href,
      frameUrl: location.href,
      clientX: pt.x,
      clientY: pt.y,
      normalizedX: canvas.hit ? canvas.nx : Math.round((pt.x / (window.innerWidth || 1)) * 10000) / 10000,
      normalizedY: canvas.hit ? canvas.ny : Math.round((pt.y / (window.innerHeight || 1)) * 10000) / 10000,
      element: elementInfo(top),
      overlay: overlayAt(pt.x, pt.y),
      timestamp: new Date().toISOString(),
    };
    const report = w.sgapRecordClick;
    if (typeof report === 'function') Promise.resolve(report(payload)).catch(() => undefined);
  };

  if (w.__sgapRecorderHandler) {
    window.removeEventListener('pointerdown', w.__sgapRecorderHandler, true);
    window.removeEventListener('mousedown', w.__sgapRecorderHandler, true);
    window.removeEventListener('touchstart', w.__sgapRecorderHandler, true);
  }
  w.__sgapRecorderHandler = handler;
  window.addEventListener('pointerdown', handler, true);
  window.addEventListener('mousedown', handler, true);
  window.addEventListener('touchstart', handler, true);
  return { ok: true, canvases: document.querySelectorAll('canvas').length, inIframe: window !== window.top };
})()`;
