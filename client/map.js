/**
 * Hearts of Iron IV - Official Web Map Engine
 * Reverse engineered from Clausewitz Engine binaries & assets.
 * 3D Perspective Tilt, Smooth Inertial Zoom, Official Textures & Colormaps.
 */
(() => {
  'use strict';

  const planeEl = document.getElementById('map-3d-plane');
  const canvas = document.getElementById('hoi4-canvas');
  const ctx = canvas.getContext('2d');

  // UI Elements
  const tooltip = document.getElementById('hover-tooltip');
  const ttFlagImg = document.getElementById('tt-flag-img');
  const ttState = document.getElementById('tt-state');
  const ttSub = document.getElementById('tt-sub');

  const stateWin = document.getElementById('state-window');
  const stName = document.getElementById('st-name');
  const stCategory = document.getElementById('st-category');
  const stOwnerName = document.getElementById('st-owner-name');
  const stFlagImg = document.getElementById('st-flag-img');
  const stManpower = document.getElementById('st-manpower');
  const stVps = document.getElementById('st-vps');
  const stInfra = document.getElementById('st-infra');
  const stProvCount = document.getElementById('st-prov-count');
  const vpList = document.getElementById('vp-list');
  const btnCloseState = document.getElementById('btn-close-state');

  // Clock & Speeds
  const dateDisplay = document.getElementById('date-display');
  const btnPause = document.getElementById('btn-pause');
  const speedPips = document.querySelectorAll('.speed-step-indicator .pip');

  // Dock Buttons
  const modePolitical = document.getElementById('mode-political');
  const modeTerrain = document.getElementById('mode-terrain');
  const btnToggle3D = document.getElementById('btn-toggle-3d');
  const lbl3DStatus = document.getElementById('lbl-3d-status');
  const btnZoomIn = document.getElementById('btn-zoom-in');
  const btnZoomOut = document.getElementById('btn-zoom-out');
  const btnZoomReset = document.getElementById('btn-zoom-reset');

  // Map Data
  let statesData = {};
  let countriesData = {};
  let provLookup = null; // Uint16Array 2816x1024
  const LOOKUP_W = 2816;
  const LOOKUP_H = 1024;
  const MAP_W = 5632;
  const MAP_H = 2048;

  // Official Textures
  const imgPolitical = new Image();
  const imgTerrain = new Image();
  let politicalLoaded = false;
  let terrainLoaded = false;
  let currentMode = 'political'; // 'political' | 'terrain'
  let enable3D = true;

  // Camera & Viewport State (Clausewitz 3D Engine)
  const view = {
    k: 1.0,
    targetK: 1.0,
    tx: 0,
    targetTx: 0,
    ty: 0,
    targetTy: 0,
    pitch: 0,
    targetPitch: 0,
    minK: 0.6,
    maxK: 12.0
  };

  let isDragging = false;
  let dragStartX = 0, dragStartY = 0;
  let mouseScreenX = 0, mouseScreenY = 0;
  let selectedStateId = 0;

  // Flag path resolver
  function getFlagUrl(tag) {
    const known = {
      GER: 'gfx/flags/GER_fascism.png',
      SOV: 'gfx/flags/SOV_communism.png',
      ENG: 'gfx/flags/ENG_democratic.png',
      FRA: 'gfx/flags/FRA_democratic.png',
      USA: 'gfx/flags/USA_democratic.png',
      ITA: 'gfx/flags/ITA_fascism.png',
      JAP: 'gfx/flags/JAP_fascism.png',
      POL: 'gfx/flags/POL_neutrality.png',
      CHI: 'gfx/flags/CHI_neutrality.png',
      SPA: 'gfx/flags/SPA_neutrality.png',
      SWE: 'gfx/flags/SWE_democratic.png',
      BRA: 'gfx/flags/BRA_neutrality.png'
    };
    return known[tag] || 'gfx/flags/GER_fascism.png';
  }

  // Resize canvas
  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);

  // Center on Europe (Clausewitz default start: Berlin x=3010, y=479)
  function centerEurope() {
    const scale = Math.max(canvas.width / MAP_W, canvas.height / MAP_H) * 2.8;
    view.targetK = scale;
    view.targetTx = canvas.width / 2 - 3010 * scale;
    view.targetTy = canvas.height / 2 - 479 * scale;
  }

  function clampTargetView() {
    const curW = MAP_W * view.targetK;
    const curH = MAP_H * view.targetK;
    if (curW < canvas.width) {
      view.targetTx = (canvas.width - curW) / 2;
    } else {
      view.targetTx = Math.min(0, Math.max(canvas.width - curW, view.targetTx));
    }
    if (curH < canvas.height) {
      view.targetTy = (canvas.height - curH) / 2;
    } else {
      view.targetTy = Math.min(0, Math.max(canvas.height - curH, view.targetTy));
    }
  }

  // 3D Perspective Raycasting Unprojection
  // Given screen coords (sx, sy), compute the 2D plane coords (px, py) accounting for perspective tilt
  function screenToPlane(sx, sy) {
    if (!enable3D || view.pitch <= 0.1) {
      return [sx, sy];
    }
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const rad = (view.pitch * Math.PI) / 180.0;
    const dist = 1200; // perspective distance matching CSS

    const dy = sy - cy;
    const denom = Math.cos(rad) - (dy / dist) * Math.sin(rad);
    if (Math.abs(denom) < 0.001) return [sx, sy];

    const py = cy + dy / denom;
    const px = cx + (sx - cx) / denom;
    return [px, py];
  }

  function screenToMap(sx, sy) {
    const [px, py] = screenToPlane(sx, sy);
    const mx = (px - view.tx) / view.k;
    const my = (py - view.ty) / view.k;
    return [mx, my];
  }

  function getProvinceAt(mx, my) {
    if (!provLookup || mx < 0 || mx >= MAP_W || my < 0 || my >= MAP_H) return 0;
    const lx = Math.floor((mx / MAP_W) * LOOKUP_W);
    const ly = Math.floor((my / MAP_H) * LOOKUP_H);
    if (lx < 0 || lx >= LOOKUP_W || ly < 0 || ly >= LOOKUP_H) return 0;
    return provLookup[ly * LOOKUP_W + lx] || 0;
  }

  // Smooth Animation Loop (60 FPS Inertial Interpolation)
  function animate() {
    // Lerp translation & scale
    view.k += (view.targetK - view.k) * 0.18;
    view.tx += (view.targetTx - view.tx) * 0.18;
    view.ty += (view.targetTy - view.ty) * 0.18;

    // Calculate dynamic 3D camera pitch based on zoom level (Clausewitz tilt curve)
    if (enable3D) {
      // Below 1.5x zoom: flat top-down. Above 1.5x zoom: tilt up to 45°
      if (view.k > 1.4) {
        view.targetPitch = Math.min(46.0, (view.k - 1.4) * 8.5);
      } else {
        view.targetPitch = 0.0;
      }
    } else {
      view.targetPitch = 0.0;
    }
    view.pitch += (view.targetPitch - view.pitch) * 0.12;

    // Apply 3D perspective tilt to plane
    if (enable3D && Math.abs(view.pitch) > 0.05) {
      planeEl.style.transform = `rotateX(${view.pitch.toFixed(2)}deg)`;
    } else {
      planeEl.style.transform = 'none';
    }

    render();
    requestAnimationFrame(animate);
  }

  // Draw frame
  function render() {
    if (!politicalLoaded) {
      ctx.fillStyle = '#070e17';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#f5d47a';
      ctx.font = '22px "Barlow Condensed"';
      ctx.textAlign = 'center';
      ctx.fillText('Carregando Texturas Oficiais do Hearts of Iron IV...', canvas.width / 2, canvas.height / 2);
      return;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = view.k > 2.2;

    // Render active texture mode (Political vs Satellite Terrain)
    const activeImg = (currentMode === 'terrain' && terrainLoaded) ? imgTerrain : imgPolitical;

    ctx.drawImage(
      activeImg,
      0, 0, activeImg.naturalWidth, activeImg.naturalHeight,
      view.tx, view.ty, MAP_W * view.k, MAP_H * view.k
    );
  }

  // Mouse drag & interaction
  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    isDragging = true;
    dragStartX = e.clientX - view.targetTx;
    dragStartY = e.clientY - view.targetTy;
  });

  window.addEventListener('mousemove', (e) => {
    mouseScreenX = e.clientX;
    mouseScreenY = e.clientY;

    if (isDragging) {
      view.targetTx = e.clientX - dragStartX;
      view.targetTy = e.clientY - dragStartY;
      clampTargetView();
      tooltip.classList.remove('visible');
      return;
    }

    // Hover detection with 3D unprojected raycast
    const [mx, my] = screenToMap(e.clientX, e.clientY);
    const pid = getProvinceAt(mx, my);

    if (pid > 0) {
      let foundState = null;
      for (const sid in statesData) {
        if (statesData[sid].provinces.includes(pid)) {
          foundState = statesData[sid];
          break;
        }
      }

      if (foundState) {
        ttFlagImg.src = getFlagUrl(foundState.owner);
        ttState.textContent = foundState.name;

        let vpText = '';
        if (foundState.vps && foundState.vps[pid]) {
          vpText = ` • ⭐ ${foundState.vps[pid]} VP`;
        }
        ttSub.textContent = `${foundState.country_name} (${foundState.owner}) • Prov: #${pid}${vpText}`;

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

  window.addEventListener('mouseup', () => {
    isDragging = false;
  });

  // Smooth mouse-wheel zoom focused on cursor
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.22 : 0.82;
    const newK = Math.min(view.maxK, Math.max(view.minK, view.targetK * zoomFactor));

    const [planeX, planeY] = screenToPlane(e.clientX, e.clientY);

    view.targetTx = planeX - (planeX - view.targetTx) * (newK / view.targetK);
    view.targetTy = planeY - (planeY - view.targetTy) * (newK / view.targetK);
    view.targetK = newK;

    clampTargetView();
  }, { passive: false });

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

  // State window details
  function showStateDetails(st) {
    selectedStateId = st.id;
    stName.textContent = st.name;
    stCategory.textContent = st.category || 'Regional';
    stOwnerName.textContent = `${st.country_name} (${st.owner})`;
    stFlagImg.src = getFlagUrl(st.owner);

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
        li.innerHTML = `<span>Província #${vpid}</span><strong>⭐ ${pts} VP</strong>`;
        vpList.appendChild(li);
      }
    }
    if (totalVps === 0) {
      const li = document.createElement('li');
      li.textContent = 'Nenhum centro urbano';
      vpList.appendChild(li);
    }
    stVps.textContent = `⭐ ${totalVps} VP`;
    stProvCount.textContent = st.provinces.length;

    stateWin.classList.add('open');
  }

  btnCloseState.addEventListener('click', () => {
    stateWin.classList.remove('open');
    selectedStateId = 0;
  });

  // Mapmode Toggles
  modePolitical.addEventListener('click', () => {
    currentMode = 'political';
    modePolitical.classList.add('active');
    modeTerrain.classList.remove('active');
  });

  modeTerrain.addEventListener('click', () => {
    currentMode = 'terrain';
    modeTerrain.classList.add('active');
    modePolitical.classList.remove('active');
  });

  btnToggle3D.addEventListener('click', () => {
    enable3D = !enable3D;
    lbl3DStatus.textContent = enable3D ? 'ON' : 'OFF';
  });

  // Zoom Buttons
  btnZoomIn.addEventListener('click', () => {
    view.targetK = Math.min(view.maxK, view.targetK * 1.35);
    clampTargetView();
  });
  btnZoomOut.addEventListener('click', () => {
    view.targetK = Math.max(view.minK, view.targetK / 1.35);
    clampTargetView();
  });
  btnZoomReset.addEventListener('click', () => {
    centerEurope();
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

  function togglePause() {
    isPaused = !isPaused;
    btnPause.textContent = isPaused ? '▶' : '⏸';
  }

  btnPause.addEventListener('click', togglePause);
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      e.preventDefault();
      togglePause();
    } else if (e.code === 'F1') {
      e.preventDefault();
      modePolitical.click();
    } else if (e.code === 'F2') {
      e.preventDefault();
      modeTerrain.click();
    } else if (e.code === 'KeyT') {
      btnToggle3D.click();
    }
  });

  speedPips.forEach(pip => {
    pip.addEventListener('click', () => {
      const spd = parseInt(pip.dataset.speed);
      gameSpeed = spd;
      speedPips.forEach(p => {
        p.classList.toggle('active', parseInt(p.dataset.speed) <= spd);
      });
      clearInterval(timer);
      const intervals = [1000, 650, 400, 220, 90];
      timer = setInterval(updateClock, intervals[spd - 1]);
    });
  });

  // Asset Initialization
  async function init() {
    resize();
    centerEurope();
    animate();

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

      // 4. Load High-Res Official HOI4 Maps
      imgPolitical.onload = () => {
        politicalLoaded = true;
      };
      imgPolitical.src = 'data/hoi4_map_full.jpg';

      imgTerrain.onload = () => {
        terrainLoaded = true;
      };
      imgTerrain.src = 'data/hoi4_terrain_colormap.jpg';
    } catch (err) {
      console.error('Failed to load HOI4 assets:', err);
    }
  }

  init();
})();
