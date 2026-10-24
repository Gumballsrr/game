/**
 * HOI4 Clone - Core Simulation (shared client + server)
 * Frente Oriental 1941 — Operação Barbarossa
 * Fórmulas extraídas dos defines reais do HOI4 (00_defines.lua)
 */
'use strict';

const DEFINES = {
  COMBAT_STACKING_START: 5,
  COMBAT_STACKING_PENALTY: -0.02,
  ARMOR_VS_AVERAGE: 0.4,
  DAMAGE_SPLIT_FIRST_TARGET: 0.35,
  COMBAT_SUPPLY_LACK_ATTACKER_ATTACK: -0.25,
  COMBAT_SUPPLY_LACK_DEFENDER_ATTACK: -0.35,
  FLANKED_PROVINCES_COUNT: 3,
  FASTER_ORG_REGAIN_LEVEL: 0.25,
  FASTER_ORG_REGAIN_MULT: 1.0,
  SLOWER_ORG_REGAIN_LEVEL: 0.80,
  SLOWER_ORG_REGAIN_MULT: -0.5,
  FIGHTING_STRENGTH_DEATH_THRESHOLD: 0.001,
  XP_GAIN_PER_OVERRUN_UNIT: 35.0,
  VP_SURRENDER_BASE: 1.0,
  MOVE_DAYS_BASE: 2,
  ORG_REGAIN_BASE: 0.1,
  ORG_LOSS_IN_COMBAT: 0.04,
  FUEL_PENALTY_START_RATIO: 0.25,
  OUT_OF_FUEL_EQUIPMENT_MULT: 0.1,
};

const TERRAIN = {
  plains:   { moveCost: 1.0, atkBonus:  0.00, defBonus:  0.00, label: 'Planície' },
  forest:   { moveCost: 1.5, atkBonus: -0.10, defBonus:  0.15, label: 'Floresta' },
  urban:    { moveCost: 1.2, atkBonus: -0.10, defBonus:  0.25, label: 'Urbano'   },
  mountain: { moveCost: 2.5, atkBonus: -0.20, defBonus:  0.35, label: 'Montanha' },
  marsh:    { moveCost: 2.0, atkBonus: -0.15, defBonus:  0.10, label: 'Pântano'  },
  desert:   { moveCost: 1.3, atkBonus:  0.00, defBonus: -0.05, label: 'Deserto'  },
  hills:    { moveCost: 1.7, atkBonus: -0.10, defBonus:  0.20, label: 'Colinas'  },
};

