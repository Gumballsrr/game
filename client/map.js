(() => {
  'use strict';

  const canvas = document.getElementById('map');
  const ctx = canvas.getContext('2d');
  const infoEl = document.getElementById('info');
  const legendEl = document.getElementById('legend');

  const opts = { provinces: true, borders: true, names: true, cities: true, grid: false };
  const view = { k: 1, tx: 0, ty: 0, kfit: 1, kmin: 1, kmax: 1 };
  let W = 0, H = 0, dpr = 1;
  let data, SC, owners, states, provinces, bgs, cities, bounds;
  const ownerPaths = {};   // por dono: provincias (preenchimento), bordas de estado, contorno
  let hover = null, selected = null, focusOwner = null;
  let queued = false;

  // ---------------------------------------------------------------- textos
  const PAIS = {
    Germany: 'Alemanha', Austria: 'Áustria', 'Czech Republic': 'Tchéquia', Poland: 'Polônia',
    Slovakia: 'Eslováquia', Hungary: 'Hungria', Romania: 'Romênia', Finland: 'Finlândia',
    Estonia: 'Estônia', Lithuania: 'Lituânia', Latvia: 'Letônia', Belarus: 'Bielorrússia',
    Ukraine: 'Ucrânia', Russia: 'Rússia', Moldova: 'Moldávia', Serbia: 'Sérvia',
    Sweden: 'Suécia', Norway: 'Noruega', Turkey: 'Turquia', Italy: 'Itália', Bulgaria: 'Bulgária',
    Greece: 'Grécia', Croatia: 'Croácia', 'Bosnia and Herz.': 'Bósnia e Herzegovina',
    Albania: 'Albânia', Switzerland: 'Suíça', Denmark: 'Dinamarca', Netherlands: 'Países Baixos',
    Belgium: 'Bélgica', France: 'França', Luxembourg: 'Luxemburgo', Kazakhstan: 'Cazaquistão',
    Georgia: 'Geórgia', Armenia: 'Armênia', Azerbaijan: 'Azerbaijão', Iran: 'Irã', Iraq: 'Iraque',
    Uzbekistan: 'Uzbequistão', Turkmenistan: 'Turcomenistão', Slovenia: 'Eslovênia',
    Montenegro: 'Montenegro', 'North Macedonia': 'Macedônia do Norte', Kosovo: 'Kosovo',
    Syria: 'Síria', Cyprus: 'Chipre', Liechtenstein: 'Liechtenstein',
    Mongolia: 'Mongólia', Kyrgyzstan: 'Quirguistão', Tajikistan: 'Tadjiquistão', China: 'China',
    Afghanistan: 'Afeganistão', Israel: 'Israel', Lebanon: 'Líbano', Jordan: 'Jordânia',
  };
  const pais = (n) => PAIS[n] || n;

  const NOTAS_NOME = {
    Transcarpathia: 'Rutênia Subcarpática, anexada pela Hungria em março de 1939.',
    Klaipedos: 'Região de Memel, anexada pela Alemanha em março de 1939.',
    Kaliningrad: 'Prússia Oriental (Königsberg), território alemão.',
    Podlachian: 'Região de Białystok, ocupada pela URSS em setembro de 1939.',
    'Košický': 'Sul da Eslováquia, cedido à Hungria (Primeira Arbitragem de Viena, 1938).',
    Nitriansky: 'Sul da Eslováquia, cedido à Hungria (Primeira Arbitragem de Viena, 1938).',
    "L'viv": 'Antiga Polônia oriental, ocupada pela URSS em 1939.',
    "Ternopil'": 'Antiga Polônia oriental, ocupada pela URSS em 1939.',
    "Ivano-Frankivs'k": 'Antiga Polônia oriental, ocupada pela URSS em 1939.',
    Rivne: 'Antiga Polônia oriental, ocupada pela URSS em 1939.',
    Volyn: 'Antiga Polônia oriental, ocupada pela URSS em 1939.',
    Brest: 'Antiga Polônia oriental, ocupada pela URSS em 1939.',
    Grodno: 'Antiga Polônia oriental, ocupada pela URSS em 1939.',
    Chernivtsi: 'Bucovina do Norte, tomada da Romênia pela URSS em 1940.',
    Karelia: 'Inclui territórios tomados da Finlândia em 1940 (Guerra de Inverno).',
    Leningrad: 'Inclui o istmo da Carélia e Vyborg, tomados da Finlândia em 1940.',
    Murmansk: 'Petsamo, hoje parte desta região, ainda era finlandesa em 1941.',
    Crimea: 'República Autônoma da Crimeia, dentro da URSS.',
  };
  const NOTAS_PAIS = {
    Poland: 'Território polonês ocupado ou anexado pela Alemanha em 1939.',
    'Czech Republic': 'Protetorado da Boêmia e Morávia, sob controle alemão.',
    Austria: 'Anexada à Alemanha em 1938 (Anschluss).',
    Estonia: 'Anexada pela URSS em 1940.',
    Latvia: 'Anexada pela URSS em 1940.',
    Lithuania: 'Anexada pela URSS em 1940.',
    Moldova: 'Bessarábia, tomada da Romênia pela URSS em 1940.',
    Serbia: 'Bačka, ocupada pela Hungria em abril de 1941.',
  };
  const NOTA_TRANSILVANIA = 'Norte da Transilvânia, cedido à Hungria em agosto de 1940 (Segunda Arbitragem de Viena).';

  function nota(s) {
    if (NOTAS_NOME[s.name]) return NOTAS_NOME[s.name];
    if (s.country === 'Romania' && s.owner === 'HUN') return NOTA_TRANSILVANIA;
    if (s.country === 'Hungary' || s.country === 'Finland' || s.country === 'Germany') return '';
    return NOTAS_PAIS[s.country] || '';
  }

  // ------------------------------------------------------------- geometria
  const mercY = (lat) => (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

  // aneis gravados como inteiros: 1o ponto absoluto, demais = diferenca para o anterior
  function decode(flat) {
    const pts = new Float64Array(flat.length);
    let x = 0, y = 0;
    for (let i = 0; i < flat.length; i += 2) {
      if (i === 0) { x = flat[0]; y = flat[1]; } else { x += flat[i]; y += flat[i + 1]; }
      pts[i] = x / SC; pts[i + 1] = y / SC;
    }
    return pts;
  }

  function build(rings) {
    const path = new Path2D();
    const list = [];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const flat of rings) {
      const pts = decode(flat);
      for (let i = 0; i < pts.length; i += 2) {
        const x = pts[i], y = pts[i + 1];
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (i === 0) path.moveTo(x, y); else path.lineTo(x, y);
      }
      path.closePath();
      list.push(pts);
    }
    return { path, rings: list, bbox: [x0, y0, x1, y1], barea: (x1 - x0) * (y1 - y0) };
  }

  function inside(rings, x, y) {
    let c = false;
    for (const r of rings) {
      const n = r.length;
      let jx = r[n - 2], jy = r[n - 1];
      for (let i = 0; i < n; i += 2) {
        const ix = r[i], iy = r[i + 1];
        if ((iy > y) !== (jy > y) && x < ((jx - ix) * (y - iy)) / (jy - iy) + ix) c = !c;
        jx = ix; jy = iy;
      }
    }
    return c;
  }

  function hit(sx, sy) {
    const x = (sx - view.tx) / view.k, y = (view.ty - sy) / view.k;
    for (const p of provinces) {
      const b = p.g.bbox;
      if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue;
      if (inside(p.g.rings, x, y)) return { kind: 'prov', ref: p };
    }
    for (const b of bgs) {
      const bb = b.g.bbox;
      if (x < bb[0] || x > bb[2] || y < bb[1] || y > bb[3]) continue;
      if (inside(b.g.rings, x, y)) return { kind: 'bg', ref: b };
    }
    return null;
  }

  // --------------------------------------------------------------- vista
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    const fk = Math.min(W / (bounds[2] - bounds[0]), H / (bounds[3] - bounds[1])) * 0.96;
    const ratio = view.kfit ? view.k / view.kfit : 1;
    view.kfit = fk; view.kmin = fk * 0.7; view.kmax = fk * 14;
    if (!resize.done) fitAll(); else { view.k = clampK(fk * ratio); }
    resize.done = true;
    schedule();
  }

  const clampK = (k) => Math.max(view.kmin, Math.min(view.kmax, k));

  function fitAll() {
    view.k = view.kfit;
    view.tx = W / 2 - ((bounds[0] + bounds[2]) / 2) * view.k;
    view.ty = H / 2 + ((bounds[1] + bounds[3]) / 2) * view.k;
    schedule();
  }

  function zoomAt(sx, sy, factor) {
    const nk = clampK(view.k * factor);
    const wx = (sx - view.tx) / view.k, wy = (view.ty - sy) / view.k;
    view.k = nk; view.tx = sx - wx * nk; view.ty = sy + wy * nk;
    schedule();
  }

  // -------------------------------------------------------------- desenho
  const labelWidth = new Map();
  function textWidth(t) {
    let w = labelWidth.get(t);
    if (w === undefined) { w = ctx.measureText(t).width; labelWidth.set(t, w); }
    return w;
  }

  const dim = (code) => (focusOwner && code !== focusOwner ? 0.22 : 1);
  const seaColor = () => getComputedStyle(document.documentElement).getPropertyValue('--sea').trim() || '#15222e';

  function draw() {
    queued = false;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = seaColor();
    ctx.fillRect(0, 0, W, H);

    ctx.setTransform(dpr * view.k, 0, 0, -dpr * view.k, dpr * view.tx, dpr * view.ty);
    const px = 1 / view.k;
    ctx.lineJoin = 'round';

    if (opts.grid) {
      ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = px;
      ctx.beginPath();
      for (let lon = 0; lon <= 60; lon += 5) { ctx.moveTo(lon, bounds[1]); ctx.lineTo(lon, bounds[3]); }
      for (let lat = 40; lat <= 70; lat += 5) { const y = mercY(lat); ctx.moveTo(bounds[0], y); ctx.lineTo(bounds[2], y); }
      ctx.stroke();
    }

    // fundo (paises inteiros, contexto)
    for (const b of bgs) {
      ctx.globalAlpha = 0.7 * dim(b.owner);
      ctx.fillStyle = owners[b.owner].color;
      ctx.fill(b.g.path, 'evenodd');
    }

    // provincias: um caminho por dono (rapido)
    const zoomRel = view.k / view.kfit;
    const provAlpha = Math.max(0.16, Math.min(0.42, 0.16 + (zoomRel - 1) * 0.12));
    for (const code of Object.keys(ownerPaths)) {
      const op = ownerPaths[code], color = owners[code].color, d = dim(code);
      ctx.globalAlpha = d;
      ctx.fillStyle = color; ctx.fill(op.prov, 'nonzero');
      ctx.strokeStyle = color; ctx.lineWidth = 1.2 * px; ctx.stroke(op.prov);   // cobre frestas
      if (opts.provinces && provAlpha > 0) {
        ctx.globalAlpha = d * (provAlpha / 0.42);
        ctx.strokeStyle = 'rgba(10,16,22,0.5)'; ctx.lineWidth = 0.6 * px; ctx.stroke(op.prov);
      }
    }
    // bordas dos estados
    if (opts.borders) {
      ctx.strokeStyle = 'rgba(10,16,22,0.7)'; ctx.lineWidth = 0.9 * px;
      for (const code of Object.keys(ownerPaths)) {
        ctx.globalAlpha = dim(code);
        ctx.stroke(ownerPaths[code].states);
      }
    }
    // contorno dos donos (fronteiras entre paises)
    ctx.strokeStyle = 'rgba(6,10,16,0.95)'; ctx.lineWidth = 1.7 * px;
    for (const code of Object.keys(ownerPaths)) {
      ctx.globalAlpha = Math.max(0.35, dim(code));
      ctx.stroke(ownerPaths[code].outline);
    }
    // bordas dos paises do fundo
    ctx.strokeStyle = 'rgba(8,12,18,0.85)'; ctx.lineWidth = 1.2 * px;
    for (const b of bgs) { if (b.inter) continue; ctx.globalAlpha = Math.max(0.3, dim(b.owner)); ctx.stroke(b.g.path); }
    ctx.globalAlpha = 1;

    // destaques
    const hp = hover && hover.kind === 'prov' ? hover.ref : null;
    if (hp && hp.state !== selected) {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1.5 * px; ctx.stroke(hp.state.g.path);
    }
    if (selected) {
      ctx.strokeStyle = '#e0b73a'; ctx.lineWidth = 2.2 * px; ctx.stroke(selected.g.path);
    }
    if (hp) {
      ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.fill(hp.g.path, 'nonzero');
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.2 * px; ctx.stroke(hp.g.path);
    } else if (hover && hover.kind === 'bg') {
      ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.fill(hover.ref.g.path, 'evenodd');
    }

    drawLabels();
  }

  const toSX = (x) => x * view.k + view.tx;
  const toSY = (y) => view.ty - y * view.k;

  function drawLabels() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    const placed = [];
    const free = (x, y, w, h) => {
      for (const r of placed) if (x < r[2] && x + w > r[0] && y < r[3] && y + h > r[1]) return false;
      placed.push([x, y, x + w, y + h]);
      return true;
    };
    const text = (t, x, y, size, weight, color) => {
      ctx.font = `${weight} ${size}px system-ui, sans-serif`;
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(8,14,20,0.8)';
      ctx.strokeText(t, x, y);
      ctx.fillStyle = color; ctx.fillText(t, x, y);
    };

    if (opts.cities) {
      const showAll = view.k > view.kfit * 2.4;
      for (const c of cities) {
        if (!c.capital && !showAll) continue;
        const x = toSX(c.x), y = toSY(c.y);
        if (x < -40 || y < -20 || x > W + 40 || y > H + 20) continue;
        ctx.globalAlpha = dim(c.owner) < 1 ? 0.5 : 1;
        ctx.fillStyle = c.capital ? '#ffffff' : '#e8eef3';
        ctx.strokeStyle = '#0b1218'; ctx.lineWidth = 1.5;
        ctx.beginPath();
        if (c.capital) {
          const r = 5;
          ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath();
        } else ctx.arc(x, y, 2.6, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        ctx.font = `${c.capital ? 700 : 500} ${c.capital ? 12 : 11}px system-ui, sans-serif`;
        const w = textWidth(c.name) + 4;
        if (free(x - w / 2, y + 7, w, 14)) text(c.name, x, y + 14, c.capital ? 12 : 11, c.capital ? 700 : 500, '#ffffff');
        ctx.globalAlpha = 1;
      }
    }

    if (opts.names) {
      ctx.font = '600 11px system-ui, sans-serif';
      for (const s of stateOrder) {
        if (s.minor) continue;
        const b = s.g.bbox;
        const sw = (b[2] - b[0]) * view.k, sh = (b[3] - b[1]) * view.k;
        const w = textWidth(s.name);
        if (sw < w + 10 || sh < 16) continue;
        const x = toSX(s.label[0]), y = toSY(s.label[1]);
        if (x < 0 || y < 0 || x > W || y > H) continue;
        if (dim(s.owner) < 1) continue;
        if (free(x - w / 2 - 2, y - 7, w + 4, 14)) text(s.name, x, y, 11, 600, 'rgba(255,255,255,0.93)');
      }
    }
  }
  let stateOrder = [];

  function schedule() {
    if (!queued) { queued = true; requestAnimationFrame(draw); }
  }

  // ----------------------------------------------------------------- painel
  const fmt = (n) => n.toLocaleString('pt-BR');

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function stateCard(s, prov) {
    const o = owners[s.owner], n = nota(s);
    return `<div class="row"><span class="chip" style="background:${o.color}"></span><h2>${esc(s.name)}</h2></div>` +
      '<dl>' +
      (prov ? `<dt>Província</dt><dd>nº ${fmt(prov.id)}</dd>` : '') +
      `<dt>Dono em 1941</dt><dd>${esc(o.name)}</dd>` +
      `<dt>País atual</dt><dd>${esc(pais(s.country))}</dd>` +
      `<dt>Províncias no estado</dt><dd>${fmt(s.n)}</dd>` +
      (s.area ? `<dt>Área</dt><dd>${fmt(s.area)} km²</dd>` : '') + '</dl>' +
      (n ? `<p class="note">${esc(n)}</p>` : '');
  }

  function updateInfo() {
    if (hover && hover.kind === 'prov') { infoEl.innerHTML = stateCard(hover.ref.state, hover.ref); return; }
    if (hover && hover.kind === 'bg') {
      const b = hover.ref, o = owners[b.owner];
      infoEl.innerHTML =
        `<div class="row"><span class="chip" style="background:${o.color}"></span><h2>${esc(pais(b.name))}</h2></div>` +
        `<dl><dt>Situação</dt><dd>${esc(o.name)}</dd></dl>`;
      return;
    }
    if (selected) { infoEl.innerHTML = stateCard(selected, null); return; }
    infoEl.innerHTML = '<p class="hint">Passe o mouse sobre uma região. Clique para fixar o estado.</p>';
  }

  function buildLegend() {
    const counts = {};
    for (const p of provinces) counts[p.owner] = (counts[p.owner] || 0) + 1;
    const codes = Object.keys(owners);
    const main = codes.filter((c) => owners[c].main), rest = codes.filter((c) => !owners[c].main);
    const btn = (c) =>
      `<button type="button" data-owner="${c}" aria-pressed="false">` +
      `<span class="chip" style="background:${owners[c].color}"></span>` +
      `<span class="name">${esc(owners[c].name)}</span>` +
      `<span class="count">${counts[c] ? fmt(counts[c]) + ' prov.' : ''}</span></button>`;
    legendEl.innerHTML = main.map(btn).join('') + '<div class="sep"></div>' + rest.map(btn).join('');
    legendEl.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-owner]');
      if (!b) return;
      focusOwner = focusOwner === b.dataset.owner ? null : b.dataset.owner;
      legendEl.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.owner === focusOwner)));
      schedule();
    });
  }

  // --------------------------------------------------------- interacao
  const pointers = new Map();
  let drag = null, pinch = null;

  function pos(e) {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    const [x, y] = pos(e);
    pointers.set(e.pointerId, [x, y]);
    if (pointers.size === 1) drag = { x, y, sx: x, sy: y, moved: false };
    else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) };
      drag = null;
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    const [x, y] = pos(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, [x, y]);
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, d / pinch.d);
      pinch.d = d;
      return;
    }
    if (drag) {
      if (!drag.moved && Math.hypot(x - drag.sx, y - drag.sy) > 4) { drag.moved = true; canvas.classList.add('dragging'); }
      if (drag.moved) {
        view.tx += x - drag.x; view.ty += y - drag.y;
        drag.x = x; drag.y = y;
        schedule();
        return;
      }
    }
    if (e.pointerType === 'mouse' || !drag) {
      const h = hit(x, y);
      const same = (h && hover && h.ref === hover.ref) || (!h && !hover);
      if (!same) {
        hover = h; updateInfo(); schedule();
        canvas.style.cursor = h && h.kind === 'prov' ? 'pointer' : '';
      }
    }
  });

  function end(e) {
    const [x, y] = pos(e);
    if (drag && !drag.moved && pointers.size === 1) {
      const h = hit(x, y);
      const st = h && h.kind === 'prov' ? h.ref.state : null;
      selected = st && st !== selected ? st : null;
      if (e.pointerType !== 'mouse') hover = h && h.kind === 'prov' ? h : null;
      updateInfo(); schedule();
    }
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) { drag = null; canvas.classList.remove('dragging'); }
  }
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', () => {
    if (!drag && hover) { hover = null; updateInfo(); schedule(); }
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [x, y] = pos(e);
    zoomAt(x, y, Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016)));
  }, { passive: false });

  document.getElementById('zin').onclick = () => zoomAt(W / 2, H / 2, 1.5);
  document.getElementById('zout').onclick = () => zoomAt(W / 2, H / 2, 1 / 1.5);
  document.getElementById('zreset').onclick = fitAll;
  for (const [id, key] of [['tProv', 'provinces'], ['tBorders', 'borders'], ['tNames', 'names'], ['tCities', 'cities'], ['tGrid', 'grid']]) {
    const el = document.getElementById(id);
    el.checked = opts[key];
    el.addEventListener('change', () => { opts[key] = el.checked; schedule(); });
  }
  window.addEventListener('keydown', (e) => {
    if (e.key === '+' || e.key === '=') zoomAt(W / 2, H / 2, 1.3);
    else if (e.key === '-') zoomAt(W / 2, H / 2, 1 / 1.3);
    else if (e.key === '0') fitAll();
    else if (e.key === 'Escape') {
      selected = null; focusOwner = null;
      legendEl.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', 'false'));
      updateInfo(); schedule();
    }
  });
  window.addEventListener('resize', resize);

  // ------------------------------------------------------------- inicio
  fetch('data/map.json')
    .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then((d) => {
      data = d; SC = d.meta.scale; owners = d.owners; bounds = d.meta.bounds;
      states = d.states; provinces = d.provinces; bgs = d.background; cities = d.cities;

      for (const s of states) s.g = build(s.rings);
      provinces.forEach((p, i) => {
        p.id = i + 1;
        p.g = build(p.r);
        p.state = states[p.s];
        p.owner = p.state.owner;
      });
      for (const b of bgs) b.g = build(b.rings);

      // caminhos combinados por dono, para desenhar milhares de provincias de uma vez
      for (const code of Object.keys(owners)) {
        const prov = new Path2D(), st = new Path2D();
        let any = false;
        for (const p of provinces) if (p.owner === code) { prov.addPath(p.g.path); any = true; }
        for (const s of states) if (s.owner === code) st.addPath(s.g.path);
        if (!any) continue;
        ownerPaths[code] = { prov, states: st, outline: build(d.outlines[code] || []).path };
      }
      stateOrder = states.slice().sort((a, b) => b.g.barea - a.g.barea);

      buildLegend();
      resize();
      window.__map = { view, states, provinces, fitAll, hit, get hover() { return hover; } };
    })
    .catch((err) => {
      infoEl.innerHTML = '<p class="hint">Não foi possível carregar o mapa (' + esc(err.message) +
        '). Abra a página por um servidor web, não direto do arquivo.</p>';
    });
})();
