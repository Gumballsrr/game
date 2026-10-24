/**
 * Hearts of Iron IV - Official Web Map Engine
 * Reverse engineered from Clausewitz Engine binaries & assets.
 */
(() => {
  'use strict';

  const canvas = document.getElementById('hoi4-canvas');
  const ctx = canvas.getContext('2d');

  // UI Elements
  const tooltip = document.getElementById('hover-tooltip');
  const ttState = document.getElementById('tt-state');
  const ttSub = document.getElementById('tt-sub');
  
  const stateWin = document.getElementById('state-window');
  const stName = document.getElementById('st-name');
  const stCategory = document.getElementById('st-category');
  const stOwner = document.getElementById('st-owner');
  const stFlag = document.getElementById('st-flag');
  const stManpower = document.getElementById('st-manpower');
  const stVps = document.getElementById('st-vps');
  const stProvCount = document.getElementById('st-prov-count');
  const vpList = document.getElementById('vp-list');
  const btnCloseState = document.getElementById('btn-close-state');

  // Clock & Speeds
  const dateDisplay = document.getElementById('date-display');
  const btnPause = document.getElementById('btn-pause');
  const speedBtns = document.querySelectorAll('.btn-speed');

  // Zoom controls
  const btnZoomIn = document.getElementById('btn-zoom-in');
  const btnZoomOut = document.getElementById('btn-zoom-out');
  const btnZoomReset = document.getElementById('btn-zoom-reset');

  // Map state
  let statesData = {};
  let countriesData = {};
  let provLookup = null; // Uint16Array 2816x1024
  const LOOKUP_W = 2816;
  const LOOKUP_H = 1024;
  const MAP_W = 5632;
  const MAP_H = 2048;

  let mapImg = new Image();
  let mapLoaded = false;

  // Viewport transformation: scale (k), translation (tx, ty)
  const view = {
    k: 1.0,
    tx: 0,
    ty: 0,
    minK: 0.5,
    maxK: 12.0
  };

  let isDragging = false;
  let startX = 0, startY = 0;
  let hoveredProvId = 0;
  let hoveredStateId = 0;
  let selectedStateId = 0;

  // Country Flag Emoji Map
  const FLAGS = {
    GER: '🇩🇪', SOV: '☭', ENG: '🇬🇧', FRA: '🇫🇷', USA: '🇺🇸',
    ITA: '🇮🇹', JAP: '🇯🇵', POL: '🇵🇱', CHI: '🇨🇳', CAN: '🇨🇦',
    AST: '🇦🇺', RAJ: '🇮🇳', SAF: '🇿🇦', NZL: '🇳🇿', BRA: '🇧🇷',
    ARG: '🇦🇷', MEX: '🇲🇽', SPA: '🇪🇸', POR: '🇵🇹', SWE: '🇸🇪',
    NOR: '🇳🇴', FIN: '🇫🇮', DEN: '🇩🇰', HOL: '🇳🇱', BEL: '🇧🇪',
    SWI: '🇨🇭', AUS: '🇦🇹', CZE: '🇨🇿', HUN: '🇭🇺', ROM: '🇷🇴',
    YUG: '🇷🇸', BUL: '🇧🇬', GRE: '🇬🇷', TUR: '🇹🇷', PER: '🇮🇷',
    AFG: '🇦🇫', SAU: '🇸🇦', EGY: '🇪🇬', ETH: '🇪🇹', SIA: '🇹🇭'
  };

  // Resize canvas to window
  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    render();
  }
  window.addEventListener('resize', resize);

  // Initialize View to Central Europe (Berlin)
  function centerEurope() {
    const scale = Math.max(canvas.width / MAP_W, canvas.height / MAP_H) * 2.2;
    view.k = scale;
    // Berlin coords roughly: x=3010, y=479
    view.tx = canvas.width / 2 - 3010 * view.k;
    view.ty = canvas.height / 2 - 479 * view.k;
    clampView();
    render();
  }

  function clampView() {
    const curW = MAP_W * view.k;
    const curH = MAP_H * view.k;
    if (curW < canvas.width) {
      view.tx = (canvas.width - curW) / 2;
    } else {
      view.tx = Math.min(0, Math.max(canvas.width - curW, view.tx));
    }
    if (curH < canvas.height) {
      view.ty = (canvas.height - curH) / 2;
    } else {
      view.ty = Math.min(0, Math.max(canvas.height - curH, view.ty));
    }
  }

  // Render loop
  function render() {
    if (!mapLoaded) {
      ctx.fillStyle = '#0b1219';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#c8a848';
      ctx.font = '20px "Barlow Condensed"';
      ctx.textAlign = 'center';
      ctx.fillText('Carregando Mapa Oficial do Hearts of Iron IV...', canvas.width / 2, canvas.height / 2);
      return;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = view.k > 2.0;

    // Draw Map Texture
    ctx.drawImage(
      mapImg,
      0, 0, MAP_W, MAP_H,
      view.tx, view.ty, MAP_W * view.k, MAP_H * view.k
    );

    // If a state is selected, draw highlight or marker
    if (selectedStateId && statesData[selectedStateId]) {
      const st = statesData[selectedStateId];
      // Draw state banner / indicator
    }
  }

  // Coordinate transforms
  function screenToMap(sx, sy) {
    const mx = (sx - view.tx) / view.k;
    const my = (sy - view.ty) / view.k;
    return [mx, my];
  }

  function getProvinceAt(mx, my) {
    if (!provLookup || mx < 0 || mx >= MAP_W || my < 0 || my >= MAP_H) return 0;
    const lx = Math.floor((mx / MAP_W) * LOOKUP_W);
    const ly = Math.floor((my / MAP_H) * LOOKUP_H);
    if (lx < 0 || lx >= LOOKUP_W || ly < 0 || ly >= LOOKUP_H) return 0;
    const idx = ly * LOOKUP_W + lx;
    return provLookup[idx] || 0;
  }

  // Mouse interaction
  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    isDragging = true;
    startX = e.clientX - view.tx;
    startY = e.clientY - view.ty;
  });

  window.addEventListener('mousemove', (e) => {
    if (isDragging) {
      view.tx = e.clientX - startX;
      view.ty = e.clientY - startY;
      clampView();
      render();
      tooltip.classList.remove('visible');
      return;
    }

    // Hit test province & state
    const [mx, my] = screenToMap(e.clientX, e.clientY);
    const pid = getProvinceAt(mx, my);

    if (pid > 0) {
      hoveredProvId = pid;
      // Find state containing this province
      let foundState = null;
      for (const sid in statesData) {
        if (statesData[sid].provinces.includes(pid)) {
          foundState = statesData[sid];
          break;
        }
      }

      if (foundState) {
        hoveredStateId = foundState.id;
        const flag = FLAGS[foundState.owner] || '🏴';
        ttState.textContent = `${flag} ${foundState.name}`;
        
        let vpText = '';
        if (foundState.vps && foundState.vps[pid]) {
          vpText = ` • ⭐ ${foundState.vps[pid]} VP`;
        }
        ttSub.textContent = `${foundState.country_name} (${foundState.owner}) • Prov: ${pid}${vpText}`;
        
        tooltip.style.left = `${e.clientX + 16}px`;
        tooltip.style.top = `${e.clientY + 16}px`;
        tooltip.classList.add('visible');
      } else {
        tooltip.classList.remove('visible');
      }
    } else {
      tooltip.classList.remove('visible');
    }
  });

  window.addEventListener('mouseup', (e) => {
    if (isDragging) {
      isDragging = false;
    }
  });

  // Click to open State Details
  canvas.addEventListener('click', (e) => {
    const [mx, my] = screenToMap(e.clientX, e.clientY);
    const pid = getProvinceAt(mx, my);
    if (pid > 0) {
      for (const sid in statesData) {
        if (statesData[sid].provinces.includes(pid)) {
          showStateDetails(statesData[sid]);
          break;
        }
      }
    }
  });

  // Mouse wheel zoom
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.18 : 0.84;
    const newK = Math.min(view.maxK, Math.max(view.minK, view.k * zoomFactor));

    const mouseX = e.clientX;
    const mouseY = e.clientY;

    view.tx = mouseX - (mouseX - view.tx) * (newK / view.k);
    view.ty = mouseY - (mouseY - view.ty) * (newK / view.k);
    view.k = newK;

    clampView();
    render();
  }, { passive: false });

  // Zoom Buttons
  btnZoomIn.addEventListener('click', () => {
    view.k = Math.min(view.maxK, view.k * 1.3);
    clampView();
    render();
  });
  btnZoomOut.addEventListener('click', () => {
    view.k = Math.max(view.minK, view.k / 1.3);
    clampView();
    render();
  });
  btnZoomReset.addEventListener('click', () => {
    centerEurope();
  });

  // State window detail popup
  function showStateDetails(st) {
    selectedStateId = st.id;
    stName.textContent = st.name;
    stCategory.textContent = st.category || 'Regional';
    stOwner.textContent = `${st.country_name} (${st.owner})`;
    stFlag.textContent = FLAGS[st.owner] || '🏴';
    
    const mpFormatted = st.manpower > 1000000 
      ? (st.manpower / 1000000).toFixed(2) + 'M' 
      : (st.manpower / 1000).toFixed(0) + 'K';
    stManpower.textContent = mpFormatted;

    let totalVps = 0;
    vpList.innerHTML = '';
    if (st.vps) {
      for (const [vpid, pts] of Object.entries(st.vps)) {
        totalVps += pts;
        const li = document.createElement('li');
        li.innerHTML = `<span>Província #${vpid}</span><strong>${pts} VP</strong>`;
        vpList.appendChild(li);
      }
    }
    if (totalVps === 0) {
      const li = document.createElement('li');
      li.textContent = 'Nenhuma cidade principal';
      vpList.appendChild(li);
    }
    stVps.textContent = `${totalVps} VP`;
    stProvCount.textContent = st.provinces.length;

    stateWin.classList.add('open');
    render();
  }

  btnCloseState.addEventListener('click', () => {
    stateWin.classList.remove('open');
    selectedStateId = 0;
    render();
  });

  // Time Engine
  let isPaused = false;
  let gameSpeed = 1;
  let currentDate = new Date(Date.UTC(1936, 0, 1, 12, 0));

  function updateClock() {
    if (!isPaused) {
      currentDate.setUTCHours(currentDate.getUTCHours() + 1);
      const hours = String(currentDate.getUTCHours()).padStart(2, '0') + ':00';
      const day = currentDate.getUTCDate();
      const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
      const month = months[currentDate.getUTCMonth()];
      const year = currentDate.getUTCFullYear();
      dateDisplay.textContent = `${hours}, ${day} ${month}, ${year}`;
    }
  }

  let timer = setInterval(updateClock, 1000);

  btnPause.addEventListener('click', togglePause);
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      e.preventDefault();
      togglePause();
    }
  });

  function togglePause() {
    isPaused = !isPaused;
    btnPause.textContent = isPaused ? '▶' : '⏸';
  }

  speedBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      speedBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      gameSpeed = parseInt(btn.dataset.speed);
      clearInterval(timer);
      const intervals = [1000, 700, 450, 250, 100];
      timer = setInterval(updateClock, intervals[gameSpeed - 1]);
    });
  });

  // Load All Assets
  async function init() {
    resize();
    render();

    try {
      // 1. Load states JSON
      const stResp = await fetch('data/hoi4_states.json');
      statesData = await stResp.json();

      // 2. Load countries JSON
      const cResp = await fetch('data/hoi4_countries.json');
      countriesData = await cResp.json();

      // 3. Load Province Binary Lookup
      const binResp = await fetch('data/hoi4_prov_lookup_2816.bin');
      const binBuf = await binResp.arrayBuffer();
      provLookup = new Uint16Array(binBuf);
      console.log('HOI4 Province Lookup Table Loaded:', provLookup.length, 'entries');

      // 4. Load High-Res Official HOI4 Map
      mapImg.onload = () => {
        mapLoaded = true;
        centerEurope();
      };
      // Load full map image
      mapImg.src = 'data/hoi4_map_full.jpg';
    } catch (err) {
      console.error('Failed to load HOI4 assets:', err);
    }
  }

  init();
})();