const DIV_TEMPLATES = {
  GER_infantry:  { name:'Div. Infantaria',  icon:'🪖', softAttack:150, hardAttack:20,  defense:180, breakthrough:40,  armor:0,  piercing:10,  hp:250, org:60, manpower:11000, equipment:1800, speed:4.0, weight:1.0, prodCost:2500, days:70  },
  GER_panzer:    { name:'Div. Panzer',      icon:'⚙️', softAttack:200, hardAttack:120, defense:100, breakthrough:200, armor:80, piercing:100, hp:200, org:40, manpower:4000,  equipment:3500, speed:8.0, weight:1.5, prodCost:5000, days:120 },
  GER_motorized: { name:'Div. Motorizada',  icon:'🚗', softAttack:170, hardAttack:30,  defense:140, breakthrough:80,  armor:0,  piercing:20,  hp:220, org:50, manpower:8000,  equipment:2200, speed:7.0, weight:1.0, prodCost:3200, days:80  },
  GER_artillery: { name:'Div. Artilharia',  icon:'💥', softAttack:220, hardAttack:15,  defense:100, breakthrough:30,  armor:0,  piercing:5,   hp:180, org:35, manpower:7000,  equipment:2000, speed:3.5, weight:1.2, prodCost:3000, days:90  },
  SOV_infantry:  { name:'Div. Rifle',       icon:'🪖', softAttack:120, hardAttack:15,  defense:160, breakthrough:30,  armor:0,  piercing:8,   hp:260, org:50, manpower:12000, equipment:1500, speed:3.5, weight:1.0, prodCost:2000, days:60  },
  SOV_tank:      { name:'Div. Blindada',    icon:'⚙️', softAttack:180, hardAttack:100, defense:90,  breakthrough:180, armor:70, piercing:90,  hp:190, org:35, manpower:3500,  equipment:4000, speed:7.0, weight:1.5, prodCost:5500, days:130 },
  SOV_cavalry:   { name:'Div. Cavalaria',   icon:'🐴', softAttack:110, hardAttack:10,  defense:120, breakthrough:60,  armor:0,  piercing:5,   hp:200, org:55, manpower:8000,  equipment:1200, speed:6.0, weight:0.8, prodCost:2200, days:65  },
  ROM_infantry:  { name:'Div. Romena',      icon:'🪖', softAttack:100, hardAttack:10,  defense:140, breakthrough:25,  armor:0,  piercing:5,   hp:220, org:45, manpower:10000, equipment:1200, speed:3.5, weight:1.0, prodCost:1800, days:55  },
  FIN_infantry:  { name:'Div. Finlandesa',  icon:'🪖', softAttack:130, hardAttack:12,  defense:200, breakthrough:35,  armor:0,  piercing:8,   hp:230, org:65, manpower:10000, equipment:1400, speed:4.0, weight:1.0, prodCost:2000, days:60  },
  HUN_infantry:  { name:'Div. Húngara',     icon:'🪖', softAttack:110, hardAttack:12,  defense:150, breakthrough:28,  armor:0,  piercing:6,   hp:230, org:48, manpower:10500, equipment:1300, speed:3.5, weight:1.0, prodCost:1900, days:58  },
  UKR_infantry:  { name:'Div. Ucraniana',   icon:'🪖', softAttack:115, hardAttack:14,  defense:155, breakthrough:28,  armor:0,  piercing:7,   hp:245, org:48, manpower:11500, equipment:1450, speed:3.5, weight:1.0, prodCost:1950, days:58  },
  BLR_infantry:  { name:'Div. Bielorrussa', icon:'🪖', softAttack:112, hardAttack:13,  defense:152, breakthrough:27,  armor:0,  piercing:7,   hp:242, org:47, manpower:11200, equipment:1420, speed:3.5, weight:1.0, prodCost:1920, days:57  },
};

const COUNTRY_DEFS = {
  GER: { name:'Alemanha',        color:'#565b5e', flag:'🇩🇪', faction:'AXIS', milFac:12, civFac:8,  pp:100, fuel:800, stability:0.85, warSupport:0.95, startDivs:['GER_panzer','GER_panzer','GER_motorized','GER_infantry','GER_infantry','GER_infantry','GER_infantry'], techs:{infantry_t2:true,armor_t2:true,motorized_t1:true,artillery_t1:true} },
  SOV: { name:'União Soviética', color:'#8a2431', flag:'🇷🇺', faction:'SOV',  milFac:14, civFac:10, pp:80,  fuel:600, stability:0.70, warSupport:0.80, startDivs:['SOV_infantry','SOV_infantry','SOV_infantry','SOV_infantry','SOV_tank','SOV_tank'], techs:{infantry_t1:true,armor_t1:true} },
  UKR: { name:'Ucrânia',        color:'#c8a832', flag:'🇺🇦', faction:'SOV',  milFac:6,  civFac:4,  pp:50,  fuel:200, stability:0.65, warSupport:0.70, startDivs:['UKR_infantry','UKR_infantry','UKR_infantry'], techs:{infantry_t1:true} },
  BLR: { name:'Bielorrússia',   color:'#3a6b3a', flag:'🇧🇾', faction:'SOV',  milFac:4,  civFac:3,  pp:40,  fuel:150, stability:0.65, warSupport:0.68, startDivs:['BLR_infantry','BLR_infantry'], techs:{infantry_t1:true} },
  ROM: { name:'Romênia',        color:'#b9b16f', flag:'🇷🇴', faction:'AXIS', milFac:4,  civFac:3,  pp:60,  fuel:300, stability:0.72, warSupport:0.78, startDivs:['ROM_infantry','ROM_infantry','ROM_infantry'], techs:{infantry_t1:true} },
  FIN: { name:'Finlândia',      color:'#a9b8c4', flag:'🇫🇮', faction:'AXIS', milFac:3,  civFac:2,  pp:55,  fuel:180, stability:0.80, warSupport:0.85, startDivs:['FIN_infantry','FIN_infantry'], techs:{infantry_t2:true} },
  HUN: { name:'Hungria',        color:'#d39a96', flag:'🇭🇺', faction:'AXIS', milFac:3,  civFac:2,  pp:55,  fuel:200, stability:0.70, warSupport:0.75, startDivs:['HUN_infantry','HUN_infantry'], techs:{infantry_t1:true} },
};

