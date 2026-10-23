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
  const hooks = (window.__hooks = window.__hooks || {});
  let cityProvs = [];
  const ownerPaths = {};
  let hover = null, selected = null, focusOwner = null;
  let queued = false;
  let riverEdges = new Set();

  // ─── PALETA HOI4 ─── cores exatas estilo Hearts of Iron 4
  // Cores base: flat, dessaturadas, médio valor como no jogo
  const HOI4_COLORS = {
    GER: '#2e4a5c',  // Wehrmacht – teal escuro
    SOV: '#7a1818',  // URSS – carmesim escuro
    ROM: '#7a6040',  // Romênia – caqui/ocre
    FIN: '#4a6878',  // Finlândia – azul aço
    HUN: '#a05838',  // Hungria – salmão/cobre
    // países de fundo (BG)
    FRA: '#4a6ea0',  ITA: '#284838',  GBR: '#a04868',
    SWE: '#3a5068',  NOR: '#4a3838',  DNK: '#806050',
    NLD: '#505848',  BEL: '#585038',  CHE: '#782020',
    LIE: '#782020',  BGR: '#506030',  GRC: '#3888b0',
    SRB: '#3a5878',  SVN: '#3a5878',  BIH: '#3a5878',
    MNE: '#3a5878',  MKD: '#3a5878',  KOS: '#3a5878',
    TUR: '#7a9068',  ALB: '#783060',  HRV: '#5a7858',
    SVK: '#6a9060',  AUT: '#c8b890',  CZE: '#c0b088',
    POL: '#8a7060',  LTU: '#6a8050',  LVA: '#5a7048',
    EST: '#4a6040',  MDA: '#7a6050',  KAZ: '#9a8060',
    GEO: '#8a7060',  ARM: '#9a5840',  AZE: '#507860',
    IRN: '#9a8060',  IRQ: '#9a8060',  SYR: '#9a7850',
    ISR: '#9a9890',  LBN: '#8a7868',  JOR: '#9a8058',
  };

  // Obter a cor HOI4 de um dono/país (fallback para a cor do json)
  function hoi4Color(code, fallback) {
    return HOI4_COLORS[code] || fallback;
  }

  // ─── TEXTOS ───
  const PAIS = {
    Germany:'Alemanha', Austria:'Áustria', 'Czech Republic':'Tchéquia', Poland:'Polônia',
    Slovakia:'Eslováquia', Hungary:'Hungria', Romania:'Romênia', Finland:'Finlândia',
    Estonia:'Estônia', Lithuania:'Lituânia', Latvia:'Letônia', Belarus:'Bielorrússia',
    Ukraine:'Ucrânia', Russia:'Rússia', Moldova:'Moldávia', Serbia:'Sérvia',
    Sweden:'Suécia', Norway:'Noruega', Turkey:'Turquia', Italy:'Itália', Bulgaria:'Bulgária',
    Greece:'Grécia', Croatia:'Croácia', 'Bosnia and Herz.':'Bósnia e Herzegovina',
    Albania:'Albânia', Switzerland:'Suíça', Denmark:'Dinamarca', Netherlands:'Países Baixos',
    Belgium:'Bélgica', France:'França', Luxembourg:'Luxemburgo', Kazakhstan:'Cazaquistão',
    Georgia:'Geórgia', Armenia:'Armênia', Azerbaijan:'Azerbaijão', Iran:'Irã', Iraq:'Iraque',
    Uzbekistan:'Uzbequistão', Turkmenistan:'Turcomenistão', Slovenia:'Eslovênia',
    Montenegro:'Montenegro', 'North Macedonia':'Macedônia do Norte', Kosovo:'Kosovo',
    Syria:'Síria', Cyprus:'Chipre', Liechtenstein:'Liechtenstein',
    Mongolia:'Mongólia', Kyrgyzstan:'Quirguistão', Tajikistan:'Tadjiquistão', China:'China',
    Afghanistan:'Afeganistão', Israel:'Israel', Lebanon:'Líbano', Jordan:'Jordânia',
  };
  const pais = (n) => PAIS[n] || n;

  const NOTAS_NOME = {
    Transcarpathia:'Rutênia Subcarpática, anexada pela Hungria em março de 1939.',
    Klaipedos:'Região de Memel, anexada pela Alemanha em março de 1939.',
    Kaliningrad:'Prússia Oriental (Königsberg), território alemão.',
    Podlachian:'Região de Białystok, ocupada pela URSS em setembro de 1939.',
    'Košický':'Sul da Eslováquia, cedido à Hungria (1938).', Nitriansky:'Sul da Eslováquia, cedido à Hungria (1938).',
    "L'viv":'Antiga Polônia oriental, ocupada pela URSS em 1939.', "Ternopil'":'Antiga Polônia oriental, URSS 1939.',
    "Ivano-Frankivs'k":'Antiga Polônia oriental, URSS 1939.', Rivne:'Antiga Polônia oriental, URSS 1939.',
    Volyn:'Antiga Polônia oriental, URSS 1939.', Brest:'Antiga Polônia oriental, URSS 1939.',
    Grodno:'Antiga Polônia oriental, URSS 1939.', Chernivtsi:'Bucovina do Norte, tomada da Romênia pela URSS em 1940.',
    Karelia:'Inclui territórios tomados da Finlândia em 1940.', Leningrad:'Inclui Vyborg e o istmo da Carélia.',
    Murmansk:'Petsamo era finlandesa em 1941.', Crimea:'República Autônoma da Crimeia.',
  };
  const NOTAS_PAIS = {
    Poland:'Território polonês ocupado pela Alemanha em 1939.',
    'Czech Republic':'Protetorado da Boêmia e Morávia, controle alemão.',
    Austria:'Anexada à Alemanha em 1938 (Anschluss).',
    Estonia:'Anexada pela URSS em 1940.', Latvia:'Anexada pela URSS em 1940.',
    Lithuania:'Anexada pela URSS em 1940.', Moldova:'Bessarábia, tomada da Romênia em 1940.',
    Serbia:'Bačka, ocupada pela Hungria em abril de 1941.',
  };
  function nota(s) {
    if (NOTAS_NOME[s.name]) return NOTAS_NOME[s.name];
    if (s.country === 'Romania' && s.owner === 'HUN') return 'Norte da Transilvânia, cedido à Hungria (1940).';
    return NOTAS_PAIS[s.country] || '';
  }

  // ─── GEOMETRIA ───
  const projY = (lat) => (projection === 'mercator'
    ? (180/Math.PI)*Math.log(Math.tan(Math.PI/4+(lat*Math.PI)/360))
    : lat);

  function decode(flat) {
    const pts = new Float64Array(flat.length);
    let x=0, y=0;
    for (let i=0; i<flat.length; i+=2) {
      if (i===0) { x=flat[0]; y=flat[1]; } else { x+=flat[i]; y+=flat[i+1]; }
      pts[i]=x/SC; pts[i+1]=y/SC;
    }
    return pts;
  }

  function build(rings) {
    const path=new Path2D(), list=[];
    let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
    for (const flat of rings) {
      const pts=decode(flat);
      for (let i=0; i<pts.length; i+=2) {
        const x=pts[i],y=pts[i+1];
        if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y;
        if(i===0)path.moveTo(x,y); else path.lineTo(x,y);
      }
      path.closePath(); list.push(pts);
    }
    return {path,rings:list,bbox:[x0,y0,x1,y1],barea:(x1-x0)*(y1-y0)};
  }

  function inside(rings,x,y) {
    let c=false;
    for (const r of rings) {
      const n=r.length; let jx=r[n-2],jy=r[n-1];
      for (let i=0; i<n; i+=2) {
        const ix=r[i],iy=r[i+1];
        if((iy>y)!==(jy>y)&&x<((jx-ix)*(y-iy))/(jy-iy)+ix) c=!c;
        jx=ix; jy=iy;
      }
    }
    return c;
  }

  function hit(sx,sy) {
    const x=(sx-view.tx)/view.k, y=(view.ty-sy)/view.k;
    for (const p of provinces) {
      const b=p.g.bbox;
      if(x<b[0]||x>b[2]||y<b[1]||y>b[3]) continue;
      if(inside(p.g.rings,x,y)) return {kind:'prov',ref:p};
    }
    for (const b of bgs) {
      const bb=b.g.bbox;
      if(x<bb[0]||x>bb[2]||y<bb[1]||y>bb[3]) continue;
      if(inside(b.g.rings,x,y)) return {kind:'bg',ref:b};
    }
    return null;
  }

  // ─── VISTA ───
  function resize() {
    dpr=Math.min(window.devicePixelRatio||1,2);
    W=window.innerWidth; H=window.innerHeight;
    canvas.width=Math.round(W*dpr); canvas.height=Math.round(H*dpr);
    const fk=Math.min(W/(bounds[2]-bounds[0]),H/(bounds[3]-bounds[1]))*0.96;
    const ratio=view.kfit?view.k/view.kfit:1;
    view.kfit=fk; view.kmin=fk*0.7; view.kmax=fk*14;
    if(!resize.done) fitAll(); else view.k=clampK(fk*ratio);
    resize.done=true; schedule();
  }
  const clampK=(k)=>Math.max(view.kmin,Math.min(view.kmax,k));
  function fitAll() {
    view.k=view.kfit;
    view.tx=W/2-((bounds[0]+bounds[2])/2)*view.k;
    view.ty=H/2+((bounds[1]+bounds[3])/2)*view.k;
    schedule();
  }
  function zoomAt(sx,sy,factor) {
    const nk=clampK(view.k*factor);
    const wx=(sx-view.tx)/view.k,wy=(view.ty-sy)/view.k;
    view.k=nk; view.tx=sx-wx*nk; view.ty=sy+wy*nk; schedule();
  }

  // ═══════════════════════════════ SISTEMA DE TERRENO ═══════════════════
  const TERRAIN_INFO = {
    plains:    {label:'Planície',   moveCost:1, defBonus:0,    atkBonus:0    },
    forest:    {label:'Floresta',   moveCost:2, defBonus:0.15, atkBonus:-0.1 },
    marsh:     {label:'Pântano',    moveCost:3, defBonus:0.20, atkBonus:-0.2 },
    hills:     {label:'Colinas',    moveCost:2, defBonus:0.10, atkBonus:-0.05},
    mountains: {label:'Montanhas',  moveCost:4, defBonus:0.35, atkBonus:-0.3 },
    urban:     {label:'Urbano',     moveCost:2, defBonus:0.25, atkBonus:-0.15},
    desert:    {label:'Estepe',     moveCost:2, defBonus:0,    atkBonus:0    },
  };

  function hashFloat(id,salt) {
    let n=Math.imul(id+salt*2654435761,2246822519);
    n=Math.imul(n^(n>>>13),3266489917); n^=n>>>16;
    return (n>>>0)/4294967295;
  }

  function assignTerrain(p) {
    if (p.c) return 'urban';
    const [lonRaw,lat]=p.l;
    const lon=lonRaw/(xscale||1);
    const id=p.id;
    const n1=hashFloat(id,1), n2=hashFloat(id,2);
    // Montanhas
    if(lat>=44&&lat<=50&&lon>=17&&lon<=28&&n1<0.65) return 'mountains'; // Cárpatos
    if(lat>=45&&lat<=48&&lon>=8&&lon<=14&&n1<0.7) return 'mountains';   // Alpes
    if(lat>=40&&lat<=44&&lon>=38&&lon<=52&&n1<0.6) return 'mountains';  // Cáucaso
    if(lon>=57&&lat>=50&&lat<=68&&n1<0.45) return 'mountains';          // Urais
    // Colinas
    if(lat>=44&&lat<=51&&lon>=15&&lon<=30&&n1<0.4) return 'hills';
    if(lat>=49&&lat<=54&&lon>=10&&lon<=18&&n1<0.35) return 'hills';
    if(lat>=40&&lat<=45&&lon>=20&&lon<=30&&n1<0.5) return 'hills';
    // Pântano
    if(lat>=51&&lat<=53&&lon>=23&&lon<=32&&n1<0.6) return 'marsh'; // Pripyat
    if(lat>=55&&lat<=60&&lon>=20&&lon<=30&&n1<0.35) return 'marsh';
    // Floresta
    if(lat>60&&n1<0.8) return 'forest';
    if(lat>=57&&lat<=65&&lon>=28&&lon<=60&&n1<0.7) return 'forest';
    if(lat>=51&&lat<=57&&lon>=23&&lon<=40&&n1<0.5) return 'forest';
    if(lat>=53&&lat<=58&&lon>=16&&lon<=28&&n1<0.45) return 'forest';
    // Estepe
    if(lat>=44&&lat<=50&&lon>=30&&lon<=60&&n1<0.6) return 'desert';
    if(lat<47&&lon>=30&&lon<=40&&n2<0.5) return 'desert';
    return 'plains';
  }

  // ═══════ COR DE TERRENO – estilo HOI4 ═══════
  // HOI4: montanhas=muito mais claras (neve/altitude), floresta=escuras,
  // pântano=azul-esverdeado, colinas=levemente escuras, estepe=quente
  function terrainFill(hexColor, terrain) {
    const v=parseInt(hexColor.slice(1),16);
    let r=(v>>16)&255, g=(v>>8)&255, b=v&255;
    switch(terrain) {
      // HOI4: montanhas são dramaticamente mais claras – branco acinzentado
      case 'mountains':
        r=Math.round(r*0.35+215*0.65);
        g=Math.round(g*0.35+210*0.65);
        b=Math.round(b*0.35+205*0.65);
        break;
      // colinas: levemente mais claras com tom quente
      case 'hills':
        r=Math.round(r*0.78+130*0.22);
        g=Math.round(g*0.82+115*0.18);
        b=Math.round(b*0.88+80*0.12);
        break;
      // floresta: mais escura com verde
      case 'forest':
        r=Math.round(r*0.60+10*0.40);
        g=Math.round(g*0.65+30*0.35);
        b=Math.round(b*0.55+12*0.45);
        break;
      // pântano: mais escuro, tint azul-esverdeado
      case 'marsh':
        r=Math.round(r*0.58+20*0.42);
        g=Math.round(g*0.65+55*0.35);
        b=Math.round(b*0.62+65*0.38);
        break;
      // urbano: mais escuro, cinzento
      case 'urban':
        r=Math.round(r*0.62+42*0.38);
        g=Math.round(g*0.60+38*0.40);
        b=Math.round(b*0.58+35*0.42);
        break;
      // estepe/desert: tint quente arenoso
      case 'desert':
        r=Math.round(r*0.72+110*0.28);
        g=Math.round(g*0.75+95*0.25);
        b=Math.round(b*0.80+45*0.20);
        break;
      // planícies: cor base, levemente mais clara (como HOI4)
      default:
        r=Math.round(r*0.92+20*0.08);
        g=Math.round(g*0.92+18*0.08);
        b=Math.round(b*0.92+15*0.08);
    }
    return `rgb(${Math.min(255,r)},${Math.min(255,g)},${Math.min(255,b)})`;
  }

  // paths por terrain por dono
  const terrainPaths = {};

  // ─── RIO-BARREIRA ───
  function segToPointDist2(ax,ay,bx,by,px,py) {
    const dx=bx-ax,dy=by-ay,len2=dx*dx+dy*dy;
    if(len2===0){const ex=px-ax,ey=py-ay;return ex*ex+ey*ey;}
    let t=((px-ax)*dx+(py-ay)*dy)/len2;
    t=Math.max(0,Math.min(1,t));
    const cx=ax+t*dx,cy=ay+t*dy,fx=px-cx,fy=py-cy;
    return fx*fx+fy*fy;
  }

  function buildRiverEdges(wt,provList) {
    const edges=new Set();
    const segs=[];
    for (const w of Object.keys(wt.rivers||{})) {
      for (const flat of wt.rivers[w]) {
        const pts=[]; let x=0,y=0;
        for(let i=0;i<flat.length;i+=2){
          if(i===0){x=flat[0];y=flat[1];}else{x+=flat[i];y+=flat[i+1];}
          pts.push(x/SC,y/SC);
        }
        for(let i=0;i<pts.length-2;i+=2) segs.push(pts[i],pts[i+1],pts[i+2],pts[i+3]);
      }
    }
    if(!segs.length) return edges;
    const THRESH2=0.06*0.06;
    for (const p of provList) {
      const [px,py]=p.l;
      for (const jIdx of p.a) {
        if(jIdx<=p.id-1) continue;
        const q=provList[jIdx];
        const [qx,qy]=q.l;
        const mx=(px+qx)/2,my=(py+qy)/2;
        for(let s=0;s<segs.length;s+=4){
          if(segToPointDist2(segs[s],segs[s+1],segs[s+2],segs[s+3],mx,my)<THRESH2){
            edges.add(`${Math.min(p.id-1,jIdx)}-${Math.max(p.id-1,jIdx)}`);
            break;
          }
        }
      }
    }
    return edges;
  }

  // ═══════════════════ TEXTURAS + ÍCONES QUASI-3D HOI4-STYLE ═══════════════════

  // Textura base: papel antigo granulado (HOI4-style)
  function makeMapTex(w,h) {
    const c=document.createElement('canvas'); c.width=w; c.height=h;
    const g=c.getContext('2d'), im=g.createImageData(w,h), d=im.data;
    const hash=(ix,iy,s)=>{
      let n=Math.imul(ix,374761393)+Math.imul(iy,668265263)+Math.imul(s,1274126177);
      n=Math.imul(n^(n>>>13),1274126177); n^=n>>>16; return (n>>>0)/4294967295;
    };
    const vn=(px,py,s)=>{
      const ix=Math.floor(px),iy=Math.floor(py),fx=px-ix,fy=py-iy;
      const u=fx*fx*(3-2*fx),v=fy*fy*(3-2*fy);
      const a=hash(ix,iy,s),b=hash(ix+1,iy,s),c0=hash(ix,iy+1,s),e=hash(ix+1,iy+1,s);
      return a+(b-a)*u+(c0-a)*v+(a-b-c0+e)*u*v;
    };
    const fbm=(px,py,oct,s)=>{let t=0,amp=0.5,f=1,n=0;for(let o=0;o<oct;o++){t+=amp*vn(px*f,py*f,s+o);n+=amp;amp*=0.5;f*=2;}return t/n;};
    for(let j=0;j<h;j++) for(let i=0;i<w;i++) {
      const u=i/w*8,v=j/h*8*(h/w);
      const n=fbm(u,v,4,17);
      const lum=0.88+n*0.24;
      const k=j*w+i;
      d[k*4]=Math.min(255,200*lum)|0;
      d[k*4+1]=Math.min(255,195*lum)|0;
      d[k*4+2]=Math.min(255,185*lum)|0;
      d[k*4+3]=255;
    }
    g.putImageData(im,0,0); return c;
  }

  // ──────────────────────────────────────────────────────────────
  // ÍCONES QUASI-3D — desenhados individualmente em canvas offline
  // e depois estampados no mapa em torno do centróide de cada
  // província (igual ao HOI4 original).
  // ──────────────────────────────────────────────────────────────

  // Ícone de MONTANHA quasi-3D (perspectiva isométrica leve)
  function makeMountainIcon(sz) {
    const c=document.createElement('canvas'); c.width=sz; c.height=sz;
    const g=c.getContext('2d');
    const R=()=>Math.random();
    // Múltiplos picos escalonados
    const peaks=[
      {x:sz*0.50,y:sz*0.72,h:sz*0.62,w:sz*0.44},
      {x:sz*0.25,y:sz*0.78,h:sz*0.42,w:sz*0.30},
      {x:sz*0.75,y:sz*0.80,h:sz*0.36,w:sz*0.26},
    ];
    for(const pk of peaks){
      const {x,y,h,w}=pk;
      // Sombra projetada (lado direito)
      const shadow=g.createLinearGradient(x,y-h,x+w*0.7,y);
      shadow.addColorStop(0,'rgba(60,50,40,0)');
      shadow.addColorStop(1,'rgba(45,38,28,0.82)');
      g.beginPath();
      g.moveTo(x,y-h);
      g.lineTo(x+w*0.15,y);
      g.lineTo(x+w*0.78,y);
      g.closePath();
      g.fillStyle=shadow; g.fill();
      // Face escura (direita)
      const darkFace=g.createLinearGradient(x,y-h,x+w*0.5,y);
      darkFace.addColorStop(0,'rgba(105,90,68,0.90)');
      darkFace.addColorStop(1,'rgba(78,65,48,0.95)');
      g.beginPath();
      g.moveTo(x,y-h);
      g.lineTo(x+w*0.15,y);
      g.lineTo(x+w*0.78,y);
      g.closePath();
      g.fillStyle=darkFace; g.fill();
      // Face iluminada (esquerda)
      const litFace=g.createLinearGradient(x-w*0.5,y,x,y-h);
      litFace.addColorStop(0,'rgba(195,188,175,0.92)');
      litFace.addColorStop(0.55,'rgba(228,222,210,0.96)');
      litFace.addColorStop(1,'rgba(255,252,248,1.0)');
      g.beginPath();
      g.moveTo(x,y-h);
      g.lineTo(x-w*0.62,y);
      g.lineTo(x+w*0.15,y);
      g.closePath();
      g.fillStyle=litFace; g.fill();
      // Calota de neve no topo
      const snowH=h*0.28;
      const snow=g.createLinearGradient(x-w*0.18,y-h+snowH,x+w*0.1,y-h);
      snow.addColorStop(0,'rgba(240,240,245,0.85)');
      snow.addColorStop(1,'rgba(255,255,255,1.0)');
      g.beginPath();
      g.moveTo(x,y-h);
      g.lineTo(x-w*0.18,y-h+snowH);
      g.lineTo(x+w*0.10,y-h+snowH*0.7);
      g.closePath();
      g.fillStyle=snow; g.fill();
      // Linha de cume
      g.strokeStyle='rgba(255,255,255,0.45)';
      g.lineWidth=0.8;
      g.beginPath(); g.moveTo(x,y-h); g.lineTo(x-w*0.18,y-h+snowH); g.stroke();
    }
    return c;
  }

  // Ícone de FLORESTA quasi-3D (árvores coníferas em perspectiva)
  function makeForestIcon(sz) {
    const c=document.createElement('canvas'); c.width=sz; c.height=sz;
    const g=c.getContext('2d');
    // Sombra do terreno
    g.fillStyle='rgba(15,28,15,0.15)';
    g.fillRect(0,0,sz,sz);
    // Posições das árvores (grade levemente irregular)
    const trees=[];
    const cols=4,rows=4;
    for(let ry=0;ry<rows;ry++) for(let cx=0;cx<cols;cx++){
      const jx=(Math.random()-0.5)*sz*0.12;
      const jy=(Math.random()-0.5)*sz*0.10;
      trees.push({
        x:sz*(0.14+cx*0.24)+jx,
        y:sz*(0.22+ry*0.22)+jy,
        h:sz*(0.18+Math.random()*0.12),
        big:Math.random()<0.45,
      });
    }
    // Ordenar por Y para perspectiva
    trees.sort((a,b)=>a.y-b.y);
    for(const {x,y,h,big} of trees){
      const w=h*0.72;
      // Tronco
      g.fillStyle='#3d2810';
      g.fillRect(x-w*0.06,y,w*0.12,h*0.28);
      // Camadas da árvore (HOI4: 3 triângulos sobrepostos)
      const layers=big?3:2;
      for(let l=0;l<layers;l++){
        const ly=y-h*0.08-l*h*0.30;
        const lw=w*(1.05-l*0.22);
        const lh=h*(0.42+l*0.08);
        // Sombra direita
        g.beginPath();
        g.moveTo(x,ly-lh);
        g.lineTo(x+lw*0.55,ly);
        g.lineTo(x+lw*0.08,ly);
        g.closePath();
        g.fillStyle=l===0?'rgba(18,38,16,0.92)':'rgba(22,45,19,0.90)';
        g.fill();
        // Face iluminada esquerda
        g.beginPath();
        g.moveTo(x,ly-lh);
        g.lineTo(x-lw*0.55,ly);
        g.lineTo(x+lw*0.08,ly);
        g.closePath();
        const litTree=g.createLinearGradient(x-lw*0.3,ly,x,ly-lh);
        litTree.addColorStop(0,l===0?'rgba(38,72,32,0.95)':'rgba(44,82,36,0.92)');
        litTree.addColorStop(1,l===0?'rgba(52,96,42,0.90)':'rgba(60,110,48,0.88)');
        g.fillStyle=litTree;
        g.fill();
        // Brilho no topo
        if(l===layers-1){
          g.strokeStyle='rgba(80,145,62,0.40)';
          g.lineWidth=0.7;
          g.beginPath(); g.moveTo(x,ly-lh); g.lineTo(x-lw*0.2,ly-lh*0.5); g.stroke();
        }
      }
    }
    return c;
  }

  // Ícone de COLINAS quasi-3D
  function makeHillsIcon(sz) {
    const c=document.createElement('canvas'); c.width=sz; c.height=sz;
    const g=c.getContext('2d');
    const hills=[
      {x:sz*0.50,y:sz*0.72,rx:sz*0.46,ry:sz*0.30},
      {x:sz*0.22,y:sz*0.80,rx:sz*0.32,ry:sz*0.21},
      {x:sz*0.78,y:sz*0.82,rx:sz*0.28,ry:sz*0.18},
    ];
    for(const {x,y,rx,ry} of hills){
      // Sombra
      const sh=g.createLinearGradient(x,y-ry,x+rx*0.6,y);
      sh.addColorStop(0,'rgba(60,52,30,0)');
      sh.addColorStop(1,'rgba(48,40,20,0.65)');
      g.beginPath(); g.ellipse(x,y,rx,ry,0,Math.PI,0); g.closePath();
      g.fillStyle=sh; g.fill();
      // Face iluminada
      const lit=g.createLinearGradient(x-rx*0.4,y,x,y-ry);
      lit.addColorStop(0,'rgba(112,100,62,0.90)');
      lit.addColorStop(0.6,'rgba(138,125,78,0.88)');
      lit.addColorStop(1,'rgba(165,150,95,0.82)');
      g.beginPath(); g.ellipse(x,y,rx,ry,0,Math.PI,0); g.closePath();
      g.fillStyle=lit; g.fill();
      // Linha de crista
      g.strokeStyle='rgba(200,185,130,0.40)';
      g.lineWidth=0.9;
      g.beginPath(); g.ellipse(x,y,rx*0.55,ry*0.55,0,Math.PI,Math.PI*0.15); g.stroke();
    }
    return c;
  }

  // Ícone de PÂNTANO quasi-3D (juncos + espelho d'água)
  function makeMarshIcon(sz) {
    const c=document.createElement('canvas'); c.width=sz; c.height=sz;
    const g=c.getContext('2d');
    // Espelho d'água (fundo)
    const waterGrad=g.createLinearGradient(0,sz*0.55,0,sz);
    waterGrad.addColorStop(0,'rgba(52,98,110,0.75)');
    waterGrad.addColorStop(1,'rgba(28,58,70,0.90)');
    g.fillStyle=waterGrad;
    g.beginPath();
    g.ellipse(sz*0.50,sz*0.80,sz*0.38,sz*0.13,0,0,Math.PI*2);
    g.fill();
    g.ellipse(sz*0.28,sz*0.88,sz*0.20,sz*0.08,0,0,Math.PI*2);
    g.fill();
    // Reflexo na água
    g.strokeStyle='rgba(120,188,210,0.28)';
    g.lineWidth=0.9;
    for(let i=0;i<3;i++){
      g.beginPath(); g.moveTo(sz*(0.30+i*0.12),sz*0.80); g.lineTo(sz*(0.38+i*0.10),sz*0.80); g.stroke();
    }
    // Juncos
    const reeds=[
      {x:sz*0.20,y:sz*0.85},{x:sz*0.32,y:sz*0.80},{x:sz*0.48,y:sz*0.82},
      {x:sz*0.62,y:sz*0.78},{x:sz*0.75,y:sz*0.84},{x:sz*0.55,y:sz*0.88},
    ];
    for(const {x,y} of reeds){
      const h=sz*(0.22+Math.random()*0.18);
      // Caule
      g.strokeStyle='rgba(75,110,55,0.95)';
      g.lineWidth=1.2;
      g.beginPath(); g.moveTo(x,y); g.lineTo(x+(Math.random()-0.5)*sz*0.04,y-h*0.85); g.stroke();
      // Espiga marrom no topo
      g.fillStyle='rgba(105,65,22,0.92)';
      g.beginPath(); g.ellipse(x,y-h,sz*0.025,sz*0.068,0.15,0,Math.PI*2); g.fill();
      // Brilho
      g.strokeStyle='rgba(140,175,85,0.35)';
      g.lineWidth=0.6;
      g.beginPath(); g.moveTo(x-1,y-h*0.1); g.lineTo(x-1,y-h*0.5); g.stroke();
    }
    return c;
  }

  // Ícone de CIDADE quasi-3D (prédios em perspectiva isométrica)
  function makeUrbanIcon(sz) {
    const c=document.createElement('canvas'); c.width=sz; c.height=sz;
    const g=c.getContext('2d');
    // Sombra no chão
    g.fillStyle='rgba(20,16,12,0.25)';
    g.beginPath(); g.ellipse(sz*0.50,sz*0.88,sz*0.44,sz*0.08,0,0,Math.PI*2); g.fill();
    // Prédios de fundo
    const buildings=[
      {x:sz*0.10,y:sz*0.60,w:sz*0.14,h:sz*0.35,d:sz*0.07},
      {x:sz*0.26,y:sz*0.48,w:sz*0.16,h:sz*0.47,d:sz*0.07},
      {x:sz*0.56,y:sz*0.44,w:sz*0.18,h:sz*0.51,d:sz*0.08},
      {x:sz*0.74,y:sz*0.55,w:sz*0.14,h:sz*0.38,d:sz*0.06},
      {x:sz*0.42,y:sz*0.55,w:sz*0.12,h:sz*0.38,d:sz*0.05},
    ];
    buildings.sort((a,b)=>a.y-b.y);
    for(const {x,y,w,h,d} of buildings){
      // Topo (face frontal)
      const front=g.createLinearGradient(x,y,x,y+h);
      front.addColorStop(0,'rgba(148,132,108,0.98)');
      front.addColorStop(0.4,'rgba(118,105,86,0.98)');
      front.addColorStop(1,'rgba(92,82,65,0.98)');
      g.fillStyle=front;
      g.fillRect(x,y,w,h);
      // Face lateral (direita – mais escura)
      const side=g.createLinearGradient(x+w,y,x+w+d,y+d);
      side.addColorStop(0,'rgba(72,62,46,0.98)');
      side.addColorStop(1,'rgba(55,48,36,0.98)');
      g.fillStyle=side;
      g.beginPath();
      g.moveTo(x+w,y);
      g.lineTo(x+w+d,y-d);
      g.lineTo(x+w+d,y+h-d);
      g.lineTo(x+w,y+h);
      g.closePath();
      g.fill();
      // Face do topo
      const top=g.createLinearGradient(x,y,x+d,y-d);
      top.addColorStop(0,'rgba(195,178,148,0.98)');
      top.addColorStop(1,'rgba(220,205,175,0.98)');
      g.fillStyle=top;
      g.beginPath();
      g.moveTo(x,y);
      g.lineTo(x+w,y);
      g.lineTo(x+w+d,y-d);
      g.lineTo(x+d,y-d);
      g.closePath();
      g.fill();
      // Janelas
      g.fillStyle='rgba(180,210,240,0.55)';
      const wrows=Math.floor(h/sz*6),wcols=Math.floor(w/sz*5);
      const wx=w/(wcols+1),wy=h/(wrows+1);
      for(let wr=1;wr<=wrows;wr++) for(let wc=1;wc<=wcols;wc++){
        g.fillRect(x+wc*wx-wx*0.25,y+wr*wy-wy*0.35,wx*0.5,wy*0.6);
      }
      // Borda do prédio
      g.strokeStyle='rgba(40,32,22,0.60)';
      g.lineWidth=0.6;
      g.strokeRect(x,y,w,h);
    }
    return c;
  }

  // Ícone de ESTEPE/DESERTO quasi-3D (dunas)
  function makeDesertIcon(sz) {
    const c=document.createElement('canvas'); c.width=sz; c.height=sz;
    const g=c.getContext('2d');
    const dunes=[
      {x:sz*0.50,y:sz*0.75,rx:sz*0.48,ry:sz*0.25},
      {x:sz*0.20,y:sz*0.85,rx:sz*0.28,ry:sz*0.15},
      {x:sz*0.80,y:sz*0.83,rx:sz*0.24,ry:sz*0.14},
    ];
    for(const {x,y,rx,ry} of dunes){
      // Sombra
      const sh=g.createLinearGradient(x,y-ry,x+rx,y);
      sh.addColorStop(0,'rgba(100,75,20,0)');
      sh.addColorStop(1,'rgba(80,58,12,0.70)');
      g.beginPath(); g.ellipse(x,y,rx,ry,0,Math.PI,0); g.closePath();
      g.fillStyle=sh; g.fill();
      // Lit face
      const lit=g.createLinearGradient(x-rx,y,x,y-ry);
      lit.addColorStop(0,'rgba(158,130,58,0.90)');
      lit.addColorStop(0.7,'rgba(188,158,72,0.88)');
      lit.addColorStop(1,'rgba(215,185,92,0.82)');
      g.beginPath(); g.ellipse(x,y,rx,ry,0,Math.PI,0); g.closePath();
      g.fillStyle=lit; g.fill();
      // Crista
      g.strokeStyle='rgba(235,210,130,0.50)';
      g.lineWidth=0.8;
      g.beginPath(); g.ellipse(x-rx*0.05,y-ry*0.05,rx*0.75,ry*0.25,0,Math.PI*1.1,Math.PI*1.9); g.stroke();
    }
    return c;
  }

  // Ícone de PLANÍCIE (ondulações suaves de grama)
  function makePlainsIcon(sz) {
    const c=document.createElement('canvas'); c.width=sz; c.height=sz;
    const g=c.getContext('2d');
    // Linhas de campo suaves
    g.strokeStyle='rgba(75,92,42,0.40)';
    g.lineWidth=1.0;
    for(let i=0;i<5;i++){
      const y=sz*(0.40+i*0.12);
      g.beginPath(); g.moveTo(0,y);
      for(let xi=0;xi<sz;xi+=sz*0.2){
        g.quadraticCurveTo(xi+sz*0.05,y+(Math.random()-0.5)*sz*0.05,xi+sz*0.1,y);
        g.quadraticCurveTo(xi+sz*0.15,y+(Math.random()-0.5)*sz*0.05,xi+sz*0.2,y);
      }
      g.stroke();
    }
    return c;
  }

  // Sprites de terreno pré-renderizados (ícones individuais para estampar)
  const terrainSprites = {};
  // Sprites maiores para estampagem
  function initTerrainTextures() {
    terrainSprites.mountains = makeMountainIcon(80);
    terrainSprites.forest    = makeForestIcon(64);
    terrainSprites.hills     = makeHillsIcon(72);
    terrainSprites.marsh     = makeMarshIcon(68);
    terrainSprites.urban     = makeUrbanIcon(72);
    terrainSprites.desert    = makeDesertIcon(72);
    terrainSprites.plains    = makePlainsIcon(64);
  }

  // ─── RIOS NAS BORDAS DAS PROVÍNCIAS ───
  // Mapa de arestas compartilhadas que têm rio, para desenhar como bordas coloridas
  let riverBorderEdges = []; // Array de {ax,ay,bx,by} no espaço de mapa

  function buildRiverBorderPaths(wt, provList) {
    // Já temos riverEdges (Set de strings "i-j") — agora precisamos
    // encontrar os segmentos geométricos compartilhados entre as duas províncias.
    riverBorderEdges = [];
    if (!riverEdges.size) return;
    // Para cada par com river edge, encontrar a aresta geométrica compartilhada
    for (const key of riverEdges) {
      const [ai,bi] = key.split('-').map(Number);
      const pa = provList[ai], pb = provList[bi];
      if (!pa || !pb) continue;
      // Encontrar segmentos compartilhados nas geometrias
      const sharedSegs = findSharedEdge(pa.g.rings, pb.g.rings);
      for (const seg of sharedSegs) riverBorderEdges.push(seg);
    }
  }

  // Encontra segmentos de reta compartilhados entre dois polígonos
  function findSharedEdge(ringsA, ringsB) {
    const SNAP = 0.003; // tolerância geométrica
    const segs = [];
    // Coleta todos os segmentos de B num Set para lookup rápido
    const bSegs = new Map();
    for (const r of ringsB) {
      const n = r.length;
      for (let i = 0; i < n; i += 2) {
        const x1=r[i],y1=r[i+1],x2=r[(i+2)%n],y2=r[(i+3)%n];
        const k = segKey(x1,y1,x2,y2);
        bSegs.set(k, {x1,y1,x2,y2});
      }
    }
    for (const r of ringsA) {
      const n = r.length;
      for (let i = 0; i < n; i += 2) {
        const x1=r[i],y1=r[i+1],x2=r[(i+2)%n],y2=r[(i+3)%n];
        const k = segKey(x2,y2,x1,y1); // inverso (polígonos compartilham opostos)
        if (bSegs.has(k)) {
          segs.push({x1,y1,x2,y2});
          break; // um segmento por anel é suficiente para aprox.
        }
      }
    }
    // fallback: se não achou geometria exata, usa linha entre centróides
    return segs;
  }

  function segKey(x1,y1,x2,y2) {
    // round para 3 casas decimais para tolerância de snap
    const r=(v)=>Math.round(v*500)/500;
    return `${r(x1)},${r(y1)}|${r(x2)},${r(y2)}`;
  }

  // ─── UTILIDADES DE COR ───
  const shadeCache=new Map();
  function shade(hex,f) {
    const key=hex+f; let r=shadeCache.get(key);
    if(!r){
      const v=parseInt(hex.slice(1),16);
      r=`rgb(${Math.min(255,((v>>16)&255)*f)|0},${Math.min(255,((v>>8)&255)*f)|0},${Math.min(255,(v&255)*f)|0})`;
      shadeCache.set(key,r);
    }
    return r;
  }

  // cor do background (países vizinhos não jogáveis)
  const BG_HOI4 = {
    ITA:'#284838', BGR:'#506030', SVK:'#6a9060', HRV:'#5a7858', ALB:'#783060',
    SWE:'#3a5068', NOR:'#4a3838', DNK:'#806050', FRA:'#4a6ea0', NLD:'#505848',
    BEL:'#585038', GRC:'#3888b0', SRB:'#3a5878', SVN:'#3a5878', BIH:'#3a5878',
    MNE:'#3a5878', MKD:'#3a5878', KOS:'#3a5878', CHE:'#782020', LIE:'#782020',
    TUR:'#7a9068', GBR:'#a04868', POL:'#8a7060', AUT:'#c8b890', CZE:'#c0b088',
  };
  const bgColor=(b)=>BG_HOI4[b.code]||HOI4_COLORS[b.owner]||owners[b.owner].color;
  const dim=(code)=>(focusOwner&&code!==focusOwner?0.22:1);

  // ─── GLOW de borda de países (HOI4 usa linha branca sutil) ───
  let mapTex=null;
  let layerL=null,layerM=null,lctx=null,mctx=null;

  function ensureLayers() {
    const w=canvas.width,h=canvas.height;
    if(layerL&&layerL.width===w&&layerL.height===h) return;
    layerL=document.createElement('canvas'); layerM=document.createElement('canvas');
    layerL.width=layerM.width=w; layerL.height=layerM.height=h;
    lctx=layerL.getContext('2d'); mctx=layerM.getContext('2d');
  }

  // ─── LABELS ───
  const labelWidth=new Map();
  function textWidth(t) {
    const key=ctx.font+'|'+t; let w=labelWidth.get(key);
    if(w===undefined){w=ctx.measureText(t).width;labelWidth.set(key,w);}
    return w;
  }

  // ═══════════════════════════ DRAW HOI4 ═══════════════════════════
  function draw() {
    queued=false;
    ensureLayers();
    if(!mapTex) {
      const th=Math.round(1280*(bounds[3]-bounds[1])/(bounds[2]-bounds[0]));
      mapTex=makeMapTex(1280,th);
      initTerrainTextures();
    }
    const zoomRel=view.k/view.kfit;

    // ── 1. Mar: HOI4 usa azul-cinza escuro (#2f4562) ──
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.fillStyle='#2a3f5a';
    ctx.fillRect(0,0,W,H);
    // gradiente sutil de profundidade
    const sg=ctx.createRadialGradient(W*0.5,H*0.45,0,W*0.5,H*0.45,Math.max(W,H)*0.9);
    sg.addColorStop(0,'rgba(48,75,100,0.5)'); sg.addColorStop(1,'rgba(15,25,40,0.3)');
    ctx.fillStyle=sg; ctx.fillRect(0,0,W,H);

    // ── 2. Grade (opcional) ──
    if(opts.grid) {
      ctx.setTransform(dpr*view.k,0,0,-dpr*view.k,dpr*view.tx,dpr*view.ty);
      ctx.strokeStyle='rgba(255,255,255,0.06)'; ctx.lineWidth=1/view.k;
      ctx.beginPath();
      for(let lon=5;lon<=55;lon+=5){const gx=lon*xscale;if(gx<bounds[0]||gx>bounds[2])continue;ctx.moveTo(gx,bounds[1]);ctx.lineTo(gx,bounds[3]);}
      for(let lat=40;lat<=70;lat+=5){const y=projY(lat);ctx.moveTo(bounds[0],y);ctx.lineTo(bounds[2],y);}
      ctx.stroke();
    }

    // ── 3. Terra: HOI4 — preencher com cores por terreno ──
    lctx.setTransform(1,0,0,1,0,0); lctx.globalAlpha=1; lctx.globalCompositeOperation='source-over';
    lctx.clearRect(0,0,layerL.width,layerL.height);
    lctx.setTransform(dpr*view.k,0,0,-dpr*view.k,dpr*view.tx,dpr*view.ty);
    lctx.lineJoin='round';

    // países de fundo (vizinhos)
    for(const b of bgs){
      lctx.globalAlpha=dim(b.owner)*0.95;
      lctx.fillStyle=shade(bgColor(b),0.82);
      lctx.fill(b.g.path,'evenodd');
    }

    // países jogáveis com cor por terreno
    if(opts.terrain) {
      for(const code of Object.keys(terrainPaths)){
        lctx.globalAlpha=dim(code);
        const tp=terrainPaths[code];
        for(const terrain of Object.keys(tp)){
          lctx.fillStyle=tp[terrain].fill;
          lctx.fill(tp[terrain].path,'nonzero');
          // anti-gap entre províncias: stroke da mesma cor
          lctx.strokeStyle=tp[terrain].fill;
          lctx.lineWidth=0.8/view.k;
          lctx.stroke(tp[terrain].path);
        }
      }
    } else {
      for(const code of Object.keys(ownerPaths)){
        const op=ownerPaths[code];
        const col=hoi4Color(code,owners[code].color);
        lctx.globalAlpha=dim(code);
        lctx.fillStyle=shade(col,0.85); lctx.fill(op.prov,'nonzero');
        lctx.strokeStyle=shade(col,0.85); lctx.lineWidth=0.8/view.k; lctx.stroke(op.prov);
      }
    }
    lctx.globalAlpha=1;

    // ── 4. Textura de mapa sutil (paper/noise) – source-atop só pinta sobre terra ──
    lctx.setTransform(dpr,0,0,dpr,0,0);
    lctx.globalCompositeOperation='source-atop'; lctx.globalAlpha=0.28;
    lctx.drawImage(mapTex,toSX(bounds[0]),toSY(bounds[3]),
      (bounds[2]-bounds[0])*view.k,(bounds[3]-bounds[1])*view.k);

    // ── 5. Ícones quasi-3D de terreno HOI4-style ──
    // Aparecem a partir de zoom 1.4× e ficam mais intensos com o zoom
    if(opts.terrain && zoomRel>1.4) {
      const fadeIn = Math.min(1,(zoomRel-1.4)/1.2);
      lctx.setTransform(dpr,0,0,dpr,0,0);
      lctx.globalCompositeOperation='source-over';

      for(const p of provinces){
        if(dim(p.owner)<1) continue;
        const sprite = terrainSprites[p.terrain]; if(!sprite) continue;
        const sx=toSX(p.l[0]), sy=toSY(p.l[1]);
        if(sx<-80||sy<-80||sx>W+80||sy>H+80) continue;

        // Escala do sprite depende do zoom e tamanho da província
        const provScreenSize = Math.sqrt(p.g.barea)*view.k;
        // Quantos ícones cabem na província?
        const iconCount = p.terrain==='forest'||p.terrain==='plains' ? Math.max(1,Math.min(4,Math.floor(provScreenSize/40))) : 1;
        const baseScale = Math.max(0.30, Math.min(1.05, provScreenSize / (sprite.width * 1.8)));
        const alpha = fadeIn * (p.terrain==='plains'?0.22:0.78);
        lctx.globalAlpha = alpha;

        if(iconCount===1){
          // Sprite único centrado na província
          const sw=sprite.width*baseScale*dpr, sh=sprite.height*baseScale*dpr;
          lctx.drawImage(sprite, sx*dpr-sw/2, sy*dpr-sh/2, sw, sh);
        } else {
          // Grade de ícones menores dentro da província (para florestas grandes)
          const smallScale = baseScale * 0.65;
          const sw=sprite.width*smallScale*dpr, sh=sprite.height*smallScale*dpr;
          const offsets = [
            [-provScreenSize*0.22*dpr,-provScreenSize*0.18*dpr],
            [ provScreenSize*0.20*dpr,-provScreenSize*0.15*dpr],
            [-provScreenSize*0.18*dpr, provScreenSize*0.20*dpr],
            [ provScreenSize*0.22*dpr, provScreenSize*0.18*dpr],
          ].slice(0,iconCount);
          for(const [dx,dy] of offsets){
            lctx.drawImage(sprite, sx*dpr+dx-sw/2, sy*dpr+dy-sh/2, sw, sh);
          }
        }
      }
      lctx.globalAlpha=1;
    }

    lctx.globalCompositeOperation='source-over'; lctx.globalAlpha=1;

    // ── 6. Compor para o canvas principal com brilho de costa (HOI4) ──
    ctx.setTransform(1,0,0,1,0,0);
    ctx.shadowColor='rgba(140,190,240,0.45)'; ctx.shadowBlur=18*dpr;
    ctx.drawImage(layerL,0,0);
    ctx.shadowColor='transparent'; ctx.shadowBlur=0;

    // ── 7. Bordas – HOI4 style ──
    ctx.setTransform(dpr*view.k,0,0,-dpr*view.k,dpr*view.tx,dpr*view.ty);
    const px=1/view.k;
    ctx.lineJoin='round'; ctx.lineCap='round';

    // Lagos
    if(lakePath){
      ctx.fillStyle='#1e3550'; ctx.fill(lakePath,'evenodd');
      ctx.strokeStyle='rgba(100,155,210,0.40)'; ctx.lineWidth=1.0*px; ctx.stroke(lakePath);
    }

    // Bordas de províncias (muito discretas – HOI4)
    if(opts.provinces){
      for(const code of Object.keys(ownerPaths)){
        ctx.globalAlpha=dim(code)*0.65;
        ctx.strokeStyle='rgba(0,0,0,0.28)'; ctx.lineWidth=0.5*px;
        ctx.stroke(ownerPaths[code].prov);
      }
    }

    // Bordas de estados (mais visíveis)
    if(opts.borders){
      for(const code of Object.keys(ownerPaths)){
        ctx.globalAlpha=dim(code);
        ctx.strokeStyle='rgba(0,0,0,0.55)'; ctx.lineWidth=0.9*px;
        ctx.stroke(ownerPaths[code].states);
      }
    }

    // Bordas de países de fundo
    ctx.globalAlpha=1;
    ctx.strokeStyle='rgba(0,0,0,0.6)'; ctx.lineWidth=0.7*px;
    for(const b of bgs){if(b.inter)continue;ctx.globalAlpha=Math.max(0.35,dim(b.owner));ctx.stroke(b.g.path);}
    ctx.globalAlpha=1;

    // Bordas de países jogáveis – HOI4: linha branca interna + escura externa
    // camada 1: halo branco/claro (brilho de borda HOI4)
    ctx.lineWidth=2.8*px;
    for(const code of Object.keys(ownerPaths)){
      ctx.globalAlpha=Math.max(0.4,dim(code))*0.5;
      ctx.strokeStyle='rgba(220,235,255,0.35)';
      ctx.stroke(ownerPaths[code].outline);
    }
    // camada 2: linha escura definida
    ctx.lineWidth=1.1*px;
    for(const code of Object.keys(ownerPaths)){
      ctx.globalAlpha=Math.max(0.5,dim(code));
      ctx.strokeStyle='rgba(5,8,14,0.9)';
      ctx.stroke(ownerPaths[code].outline);
    }
    ctx.globalAlpha=1;

    // Cidades (círculo suave na borda)
    if(opts.cities){
      for(const code of Object.keys(ownerPaths)){
        if(!ownerPaths[code].city) continue;
        ctx.globalAlpha=dim(code)*0.7;
        ctx.strokeStyle='rgba(0,0,0,0.45)'; ctx.lineWidth=0.7*px;
        ctx.stroke(ownerPaths[code].city);
      }
    }

    // Rios – desenhados NAS BORDAS das províncias (não como paths flutuantes)
    if(riverBorderEdges.length>0){
      const riverWidth = Math.max(1.2, Math.min(4.0, zoomRel*0.9)) * px;
      // Halo azul claro
      ctx.strokeStyle='rgba(130,185,235,0.55)';
      ctx.lineWidth=riverWidth*2.8;
      ctx.lineCap='round';
      for(const {x1,y1,x2,y2} of riverBorderEdges){
        ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
      }
      // Linha central escura
      ctx.strokeStyle='rgba(24,62,105,0.88)';
      ctx.lineWidth=riverWidth;
      for(const {x1,y1,x2,y2} of riverBorderEdges){
        ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
      }
      // Brilho (linha branca fina no centro)
      ctx.strokeStyle='rgba(190,230,255,0.30)';
      ctx.lineWidth=riverWidth*0.35;
      for(const {x1,y1,x2,y2} of riverBorderEdges){
        ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
      }
    } else if(riverPaths){
      // Fallback: rios como paths GeoJSON se bordas não foram detectadas
      const zf=Math.min(2.0,0.7+0.15*Math.sqrt(zoomRel));
      for(const [w,wpx] of [['1',0.8],['2',1.5],['3',2.4]]){
        if(!riverPaths[w]) continue;
        ctx.strokeStyle='rgba(130,185,235,0.45)'; ctx.lineWidth=(wpx+1.4)*zf*px; ctx.stroke(riverPaths[w]);
        ctx.strokeStyle='rgba(24,62,105,0.88)'; ctx.lineWidth=wpx*zf*px; ctx.stroke(riverPaths[w]);
      }
    }

    // Destaques de seleção/hover
    const hp=hover&&hover.kind==='prov'?hover.ref:null;
    if(hp&&hp.state!==selected){
      ctx.strokeStyle='rgba(255,255,255,0.75)'; ctx.lineWidth=1.2*px; ctx.stroke(hp.state.g.path);
    }
    if(selected){
      // HOI4: borda de seleção amarela
      ctx.strokeStyle='#e8c84a'; ctx.lineWidth=2.0*px; ctx.stroke(selected.g.path);
    }
    if(hp){
      ctx.fillStyle='rgba(255,255,255,0.22)'; ctx.fill(hp.g.path,'nonzero');
      ctx.strokeStyle='rgba(255,255,255,0.9)'; ctx.lineWidth=1.0*px; ctx.stroke(hp.g.path);
    } else if(hover&&hover.kind==='bg'){
      ctx.fillStyle='rgba(255,255,255,0.12)'; ctx.fill(hover.ref.g.path,'evenodd');
    }

    if(hooks.draw){ctx.save();hooks.draw(ctx,{view,dpr,toSX,toSY,zoomRel,owners,W,H});ctx.restore();}

    drawLabels();
  }

  const toSX=(x)=>x*view.k+view.tx;
  const toSY=(y)=>view.ty-y*view.k;

  // ─── LABELS HOI4-style ───
  let stateOrder=[], ownerBox=null;

  function drawLabels() {
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.lineJoin='round';
    const placed=[];
    const free=(x,y,w,h)=>{for(const r of placed)if(x<r[2]&&x+w>r[0]&&y<r[3]&&y+h>r[1])return false;placed.push([x,y,x+w,y+h]);return true;};

    // HOI4: nomes de países em CAPS com letter-spacing grande
    if(opts.names){
      const zr=view.k/view.kfit,fade=Math.max(0,Math.min(1,1-(zr-2.5)/2));
      if(fade>0){
        if(!ownerBox){
          ownerBox={};
          for(const s of stateOrder){
            if(s.minor||!s.label) continue;
            const o=ownerBox[s.owner]||(ownerBox[s.owner]={x0:1e9,y0:1e9,x1:-1e9,y1:-1e9,sx:0,sy:0,n:0});
            o.x0=Math.min(o.x0,s.label[0]);o.x1=Math.max(o.x1,s.label[0]);
            o.y0=Math.min(o.y0,s.label[1]);o.y1=Math.max(o.y1,s.label[1]);
            o.sx+=s.label[0];o.sy+=s.label[1];o.n++;
          }
        }
        const nameBoxes=[];
        const nfree=(x,y,w,h)=>{for(const r of nameBoxes)if(x<r[2]&&x+w>r[0]&&y<r[3]&&y+h>r[1])return false;nameBoxes.push([x,y,x+w,y+h]);return true;};
        for(const code of ['SOV','GER','FIN','ROM','HUN']){
          const o=ownerBox[code];if(!o||dim(code)<1)continue;
          const name=owners[code].name.toUpperCase();
          const widthPx=Math.max(40,(o.x1-o.x0)*view.k*0.75+20);
          const size=Math.max(9,Math.min(36,widthPx/(name.length*1.05)));
          // HOI4 usa fonte sem serifa, caps, com letter-spacing
          ctx.font=`700 ${size}px 'Trebuchet MS', system-ui, sans-serif`;
          ctx.letterSpacing=(size*0.22)+'px';
          const x=toSX(o.sx/o.n),y=toSY(o.sy/o.n);
          const tw=ctx.measureText(name).width+10;
          if(!nfree(x-tw/2,y-size/2,tw,size)){ctx.letterSpacing='0px';continue;}
          // sombra de texto HOI4 (fina)
          ctx.lineWidth=Math.max(1,size/16);
          ctx.strokeStyle=`rgba(0,0,0,${0.7*fade})`; ctx.strokeText(name,x,y);
          ctx.fillStyle=`rgba(220,225,235,${0.85*fade})`; ctx.fillText(name,x,y);
          ctx.letterSpacing='0px';
        }
      }
    }

    // Estrela/círculo de cidades HOI4-style
    const star=(x,y,r)=>{
      ctx.beginPath();
      for(let i=0;i<10;i++){const a=-Math.PI/2+i*Math.PI/5,rr=i%2?r*0.45:r;ctx[i?'lineTo':'moveTo'](x+Math.cos(a)*rr,y+Math.sin(a)*rr);}
      ctx.closePath();
    };

    if(opts.cities){
      const showAll=view.k>view.kfit*3;
      for(const c of cityProvs){
        if(!c.k&&!showAll) continue;
        if(dim(c.owner)<1) continue;
        const x=toSX(c.l[0]),y=toSY(c.l[1]);
        if(x<-40||y<-20||x>W+40||y>H+20) continue;
        const size=c.k?12:11,weight=c.k?700:600;
        ctx.font=`${weight} ${size}px 'Trebuchet MS', system-ui, sans-serif`;
        const w=textWidth(c.c)+16;
        if(!free(x-8,y-8,w,16)) continue;
        ctx.lineWidth=1.3;
        if(c.k){
          // HOI4: estrela dourada para capital
          star(x,y,6.0); ctx.fillStyle='#c8a428'; ctx.strokeStyle='rgba(255,255,255,0.9)'; ctx.stroke(); ctx.fill();
        } else {
          ctx.beginPath(); ctx.arc(x,y,2.8,0,6.2832); ctx.fillStyle='#c8a428'; ctx.strokeStyle='rgba(255,255,255,0.85)'; ctx.stroke(); ctx.fill();
        }
        ctx.textAlign='left';
        ctx.lineWidth=2.5; ctx.strokeStyle='rgba(0,0,0,0.7)';
        ctx.font=`${weight} ${size}px 'Trebuchet MS', system-ui, sans-serif`;
        ctx.strokeText(c.c,x+8,y);
        ctx.fillStyle='#e8e0cc'; ctx.fillText(c.c,x+8,y);
        ctx.textAlign='center';
      }
    }

    // Nomes dos estados (zoom próximo) – HOI4: fonte pequena, quase branca
    if(opts.names){
      ctx.font=`500 10px 'Trebuchet MS', system-ui, sans-serif`;
      for(const s of stateOrder){
        if(s.minor) continue;
        const b=s.g.bbox;
        const sw=(b[2]-b[0])*view.k,sh=(b[3]-b[1])*view.k;
        const w=textWidth(s.name);
        if(sw<w+10||sh<16) continue;
        const x=toSX(s.label[0]),y=toSY(s.label[1]);
        if(x<0||y<0||x>W||y>H) continue;
        if(dim(s.owner)<1) continue;
        if(!free(x-w/2-2,y-6,w+4,13)){continue;}
        ctx.lineWidth=2.5; ctx.strokeStyle='rgba(0,0,0,0.65)'; ctx.strokeText(s.name,x,y);
        ctx.fillStyle='rgba(220,215,200,0.92)'; ctx.fillText(s.name,x,y);
      }
    }
  }

  function schedule(){if(!queued){queued=true;requestAnimationFrame(draw);}}

  // ─── PAINEL DE INFO ───
  const fmt=(n)=>n.toLocaleString('pt-BR');
  function esc(s){return String(s).replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

  function terrainBadge(terrain){
    const ti=TERRAIN_INFO[terrain]||TERRAIN_INFO.plains;
    const icons={plains:'🌾',forest:'🌲',marsh:'🌿',hills:'⛰',mountains:'🏔',urban:'🏙',desert:'🏜'};
    return `<span style="display:inline-flex;align-items:center;gap:4px;background:rgba(255,255,255,0.08);border-radius:4px;padding:1px 6px;font-size:11px;">${icons[terrain]||''}${ti.label}</span>`;
  }

  function stateCard(s,prov){
    const o=owners[s.owner],n=nota(s);
    const city=prov&&prov.c, terrain=prov&&prov.terrain;
    const ti=terrain?TERRAIN_INFO[terrain]:null;
    const isRiverEdge=prov&&prov.a&&prov.a.some((jIdx)=>{
      const key=`${Math.min(prov.id-1,jIdx)}-${Math.max(prov.id-1,jIdx)}`;
      return riverEdges.has(key);
    });
    return `<div class="row"><span class="chip" style="background:${hoi4Color(s.owner,o.color)}"></span><h2>${esc(city?prov.c:s.name)}</h2></div>`+
      '<dl>'+
      (prov?`<dt>Província</dt><dd>nº ${fmt(prov.id)}${city?(prov.k?' · capital':' · cidade'):''}</dd>`:'')+ 
      (city?`<dt>Estado</dt><dd>${esc(s.name)}</dd>`:'')+
      (terrain?`<dt>Terreno</dt><dd>${terrainBadge(terrain)}</dd>`:'')+
      (ti?`<dt>Custo mov.</dt><dd>${ti.moveCost} dia${ti.moveCost>1?'s':''} por prov.</dd>`:'')+
      (ti&&ti.defBonus?`<dt>Bônus defesa</dt><dd>+${Math.round(ti.defBonus*100)}%</dd>`:'')+
      (isRiverEdge?`<dt>Barreira fluvial</dt><dd>⚓ Rio (+2 dias cruzamento)</dd>`:'')+
      (prov?`<dt>Vizinhas</dt><dd>${prov.a.length} províncias</dd>`:'')+
      `<dt>Dono em 1941</dt><dd>${esc(o.name)}</dd>`+
      `<dt>País atual</dt><dd>${esc(pais(s.country))}</dd>`+
      `<dt>Províncias</dt><dd>${fmt(s.n)}</dd>`+
      (s.area?`<dt>Área</dt><dd>${fmt(s.area)} km²</dd>`:'')+
      '</dl>'+(n?`<p class="note">${esc(n)}</p>`:'');
  }

  function updateInfo(){
    if(hover&&hover.kind==='prov'){infoEl.innerHTML=stateCard(hover.ref.state,hover.ref);return;}
    if(hover&&hover.kind==='bg'){
      const b=hover.ref,o=owners[b.owner];
      infoEl.innerHTML=`<div class="row"><span class="chip" style="background:${bgColor(b)}"></span><h2>${esc(pais(b.name))}</h2></div><dl><dt>Situação</dt><dd>${esc(o.name)}</dd></dl>`;
      return;
    }
    if(selected){infoEl.innerHTML=stateCard(selected,null);return;}
    infoEl.innerHTML='<p class="hint">Passe o mouse sobre uma região. Clique para fixar.</p>';
  }

  function buildLegend(){
    const counts={};
    for(const p of provinces) counts[p.owner]=(counts[p.owner]||0)+1;
    const codes=Object.keys(owners);
    const main=codes.filter(c=>owners[c].main),rest=codes.filter(c=>!owners[c].main);
    const btn=(c)=>`<button type="button" data-owner="${c}" aria-pressed="false">`+
      `<span class="chip" style="background:${hoi4Color(c,owners[c].color)}"></span>`+
      `<span class="name">${esc(owners[c].name)}</span>`+
      `<span class="count">${counts[c]?fmt(counts[c])+' prov.':''}</span></button>`;
    legendEl.innerHTML=main.map(btn).join('')+'<div class="sep"></div>'+rest.map(btn).join('');
    legendEl.addEventListener('click',(e)=>{
      const b=e.target.closest('button[data-owner]');if(!b)return;
      focusOwner=focusOwner===b.dataset.owner?null:b.dataset.owner;
      legendEl.querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',String(x.dataset.owner===focusOwner)));
      schedule();
    });
  }

  // ─── INTERAÇÃO ───
  const pointers=new Map(); let drag=null,pinch=null;
  function pos(e){const r=canvas.getBoundingClientRect();return[e.clientX-r.left,e.clientY-r.top];}

  canvas.addEventListener('pointerdown',(e)=>{
    canvas.setPointerCapture(e.pointerId);
    const[x,y]=pos(e); pointers.set(e.pointerId,[x,y]);
    if(pointers.size===1) drag={x,y,sx:x,sy:y,moved:false};
    else if(pointers.size===2){const[a,b]=[...pointers.values()];pinch={d:Math.hypot(a[0]-b[0],a[1]-b[1])};drag=null;}
  });
  canvas.addEventListener('pointermove',(e)=>{
    const[x,y]=pos(e);
    if(pointers.has(e.pointerId)) pointers.set(e.pointerId,[x,y]);
    if(pinch&&pointers.size===2){
      const[a,b]=[...pointers.values()],d=Math.hypot(a[0]-b[0],a[1]-b[1]);
      zoomAt((a[0]+b[0])/2,(a[1]+b[1])/2,d/pinch.d); pinch.d=d; return;
    }
    if(drag){
      if(!drag.moved&&Math.hypot(x-drag.sx,y-drag.sy)>4){drag.moved=true;canvas.classList.add('dragging');}
      if(drag.moved){view.tx+=x-drag.x;view.ty+=y-drag.y;drag.x=x;drag.y=y;schedule();return;}
    }
    if(e.pointerType==='mouse'||!drag){
      const h=hit(x,y);
      const same=(h&&hover&&h.ref===hover.ref)||(!h&&!hover);
      if(!same){hover=h;updateInfo();schedule();canvas.style.cursor=h&&h.kind==='prov'?'pointer':'';}
    }
  });
  function end(e){
    const[x,y]=pos(e);
    if(drag&&!drag.moved&&pointers.size===1){
      const h=hit(x,y);
      if(hooks.click&&hooks.click(h,e)){if(e.pointerType!=='mouse')hover=null;updateInfo();schedule();pointers.delete(e.pointerId);if(pointers.size===0){drag=null;canvas.classList.remove('dragging');}return;}
      const st=h&&h.kind==='prov'?h.ref.state:null;
      selected=st&&st!==selected?st:null;
      if(e.pointerType!=='mouse')hover=h&&h.kind==='prov'?h:null;
      updateInfo();schedule();
    }
    pointers.delete(e.pointerId);
    if(pointers.size<2)pinch=null;
    if(pointers.size===0){drag=null;canvas.classList.remove('dragging');}
  }
  canvas.addEventListener('pointerup',end);
  canvas.addEventListener('pointercancel',end);
  canvas.addEventListener('pointerleave',()=>{if(!drag&&hover){hover=null;updateInfo();schedule();}});
  canvas.addEventListener('wheel',(e)=>{e.preventDefault();const[x,y]=pos(e);zoomAt(x,y,Math.exp(-e.deltaY*(e.deltaMode===1?0.05:0.0016)));},{passive:false});

  document.getElementById('zin').onclick=()=>zoomAt(W/2,H/2,1.5);
  document.getElementById('zout').onclick=()=>zoomAt(W/2,H/2,1/1.5);
  document.getElementById('zreset').onclick=fitAll;

  for(const[id,key]of[['tProv','provinces'],['tBorders','borders'],['tNames','names'],['tCities','cities'],['tGrid','grid']]){
    const el=document.getElementById(id); if(!el)continue;
    el.checked=opts[key];
    el.addEventListener('change',()=>{opts[key]=el.checked;schedule();});
  }
  const tTerrain=document.getElementById('tTerrain');
  if(tTerrain){tTerrain.checked=opts.terrain;tTerrain.addEventListener('change',()=>{opts.terrain=tTerrain.checked;schedule();});}

  window.addEventListener('keydown',(e)=>{
    if(e.key==='+'||e.key==='=') zoomAt(W/2,H/2,1.3);
    else if(e.key==='-') zoomAt(W/2,H/2,1/1.3);
    else if(e.key==='0') fitAll();
    else if(e.key==='t'||e.key==='T'){opts.terrain=!opts.terrain;if(tTerrain)tTerrain.checked=opts.terrain;schedule();}
    else if(e.key==='Escape'){
      selected=null;focusOwner=null;
      legendEl.querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed','false'));
      updateInfo();schedule();
    }
  });
  window.addEventListener('resize',resize);

  // ─── CARREGAMENTO ───
  fetch('data/map.json')
    .then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.json();})
    .then(d=>{
      data=d; SC=d.meta.scale; owners=d.owners; bounds=d.meta.bounds;
      states=d.states; provinces=d.provinces; bgs=d.background;
      projection=d.meta.projection||'equirectangular';

      for(const s of states) s.g=build(s.rings);
      provinces.forEach((p,i)=>{
        p.id=i+1; p.g=build(p.r); p.state=states[p.s]; p.owner=p.state.owner;
      });
      for(const b of bgs) b.g=build(b.rings);
      xscale=d.meta.xscale||1;

      // Rios
      riverPaths={};
      const wt=d.water||{rivers:{},lakes:[]};
      for(const w of Object.keys(wt.rivers)){
        const p=new Path2D();
        for(const flat of wt.rivers[w]){const pts=decode(flat);for(let i=0;i<pts.length;i+=2){if(i===0)p.moveTo(pts[i],pts[i+1]);else p.lineTo(pts[i],pts[i+1]);}}
        riverPaths[w]=p;
      }
      lakePath=new Path2D();
      for(const lake of wt.lakes) for(const flat of lake){
        const pts=decode(flat);
        for(let i=0;i<pts.length;i+=2){if(i===0)lakePath.moveTo(pts[i],pts[i+1]);else lakePath.lineTo(pts[i],pts[i+1]);}
        lakePath.closePath();
      }

      // Terreno
      for(const p of provinces) p.terrain=assignTerrain(p);

      // Bordas de rio (para detecção de custo de movimento)
      riverEdges=buildRiverEdges(wt,provinces);

      // Rios nas bordas geométricas das províncias
      buildRiverBorderPaths(wt,provinces);

      cityProvs=provinces.filter(p=>p.c);

      // Paths por owner e por terrain
      for(const code of Object.keys(owners)){
        const prov=new Path2D(),st=new Path2D(),city=new Path2D(),cap=new Path2D();
        let any=false;
        for(const p of provinces){
          if(p.owner!==code)continue;
          prov.addPath(p.g.path);any=true;
          if(p.c)city.addPath(p.g.path);
          if(p.k)cap.addPath(p.g.path);
        }
        for(const s of states) if(s.owner===code) st.addPath(s.g.path);
        if(!any)continue;
        ownerPaths[code]={prov,states:st,city,cap,outline:build(d.outlines[code]||[]).path};

        // paths por terrain — cor HOI4
        terrainPaths[code]={};
        const baseColor=hoi4Color(code,owners[code].color);
        const byTerrain={};
        for(const p of provinces){
          if(p.owner!==code)continue;
          const t=p.terrain;
          if(!byTerrain[t])byTerrain[t]=new Path2D();
          byTerrain[t].addPath(p.g.path);
        }
        for(const t of Object.keys(byTerrain)){
          terrainPaths[code][t]={path:byTerrain[t],fill:terrainFill(baseColor,t)};
        }
      }

      // centróide dos estados para label
      for(const s of states){
        if(!s.label){
          const b=s.g.bbox;
          s.label=[(b[0]+b[2])/2,(b[1]+b[3])/2];
        }
        s.minor=(s.g.barea<0.01);
      }
      stateOrder=states.slice().sort((a,b)=>b.g.barea-a.g.barea);

      buildLegend();
      resize();

      window.__map={
        view,states,provinces,cityProvs,owners,fitAll,hit,schedule,
        riverEdges,TERRAIN_INFO,
        get hover(){return hover;}
      };
      if(hooks.ready)hooks.ready(window.__map);
    })
    .catch(err=>{
      infoEl.innerHTML='<p class="hint">Não foi possível carregar o mapa ('+esc(err.message)+
        '). Abra a página por um servidor web, não direto do arquivo.</p>';
    });
})();
