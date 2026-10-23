(() => {
  'use strict';

  const canvas = document.getElementById('map');
  const ctx = canvas.getContext('2d');
  const infoEl = document.getElementById('info');
  const legendEl = document.getElementById('legend');

  const opts = { provinces: true, borders: true, names: true, cities: true, grid: false, terrain: true };
  const view = { k: 1, tx: 0, ty: 0, kfit: 1, kmin: 1, kmax: 1 };
  let W = 0, H = 0, dpr = 1;
  let data, SC, owners, states, provinces, bgs, bounds, projection = 'equirectangular', xscale = 1;
  let riverPaths = null, lakePath = null;
  const hooks = (window.__hooks = window.__hooks || {});   // camada de jogo (game.js) se pluga aqui
  let cityProvs = [];      // provincias que sao cidades (nome em p.c, capital em p.k)
  const ownerPaths = {};   // por dono: provincias (preenchimento), bordas de estado, contorno
  let hover = null, selected = null, focusOwner = null;
  let queued = false;

  // ---- rios como barreiras: set de pares "i-j" (i<j) separados por um rio
  let riverEdges = new Set();   // exposto em window.__map para o game.js

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
  const projY = (lat) => (projection === 'mercator'
    ? (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))
    : lat);

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

  // ============================================================ TERRENO
  // Atribui terrain a cada provincia baseado em coordenadas + ruido hash
  const TERRAIN_TYPES = ['plains', 'forest', 'marsh', 'hills', 'mountains', 'urban', 'desert'];

  const TERRAIN_INFO = {
    plains:    { label: 'Planície',   color: '#6a8a4a', moveCost: 1, defBonus: 0,   atkBonus: 0   },
    forest:    { label: 'Floresta',   color: '#2d5c2a', moveCost: 2, defBonus: 0.15, atkBonus: -0.1 },
    marsh:     { label: 'Pântano',    color: '#3d6e5a', moveCost: 3, defBonus: 0.20, atkBonus: -0.2 },
    hills:     { label: 'Colinas',    color: '#7a6a3a', moveCost: 2, defBonus: 0.10, atkBonus: -0.05 },
    mountains: { label: 'Montanhas', color: '#6a6060', moveCost: 4, defBonus: 0.35, atkBonus: -0.3 },
    urban:     { label: 'Urbano',     color: '#5a5050', moveCost: 2, defBonus: 0.25, atkBonus: -0.15 },
    desert:    { label: 'Estepe',     color: '#8a7a3a', moveCost: 2, defBonus: 0,   atkBonus: 0   },
  };

  // hash sem seno para ruido determinístico por provincia
  function hashFloat(id, salt) {
    let n = Math.imul(id + salt * 2654435761, 2246822519);
    n = Math.imul(n ^ (n >>> 13), 3266489917);
    n ^= n >>> 16;
    return (n >>> 0) / 4294967295;
  }

  function assignTerrain(p) {
    if (p.c) return 'urban';        // cidades sempre urbanas
    const [lonRaw, lat] = p.l;
    const lon = lonRaw / (xscale || 1);  // longitude real
    const id = p.id;
    const noise = hashFloat(id, 1);
    const noise2 = hashFloat(id, 2);

    // ---- Montanhas ----
    // Cárpatos: lat 44-50, lon 17-28
    if (lat >= 44 && lat <= 50 && lon >= 17 && lon <= 28 && noise < 0.65) return 'mountains';
    // Alpes (bordas do mapa): lat 45-48, lon 9-14
    if (lat >= 45 && lat <= 48 && lon >= 9 && lon <= 14 && noise < 0.7) return 'mountains';
    // Cáucaso: lat 40-44, lon 38-52
    if (lat >= 40 && lat <= 44 && lon >= 38 && lon <= 52 && noise < 0.6) return 'mountains';
    // Urais (leste): lon >= 57, lat 50-68
    if (lon >= 57 && lat >= 50 && lat <= 68 && noise < 0.45) return 'mountains';

    // ---- Colinas ----
    // Pré-Cárpatos e Transilvânia
    if (lat >= 44 && lat <= 51 && lon >= 15 && lon <= 30 && noise < 0.4) return 'hills';
    // Centro da Alemanha, Boêmia
    if (lat >= 49 && lat <= 54 && lon >= 10 && lon <= 18 && noise < 0.35) return 'hills';
    // Balkãs
    if (lat >= 40 && lat <= 45 && lon >= 20 && lon <= 30 && noise < 0.5) return 'hills';

    // ---- Pântano (Pripyat e regiões bálticas) ----
    // Pântano de Pripyat: lat 51-53, lon 23-32
    if (lat >= 51 && lat <= 53 && lon >= 23 && lon <= 32 && noise < 0.6) return 'marsh';
    // Litoral báltico e Finlândia sul: lat 55-60, lon 20-30
    if (lat >= 55 && lat <= 60 && lon >= 20 && lon <= 30 && noise < 0.35) return 'marsh';

    // ---- Floresta ----
    // Finlândia e Carélia: lat > 60
    if (lat > 60 && noise < 0.8) return 'forest';
    // Norte da Rússia: lat 57-65, lon 28-60
    if (lat >= 57 && lat <= 65 && lon >= 28 && lon <= 60 && noise < 0.7) return 'forest';
    // Bielorrússia e Ucrânia norte: lat 51-57, lon 23-40
    if (lat >= 51 && lat <= 57 && lon >= 23 && lon <= 40 && noise < 0.5) return 'forest';
    // Polônia e Países Bálticos: lat 53-58, lon 16-28
    if (lat >= 53 && lat <= 58 && lon >= 16 && lon <= 28 && noise < 0.45) return 'forest';

    // ---- Estepe/Deserto ----
    // Estepe ucraniana e kazakstão: lat 44-50, lon 30-60
    if (lat >= 44 && lat <= 50 && lon >= 30 && lon <= 60 && noise < 0.6) return 'desert';
    // Crimeia e região ao sul: lat < 47, lon 30-40
    if (lat < 47 && lon >= 30 && lon <= 40 && noise2 < 0.5) return 'desert';

    // ---- Planície (padrão) ----
    return 'plains';
  }

  // ============================================================ RIO-BARREIRA
  // Detecta quais pares de províncias vizinhas têm um rio entre elas
  // Método: midpoint entre os dois centróides → se um segmento do rio passa perto
  function segToPointDist2(ax, ay, bx, by, px, py) {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) { const ex = px - ax, ey = py - ay; return ex * ex + ey * ey; }
    let t = ((px - ax) * dx + (py - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx, cy = ay + t * dy;
    const fx = px - cx, fy = py - cy;
    return fx * fx + fy * fy;
  }

  function buildRiverEdges(wt, provList) {
    const edges = new Set();
    // junta todos os segmentos de rio num array plano de [x0,y0,x1,y1]
    const segs = [];
    for (const w of Object.keys(wt.rivers || {})) {
      for (const flat of wt.rivers[w]) {
        const pts = [];
        let x = 0, y = 0;
        for (let i = 0; i < flat.length; i += 2) {
          if (i === 0) { x = flat[0]; y = flat[1]; } else { x += flat[i]; y += flat[i + 1]; }
          pts.push(x / SC, y / SC);
        }
        for (let i = 0; i < pts.length - 2; i += 2) segs.push(pts[i], pts[i + 1], pts[i + 2], pts[i + 3]);
      }
    }
    if (segs.length === 0) return edges;

    // threshold: ~1/3 do tamanho médio de uma província (em unidades do mapa)
    const THRESH2 = 0.06 * 0.06;   // ajustar se necessário

    for (const p of provList) {
      const [px, py] = p.l;
      for (const jIdx of p.a) {
        if (jIdx <= p.id - 1) continue; // só processa par uma vez (i < j)
        const q = provList[jIdx];
        const [qx, qy] = q.l;
        const mx = (px + qx) / 2, my = (py + qy) / 2;
        // testa se algum segmento de rio passa perto do midpoint
        for (let s = 0; s < segs.length; s += 4) {
          const d2 = segToPointDist2(segs[s], segs[s + 1], segs[s + 2], segs[s + 3], mx, my);
          if (d2 < THRESH2) {
            const key = `${Math.min(p.id - 1, jIdx)}-${Math.max(p.id - 1, jIdx)}`;
            edges.add(key);
            break;
          }
        }
      }
    }
    return edges;
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
      const sh = (hf[j0 * w + i0] - hf[j1 * w + i1]) * 14;
      const t = Math.min(1, Math.max(0, (tn[k] - 0.3) * 2.6)) * 2;
      const p0 = pal[Math.min(1, Math.floor(t))], p1 = pal[Math.min(2, Math.floor(t) + 1)], f = t - Math.floor(t);
      const lum = 0.72 + hf[k] * 0.5 + sh * 0.55;
      for (let q = 0; q < 3; q++) d[k * 4 + q] = Math.max(0, Math.min(255, (p0[q] + (p1[q] - p0[q]) * f) * lum));
      d[k * 4 + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    return c;
  }

  // ------- texturas de terreno pré-renderizadas -------
  const terrainTex = {};   // terrain -> canvas

  function makeForestTex(n) {
    const c = document.createElement('canvas'); c.width = c.height = n;
    const g = c.getContext('2d');
    g.fillStyle = '#1a3d18'; g.fillRect(0, 0, n, n);
    let seed = 42;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    // árvores estilizadas (triângulos verdes)
    const treesPerTile = 18;
    for (let i = 0; i < treesPerTile; i++) {
      const tx = rnd() * n, ty = rnd() * n;
      const th = 9 + rnd() * 7;
      const tw = th * 0.55;
      const dark = rnd() < 0.4;
      g.fillStyle = dark ? '#1e4a1c' : '#2a6128';
      g.beginPath();
      g.moveTo(tx, ty - th);
      g.lineTo(tx - tw, ty);
      g.lineTo(tx + tw, ty);
      g.closePath();
      g.fill();
      // sombra sutil
      g.fillStyle = 'rgba(0,0,0,0.18)';
      g.beginPath();
      g.moveTo(tx, ty - th * 0.6);
      g.lineTo(tx - tw * 0.7, ty);
      g.lineTo(tx + tw * 0.5, ty);
      g.closePath();
      g.fill();
    }
    return c;
  }

  function makeMarshTex(n) {
    const c = document.createElement('canvas'); c.width = c.height = n;
    const g = c.getContext('2d');
    g.fillStyle = '#233d30'; g.fillRect(0, 0, n, n);
    // linhas horizontais azuladas + tufos
    g.strokeStyle = 'rgba(80,160,140,0.45)'; g.lineWidth = 1.2;
    for (let y = 4; y < n; y += 9) {
      g.beginPath(); g.moveTo(0, y); g.lineTo(n, y); g.stroke();
    }
    // pequenos ovais de agua
    let seed = 13;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    g.fillStyle = 'rgba(40,100,110,0.55)';
    for (let i = 0; i < 12; i++) {
      const ox = rnd() * n, oy = rnd() * n;
      g.beginPath(); g.ellipse(ox, oy, 5 + rnd() * 6, 2.5 + rnd() * 3, 0, 0, Math.PI * 2); g.fill();
    }
    return c;
  }

  function makeHillsTex(n) {
    const c = document.createElement('canvas'); c.width = c.height = n;
    const g = c.getContext('2d');
    g.fillStyle = '#4a4020'; g.fillRect(0, 0, n, n);
    let seed = 77;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    // meia-luas que imitam colinas
    for (let i = 0; i < 8; i++) {
      const hx = rnd() * n, hy = rnd() * n;
      const hr = 10 + rnd() * 10;
      const grd = g.createRadialGradient(hx, hy - hr * 0.3, 0, hx, hy, hr);
      grd.addColorStop(0, 'rgba(120,100,50,0.7)');
      grd.addColorStop(0.6, 'rgba(80,65,30,0.5)');
      grd.addColorStop(1, 'rgba(50,40,15,0)');
      g.fillStyle = grd;
      g.beginPath(); g.arc(hx, hy, hr, Math.PI, 0); g.closePath(); g.fill();
    }
    return c;
  }

  function makeMountainsTex(n) {
    const c = document.createElement('canvas'); c.width = c.height = n;
    const g = c.getContext('2d');
    g.fillStyle = '#2e2828'; g.fillRect(0, 0, n, n);
    let seed = 99;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    // picos de montanha
    for (let i = 0; i < 5; i++) {
      const mx = rnd() * n, my = n * 0.3 + rnd() * n * 0.6;
      const mh = 18 + rnd() * 18, mw = mh * (0.5 + rnd() * 0.4);
      // sombra
      g.fillStyle = 'rgba(0,0,0,0.5)';
      g.beginPath(); g.moveTo(mx, my - mh); g.lineTo(mx + mw * 0.4, my); g.lineTo(mx + mw, my); g.closePath(); g.fill();
      // face iluminada
      g.fillStyle = 'rgba(160,145,130,0.75)';
      g.beginPath(); g.moveTo(mx, my - mh); g.lineTo(mx - mw, my); g.lineTo(mx + mw * 0.1, my); g.closePath(); g.fill();
      // neve no pico
      if (mh > 24) {
        g.fillStyle = 'rgba(240,240,255,0.8)';
        g.beginPath(); g.moveTo(mx, my - mh); g.lineTo(mx - mw * 0.25, my - mh * 0.6); g.lineTo(mx + mw * 0.15, my - mh * 0.65); g.closePath(); g.fill();
      }
    }
    return c;
  }

  function makeUrbanTex(n) {
    const c = document.createElement('canvas'); c.width = c.height = n;
    const g = c.getContext('2d');
    g.fillStyle = '#2a2218'; g.fillRect(0, 0, n, n);
    // grade de ruas + blocos
    g.strokeStyle = 'rgba(80,70,50,0.6)'; g.lineWidth = 1;
    const step = 14;
    for (let x = 0; x < n; x += step) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, n); g.stroke(); }
    for (let y = 0; y < n; y += step) { g.beginPath(); g.moveTo(0, y); g.lineTo(n, y); g.stroke(); }
    // blocos de edificios
    let seed = 55;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    g.fillStyle = 'rgba(60,50,35,0.75)';
    for (let bx = 2; bx < n; bx += step) {
      for (let by = 2; by < n; by += step) {
        const bw = step - 4 - rnd() * 3, bh = step - 4 - rnd() * 3;
        g.fillRect(bx, by, bw, bh);
      }
    }
    return c;
  }

  function makePlainsTex(n) {
    const c = document.createElement('canvas'); c.width = c.height = n;
    const g = c.getContext('2d');
    g.fillStyle = '#3a5028'; g.fillRect(0, 0, n, n);
    // textura suave de campo
    let seed = 33;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    g.fillStyle = 'rgba(70,90,40,0.3)';
    for (let i = 0; i < 30; i++) {
      const px = rnd() * n, py = rnd() * n, pr = 3 + rnd() * 8;
      g.beginPath(); g.arc(px, py, pr, 0, Math.PI * 2); g.fill();
    }
    return c;
  }

  function makeDesertTex(n) {
    const c = document.createElement('canvas'); c.width = c.height = n;
    const g = c.getContext('2d');
    g.fillStyle = '#5a4e28'; g.fillRect(0, 0, n, n);
    let seed = 88;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    // ondas de estepe
    g.strokeStyle = 'rgba(100,90,50,0.4)'; g.lineWidth = 1;
    for (let i = 0; i < 6; i++) {
      const sy = rnd() * n;
      g.beginPath(); g.moveTo(0, sy);
      for (let x = 0; x < n; x += 8) g.lineTo(x, sy + (rnd() - 0.5) * 6);
      g.stroke();
    }
    return c;
  }

  function initTerrainTextures() {
    const N = 96;
    terrainTex.plains    = makePlainsTex(N);
    terrainTex.forest    = makeForestTex(N);
    terrainTex.marsh     = makeMarshTex(N);
    terrainTex.hills     = makeHillsTex(N);
    terrainTex.mountains = makeMountainsTex(N);
    terrainTex.urban     = makeUrbanTex(N);
    terrainTex.desert    = makeDesertTex(N);
  }

  // Cor de preenchimento da província baseado no dono + terreno
  function terrainFill(ownerColor, terrain) {
    const v = parseInt(ownerColor.slice(1), 16);
    let r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
    switch (terrain) {
      case 'forest':    r = r * 0.55 + 30 * 0.45 | 0; g = g * 0.55 + 80 * 0.45 | 0; b = b * 0.55 + 28 * 0.45 | 0; break;
      case 'marsh':     r = r * 0.6 + 35 * 0.4 | 0; g = g * 0.6 + 90 * 0.4 | 0; b = b * 0.6 + 80 * 0.4 | 0; break;
      case 'hills':     r = r * 0.7 + 90 * 0.3 | 0; g = g * 0.7 + 75 * 0.3 | 0; b = b * 0.7 + 35 * 0.3 | 0; break;
      case 'mountains': r = r * 0.5 + 85 * 0.5 | 0; g = g * 0.5 + 78 * 0.5 | 0; b = b * 0.5 + 78 * 0.5 | 0; break;
      case 'urban':     r = r * 0.55 + 65 * 0.45 | 0; g = g * 0.55 + 55 * 0.45 | 0; b = b * 0.55 + 45 * 0.45 | 0; break;
      case 'desert':    r = r * 0.6 + 105 * 0.4 | 0; g = g * 0.6 + 92 * 0.4 | 0; b = b * 0.6 + 42 * 0.4 | 0; break;
      default:          r = r * 0.85 | 0; g = g * 0.85 | 0; b = b * 0.85 | 0; break;
    }
    return `rgb(${Math.min(255,r)},${Math.min(255,g)},${Math.min(255,b)})`;
  }

  // paths por terrain por dono para desenhar de forma eficiente
  const terrainPaths = {};   // [owner][terrain] = Path2D

  const shadeCache = new Map();
  function shade(hex, f) {
    const key = hex + f; let r = shadeCache.get(key);
    if (!r) { const v = parseInt(hex.slice(1), 16); r = `rgb(${((v >> 16) & 255) * f | 0},${((v >> 8) & 255) * f | 0},${(v & 255) * f | 0})`; shadeCache.set(key, r); }
    return r;
  }

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
  function makeGrain(n) {
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

  // ------- ícones de terreno no canvas (zoom próximo) -------
  function drawTerrainIcons(zoomRel) {
    if (!opts.terrain || zoomRel < 2.5) return;
    const alpha = Math.min(1, (zoomRel - 2.5) / 1.5);
    ctx.save();
    ctx.globalAlpha = alpha * 0.82;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const tSize = Math.max(32, Math.min(96, view.k * 0.55));
    for (const p of provinces) {
      if (p.terrain === 'plains') continue;   // planície não precisa ícone extra
      const sx = toSX(p.l[0]), sy = toSY(p.l[1]);
      if (sx < -tSize || sy < -tSize || sx > W + tSize || sy > H + tSize) continue;
      if (dim(p.owner) < 1) continue;
      const tex2 = terrainTex[p.terrain];
      if (!tex2) continue;
      const pat = ctx.createPattern(tex2, 'repeat');
      pat.setTransform(new DOMMatrix([1, 0, 0, 1, sx % tSize, sy % tSize]));
      ctx.save();
      ctx.setTransform(dpr * view.k, 0, 0, -dpr * view.k, dpr * view.tx, dpr * view.ty);
      ctx.clip(p.g.path, 'nonzero');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = pat;
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = alpha * 0.55;
      ctx.fillRect(sx - tSize, sy - tSize, tSize * 2, tSize * 2);
      ctx.restore();
    }
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
  }

  function draw() {
    queued = false;
    ensureLayers();
    if (!tex) {
      const th = Math.round(1280 * (bounds[3] - bounds[1]) / (bounds[2] - bounds[0]));
      tex = makeTexture(1280, th); glow = makeGlow(1280, th); grain = makeGrain(192); detail = makeDetail(512);
      initTerrainTextures();
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

    // ---- terra: cores dos países com tinta de terreno
    lctx.setTransform(1, 0, 0, 1, 0, 0); lctx.globalAlpha = 1; lctx.globalCompositeOperation = 'source-over';
    lctx.clearRect(0, 0, layerL.width, layerL.height);
    lctx.setTransform(dpr * view.k, 0, 0, -dpr * view.k, dpr * view.tx, dpr * view.ty);
    lctx.lineJoin = 'round';

    for (const b of bgs) {
      lctx.globalAlpha = dim(b.owner); lctx.fillStyle = shade(bgColor(b), 0.7); lctx.fill(b.g.path, 'evenodd');
    }

    // Pintar províncias com cor de terreno (quando terrain layer ativo)
    if (opts.terrain) {
      for (const code of Object.keys(terrainPaths)) {
        const d2 = dim(code);
        lctx.globalAlpha = d2;
        const tp = terrainPaths[code];
        for (const terrain of Object.keys(tp)) {
          lctx.fillStyle = tp[terrain].fill;
          lctx.fill(tp[terrain].path, 'nonzero');
          lctx.strokeStyle = tp[terrain].fill;
          lctx.lineWidth = 1.0 / view.k;
          lctx.stroke(tp[terrain].path);
        }
      }
    } else {
      for (const code of Object.keys(ownerPaths)) {
        const op = ownerPaths[code], color = owners[code].color;
        lctx.globalAlpha = dim(code);
        lctx.fillStyle = shade(color, 0.7); lctx.fill(op.prov, 'nonzero');
        lctx.strokeStyle = shade(color, 0.7); lctx.lineWidth = 1.2 / view.k; lctx.stroke(op.prov);
      }
    }

    lctx.globalAlpha = 1;
    // Salvar snapshot da terra (antes dos overlays) para usar como máscara
    mctx.setTransform(1, 0, 0, 1, 0, 0); mctx.clearRect(0, 0, layerM.width, layerM.height); mctx.drawImage(layerL, 0, 0);

    // Textura procedural: aplica só dentro das áreas de terra usando layerM como clip
    lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // tex overlay: escurecer e dar profundidade ao mapa
    lctx.globalCompositeOperation = 'source-atop'; lctx.globalAlpha = 0.45;
    lctx.drawImage(tex, toSX(bounds[0]), toSY(bounds[3]), (bounds[2] - bounds[0]) * view.k, (bounds[3] - bounds[1]) * view.k);
    // glow das bordas de países
    lctx.globalCompositeOperation = 'source-over'; lctx.globalAlpha = 0.85;
    lctx.drawImage(glow, toSX(bounds[0]), toSY(bounds[3]), (bounds[2] - bounds[0]) * view.k, (bounds[3] - bounds[1]) * view.k);
    // detalhe de relevo
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    const dp = lctx.createPattern(detail, 'repeat');
    dp.setTransform(new DOMMatrix([view.k * dpr * 2.2 / 512, 0, 0, view.k * dpr * 2.2 / 512, view.tx * dpr, view.ty * dpr]));
    lctx.globalCompositeOperation = 'source-atop'; lctx.globalAlpha = 0.35; lctx.fillStyle = dp;
    lctx.fillRect(0, 0, layerL.width, layerL.height);
    // grain de papel
    const pat = lctx.createPattern(grain, 'repeat');
    pat.setTransform(new DOMMatrix([1, 0, 0, 1, (view.tx * dpr) % 192, (view.ty * dpr) % 192]));
    lctx.globalCompositeOperation = 'source-atop'; lctx.globalAlpha = 0.18; lctx.fillStyle = pat;
    lctx.fillRect(0, 0, layerL.width, layerL.height);
    lctx.globalCompositeOperation = 'source-over'; lctx.globalAlpha = 1;

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
      const op = ownerPaths[code], d2 = dim(code);
      if (opts.provinces) {
        ctx.globalAlpha = d2; ctx.strokeStyle = 'rgba(0,0,0,0.34)'; ctx.lineWidth = 0.7 * px; ctx.stroke(op.prov);
      }
      if (opts.cities && op.city) {
        ctx.globalAlpha = d2; ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 0.9 * px; ctx.stroke(op.city);
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

    if (hooks.draw) {
      ctx.save();
      hooks.draw(ctx, { view, dpr, toSX, toSY, zoomRel: view.k / view.kfit, owners, W, H });
      ctx.restore();
    }

    // ícones de terreno (zoom próximo)
    drawTerrainIcons(zoomRel);

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
    const lightFill = (code) => {
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

    // nomes grandes dos paises
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
        if (!c.k && !showAll) continue;
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

  function terrainBadge(terrain) {
    const ti = TERRAIN_INFO[terrain] || TERRAIN_INFO.plains;
    const icons = { plains: '🌾', forest: '🌲', marsh: '🌿', hills: '⛰', mountains: '🏔', urban: '🏙', desert: '🌾' };
    return `<span style="display:inline-flex;align-items:center;gap:4px;background:rgba(255,255,255,0.1);border-radius:4px;padding:1px 6px;font-size:11px;">${icons[terrain] || ''}${ti.label}</span>`;
  }

  function stateCard(s, prov) {
    const o = owners[s.owner], n = nota(s);
    const city = prov && prov.c;
    const terrain = prov && prov.terrain;
    const ti = terrain ? TERRAIN_INFO[terrain] : null;
    const isRiverEdge = prov && prov.a && prov.a.some((jIdx) => {
      const key = `${Math.min(prov.id - 1, jIdx)}-${Math.max(prov.id - 1, jIdx)}`;
      return riverEdges.has(key);
    });
    return `<div class="row"><span class="chip" style="background:${o.color}"></span><h2>${esc(city ? prov.c : s.name)}</h2></div>` +
      '<dl>' +
      (prov ? `<dt>Província</dt><dd>nº ${fmt(prov.id)}${city ? (prov.k ? ' · capital' : ' · cidade') : ''}</dd>` : '') +
      (city ? `<dt>Estado</dt><dd>${esc(s.name)}</dd>` : '') +
      (terrain ? `<dt>Terreno</dt><dd>${terrainBadge(terrain)}</dd>` : '') +
      (ti ? `<dt>Custo mov.</dt><dd>${ti.moveCost} dia${ti.moveCost > 1 ? 's' : ''} por prov.</dd>` : '') +
      (ti && ti.defBonus ? `<dt>Bônus defesa</dt><dd>+${Math.round(ti.defBonus * 100)}%</dd>` : '') +
      (isRiverEdge ? `<dt>Barreira</dt><dd>⚓ Rio na fronteira (+2 dias)</dd>` : '') +
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
      if (hooks.click && hooks.click(h, e)) { if (e.pointerType !== 'mouse') hover = null; updateInfo(); schedule(); pointers.delete(e.pointerId); if (pointers.size === 0) { drag = null; canvas.classList.remove('dragging'); } return; }
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
  // toggle terreno (adicionado dinamicamente)
  window.addEventListener('keydown', (e) => {
    if (e.key === '+' || e.key === '=') zoomAt(W / 2, H / 2, 1.3);
    else if (e.key === '-') zoomAt(W / 2, H / 2, 1 / 1.3);
    else if (e.key === '0') fitAll();
    else if (e.key === 't' || e.key === 'T') { opts.terrain = !opts.terrain; schedule(); }
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

      // ----- atribuir terreno a cada província -----
      for (const p of provinces) {
        p.terrain = assignTerrain(p);
      }

      // ----- detectar bordas de rio -----
      riverEdges = buildRiverEdges(wt, provinces);

      cityProvs = provinces.filter((p) => p.c);

      // caminhos combinados por dono + terrain
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

        // paths por terrain para renderização eficiente
        terrainPaths[code] = {};
        const color = owners[code].color;
        const byTerrain = {};
        for (const p of provinces) {
          if (p.owner !== code) continue;
          const t = p.terrain;
          if (!byTerrain[t]) byTerrain[t] = new Path2D();
          byTerrain[t].addPath(p.g.path);
        }
        for (const t of Object.keys(byTerrain)) {
          // terrainFill já retorna rgb(...), não usar shade() que espera #hex
          terrainPaths[code][t] = { path: byTerrain[t], fill: terrainFill(color, t) };
        }
      }
      stateOrder = states.slice().sort((a, b) => b.g.barea - a.g.barea);

      buildLegend();
      resize();
      window.__map = {
        view, states, provinces, cityProvs, owners, fitAll, hit, schedule,
        riverEdges, TERRAIN_INFO,
        get hover() { return hover; }
      };
      if (hooks.ready) hooks.ready(window.__map);
    })
    .catch((err) => {
      infoEl.innerHTML = '<p class="hint">Não foi possível carregar o mapa (' + esc(err.message) +
        '). Abra a página por um servidor web, não direto do arquivo.</p>';
    });
})();