const TECH_TREE = {
  infantry_t1:     { name:'Infantaria I',    cost:100, prereqs:[],                       bonus:{softAtk:0.05,defense:0.05} },
  infantry_t2:     { name:'Infantaria II',   cost:200, prereqs:['infantry_t1'],          bonus:{softAtk:0.08,defense:0.08} },
  infantry_t3:     { name:'Infantaria III',  cost:350, prereqs:['infantry_t2'],          bonus:{softAtk:0.10,defense:0.12} },
  armor_t1:        { name:'Blindados I',     cost:150, prereqs:[],                       bonus:{hardAtk:0.10,armor:5} },
  armor_t2:        { name:'Blindados II',    cost:300, prereqs:['armor_t1'],             bonus:{hardAtk:0.15,armor:10,piercing:10} },
  armor_t3:        { name:'Blindados III',   cost:500, prereqs:['armor_t2'],             bonus:{hardAtk:0.20,armor:20,piercing:20} },
  artillery_t1:    { name:'Artilharia I',   cost:120, prereqs:[],                       bonus:{softAtk:0.15,hardAtk:0.05} },
  artillery_t2:    { name:'Artilharia II',  cost:250, prereqs:['artillery_t1'],         bonus:{softAtk:0.20,hardAtk:0.10} },
  motorized_t1:    { name:'Motorizado I',   cost:130, prereqs:[],                       bonus:{speed:1.0} },
  supply_t1:       { name:'Logística I',    cost:100, prereqs:[],                       bonus:{supplyConsumption:-0.10} },
  supply_t2:       { name:'Logística II',   cost:200, prereqs:['supply_t1'],            bonus:{supplyConsumption:-0.15} },
  doctrine_blitz:  { name:'Blitzkrieg',     cost:300, prereqs:['armor_t2','motorized_t1'], bonus:{breakthrough:0.20,orgRecover:0.10} },
  doctrine_deep:   { name:'Deep Battle',    cost:300, prereqs:['armor_t1','supply_t1'], bonus:{softAtk:0.12,manpowerBonus:0.10} },
};

