/* Camada de jogo (offline): unidades, movimento pelo grafo de províncias e combate.
 *
 * Novidades:
 *  - Terreno afeta custo de movimento (MOVE_DAYS * terrain.moveCost dias)
 *  - Rios entre províncias vizinhas adicionam +2 dias de cruzamento
 *  - Terreno afeta combate: defBonus e atkBonus por tipo
 *  - Toda a regra fica em `Sim`, sem DOM nem canvas, para o servidor online
 *    rodar o mesmo `Sim.step()` e os clientes só enviarem ordens.
 */
(() => {
  'use strict';

  const AXIS = new Set(['GER', 'ROM', 'FIN', 'HUN', 'AXM']);
  const sideOf = (o) => (AXIS.has(o) ? 'AXIS' : 'SOV');
  const SIDE_NAME = { AXIS: 'Eixo', SOV: 'União Soviética' };
  const MOVE_DAYS = 2;        // dias base para cruzar uma província (terreno pode multiplicar)
  const RIVER_EXTRA = 2;      // dias extras para cruzar um rio
  const START = Date.UTC(1941, 5, 22);
  const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

  function rng(seed) {                 // mulberry32: mesmo resultado no cliente e no servidor
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ------------------------------------------------------------------ simulação
  class Sim {
    constructor(provinces, seed = 1941) {
      this.P = provinces;                         // { owner, a (vizinhas), c (cidade?), terrain }
      this.rand = rng(seed);
      this.day = 0;
      this.ctrl = provinces.map((p) => p.owner);   // quem controla cada província
      this.units = [];
      this.nextId = 1;
      this.log = [];
      // riverEdges e TERRAIN_INFO vêm do map.js via window.__map (carregados depois de ready)
      this.riverEdges = null;
      this.terrainInfo = null;
      this.setup();
    }

    // custo (em dias) para mover de i para next
    moveCost(fromIdx, toIdx) {
      const P = this.P;
      const terrain = P[toIdx].terrain || 'plains';
      const ti = this.terrainInfo && this.terrainInfo[terrain];
      const terrainDays = ti ? MOVE_DAYS * ti.moveCost : MOVE_DAYS;
      // borda de rio?
      let riverDays = 0;
      if (this.riverEdges) {
        const key = `${Math.min(fromIdx, toIdx)}-${Math.max(fromIdx, toIdx)}`;
        if (this.riverEdges.has(key)) riverDays = RIVER_EXTRA;
      }
      return Math.round(terrainDays) + riverDays;
    }

    setup() {
      const P = this.P, r = this.rand;
      const isBorder = (i) => P[i].a.some((j) => sideOf(P[j].owner) !== sideOf(P[i].owner));
      const lines = { GER: 5, SOV: 4, ROM: 2, FIN: 2, HUN: 1 };
      const perProv = { GER: 2, SOV: 1, ROM: 1, FIN: 1, HUN: 1 };
      for (const o of Object.keys(lines)) {
        const mine = []; P.forEach((p, i) => { if (p.owner === o) mine.push(i); });
        let front = mine.filter(isBorder);
        const seen = new Set(front);
        let ring = front;
        for (let depth = 0; depth < lines[o]; depth++) {
          for (const i of ring) if (depth === 0 || r() < (o === 'SOV' ? 0.5 : 0.6)) for (let k = 0; k < (depth === 0 ? perProv[o] : 1); k++) this.addUnit(o, i);
          const next = [];
          for (const i of ring) for (const j of P[i].a) if (P[j].owner === o && !seen.has(j)) { seen.add(j); next.push(j); }
          ring = next;
        }
      }
    }

    addUnit(o, p) { this.units.push({ id: this.nextId++, o, p, str: 100, path: [], wait: 0, target: -1 }); }
    unitsAt(p) { return this.units.filter((u) => u.p === p); }
    sideAt(p) { const u = this.units.find((x) => x.p === p); return u ? sideOf(u.o) : null; }

    // caminho mais curto (em custo de dias) via Dijkstra
    findPath(from, to) {
      if (from === to) return [];
      const dist = new Map([[from, 0]]);
      const prev = new Map([[from, -1]]);
      // heap simples (fila de prioridade com array ordenado)
      const heap = [{ d: 0, i: from }];
      while (heap.length) {
        heap.sort((a, b) => a.d - b.d);
        const { d, i } = heap.shift();
        if (d > (dist.get(i) ?? Infinity)) continue;
        if (i === to) {
          // reconstrói o caminho
          const path = [];
          for (let k = to; k !== from; k = prev.get(k)) path.push(k);
          return path.reverse();
        }
        for (const j of this.P[i].a) {
          const nd = d + this.moveCost(i, j);
          if (nd < (dist.get(j) ?? Infinity)) {
            dist.set(j, nd); prev.set(j, i);
            heap.push({ d: nd, i: j });
          }
        }
      }
      return null;
    }

    // custo total do caminho (em dias)
    pathCost(from, path) {
      let cost = 0, cur = from;
      for (const next of path) { cost += this.moveCost(cur, next); cur = next; }
      return cost;
    }

    order(unitIds, dest) {
      let n = 0;
      for (const id of unitIds) {
        const u = this.units.find((x) => x.id === id);
        if (!u) continue;
        const path = this.findPath(u.p, dest);
        if (!path) continue;
        u.path = path; u.target = -1; n++;
      }
      return n;
    }

    enemyAt(p, u) {
      const s = sideOf(u.o);
      const foes = this.units.some((x) => x.p === p && sideOf(x.o) !== s);
      return foes || sideOf(this.ctrl[p]) !== s;
    }

    step() {
      this.day++;
      const attacks = new Map();
      for (const u of this.units) {
        if (!u.path.length) { if (u.str < 100) u.str = Math.min(100, u.str + 1); continue; }
        const next = u.path[0];
        if (this.units.some((x) => x.p === next && sideOf(x.o) !== sideOf(u.o))) {
          (attacks.get(next) || attacks.set(next, []).get(next)).push(u);
          u.target = next; continue;
        }
        u.target = -1;
        if (u.wait > 0) { u.wait--; continue; }
        u.p = next; u.path.shift();
        // custo de movimento do próximo passo (agora com terreno e rio)
        const nextNext = u.path.length ? u.path[0] : next;
        u.wait = this.moveCost(next, nextNext) - 1;
        if (sideOf(this.ctrl[next]) !== sideOf(u.o)) this.ctrl[next] = u.o;
      }
      for (const [p, atk] of attacks) {
        const def = this.units.filter((x) => x.p === p && sideOf(x.o) !== sideOf(atk[0].o));
        const terrain = this.P[p].terrain || 'plains';
        const ti = (this.terrainInfo && this.terrainInfo[terrain]) || { defBonus: 0, atkBonus: 0 };
        // cidades têm bônus extra de defesa (como no HOI4)
        const cityBonus = this.P[p].c ? 0.2 : 0;
        const defMult = 1.0 + ti.defBonus + cityBonus;
        const atkMult = 1.0 + ti.atkBonus;
        const a = atk.reduce((s, u) => s + u.str, 0) * (0.08 + this.rand() * 0.06) * Math.max(0.3, atkMult);
        const d = def.reduce((s, u) => s + u.str, 0) * (0.07 + this.rand() * 0.05) * defMult;
        for (const u of def) u.str -= a / def.length;
        for (const u of atk) u.str -= d / atk.length;
      }
      const before = this.units.length;
      this.units = this.units.filter((u) => u.str > 0);
      if (this.units.length !== before) this.log.push(`dia ${this.day}: ${before - this.units.length} divisão(ões) destruída(s)`);
      for (const u of this.units) {
        if (u.target >= 0 && !this.units.some((x) => x.p === u.target && sideOf(x.o) !== sideOf(u.o))) {
          u.p = u.target; u.path.shift(); u.target = -1;
          const nextNext2 = u.path.length ? u.path[0] : u.p;
          u.wait = this.moveCost(u.p, nextNext2) - 1;
          if (sideOf(this.ctrl[u.p]) !== sideOf(u.o)) this.ctrl[u.p] = u.o;
        }
      }
    }

    get date() {
      const d = new Date(START + this.day * 86400000);
      return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    }
  }
  window.Sim = Sim;

  // ---------------------------------------------------------------- ligação com o mapa
  const hooks = (window.__hooks = window.__hooks || {});
  const $ = (id) => document.getElementById(id);
  let M = null, sim = null, side = 'AXIS', selected = null, speed = 0, timer = null;
  const sel = { prov: -1, ids: [] };

  const SPEEDS = [0, 900, 280, 70];
  function setSpeed(s) {
    speed = s;
    clearInterval(timer);
    if (s > 0) timer = setInterval(() => { sim.step(); refresh(); }, SPEEDS[s]);
    $('gspeed').textContent = s === 0 ? 'pausado' : `velocidade ${s}`;
    for (const [id, v] of [['gpause', 0], ['g1', 1], ['g2', 2], ['g3', 3]]) $(id).setAttribute('aria-pressed', String(v === s));
  }

  function refresh() {
    $('gdate').textContent = sim.date;
    if (sel.prov >= 0) {
      sel.ids = sel.ids.filter((id) => sim.units.some((u) => u.id === id));
      if (!sel.ids.length) sel.prov = -1;
    }
    describe();
    M.schedule();
  }

  function describe() {
    const el = $('gsel');
    const mine = sim.units.filter((u) => sideOf(u.o) === side).length;
    const theirs = sim.units.length - mine;
    if (sel.prov < 0) {
      el.textContent = `${SIDE_NAME[side]}: ${mine} divisões · inimigo: ${theirs}. Clique numa província sua com unidades e depois no destino.`;
      return;
    }
    const us = sim.units.filter((u) => sel.ids.includes(u.id));
    const str = Math.round(us.reduce((s, u) => s + u.str, 0) / us.length);
    const p = M.provinces[sel.prov];
    const dest = us[0].path.length ? M.provinces[us[0].path[us[0].path.length - 1]] : null;
    const terrain = p.terrain || 'plains';
    const ti = sim.terrainInfo && sim.terrainInfo[terrain];
    const pathDays = us[0].path.length ? sim.pathCost(us[0].p, us[0].path) : 0;
    el.textContent = `${us.length} div. em ${p.c || p.state.name} [${ti ? ti.label : 'Planície'}] · força ${str}%` +
      (dest ? ` → ${dest.c || dest.state.name} (~${pathDays} dias)` : '');
  }

  hooks.ready = (map) => {
    M = map;
    sim = new Sim(map.provinces);
    // conectar riverEdges e TERRAIN_INFO ao sim
    sim.riverEdges = map.riverEdges || new Set();
    sim.terrainInfo = map.TERRAIN_INFO || {};
    const selEl = $('gside');
    selEl.innerHTML = Object.entries(SIDE_NAME).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
    selEl.onchange = () => { side = selEl.value; sel.prov = -1; sel.ids = []; describe(); M.schedule(); };
    $('gpause').onclick = () => setSpeed(0);
    $('g1').onclick = () => setSpeed(1);
    $('g2').onclick = () => setSpeed(2);
    $('g3').onclick = () => setSpeed(3);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && e.target.tagName !== 'SELECT') { e.preventDefault(); setSpeed(speed ? 0 : 1); }
      if (e.key === 'Escape') { sel.prov = -1; sel.ids = []; describe(); }
    });
    setSpeed(0); refresh();
    window.__sim = sim;
  };

  hooks.click = (h) => {
    if (!sim || !h || h.kind !== 'prov') { if (sel.prov >= 0) { sel.prov = -1; sel.ids = []; describe(); return true; } return false; }
    const idx = h.ref.id - 1;
    const here = sim.unitsAt(idx).filter((u) => sideOf(u.o) === side);
    if (sel.prov >= 0 && idx !== sel.prov) {
      const n = sim.order(sel.ids, idx);
      describe();
      return n > 0 || true;
    }
    if (here.length) {
      if (idx === sel.prov) { sel.prov = -1; sel.ids = []; }
      else { sel.prov = idx; sel.ids = here.map((u) => u.id); }
      describe();
      return true;
    }
    return false;
  };

  const shade = (hex, f) => {
    const v = parseInt(hex.slice(1), 16);
    return `rgb(${Math.min(255, ((v >> 16) & 255) * f) | 0},${Math.min(255, ((v >> 8) & 255) * f) | 0},${Math.min(255, (v & 255) * f) | 0})`;
  };

  hooks.draw = (ctx, a) => {
    if (!sim) return;
    const { view, dpr, toSX, toSY, zoomRel, owners } = a;
    ctx.setTransform(dpr * view.k, 0, 0, -dpr * view.k, dpr * view.tx, dpr * view.ty);
    ctx.lineWidth = 0.7 / view.k;

    // províncias ocupadas: cor de quem controla (semitransparente)
    for (let i = 0; i < sim.ctrl.length; i++) {
      const p = M.provinces[i];
      if (sim.ctrl[i] === p.owner) continue;
      ctx.globalAlpha = 0.6; ctx.fillStyle = owners[sim.ctrl[i]].color; ctx.fill(p.g.path, 'nonzero');
      ctx.globalAlpha = 1; ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.stroke(p.g.path);
    }

    // destaque de bordas de rio (apenas zoom próximo)
    if (zoomRel > 1.8 && sim.riverEdges && sim.riverEdges.size > 0) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.strokeStyle = 'rgba(80,160,220,0.55)';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([4, 3]);
      // marca províncias que têm rio em pelo menos uma borda
      for (const key of sim.riverEdges) {
        const [iStr, jStr] = key.split('-');
        const i = parseInt(iStr), j = parseInt(jStr);
        const pi = M.provinces[i], pj = M.provinces[j];
        if (!pi || !pj) continue;
        const sx1 = toSX(pi.l[0]), sy1 = toSY(pi.l[1]);
        const sx2 = toSX(pj.l[0]), sy2 = toSY(pj.l[1]);
        if (sx1 < -20 && sx2 < -20) continue;
        if (sy1 < -20 && sy2 < -20) continue;
        ctx.beginPath(); ctx.moveTo(sx1, sy1); ctx.lineTo(sx2, sy2); ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.setTransform(dpr * view.k, 0, 0, -dpr * view.k, dpr * view.tx, dpr * view.ty);
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // rota da seleção
    if (sel.prov >= 0) {
      const us = sim.units.find((u) => u.id === sel.ids[0]);
      if (us && us.path.length) {
        ctx.strokeStyle = '#ffd35c'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
        ctx.beginPath(); ctx.moveTo(toSX(M.provinces[us.p].l[0]), toSY(M.provinces[us.p].l[1]));
        for (const j of us.path) ctx.lineTo(toSX(M.provinces[j].l[0]), toSY(M.provinces[j].l[1]));
        ctx.stroke(); ctx.setLineDash([]);
      }
    }

    // contadores de unidades
    const big = zoomRel > 2.2;
    const stacks = new Map();
    for (const u of sim.units) { const s = stacks.get(u.p) || { o: u.o, n: 0, str: 0, moving: false }; s.n++; s.str += u.str; s.moving = s.moving || u.path.length > 0; stacks.set(u.p, s); }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const [p, s] of stacks) {
      const pr = M.provinces[p], x = toSX(pr.l[0]), y = toSY(pr.l[1]);
      if (x < -20 || y < -20 || x > a.W + 20 || y > a.H + 20) continue;
      const col = owners[s.o].color, chosen = sel.prov === p;
      if (!big) {
        ctx.fillStyle = shade(col, 1.15); ctx.strokeStyle = chosen ? '#ffd35c' : '#0b0f14'; ctx.lineWidth = chosen ? 2 : 1;
        ctx.fillRect(x - 3.5, y - 3.5, 7, 7); ctx.strokeRect(x - 3.5, y - 3.5, 7, 7);
        continue;
      }
      // contador estilo HOI4: caixa escura com barra lateral colorida + barra de força
      const w = 26, h = 15;
      ctx.fillStyle = '#10161c'; ctx.fillRect(x - w / 2, y - h / 2, w, h);
      ctx.fillStyle = shade(col, 1.2); ctx.fillRect(x - w / 2, y - h / 2, 5, h);
      ctx.strokeStyle = chosen ? '#ffd35c' : 'rgba(255,255,255,0.7)'; ctx.lineWidth = chosen ? 2 : 1; ctx.strokeRect(x - w / 2, y - h / 2, w, h);
      ctx.fillStyle = '#fff'; ctx.font = '700 10px system-ui, sans-serif'; ctx.fillText(String(s.n), x + 3, y + 0.5);
      const bw = Math.max(0, (w - 6) * Math.min(1, s.str / (s.n * 100)));
      ctx.fillStyle = s.str / (s.n * 100) > 0.5 ? '#6fd36f' : '#e0a030'; ctx.fillRect(x - w / 2 + 5, y + h / 2 - 2, bw, 2);
    }
  };
})();
