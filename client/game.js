/* Camada de jogo (offline): unidades, movimento pelo grafo de províncias e combate simples.
 *
 * Toda a regra fica em `Sim`, que não toca no DOM nem no canvas. A ideia é que o
 * servidor do modo online rode exatamente o mesmo `Sim.step()` e os clientes só
 * mandem ordens (`Sim.order`). A parte de baixo liga a simulação ao mapa (map.js).
 */
(() => {
  'use strict';

  const AXIS = new Set(['GER', 'ROM', 'FIN', 'HUN', 'AXM']);
  const sideOf = (o) => (AXIS.has(o) ? 'AXIS' : 'SOV');
  const SIDE_NAME = { AXIS: 'Eixo', SOV: 'União Soviética' };
  const MOVE_DAYS = 2;        // dias para cruzar uma província
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
      this.P = provinces;                         // { owner, a (vizinhas), c (cidade?) }
      this.rand = rng(seed);
      this.day = 0;
      this.ctrl = provinces.map((p) => p.owner);   // quem controla cada província
      this.units = [];
      this.nextId = 1;
      this.log = [];
      this.setup();
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

    // caminho mais curto (em províncias) por busca em largura
    findPath(from, to) {
      if (from === to) return [];
      const prev = new Map([[from, -1]]), q = [from];
      for (let h = 0; h < q.length; h++) {
        const i = q[h];
        for (const j of this.P[i].a) {
          if (prev.has(j)) continue;
          prev.set(j, i);
          if (j === to) { const path = []; for (let k = to; k !== from; k = prev.get(k)) path.push(k); return path.reverse(); }
          q.push(j);
        }
      }
      return null;
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

    enemyAt(p, u) {                                    // há inimigo (unidade ou controle) em p?
      const s = sideOf(u.o);
      const foes = this.units.some((x) => x.p === p && sideOf(x.o) !== s);
      return foes || sideOf(this.ctrl[p]) !== s;
    }

    step() {
      this.day++;
      const attacks = new Map();                        // província alvo -> atacantes
      for (const u of this.units) {
        if (!u.path.length) { if (u.str < 100) u.str = Math.min(100, u.str + 1); continue; }
        const next = u.path[0];
        if (this.units.some((x) => x.p === next && sideOf(x.o) !== sideOf(u.o))) {
          (attacks.get(next) || attacks.set(next, []).get(next)).push(u);       // combate
          u.target = next; continue;
        }
        u.target = -1;
        if (u.wait > 0) { u.wait--; continue; }
        u.p = next; u.path.shift(); u.wait = MOVE_DAYS - 1;
        if (sideOf(this.ctrl[next]) !== sideOf(u.o)) this.ctrl[next] = u.o;     // ocupa
      }
      for (const [p, atk] of attacks) {
        const def = this.units.filter((x) => x.p === p && sideOf(x.o) !== sideOf(atk[0].o));
        const bonus = 1.15 + (this.P[p].c ? 0.2 : 0);
        const a = atk.reduce((s, u) => s + u.str, 0) * (0.08 + this.rand() * 0.06);
        const d = def.reduce((s, u) => s + u.str, 0) * (0.07 + this.rand() * 0.05) * bonus;
        for (const u of def) u.str -= a / def.length;
        for (const u of atk) u.str -= d / atk.length;
      }
      const before = this.units.length;
      this.units = this.units.filter((u) => u.str > 0);
      if (this.units.length !== before) this.log.push(`dia ${this.day}: ${before - this.units.length} divisão(ões) destruída(s)`);
      // atacantes cujo alvo ficou vazio avançam no mesmo dia
      for (const u of this.units) {
        if (u.target >= 0 && !this.units.some((x) => x.p === u.target && sideOf(x.o) !== sideOf(u.o))) {
          u.p = u.target; u.path.shift(); u.target = -1; u.wait = MOVE_DAYS - 1;
          if (sideOf(this.ctrl[u.p]) !== sideOf(u.o)) this.ctrl[u.p] = u.o;
        }
      }
    }

    get date() {
      const d = new Date(START + this.day * 86400000);
      return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    }
  }
  window.Sim = Sim;           // o servidor do modo online pode reutilizar

  // ---------------------------------------------------------------- ligação com o mapa
  const hooks = (window.__hooks = window.__hooks || {});
  const $ = (id) => document.getElementById(id);
  let M = null, sim = null, side = 'AXIS', selected = null, speed = 0, timer = null;
  const sel = { prov: -1, ids: [] };

  const SPEEDS = [0, 900, 280, 70];                      // ms por dia
  function setSpeed(s) {
    speed = s;
    clearInterval(timer);
    if (s > 0) timer = setInterval(() => { sim.step(); refresh(); }, SPEEDS[s]);
    $('gspeed').textContent = s === 0 ? 'pausado' : `velocidade ${s}`;
    for (const [id, v] of [['gpause', 0], ['g1', 1], ['g2', 2], ['g3', 3]]) $(id).setAttribute('aria-pressed', String(v === s));
  }

  function refresh() {
    $('gdate').textContent = sim.date;
    // seleção some se as unidades morreram
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
    el.textContent = `${us.length} div. em ${p.c || p.state.name} · força ${str}%` +
      (dest ? ` → ${dest.c || dest.state.name} (${us[0].path.length} prov.)` : '');
  }

  hooks.ready = (map) => {
    M = map;
    sim = new Sim(map.provinces);
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
    if (sel.prov >= 0 && idx !== sel.prov) {            // ordem de movimento
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
    return false;                                       // sem unidade: cai no card do estado
  };

  const shade = (hex, f) => {
    const v = parseInt(hex.slice(1), 16);
    return `rgb(${Math.min(255, ((v >> 16) & 255) * f) | 0},${Math.min(255, ((v >> 8) & 255) * f) | 0},${Math.min(255, (v & 255) * f) | 0})`;
  };

  hooks.draw = (ctx, a) => {
    if (!sim) return;
    const { view, dpr, toSX, toSY, zoomRel, owners } = a;
    // províncias ocupadas: cor de quem controla
    ctx.setTransform(dpr * view.k, 0, 0, -dpr * view.k, dpr * view.tx, dpr * view.ty);
    ctx.lineWidth = 0.7 / view.k;
    for (let i = 0; i < sim.ctrl.length; i++) {
      const p = M.provinces[i];
      if (sim.ctrl[i] === p.owner) continue;
      ctx.globalAlpha = 0.6; ctx.fillStyle = owners[sim.ctrl[i]].color; ctx.fill(p.g.path, 'nonzero');
      ctx.globalAlpha = 1; ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.stroke(p.g.path);
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
    // contadores
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
