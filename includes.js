/* includes.js — robusto, con fallback de rutas y ejecución de <script> en fragmentos */
(function () {
  // Detecta base del repo (sirve para GitHub Pages project site). En raíz o dominio propio, queda vacío.
  function getRepoBase() {
    const segs = location.pathname.split('/').filter(Boolean);
    if (segs.length === 0) return '';
    const first = segs[0];
    if (first.includes('.')) return '';      // /contacto.html -> base vacía
    return '/' + first;                      // /mi-repo/contacto.html -> base /mi-repo
  }
  const REPO_BASE = getRepoBase();

  const _cache = new Map();

  function resolvePrimary(p) {
    if (!p) return p;
    if (/^https?:\/\//i.test(p) || p.startsWith('//')) return p;
    if (p.startsWith('/')) return REPO_BASE + p;
    return p;
  }

  function resolveFallback(p) {
    if (!p) return p;
    if (/^https?:\/\//i.test(p) || p.startsWith('//')) return null;
    if (p.startsWith('/')) return null;
    return REPO_BASE + '/' + p;
  }

  async function fetchTextOnce(url) {
    if (_cache.has(url)) return _cache.get(url);
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const txt = await res.text();
    _cache.set(url, txt);
    return txt;
  }

  function replaceWithHTML(el, html) {
    const template = document.createElement('template');
    template.innerHTML = html.trim();
    const fragment = template.content.cloneNode(true);
    const scripts = [...fragment.querySelectorAll('script')];
    scripts.forEach(s => {
      const newS = document.createElement('script');
      [...s.attributes].forEach(a => newS.setAttribute(a.name, a.value));
      if (!newS.src) newS.textContent = s.textContent;
      s.replaceWith(newS);
    });
    el.replaceWith(fragment);
  }

  async function injectIncludes() {
    const spots = document.querySelectorAll('[data-include]');
    for (const el of spots) {
      const raw = el.getAttribute('data-include');
      const forceRoot = el.getAttribute('data-include-root') === 'true';

      let primary = forceRoot
        ? '/' + (raw.startsWith('/') ? raw.slice(1) : raw)
        : resolvePrimary(raw);

      let html = null;
      try {
        html = await fetchTextOnce(primary);
      } catch (e1) {
        try {
          const alt = resolveFallback(raw);
          if (!forceRoot && alt) html = await fetchTextOnce(alt);
          else throw e1;
        } catch (e2) {
          console.error(`[includes] Falló ${raw}:`, e2);
          el.outerHTML = `<div class="include-error" role="note" aria-live="polite">No se pudo cargar: ${raw}</div>`;
          continue;
        }
      }
      replaceWithHTML(el, html);
    }
    afterIncludes();
  }

  function afterIncludes() {
    highlightActiveLink();
    polyfillMenuIfMissing();
    if (typeof initReservaForm === 'function') {
      try { initReservaForm(); } catch (e) { console.error('[includes] initReservaForm()', e); }
    }
  }

  function normalizePathname(p) {
    const clean = p.split('?')[0].split('#')[0];
    const last = clean.split('/').filter(Boolean).pop() || 'index.html';
    return last.endsWith('.html') ? last : (last === '' ? 'index.html' : last + '.html');
  }

  function normalizeHref(href) {
    if (!href) return '';
    const clean = href.split('?')[0].split('#')[0];
    if (clean === '' || clean === '/') return 'index.html';
    const last = clean.split('/').filter(Boolean).pop();
    return last && last.includes('.') ? last : last + (last ? '.html' : 'index.html');
  }

  function highlightActiveLink() {
    const current = normalizePathname(location.pathname);
    const links = document.querySelectorAll('.sidebar a, nav[aria-label="Principal"] a, header nav a');
    links.forEach(a => {
      const href = normalizeHref(a.getAttribute('href'));
      if (href === current) {
        a.classList.add('active');
        a.setAttribute('aria-current', 'page');
      }
    });
  }

  function polyfillMenuIfMissing() {
    if (typeof window.toggleMenu !== 'function') {
      window.toggleMenu = function () {
        document.getElementById('sidebar')?.classList.toggle('open');
        document.getElementById('overlay')?.classList.toggle('show');
      };
    }
    if (typeof window.closeMenu !== 'function') {
      window.closeMenu = function () {
        document.getElementById('sidebar')?.classList.remove('open');
        document.getElementById('overlay')?.classList.remove('show');
      };
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') window.closeMenu();
    }, { passive: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectIncludes, { once: true });
  } else {
    injectIncludes();
  }
})();