function makeRng(seed) {
  let a = (seed >>> 0) || 1941;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Division {
  constructor(id, templateKey, owner, provinceIdx) {
    const tpl = DIV_TEMPLATES[templateKey] || DIV_TEMPLATES.GER_infantry;
    this.id = id; this.templateKey = templateKey;
    this.name = tpl.name; this.icon = tpl.icon || '🪖';
    this.owner = owner;
    this.softAttack = tpl.softAttack; this.hardAttack = tpl.hardAttack;
    this.defense = tpl.defense; this.breakthrough = tpl.breakthrough;
    this.armor = tpl.armor; this.piercing = tpl.piercing;
    this.speed = tpl.speed; this.weight = tpl.weight;
    this.maxHp = tpl.hp; this.hp = tpl.hp;
    this.maxOrg = tpl.org; this.org = tpl.org;
    this.manpower = tpl.manpower; this.equipment = tpl.equipment;
    this.maxEquipment = tpl.equipment; this.xp = 0;
    this.province = provinceIdx; this.target = null;
    this.moveProgress = 0; this.moveDays = 0;
    this.inCombat = false; this.combatTarget = null;
  }
  fightingStrength() { return Math.min(this.hp / this.maxHp, this.org / this.maxOrg); }
  isDead() { return this.fightingStrength() < DEFINES.FIGHTING_STRENGTH_DEATH_THRESHOLD; }
  effectiveAttack(isSoft, terrainBonus = 0, supplyOk = true) {
    const base = isSoft ? this.softAttack : this.hardAttack;
    return base * (1 + terrainBonus) * (supplyOk ? 1.0 : 1 + DEFINES.COMBAT_SUPPLY_LACK_ATTACKER_ATTACK);
  }
  effectiveDefense(tb = 0) { return this.defense * (1 + tb); }
  penetrationDamage(atkPierce, defArmor) {
    if (atkPierce >= defArmor) return 1.0;
    return DEFINES.ARMOR_VS_AVERAGE + (1 - DEFINES.ARMOR_VS_AVERAGE) * (atkPierce / Math.max(defArmor, 1));
  }
}

class Sim {
  constructor(mapData, seed = 1941) {
    this.map = mapData; this.rand = makeRng(seed); this.seed = seed;
    this.day = 0; this.hour = 0;
    this.date = new Date(Date.UTC(1941, 5, 22));
    this.ctrl = []; this.states = []; this.countries = {};
    this.units = []; this.nextUnitId = 1;
    this.combats = []; this.productionQueues = {};
    this.techQueues = {};
    this.log = [];
    this._initWorld();
  }

  _initWorld() {
    const P = this.map.provinces;
    this.ctrl = P.map(p => p.o || 'NEU');

    this.states = (this.map.states || []).map((s, i) => ({
      id: i, name: s.name || `State ${i}`,
      owner: s.owner || 'NEU', controller: s.owner || 'NEU',
      vp: s.vp || 0, manpower: s.manpower || 50000,
      milFac: s.milFac || 0, civFac: s.civFac || 0,
      resources: s.resources || {},
      provinces: s.provinces || [],
      buildings: { fort: 0, airfield: 0, ...(s.buildings || {}) },
    }));

    // Dividir estados soviéticos em UKR e BLR
    const UKR_NAMES = ['Lviv','Ternopil','Ivano','Khmeln','Vinn','Zhytomyr','Kyiv','Cherk',
      'Kropyvn','Mykolaiv','Odessa','Kherson','Zapor','Dnipro','Poltava','Kharkiv',
      'Donetsk','Luhansk','Sumy','Chernihiv','Rivne','Volyn','Ucrânia','Ukraine'];
    const BLR_NAMES = ['Brest','Hrodna','Minsk','Vitsebsk','Mahily','Homel','Gomel',
      'Bialystok','Baranavichy','Bielorrússia','Belarus'];

    this.states.forEach(s => {
      if (s.owner !== 'SOV') return;
      const nm = s.name || '';
      if (UKR_NAMES.some(n => nm.includes(n))) { s.owner = 'UKR'; s.controller = 'UKR'; }
      else if (BLR_NAMES.some(n => nm.includes(n))) { s.owner = 'BLR'; s.controller = 'BLR'; }
    });

    for (const [tag, def] of Object.entries(COUNTRY_DEFS)) {
      const ownedStates = this.states.filter(s => s.owner === tag);
      const totalVP = ownedStates.reduce((s, st) => s + (st.vp || 0), 0) || 100;
      const manpower = ownedStates.reduce((s, st) => s + (st.manpower || 50000), 0) || 500000;
      this.countries[tag] = {
        tag, name: def.name, color: def.color, flag: def.flag, faction: def.faction,
        milFac: def.milFac, civFac: def.civFac, pp: def.pp, fuel: def.fuel,
        stability: def.stability, warSupport: def.warSupport,
        techs: { ...(def.techs || {}) }, research: null,
        manpower, manpowerMax: manpower, equipment: 50000,
        totalVP, isDefeated: false,
      };
      this.productionQueues[tag] = [];
      this.techQueues[tag] = null;

      const divTemplates = def.startDivs || [];
      divTemplates.forEach((tplKey, i) => {
        const state = ownedStates[i % Math.max(ownedStates.length, 1)];
        const provIdx = state?.provinces?.[0] ?? 0;
        if (provIdx < this.map.provinces.length) this._spawnUnit(tplKey, tag, provIdx);
      });
    }
  }

  _spawnUnit(tplKey, owner, provIdx) {
    const div = new Division(this.nextUnitId++, tplKey, owner, provIdx);
    this.units.push(div);
    return div;
  }

  orderMove(unitId, targetProv) {
    const u = this.units.find(u => u.id === unitId);
    if (!u || u.inCombat || !this._isAdj(u.province, targetProv)) return false;
    const t = TERRAIN[this.map.provinces[targetProv]?.t || 'plains'] || TERRAIN.plains;
    u.target = targetProv; u.moveProgress = 0; u.moveDays = DEFINES.MOVE_DAYS_BASE * t.moveCost;
    return true;
  }

  orderAttack(unitId, targetProv) {
    const u = this.units.find(u => u.id === unitId);
    if (!u || !this._isAdj(u.province, targetProv)) return false;
    if (this._sameFaction(u.owner, this.ctrl[targetProv])) return false;
    u.inCombat = true; u.combatTarget = targetProv;
    let c = this.combats.find(c => c.province === targetProv);
    if (!c) { c = { province: targetProv, attackers: [], defenders: [], hour: 0 }; this.combats.push(c); }
    if (!c.attackers.includes(unitId)) c.attackers.push(unitId);
    this.units.filter(u2 => u2.province === targetProv && !this._sameFaction(u2.owner, u.owner) && !u2.inCombat)
      .forEach(u2 => { u2.inCombat = true; u2.combatTarget = targetProv; if (!c.defenders.includes(u2.id)) c.defenders.push(u2.id); });
    return true;
  }

  step() {
    this.hour = (this.hour + 1) % 24;
    if (this.hour === 0) { this.day++; this.date = new Date(Date.UTC(1941, 5, 22 + this.day)); this._dailyTick(); }
    this._hourlyTick();
  }

  _hourlyTick() { this._resolveCombats(); this._resolveMovements(); this._updateOrg(); }
  _dailyTick()  { this._processProduction(); this._processResearch(); this._checkSurrender(); }

  _resolveCombats() {
    const dead = [];
    for (const c of this.combats) {
      const atks = c.attackers.map(id => this.units.find(u => u.id === id)).filter(Boolean);
      const defs = c.defenders.map(id => this.units.find(u => u.id === id)).filter(Boolean);
      if (!atks.length) { dead.push(c); continue; }
      if (!defs.length) {
        this._captureProv(c.province, atks[0].owner);
        atks.forEach(u => { u.inCombat = false; u.combatTarget = null; u.province = c.province; });
        dead.push(c); continue;
      }
      const t = TERRAIN[this.map.provinces[c.province]?.t || 'plains'] || TERRAIN.plains;
      const flankBonus = atks.length >= DEFINES.FLANKED_PROVINCES_COUNT ? 0.25 : 0;
      const roll = () => 0.8 + this.rand() * 0.4;
      const TICKS = 72;
      const aDmg = atks.reduce((s, u) => s + u.effectiveAttack(true, t.atkBonus + flankBonus), 0) / TICKS * roll();
      const dDmg = defs.reduce((s, u) => s + u.effectiveAttack(true, t.defBonus), 0) / TICKS * roll();
      defs.forEach((d, i) => {
        const sh = i === 0 ? DEFINES.DAMAGE_SPLIT_FIRST_TARGET : (1 - DEFINES.DAMAGE_SPLIT_FIRST_TARGET) / Math.max(defs.length - 1, 1);
        const armorM = atks[0] ? atks[0].penetrationDamage(atks[0].piercing, d.armor) : 1;
        d.hp = Math.max(0, d.hp - aDmg * sh * armorM * 0.01);
        d.org = Math.max(0, d.org - aDmg * sh * 0.015);
      });
      atks.forEach((a, i) => {
        const sh = i === 0 ? DEFINES.DAMAGE_SPLIT_FIRST_TARGET : (1 - DEFINES.DAMAGE_SPLIT_FIRST_TARGET) / Math.max(atks.length - 1, 1);
        a.hp = Math.max(0, a.hp - dDmg * sh * 0.01);
        a.org = Math.max(0, a.org - dDmg * sh * 0.015);
      });
      const defBroke = defs.every(u => u.org < u.maxOrg * 0.1);
      const atkBroke = atks.every(u => u.org < u.maxOrg * 0.1);
      if (defBroke) {
        this._retreatUnits(defs, c.province);
        this._captureProv(c.province, atks[0].owner);
        atks.forEach(u => { u.inCombat = false; u.combatTarget = null; u.province = c.province; });
        this.log.push({ day: this.day, type: 'combat_win', prov: c.province, winner: atks[0].owner });
        dead.push(c);
      } else if (atkBroke) {
        this._retreatUnits(atks, c.province);
        defs.forEach(u => { u.inCombat = false; u.combatTarget = null; });
        this.log.push({ day: this.day, type: 'combat_loss', prov: c.province, loser: atks[0].owner });
        dead.push(c);
      }
      this.units = this.units.filter(u => !u.isDead());
      c.attackers = c.attackers.filter(id => this.units.find(u => u.id === id));
      c.defenders = c.defenders.filter(id => this.units.find(u => u.id === id));
      c.hour++;
    }
    this.combats = this.combats.filter(c => !dead.includes(c));
  }

  _retreatUnits(units, fromProv) {
    units.forEach(u => {
      const adj = this.map.provinces[fromProv]?.a || [];
      const friendly = adj.find(a => this._sameFaction(u.owner, this.ctrl[a]));
      if (friendly !== undefined) u.province = friendly;
      u.org = u.maxOrg * 0.05; u.inCombat = false; u.combatTarget = null;
    });
  }

  _captureProv(provIdx, newOwner) {
    this.ctrl[provIdx] = newOwner;
    const state = this.states.find(s => s.provinces?.includes(provIdx));
    if (state) state.controller = newOwner;
    this.log.push({ day: this.day, type: 'capture', prov: provIdx, owner: newOwner });
  }

  _resolveMovements() {
    this.units.forEach(u => {
      if (u.target === null || u.inCombat) return;
      u.moveProgress += 1 / 24;
      if (u.moveProgress >= u.moveDays) {
        u.province = u.target; u.target = null; u.moveProgress = 0; u.moveDays = 0;
        const ctrl = this.ctrl[u.province];
        if (ctrl && !this._sameFaction(u.owner, ctrl)) this.orderAttack(u.id, u.province);
      }
    });
  }

  _updateOrg() {
    this.units.forEach(u => {
      if (u.inCombat) return;
      let rate = DEFINES.ORG_REGAIN_BASE;
      const ratio = u.org / u.maxOrg;
      if (ratio < DEFINES.FASTER_ORG_REGAIN_LEVEL) rate *= (1 + DEFINES.FASTER_ORG_REGAIN_MULT);
      else if (ratio > DEFINES.SLOWER_ORG_REGAIN_LEVEL) rate *= (1 + DEFINES.SLOWER_ORG_REGAIN_MULT);
      u.org = Math.min(u.maxOrg, u.org + rate);
    });
  }

  queueProduction(tag, tplKey) {
    const tpl = DIV_TEMPLATES[tplKey];
    if (!tpl) return false;
    this.productionQueues[tag] = this.productionQueues[tag] || [];
    this.productionQueues[tag].push({ templateKey: tplKey, daysLeft: tpl.days, total: tpl.days });
    return true;
  }

  _processProduction() {
    for (const [tag, q] of Object.entries(this.productionQueues)) {
      if (!q.length) continue;
      const c = this.countries[tag];
      if (!c) continue;
      const item = q[0];
      item.daysLeft -= (c.milFac * 0.5);
      if (item.daysLeft <= 0) {
        q.shift();
        const ownedStates = this.states.filter(s => s.owner === tag || s.controller === tag);
        if (ownedStates.length) {
          const st = ownedStates[Math.floor(this.rand() * ownedStates.length)];
          const prov = st.provinces?.[0] ?? 0;
          const nu = this._spawnUnit(item.templateKey, tag, prov);
          this.log.push({ day: this.day, type: 'unit_produced', tag, unit: nu.id, name: nu.name });
        }
      }
    }
  }

  startResearch(tag, techKey) {
    const c = this.countries[tag];
    if (!c || c.techs[techKey]) return false;
    const tech = TECH_TREE[techKey];
    if (!tech) return false;
    if (tech.prereqs.some(p => !c.techs[p])) return false;
    c.research = { tech: techKey, daysLeft: tech.cost, total: tech.cost };
    return true;
  }

  _processResearch() {
    for (const [tag, c] of Object.entries(this.countries)) {
      if (!c.research) continue;
      c.research.daysLeft--;
      if (c.research.daysLeft <= 0) {
        const key = c.research.tech;
        c.techs[key] = true;
        c.research = null;
        this._applyTech(tag, key);
        this.log.push({ day: this.day, type: 'tech_complete', tag, tech: key, name: TECH_TREE[key]?.name });
      }
    }
  }

  _applyTech(tag, key) {
    const b = TECH_TREE[key]?.bonus || {};
    this.units.filter(u => u.owner === tag).forEach(u => {
      if (b.softAtk)  u.softAttack  *= (1 + b.softAtk);
      if (b.defense)  u.defense     *= (1 + b.defense);
      if (b.hardAtk)  u.hardAttack  *= (1 + b.hardAtk);
      if (b.armor)    u.armor       += b.armor;
      if (b.piercing) u.piercing    += b.piercing;
      if (b.speed)    u.speed       += b.speed;
      if (b.breakthrough) u.breakthrough *= (1 + b.breakthrough);
    });
  }

  _checkSurrender() {
    for (const [tag, c] of Object.entries(this.countries)) {
      if (c.isDefeated) continue;
      const myVP = this.states.filter(s => s.controller === tag).reduce((s, st) => s + (st.vp || 0), 0);
      if (c.totalVP > 0 && myVP / c.totalVP < 0.2) {
        c.isDefeated = true;
        this.log.push({ day: this.day, type: 'surrender', tag, name: c.name });
      }
    }
  }

  _isAdj(a, b) { return (this.map.provinces[a]?.a || []).includes(b); }
  _sameFaction(a, b) {
    if (!a || !b || a === b) return a === b;
    if (a === 'NEU' || b === 'NEU') return false;
    const fa = COUNTRY_DEFS[a]?.faction, fb = COUNTRY_DEFS[b]?.faction;
    return fa && fb && fa === fb;
  }

  getState() {
    return {
      day: this.day, hour: this.hour, date: this.date.toISOString(),
      ctrl: this.ctrl, states: this.states,
      countries: this.countries,
      units: this.units.map(u => ({
        id: u.id, owner: u.owner, province: u.province,
        target: u.target, moveProgress: u.moveProgress, moveDays: u.moveDays,
        inCombat: u.inCombat, combatTarget: u.combatTarget,
        hp: u.hp, maxHp: u.maxHp, org: u.org, maxOrg: u.maxOrg,
        name: u.name, icon: u.icon, xp: u.xp, fightingStrength: u.fightingStrength(),
        templateKey: u.templateKey, armor: u.armor, piercing: u.piercing,
        softAttack: u.softAttack, hardAttack: u.hardAttack, defense: u.defense,
      })),
      combats: this.combats.map(c => ({ province: c.province, attackers: c.attackers, defenders: c.defenders, hour: c.hour })),
      productionQueues: this.productionQueues,
      log: this.log.slice(-30),
    };
  }
}

if (typeof module !== 'undefined') {
  module.exports = { Sim, Division, COUNTRY_DEFS, DIV_TEMPLATES, TECH_TREE, TERRAIN, DEFINES, makeRng };
} else {
  window.HOI4 = { Sim, Division, COUNTRY_DEFS, DIV_TEMPLATES, TECH_TREE, TERRAIN, DEFINES, makeRng };
}
