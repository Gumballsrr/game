(() => {
  'use strict';

  const canvas = document.getElementById('map');
  const ctx = canvas.getContext('2d');
  const infoEl = document.getElementById('info');
  const legendEl = document.getElementById('legend');

  const opts = { provinces: true, borders: true, names: true, cities: true, grid: false };
  const view = { k: 1, tx: 0, ty: 0, kfit: 1, kmin: 1, kmax: 1 };
  let W = 0, H = 0, dpr = 1;
  let data, SC, owners, states, provinces, bgs, bounds, projection = 'equirectangular', xscale = 1;
  let riverPaths = null, lakePath = null;
  let cityProvs = [];      // provincias que sao cidades (nome em p.c, capital em p.k)
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
  // y do mapa para uma latitude. O mapa e equirretangular (como o do HOI4): y = latitude.
  const projY = (lat) => (projection === 'mercator'
    ? (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))
    : lat);

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
    const key = ctx.font + '|' + t;
    let w = labelWidth.get(key);
    if (w === undefined) { w = ctx.measureText(t).width; labelWidth.set(key, w); }
    return w;
  }

  const dim = (code) => (focusOwner && code !== focusOwner ? 0.22 : 1);
  const seaColor = () => '#efefef';
  // cores de paises de contexto, como no HOI4
  const BG_COLORS = { ITA:'#5a8a4f', BGR:'#4f8a2c', SVK:'#7fae7a', HRV:'#6c9a68', ALB:'#8a3a6e', SWE:'#2f6f9f', NOR:'#5a3f3f',
    DNK:'#a07f66', FRA:'#4f8a9c', NLD:'#4d5154', BEL:'#4d5154', GRC:'#5fb0c8', SRB:'#4a4a80', SVN:'#4a4a80', BIH:'#4a4a80',
    MNE:'#4a4a80', MKD:'#4a4a80', KOS:'#4a4a80', CHE:'#a8474f', LIE:'#a8474f', TUR:'#9bb98a' };
  const bgColor = (b) => BG_COLORS[b.code] || owners[b.owner].color;

  // ---------------------------------------------------------- textura procedural
  // Terreno gerado por ruido (nao usa nenhuma textura do HOI4): relevo com luz de noroeste
  // e manchas verde/marrom/cinza que se misturam com a cor de cada pais.
  let tex = null;
  function makeTexture(w, h) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d'); const img = x.createImageData(w, h); const d = img.data;
    const hash = (ix, iy, s) => {
      let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(s, 1274126177);
      n = Math.imul(n ^ (n >>> 13), 1274126177); n ^= n >>> 16; return (n >>> 0) / 4294967295;
    };
    const vn = (px, py, s) => {
      const ix = Math.floor(px), iy = Math.floor(py), fx = px - ix, fy = py - iy;
      const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
      const a0 = hash(ix, iy, s), b0 = hash(ix + 1, iy, s), c0 = hash(ix, iy + 1, s), d0 = hash(ix + 1, iy + 1, s);
      return a0 + (b0 - a0) * u + (c0 - a0) * v + (a0 - b0 - c0 + d0) * u * v;
    };
    const fbm = (px, py, oct, s) => { let t = 0, amp = 0.5, f = 1, n = 0; for (let o = 0; o < oct; o++) { t += amp * vn(px * f, py * f, s + o); n += amp; amp *= 0.5; f *= 2; } return t / n; };
    const hf = new Float32Array(w * h), tn = new Float32Array(w * h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const u = i / w * 9, v = j / h * 9 * (h / w);
      const n = fbm(u, v, 6, 11), r = 1 - Math.abs(2 * fbm(u * 1.7, v * 1.7, 4, 31) - 1);
      hf[j * w + i] = n * 0.65 + r * 0.35;
      tn[j * w + i] = fbm(u * 0.45 + 3, v * 0.45 + 7, 3, 71);
    }
    const pal = [[70, 105, 60], [118, 108, 72], [150, 140, 128]];
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const k = j * w + i, i0 = Math.max(0, i - 2), j0 = Math.max(0, j - 2), i1 = Math.min(w - 1, i + 2), j1 = Math.min(h - 1, j + 2);
      const sh = (hf[j0 * w + i0] - hf[j1 * w + i1]) * 14;        // relevo
      const t = Math.min(1, Math.max(0, (tn[k] - 0.3) * 2.6)) * 2;   // 0..2 entre as 3 cores
      const p0 = pal[Math.min(1, Math.floor(t))], p1 = pal[Math.min(2, Math.floor(t) + 1)], f = t - Math.floor(t);
      const lum = 0.72 + hf[k] * 0.5 + sh * 0.55;
      for (let q = 0; q < 3; q++) d[k * 4 + q] = Math.max(0, Math.min(255, (p0[q] + (p1[q] - p0[q]) * f) * lum));
      d[k * 4 + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    return c;
  }

  const shadeCache = new Map();
  function shade(hex, f) {
    const key = hex + f; let r = shadeCache.get(key);
    if (!r) { const v = parseInt(hex.slice(1), 16); r = `rgb(${((v >> 16) & 255) * f | 0},${((v >> 8) & 255) * f | 0},${(v & 255) * f | 0})`; shadeCache.set(key, r); }
    return r;
  }
  // brilho da cor do pais na borda (interior fica mais escuro e com terreno), pre-renderizado uma vez
  let glow = null, grain = null, detail = null;
  function makeGlow(w, h) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'), s = w / (bounds[2] - bounds[0]), OFF = 20000;
    for (const code of Object.keys(ownerPaths)) {
      const op = ownerPaths[code];
      g.save();
      g.setTransform(s, 0, 0, -s, -bounds[0] * s, bounds[3] * s);
      g.clip(op.prov, 'nonzero');
      g.setTransform(s, 0, 0, -s, -bounds[0] * s + OFF, bounds[3] * s);
      g.shadowColor = owners[code].color; g.shadowBlur = 0.55 * s; g.shadowOffsetX = -OFF; g.shadowOffsetY = 0;
      g.strokeStyle = '#000'; g.lineWidth = 0.7; g.lineJoin = 'round';
      g.stroke(op.outline); g.stroke(op.outline);
      g.restore();
    }
    return c;
  }
  // relevo de detalhe que se repete sem emendas e acompanha o mapa (aparece ao aproximar)
  function makeDetail(n) {
    const c = document.createElement('canvas'); c.width = c.height = n;
    const g = c.getContext('2d'), im = g.createImageData(n, n), d = im.data;
    const hash = (ix, iy, s) => { let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(s, 1274126177); h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967295; };
    const vn = (px, py, per, s) => {
      const ix = Math.floor(px), iy = Math.floor(py), fx = px - ix, fy = py - iy, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
      const a = hash(((ix % per) + per) % per, ((iy % per) + per) % per, s), b = hash(((ix + 1) % per + per) % per, ((iy % per) + per) % per, s);
      const c0 = hash(((ix % per) + per) % per, ((iy + 1) % per + per) % per, s), e = hash(((ix + 1) % per + per) % per, ((iy + 1) % per + per) % per, s);
      return a + (b - a) * u + (c0 - a) * v + (a - b - c0 + e) * u * v;
    };
    const hf = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      let t = 0, amp = 0.5, per = 6, tot = 0;
      for (let o = 0; o < 6; o++) { t += amp * vn(i / n * per, j / n * per, per, 5 + o); tot += amp; amp *= 0.55; per *= 2; }
      hf[j * n + i] = t / tot;
    }
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i, sh = (hf[k] - hf[((j + 2) % n) * n + (i + 2) % n]) * 7;
      const v = Math.max(0, Math.min(255, 128 + (hf[k] - 0.5) * 150 + sh * 90));
      d[k * 4] = v * 0.97; d[k * 4 + 1] = v; d[k * 4 + 2] = v * 0.95; d[k * 4 + 3] = 255;
    }
    g.putImageData(im, 0, 0); return c;
  }
  function makeGrain(n) {          // pontilhado fino de floresta/neve
    const c = document.createElement('canvas'); c.width = c.height = n;
    const g = c.getContext('2d'), im = g.createImageData(n, n);
    let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < n * n; i++) { const v = rnd() < 0.18 ? 40 + rnd() * 50 : 140 + rnd() * 80; im.data.set([v, v, v, 255], i * 4); }
    g.putImageData(im, 0, 0); return c;
  }

  let layerL = null, layerM = null, lctx = null, mctx = null;
  function ensureLayers() {
    const w = canvas.width, h = canvas.height;
    if (layerL && layerL.width === w && layerL.height === h) return;
    layerL = document.createElement('canvas'); layerM = document.createElement('canvas');
    layerL.width = layerM.width = w; layerL.height = layerM.height = h;
    lctx = layerL.getContext('2d'); mctx = layerM.getContext('2d');
  }

  function draw() {
    queued = false;
    ensureLayers();
    if (!tex) {
      const th = Math.round(1280 * (bounds[3] - bounds[1]) / (bounds[2] - bounds[0]));
      tex = makeTexture(1280, th); glow = makeGlow(1280, th); grain = makeGrain(192); detail = makeDetail(512);
    }
    const zoomRel = view.k / view.kfit;

    // mar: degrade escuro azulado
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sg = ctx.createRadialGradient(W * 0.5, H * 0.45, 0, W * 0.5, H * 0.45, Math.max(W, H) * 0.85);
    sg.addColorStop(0, '#27486b'); sg.addColorStop(1, '#13243a');
    ctx.fillStyle = sg; ctx.fillRect(0, 0, W, H);

    if (opts.grid) {
      ctx.setTransform(dpr * view.k, 0, 0, -dpr * view.k, dpr * view.tx, dpr * view.ty);
      ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1 / view.k;
      ctx.beginPath();
      for (let lon = 5; lon <= 55; lon += 5) { const gx = lon * xscale; if (gx < bounds[0] || gx > bounds[2]) continue; ctx.moveTo(gx, bounds[1]); ctx.lineTo(gx, bounds[3]); }
      for (let lat = 40; lat <= 70; lat += 5) { const y = projY(lat); ctx.moveTo(bounds[0], y); ctx.lineTo(bounds[2], y); }
      ctx.stroke();
    }

    // ---- terra numa camada propria: cores dos paises + textura, recortada pela silhueta
    lctx.setTransform(1, 0, 0, 1, 0, 0); lctx.globalAlpha = 1; lctx.globalCompositeOperation = 'source-over';
    lctx.clearRect(0, 0, layerL.width, layerL.height);
    lctx.setTransform(dpr * view.k, 0, 0, -dpr * view.k, dpr * view.tx, dpr * view.ty);
    lctx.lineJoin = 'round';
    for (const b of bgs) {
      lctx.globalAlpha = dim(b.owner); lctx.fillStyle = shade(bgColor(b), 0.7); lctx.fill(b.g.path, 'evenodd');
    }
    for (const code of Object.keys(ownerPaths)) {
      const op = ownerPaths[code], color = owners[code].color;
      lctx.globalAlpha = dim(code);
      lctx.fillStyle = shade(color, 0.7); lctx.fill(op.prov, 'nonzero');
      lctx.strokeStyle = shade(color, 0.7); lctx.lineWidth = 1.2 / view.k; lctx.stroke(op.prov);   // cobre frestas
    }
    lctx.globalAlpha = 1;
    mctx.setTransform(1, 0, 0, 1, 0, 0); mctx.clearRect(0, 0, layerM.width, layerM.height); mctx.drawImage(layerL, 0, 0);
    lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    lctx.globalCompositeOperation = 'overlay'; lctx.globalAlpha = 0.75;
    lctx.drawImage(tex, toSX(bounds[0]), toSY(bounds[3]), (bounds[2] - bounds[0]) * view.k, (bounds[3] - bounds[1]) * view.k);
    lctx.globalCompositeOperation = 'source-over'; lctx.globalAlpha = 0.9;
    lctx.drawImage(glow, toSX(bounds[0]), toSY(bounds[3]), (bounds[2] - bounds[0]) * view.k, (bounds[3] - bounds[1]) * view.k);
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    const dp = lctx.createPattern(detail, 'repeat');
    dp.setTransform(new DOMMatrix([view.k * dpr * 2.2 / 512, 0, 0, view.k * dpr * 2.2 / 512, view.tx * dpr, view.ty * dpr]));
    lctx.globalCompositeOperation = 'overlay'; lctx.globalAlpha = 0.5; lctx.fillStyle = dp;
    lctx.fillRect(0, 0, layerL.width, layerL.height);
    lctx.globalAlpha = 0.9; lctx.globalCompositeOperation = 'source-over';
    const pat = lctx.createPattern(grain, 'repeat');
    pat.setTransform(new DOMMatrix([1, 0, 0, 1, (view.tx * dpr) % 192, (view.ty * dpr) % 192]));
    lctx.globalCompositeOperation = 'overlay'; lctx.globalAlpha = 0.3; lctx.fillStyle = pat;
    lctx.fillRect(0, 0, layerL.width, layerL.height);
    lctx.globalCompositeOperation = 'destination-in'; lctx.globalAlpha = 1;
    lctx.setTransform(1, 0, 0, 1, 0, 0); lctx.drawImage(layerM, 0, 0);
    lctx.globalCompositeOperation = 'source-over';

    // brilho de costa + terra
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.shadowColor = 'rgba(120,175,230,0.55)'; ctx.shadowBlur = 22 * dpr;
    ctx.drawImage(layerL, 0, 0);
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;

    ctx.setTransform(dpr * view.k, 0, 0, -dpr * view.k, dpr * view.tx, dpr * view.ty);
    const px = 1 / view.k;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';

    // lagos
    if (lakePath) {
      ctx.fillStyle = '#1b3856'; ctx.fill(lakePath, 'evenodd');
      ctx.strokeStyle = 'rgba(150,190,230,0.45)'; ctx.lineWidth = 1.3 * px; ctx.stroke(lakePath);
    }

    // bordas das provincias (discretas, como no jogo)
    for (const code of Object.keys(ownerPaths)) {
      const op = ownerPaths[code], d = dim(code);
      if (opts.provinces) {
        ctx.globalAlpha = d; ctx.strokeStyle = 'rgba(0,0,0,0.34)'; ctx.lineWidth = 0.7 * px; ctx.stroke(op.prov);
      }
      if (opts.cities && op.city) {
        ctx.globalAlpha = d; ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 0.9 * px; ctx.stroke(op.city);
      }
    }
    // bordas dos estados
    if (opts.borders) {
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1.0 * px;
      for (const code of Object.keys(ownerPaths)) {
        ctx.globalAlpha = dim(code);
        ctx.stroke(ownerPaths[code].states);
      }
    }
    // contorno dos donos (fronteiras entre paises)
    ctx.strokeStyle = 'rgba(200,225,255,0.35)'; ctx.lineWidth = 3.2 * px;
    for (const code of Object.keys(ownerPaths)) { ctx.globalAlpha = Math.max(0.35, dim(code)); ctx.stroke(ownerPaths[code].outline); }
    ctx.strokeStyle = 'rgba(8,10,16,0.9)'; ctx.lineWidth = 1.3 * px;
    for (const code of Object.keys(ownerPaths)) {
      ctx.globalAlpha = Math.max(0.35, dim(code));
      ctx.stroke(ownerPaths[code].outline);
    }
    // bordas dos paises do fundo
    ctx.strokeStyle = 'rgba(8,10,16,0.75)'; ctx.lineWidth = 0.9 * px;
    for (const b of bgs) { if (b.inter) continue; ctx.globalAlpha = Math.max(0.3, dim(b.owner)); ctx.stroke(b.g.path); }
    ctx.globalAlpha = 1;

    // rios (azul-escuro, mais grossos com o zoom)
    if (riverPaths) {
      const zf = Math.min(2.4, 0.75 + 0.25 * Math.sqrt(zoomRel));
      for (const [w, wpx] of [['1', 1.1], ['2', 1.9], ['3', 3.0]]) {
        if (!riverPaths[w]) continue;
        ctx.strokeStyle = 'rgba(150,190,230,0.30)'; ctx.lineWidth = (wpx + 1.6) * zf * px; ctx.stroke(riverPaths[w]);
        ctx.strokeStyle = '#15294a'; ctx.lineWidth = wpx * zf * px; ctx.stroke(riverPaths[w]);
      }
    }

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
    const lightFill = (code) => {                      // fundo claro -> texto escuro
      const h = owners[code].color, v = parseInt(h.slice(1), 16);
      return (0.299 * (v >> 16) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) > 215;
    };
    const text = (t, x, y, size, weight, owner, cap) => {
      const light = lightFill(owner);
      ctx.font = `${weight} ${size}px system-ui, sans-serif`;
      ctx.lineWidth = 3; ctx.strokeStyle = light ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.75)';
      ctx.strokeText(t, x, y);
      ctx.fillStyle = light ? '#111' : (cap ? '#ffe9a8' : '#fff'); ctx.fillText(t, x, y);
    };

    // nomes grandes dos paises, espacados, semitransparentes (como no jogo)
    if (opts.names) {
      const zr = view.k / view.kfit, fade = Math.max(0, Math.min(1, 1 - (zr - 2.5) / 2));
      if (fade > 0) {
        if (!ownerBox) {
          ownerBox = {};
          for (const s of stateOrder) {
            if (s.minor || !s.label) continue;
            const o = ownerBox[s.owner] || (ownerBox[s.owner] = { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9, sx: 0, sy: 0, n: 0 });
            o.x0 = Math.min(o.x0, s.label[0]); o.x1 = Math.max(o.x1, s.label[0]);
            o.y0 = Math.min(o.y0, s.label[1]); o.y1 = Math.max(o.y1, s.label[1]);
            o.sx += s.label[0]; o.sy += s.label[1]; o.n++;
          }
        }
        ctx.textAlign = 'center'; ctx.lineJoin = 'round';
        const nameBoxes = [];
        const nameFree = (x, y, w, h) => { for (const r of nameBoxes) if (x < r[2] && x + w > r[0] && y < r[3] && y + h > r[1]) return false; nameBoxes.push([x, y, x + w, y + h]); return true; };
        for (const code of ['SOV', 'GER', 'FIN', 'ROM', 'HUN']) {
          const o = ownerBox[code]; if (!o || dim(code) < 1) continue;
          const name = owners[code].name.toUpperCase();
          const widthPx = Math.max(40, (o.x1 - o.x0) * view.k * 0.8 + 20);
          const size = Math.max(10, Math.min(40, widthPx / (name.length * 0.95)));
          ctx.font = `700 ${size}px system-ui, sans-serif`;
          ctx.letterSpacing = (size * 0.18) + 'px';
          const x = toSX(o.sx / o.n), y = toSY(o.sy / o.n);
          const tw = ctx.measureText(name).width + 8;
          if (!nameFree(x - tw / 2, y - size / 2, tw, size)) { ctx.letterSpacing = '0px'; continue; }
          ctx.lineWidth = Math.max(1.5, size / 14); ctx.strokeStyle = `rgba(255,255,255,${0.55 * fade})`;
          ctx.strokeText(name, x, y);
          ctx.fillStyle = `rgba(0,0,0,${0.28 * fade})`; ctx.fillText(name, x, y);
          ctx.letterSpacing = '0px';
        }
      }
    }

    const star = (x, y, r) => {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
      ctx.closePath();
    };
    if (opts.cities) {
      const showAll = view.k > view.kfit * 3;
      for (const c of cityProvs) {
        if (!c.k && !showAll) continue;              // longe: so as capitais
        if (dim(c.owner) < 1) continue;
        const x = toSX(c.l[0]), y = toSY(c.l[1]);
        if (x < -40 || y < -20 || x > W + 40 || y > H + 20) continue;
        const size = c.k ? 12 : 11, weight = c.k ? 700 : 600;
        ctx.font = `${weight} ${size}px system-ui, sans-serif`;
        const w = textWidth(c.c) + 16;
        if (!free(x - 8, y - 8, w, 16)) continue;
        ctx.lineWidth = 1.4;
        if (c.k) { star(x, y, 6.5); ctx.fillStyle = '#d6322e'; ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.fill(); }
        else { ctx.beginPath(); ctx.arc(x, y, 3, 0, 6.2832); ctx.fillStyle = '#d6322e'; ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.fill(); }
        ctx.textAlign = 'left'; text(c.c, x + 9, y, size, weight, c.owner, false); ctx.textAlign = 'center';
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
        if (free(x - w / 2 - 2, y - 7, w + 4, 14)) text(s.name, x, y, 11, 600, s.owner, false);
      }
    }
  }
  let stateOrder = [], ownerBox = null;

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
    const city = prov && prov.c;
    return `<div class="row"><span class="chip" style="background:${o.color}"></span><h2>${esc(city ? prov.c : s.name)}</h2></div>` +
      '<dl>' +
      (prov ? `<dt>Província</dt><dd>nº ${fmt(prov.id)}${city ? (prov.k ? ' · capital' : ' · cidade') : ''}</dd>` : '') +
      (city ? `<dt>Estado</dt><dd>${esc(s.name)}</dd>` : '') +
      (prov ? `<dt>Províncias vizinhas</dt><dd>${prov.a.length}</dd>` : '') +
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
      states = d.states; provinces = d.provinces; bgs = d.background;
      projection = d.meta.projection || 'equirectangular';

      for (const s of states) s.g = build(s.rings);
      provinces.forEach((p, i) => {
        p.id = i + 1;
        p.g = build(p.r);
        p.state = states[p.s];
        p.owner = p.state.owner;
      });
      for (const b of bgs) b.g = build(b.rings);
      xscale = d.meta.xscale || 1;
      riverPaths = {};
      const wt = d.water || { rivers: {}, lakes: [] };
      for (const w of Object.keys(wt.rivers)) {
        const p = new Path2D();
        for (const flat of wt.rivers[w]) { const pts = decode(flat); for (let i = 0; i < pts.length; i += 2) { if (i === 0) p.moveTo(pts[i], pts[i + 1]); else p.lineTo(pts[i], pts[i + 1]); } }
        riverPaths[w] = p;
      }
      lakePath = new Path2D();
      for (const lake of wt.lakes) for (const flat of lake) {
        const pts = decode(flat);
        for (let i = 0; i < pts.length; i += 2) { if (i === 0) lakePath.moveTo(pts[i], pts[i + 1]); else lakePath.lineTo(pts[i], pts[i + 1]); }
        lakePath.closePath();
      }
      cityProvs = provinces.filter((p) => p.c);

      // caminhos combinados por dono, para desenhar milhares de provincias de uma vez
      for (const code of Object.keys(owners)) {
        const prov = new Path2D(), st = new Path2D(), city = new Path2D(), cap = new Path2D();
        let any = false;
        for (const p of provinces) {
          if (p.owner !== code) continue;
          prov.addPath(p.g.path); any = true;
          if (p.c) city.addPath(p.g.path);
          if (p.k) cap.addPath(p.g.path);
        }
        for (const s of states) if (s.owner === code) st.addPath(s.g.path);
        if (!any) continue;
        ownerPaths[code] = { prov, states: st, city, cap, outline: build(d.outlines[code] || []).path };
      }
      stateOrder = states.slice().sort((a, b) => b.g.barea - a.g.barea);

      buildLegend();
      resize();
      window.__map = { view, states, provinces, cityProvs, fitAll, hit, get hover() { return hover; } };
    })
    .catch((err) => {
      infoEl.innerHTML = '<p class="hint">Não foi possível carregar o mapa (' + esc(err.message) +
        '). Abra a página por um servidor web, não direto do arquivo.</p>';
    });
})();
