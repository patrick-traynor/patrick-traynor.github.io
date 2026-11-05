// Everything HTML: the landing page, the placards, the in-museum guide, the prompt.
// All text comes from exhibits.json, so the landing page works even if 3D never loads.
const $ = (id) => document.getElementById(id);

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) if (c != null && c !== false) n.append(c);
  return n;
}

// replaceChildren() doesn't flatten arrays or skip nulls, so do that first.
const fill = (node, ...kids) => node.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));

export const catalogueNo = (i) => `EXH. ${String(i + 1).padStart(2, '0')}`;

export function createUI(data, h) {
  const { site, exhibits } = data;
  const byId = new Map(exhibits.map((e, i) => [e.id, { entry: e, index: i }]));
  const wings = [];
  for (const e of exhibits) if (!wings.includes(e.wing ?? 'Other')) wings.push(e.wing ?? 'Other');

  const stack = [];
  let markers = new Set();
  let walkable = false;
  let mode = 'start';
  let paused = false;

  // ---------- Landing page text ----------
  $('site-name').textContent = site.name;
  $('foot-name').textContent = site.name;
  $('site-role').textContent = site.role;
  $('site-intro').textContent = site.intro;
  fill($('site-contact'), contactItems());
  $('guide-count').textContent =
    `A quick summary of my work.`;
  $('enter-hint').textContent = h.touch
    ? 'Left thumb walks, right thumb looks, tap a label to inspect.'
    : 'WASD to walk, mouse to look, E to inspect, G for the guide.';
  renderLanding();

  $('btn-enter').addEventListener('click', () => h.onEnter());
  $('hud-guide').addEventListener('click', () => openGuide());
  $('hud-exit').addEventListener('click', () => h.onExit());
  $('paused-resume').addEventListener('click', () => { showPaused(false); h.onResume(); });
  $('paused-guide').addEventListener('click', () => openGuide());
  $('paused-exit').addEventListener('click', () => { showPaused(false); h.onExit(); });
  $('prompt').addEventListener('click', () => h.onInteract());

  // ---------- Shared pieces ----------
  function contactItems() {
    const items = (site.links ?? []).map((l) =>
      el('li', {}, el('a', { href: l.url, target: '_blank', rel: 'noopener' }, l.label, el('span', { 'aria-hidden': 'true', text: ' ↗' }))));
    if (site.email) {
      const addr = el('span', { class: 'addr', text: site.email });
      items.push(el('li', { class: 'email' }, addr,
        el('button', { class: 'chip copper', type: 'button', onclick: (e) => copy(site.email, addr, e.currentTarget) }, 'Copy email')));
    }
    return items;
  }

  function listing() {
    return wings.map((w) => {
      const items = exhibits.map((e, i) => ((e.wing ?? 'Other') === w ? lot(e, i) : null)).filter(Boolean);
      return el('section', { class: 'wing' },
        el('h3', {}, el('span', { text: `${w} wing` }), el('span', { class: 'wing-count', text: `${items.length} ${items.length === 1 ? 'exhibit' : 'exhibits'}` })),
        el('ol', { class: 'listing' }, items));
    });
  }

  function lot(e, i) {
    return el('li', { class: 'lot' },
      el('span', { class: 'lot-no', text: catalogueNo(i) }),
      el('div', { class: 'lot-body' },
        el('h4', { text: e.title }),
        el('p', { text: e.summary }),
        el('div', { class: 'lot-actions' },
          el('button', { class: 'chip copper', type: 'button', onclick: () => openPanel(e.id) }, 'Read more'),
          walkable && markers.has(e.id)
            ? el('button', { class: 'chip teal', type: 'button', onclick: () => { closeAll(); h.onVisit(e.id); } }, 'Walk there', el('span', { 'aria-hidden': 'true', text: '→' }))
            : null,
        ),
      ),
    );
  }

  function renderLanding() {
    fill($('guide-list'), listing());
  }

  function closeButton(label) {
    return el('button', { class: 'close', type: 'button', 'data-close': true, 'aria-label': label, onclick: () => closeTop(true) }, 'Close', el('kbd', { text: 'Esc' }));
  }

  // ---------- Overlays (stacked: the newest is always on top) ----------
  function open(node) {
    const i = stack.indexOf(node);
    if (i >= 0) stack.splice(i, 1);
    stack.push(node);
    stack.forEach((n, k) => { n.style.zIndex = String(20 + k); });
    node.hidden = false;
    node.scrollTop = 0;
    document.documentElement.classList.add('sheet-open');
    h.onOverlay(true);
    node.querySelector('[data-close]')?.focus({ preventScroll: true });
  }
  function closeTop(viaClick = false) {
    const node = stack.pop();
    if (node) node.hidden = true;
    if (!stack.length) {
      document.documentElement.classList.remove('sheet-open');
      h.onOverlay(false, viaClick);
    }
  }
  function closeAll() {
    while (stack.length) stack.pop().hidden = true;
    document.documentElement.classList.remove('sheet-open');
  }

  // ---------- Exhibit placard ----------
  function openPanel(id) {
    const hit = byId.get(id);
    if (!hit) return;
    const { entry, index } = hit;
    fill($('panel-card'),
      el('div', { class: 'card-top' },
        el('p', { class: 'eyebrow', text: `${catalogueNo(index)}${entry.wing ? ` · ${entry.wing} wing` : ''}` }),
        closeButton('Close exhibit')),
      el('h2', { id: 'panel-title', text: entry.title }),
      entry.tags?.length ? el('ul', { class: 'tags' }, entry.tags.map((t) => el('li', { text: t }))) : null,
      el('div', { class: 'body' }, (entry.body ?? [entry.summary]).map((p) => el('p', { text: p }))),
      entry.images?.length
        ? el('div', { class: 'gallery' }, entry.images.map((img) =>
            el('figure', {}, media(img), img.caption ? el('figcaption', { text: img.caption }) : null)))
        : null,
      entry.links?.length
        ? el('div', { class: 'links' }, entry.links.map((l) =>
            el('a', { class: 'btn copper', href: l.url, target: '_blank', rel: 'noopener' }, l.label, el('span', { 'aria-hidden': 'true', text: '↗' }))))
        : null,
    );
    open($('panel'));
  }

  // Images and GIFs show as pictures; .mp4 / .webm play muted on a loop, like a GIF.
  function media(item) {
    const label = item.alt ?? item.caption ?? '';
    if (!/\.(mp4|webm|mov)(\?|#|$)/i.test(item.src)) return el('img', { src: item.src, alt: label, loading: 'lazy' });
    const v = el('video', { src: item.src, poster: item.poster, 'aria-label': label, playsinline: true, loop: true, muted: true, autoplay: true, preload: 'metadata' });
    v.muted = true; // the property, not just the attribute, is what lets it autoplay
    v.play?.().catch(() => { v.controls = true; }); // autoplay refused: show controls instead
    return v;
  }

  // ---------- Guide: inline on the landing page, a sheet inside the museum ----------
  function openGuide() {
    showPaused(false);
    if (mode === 'start') {
      const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
      $('guide').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
      return;
    }
    renderSheet();
    open($('guide-sheet'));
  }

  function renderSheet() {
    fill($('guide-card'),
      el('div', { class: 'card-top' }, el('p', { class: 'eyebrow', text: `Visitor guide · ${exhibits.length} exhibits` }), closeButton('Close guide')),
      el('h2', { id: 'guide-sheet-title', text: site.name }),
      el('ul', { class: 'contact' }, contactItems()),
      listing(),
      el('div', { class: 'pamphlet-foot' },
        el('button', { class: 'btn teal', type: 'button', onclick: () => closeTop(true) }, 'Back to the museum')),
    );
  }

  async function copy(text, addr, btn) {
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = 'Copied';
      setTimeout(() => { btn.textContent = 'Copy email'; }, 1600);
    } catch {
      const range = document.createRange();
      range.selectNodeContents(addr);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      btn.textContent = 'Selected, press Ctrl+C';
    }
  }

  // ---------- Prompt ----------
  const prompt = $('prompt');
  let promptKey = '';
  function setPrompt(target, x, y) {
    if (!target) { prompt.hidden = true; promptKey = ''; return; }
    if (target.id !== promptKey) {
      promptKey = target.id;
      const guide = target.kind === 'guide';
      fill(prompt,
        h.touch ? null : el('kbd', { text: 'E' }),
        el('span', { class: 'verb', text: guide ? 'Read' : 'Inspect' }),
        el('span', { class: 'name', text: guide ? 'Visitor guide' : target.entry.title }));
    }
    prompt.hidden = false;
    prompt.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, calc(-100% - 8px))`;
  }

  function showPaused(show) {
    paused = show && mode === 'play';
    $('paused').hidden = !paused;
  }

  return {
    openPanel,
    openGuide,
    closeTop,
    closeAll,
    setPrompt,
    showPaused,
    isOpen: () => stack.length > 0,
    isPaused: () => paused,
    setStatus(text) { $('start-status').textContent = text; },
    ready(ids) {
      markers = ids;
      walkable = true;
      $('btn-enter').disabled = false;
      $('start-status').textContent = '';
      renderLanding();
    },
    noWebGL(message) {
      walkable = false;
      $('btn-enter').disabled = true;
      $('btn-enter').classList.add('no-3d');
      $('start-status').textContent = message;
      renderLanding();
    },
    setMode(m) {
      mode = m;
      const play = m === 'play';
      document.documentElement.classList.toggle('playing', play);
      $('landing').hidden = play;
      $('stage').hidden = !play;
      $('hud').hidden = !play;
      $('crosshair').hidden = !play || h.touch;
      $('touch').hidden = !play || !h.touch;
      if (!play) { showPaused(false); setPrompt(null); }
    },
  };
}
