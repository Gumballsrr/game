#!/usr/bin/env python3
"""
Gera client/data/map.json a partir do Natural Earth (dominio publico).

Uso:
    python3 tools/build_map.py --src /caminho/para/natural-earth-vector/geojson

Arquivos necessarios na pasta --src:
    ne_10m_admin_1_states_provinces.geojson
    ne_10m_admin_0_countries.geojson
    ne_10m_populated_places_simple.geojson

Dependencias: numpy, scipy, scikit-image e opencv-python.

O que o script faz:
  1. Recorta a parte EUROPEIA do teatro (Alemanha ate o Volga/Kama; sem a Asia).
  2. Atribui cada regiao administrativa ao dono em 22/06/1941 (owner_of()).
  3. Projeta (equirretangular, como o mapa do HOI4) e rasteriza tudo numa grade.
  4. Divide a area de cada dono em PROVINCIAS de tamanho uniforme (Lloyd/Voronoi
     com bordas irregulares). A quantidade por dono vem de
     tools/province_targets.json (derivada do CSV real do HOI4).
  5. Cada cidade importante vira uma provincia pequena, cercada por varias
     provincias (nunca por uma so), como no HOI4.
  6. Os ESTADOS sao formados pela uniao das provincias (como no HOI4): cada
     provincia pertence ao estado administrativo em que ela mais se encaixa;
     cidades-estado minusculas (Berlim, Praga, Bucareste...) sao absorvidas pelo
     estado vizinho.
  7. Grava um JSON compacto, com a lista de vizinhos de cada provincia.

Os estados sao as divisoes administrativas ATUAIS dos paises. As fronteiras de
1941 sao aproximadas: regioes inteiras mudam de dono, sem dividi-las.
"""
import argparse
import json
import math
import os
import warnings

import cv2
import numpy as np
from scipy import ndimage
from scipy.spatial import cKDTree
from skimage import measure

# Janela do mapa (graus). Oeste = Alemanha, leste = Volga/Kama (sem a Asia).
WEST, EAST, SOUTH, NORTH = 5.0, 54.0, 40.0, 71.5
DATE = "1941-06-22"      # inicio da Operacao Barbarossa

SC = 200                 # coordenadas gravadas = inteiro / SC (unidades projetadas)
R = 50                   # pixels por grau na grade de trabalho
TOL_PX = 0.3             # simplificacao dos contornos (em pixels)
TOL_BG = 0.04
MIN_AREA_BG = 0.004
MIN_RING_PX = 3.0        # descarta aneis menores que isso (pixels quadrados)
MIN_RING_PROV_PX = 10.0
MIN_FRAGMENT_PX = 20     # fragmentos soltos menores que isso sao anexados ao vizinho
KM_PER_UNIT = 111.32     # km por grau no equador
SEED = 1941

CITY_AREA_FRAC = 0.30    # area de uma cidade-provincia, em relacao a uma provincia comum
CAPITAL_AREA_FRAC = 0.42
CITY_MAX_SHARE = 0.17    # no maximo 17% das provincias de um dono podem ser cidades
CITY_SPACING = 1.9       # distancia minima entre cidades (em espacamentos de provincia)
POP_MIN = 80000          # populacao minima para uma cidade virar provincia
WARP = 0.20              # irregularidade das bordas (fracao do espacamento)

# ----------------------------------------------------------------- donos 1941
OWNERS = {
    "GER": {"name": "Alemanha",       "color": "#868a92", "main": True},
    "SOV": {"name": "União Soviética", "color": "#c0392b", "main": True},
    "ROM": {"name": "Romênia",        "color": "#e0b73a", "main": True},
    "FIN": {"name": "Finlândia",      "color": "#66b3e0", "main": True},
    "HUN": {"name": "Hungria",        "color": "#4e9d5b", "main": True},
    "AXM": {"name": "Eixo (outros)",  "color": "#a58cc4", "main": False},
    "OCC": {"name": "Ocupado / dividido", "color": "#8c7155", "main": False},
    "NEU": {"name": "Neutros / outros", "color": "#b9a77f", "main": False},
    "OUT": {"name": "Fora do mapa (Ásia)", "color": "#33414f", "main": False},
}
PROVINCED = ["GER", "SOV", "ROM", "FIN", "HUN", "AXM"]   # donos que recebem provincias

TRANSILVANIA_NORTE = {  # Segunda Arbitragem de Viena (agosto de 1940)
    "Satu Mare", "Maramures", "Salaj", "Cluj", "Bistrita-Nasaud",
    "Mures", "Harghita", "Covasna", "Bihor",
}
BACKA = {"Severno-Backi", "Zapadno-Backi", "Južno-Backi"}  # ocupada pela Hungria em 1941
ESLOVAQUIA_SUL = {"Košický", "Nitriansky"}                  # Primeira Arbitragem de Viena

# Paises cujas regioes (admin-1) viram "estados" do jogo.
INTERACTIVE = {
    "Germany", "Austria", "Czech Republic", "Poland", "Slovakia", "Hungary",
    "Romania", "Finland", "Estonia", "Lithuania", "Belarus", "Ukraine", "Russia",
    "Georgia", "Armenia", "Azerbaijan",
}
# Regioes russas fora do recorte europeu: ficam so como fundo ("Fora do mapa").
RUSSIA_SKIP = {"Chukchi Autonomous Okrug", "Kurgan", "Khanty-Mansiy", "Orenburg",
               "Bashkortostan", "Chelyabinsk", "Sverdlovsk"}
# Paises que viram estados (o fundo nao traca borda neles).
INTER_A3 = {"DEU", "AUT", "CZE", "POL", "SVK", "HUN", "ROU", "FIN", "EST", "LTU",
            "BLR", "UKR", "LVA", "MDA", "GEO", "ARM", "AZE"}


def owner_of(admin, name):
    if admin in ("Germany", "Austria", "Czech Republic"):
        return "GER"
    if admin == "Poland":
        return "SOV" if name == "Podlachian" else "GER"   # Bialystok ficou com a URSS
    if admin == "Slovakia":
        return "HUN" if name in ESLOVAQUIA_SUL else "AXM"
    if admin == "Hungary":
        return "HUN"
    if admin == "Romania":
        return "HUN" if name in TRANSILVANIA_NORTE else "ROM"
    if admin == "Finland":
        return "FIN"
    if admin == "Ukraine":
        return "HUN" if name == "Transcarpathia" else "SOV"  # Rutenia, anexada em 1939
    if admin in ("Estonia", "Belarus", "Georgia", "Armenia", "Azerbaijan"):
        return "SOV"
    if admin == "Lithuania":
        return "GER" if name == "Klaipedos" else "SOV"     # Memel foi anexada em 1939
    if admin == "Russia":
        return "GER" if name == "Kaliningrad" else "SOV"   # Prussia Oriental
    if admin == "Republic of Serbia":
        return "HUN" if name in BACKA else "OCC"
    return "NEU"


BG_CLASS = {}
for _c in "DEU AUT CZE POL LUX".split():
    BG_CLASS[_c] = "GER"
for _c in "UKR BLR MDA EST LVA LTU GEO ARM AZE".split():
    BG_CLASS[_c] = "SOV"
for _c in "KAZ UZB TKM KGZ TJK".split():
    BG_CLASS[_c] = "OUT"
BG_CLASS.update({"HUN": "HUN", "ROU": "ROM", "FIN": "FIN"})
for _c in "ITA BGR SVK HRV ALB".split():
    BG_CLASS[_c] = "AXM"
for _c in "DNK NOR NLD BEL FRA GRC SRB SVN BIH MNE MKD KOS".split():
    BG_CLASS[_c] = "OCC"

# Cidades sempre presentes: (nome em 1941, lon, lat, capital?)
CITIES_FORCED = [
    ("Berlim", 13.405, 52.52, True), ("Moscou", 37.62, 55.755, True),
    ("Bucareste", 26.10, 44.43, True), ("Helsinque", 24.94, 60.17, True),
    ("Budapeste", 19.04, 47.50, True),
    ("Varsóvia", 21.01, 52.23, False), ("Viena", 16.37, 48.21, False),
    ("Praga", 14.42, 50.09, False), ("Königsberg", 20.51, 54.71, False),
    ("Bratislava", 17.11, 48.15, False), ("Kiev", 30.52, 50.45, False),
    ("Minsk", 27.56, 53.90, False), ("Leningrado", 30.32, 59.93, False),
    ("Riga", 24.11, 56.95, False), ("Tallinn", 24.75, 59.44, False),
    ("Vilnius", 25.28, 54.69, False), ("Kishinev", 28.86, 47.01, False),
    ("Odessa", 30.73, 46.48, False), ("Sebastopol", 33.53, 44.62, False),
    ("Carcóvia", 36.23, 49.99, False), ("Rostov", 39.72, 47.23, False),
    ("Stalingrado", 44.52, 48.71, False), ("Smolensk", 32.04, 54.78, False),
    ("Murmansk", 33.08, 68.97, False), ("Arcangel", 40.54, 64.54, False),
    ("Lvov", 24.03, 49.84, False), ("Oulu", 25.47, 65.01, False),
    ("Ploiești", 26.03, 44.94, False), ("Constança", 28.65, 44.18, False),
    ("Baku", 49.87, 40.41, False), ("Tbilisi", 44.79, 41.72, False),
    ("Erevan", 44.51, 40.18, False),
]
# Nomes de 1941 (ou em portugues) para as demais cidades do Natural Earth.
NOMES = {
    "Kaliningrad": "Königsberg", "Volgograd": "Stalingrado", "Saint Petersburg": "Leningrado",
    "St. Petersburg": "Leningrado", "Samara": "Kuibyshev", "Tver": "Kalinin",
    "Nizhniy Novgorod": "Gorki", "Nizhny Novgorod": "Gorki", "Luhansk": "Voroshilovgrad",
    "Donetsk": "Stalino", "Kharkiv": "Carcóvia", "Lviv": "Lvov", "Dnipro": "Dnepropetrovsk",
    "Dnipropetrovsk": "Dnepropetrovsk", "Zaporizhzhya": "Zaporozhie", "Mykolayiv": "Nikolaiev",
    "Chernivtsi": "Tchernovtsy", "Rivne": "Rovno", "Chisinau": "Kishinev",
    "Arkhangelsk": "Arcangel", "Gdansk": "Danzig", "Gdańsk": "Danzig", "Wroclaw": "Breslau",
    "Wrocław": "Breslau", "Szczecin": "Stettin", "Poznan": "Posen", "Poznań": "Posen",
    "Katowice": "Kattowitz", "Krakow": "Cracóvia", "Kraków": "Cracóvia", "Klaipeda": "Memel",
    "Klaipėda": "Memel", "Kyiv": "Kiev", "Warsaw": "Varsóvia", "Moscow": "Moscou",
    "Vienna": "Viena", "Prague": "Praga", "Berlin": "Berlim", "Bucharest": "Bucareste",
    "Budapest": "Budapeste", "Helsinki": "Helsinque", "Yerevan": "Erevan",
    "Cluj-Napoca": "Cluj", "Constanța": "Constança", "Sevastopol": "Sebastopol",
    "Munich": "Munique", "Cologne": "Colônia", "Nuremberg": "Nuremberg", "Hanover": "Hanôver",
    "Kazan": "Kazan", "Ulyanovsk": "Ulianovsk", "Yaroslavl": "Iaroslavl",
    "Ivanovo": "Ivanovo", "Bryansk": "Briansk", "Kursk": "Kursk",
}


# ------------------------------------------------------------------ geometria
def project(lon, lat):
    """Projecao do mapa: equirretangular (plate carree), como o mapa do HOI4.
    1 grau de longitude e 1 grau de latitude medem o mesmo na tela. Assim as
    provincias ficam com tamanho parecido de um pais para o outro; no Mercator o
    norte e esticado e as da Finlandia pareceriam o dobro das alemas."""
    return lon, lat


def ring_area(pts):
    a = 0.0
    n = len(pts)
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        a += x1 * y2 - x2 * y1
    return a / 2.0


def clip_ring(ring, bounds):
    """Sutherland-Hodgman contra um retangulo (lon/lat)."""
    xmin, ymin, xmax, ymax = bounds
    pts = [tuple(p[:2]) for p in ring]
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts = pts[:-1]

    def run(pts, inside, inter):
        if not pts:
            return []
        out = []
        prev = pts[-1]
        for cur in pts:
            if inside(cur):
                if not inside(prev):
                    out.append(inter(prev, cur))
                out.append(cur)
            elif inside(prev):
                out.append(inter(prev, cur))
            prev = cur
        return out

    def ix(x):
        return lambda a, b: (x, a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]))

    def iy(y):
        return lambda a, b: (a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]), y)

    pts = run(pts, lambda p: p[0] >= xmin, ix(xmin))
    pts = run(pts, lambda p: p[0] <= xmax, ix(xmax))
    pts = run(pts, lambda p: p[1] >= ymin, iy(ymin))
    pts = run(pts, lambda p: p[1] <= ymax, iy(ymax))
    return pts if len(pts) >= 3 else []


def dp_open(pts, tol):
    """Douglas-Peucker vetorizado em numpy. pts: (n, 2). Devolve (m, 2)."""
    n = len(pts)
    if n < 3:
        return pts
    keep = np.zeros(n, bool)
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        a, b = pts[i], pts[j]
        d = b - a
        L2 = float(d @ d)
        seg = pts[i + 1:j]
        if L2 == 0:
            dist = np.hypot(*(seg - a).T)
        else:
            t = np.clip(((seg - a) @ d) / L2, 0.0, 1.0)
            dist = np.hypot(*(seg - (a + t[:, None] * d)).T)
        k = int(dist.argmax())
        if dist[k] > tol:
            m = i + 1 + k
            keep[m] = True
            stack.append((i, m))
            stack.append((m, j))
    return pts[keep]


def simplify_ring(pts, tol):
    """Simplifica um anel preservando a forma fechada."""
    pts = np.asarray(pts, dtype=float)
    if len(pts) > 1 and np.array_equal(pts[0], pts[-1]):
        pts = pts[:-1]
    if len(pts) <= 4:
        return pts
    k = int(np.argmax(((pts - pts[0]) ** 2).sum(axis=1)))
    a = dp_open(pts[: k + 1], tol)
    b = dp_open(np.vstack([pts[k:], pts[:1]]), tol)
    out = np.vstack([a[:-1], b[:-1]])
    return out if len(out) >= 3 else pts[:3]


def polys_of(geom):
    if geom["type"] == "Polygon":
        return [geom["coordinates"]]
    if geom["type"] == "MultiPolygon":
        return geom["coordinates"]
    return []


def process_geometry(geom, tol, min_area):
    """Recorta e projeta. Devolve lista de aneis (ndarray (n,2)) ou None."""
    bounds = (WEST, SOUTH, EAST, NORTH)
    out = []
    for poly in polys_of(geom):
        for ring in poly:
            xs = [p[0] for p in ring]
            ys = [p[1] for p in ring]
            if max(xs) < WEST or min(xs) > EAST or max(ys) < SOUTH or min(ys) > NORTH:
                continue
            clipped = clip_ring(ring, bounds)
            if not clipped:
                continue
            proj = np.array([project(x, y) for x, y in clipped])
            if abs(ring_area(proj)) < min_area:
                continue
            proj = simplify_ring(proj, tol)
            if abs(ring_area(proj)) < min_area:
                continue
            out.append(proj)
    return out or None


def pack(rings):
    """Aneis -> listas planas de inteiros (coordenada * SC), 1o ponto absoluto
    e os demais como diferenca para o anterior."""
    out = []
    for r in rings:
        arr = []
        px = py = 0
        for k, (x, y) in enumerate(r):
            xi, yi = int(round(x * SC)), int(round(y * SC))
            if k == 0:
                arr += [xi, yi]
            else:
                arr += [xi - px, yi - py]
            px, py = xi, yi
        out.append(arr)
    return out


# -------------------------------------------------------------- grade / raster
class Grid:
    def __init__(self, bounds):
        self.x0, self.y0, self.x1, self.y1 = bounds
        self.W = int(math.ceil((self.x1 - self.x0) * R))
        self.H = int(math.ceil((self.y1 - self.y0) * R))
        rows = np.arange(self.H)
        lat = self.y1 - (rows + 0.5) / R
        # km2 por pixel em cada linha (na equirretangular, a area encolhe com cos(lat))
        self.km2_row = (KM_PER_UNIT / R) ** 2 * np.cos(np.radians(lat))

    def to_cv(self, ring):
        u = (ring[:, 0] - self.x0) * R - 0.5
        v = (self.y1 - ring[:, 1]) * R - 0.5
        return np.round(np.stack([u, v], axis=1) * 16).astype(np.int32)

    def to_world(self, rc, i0=0, j0=0):
        x = self.x0 + (rc[:, 1] + j0 + 0.5) / R
        y = self.y1 - (rc[:, 0] + i0 + 0.5) / R
        return np.stack([x, y], axis=1)

    def pixel(self, lon, lat):
        x, y = project(lon, lat)
        return int((self.y1 - y) * R), int((x - self.x0) * R)


def rasterize_states(grid, states):
    """Grade com o indice (1..n) do estado em cada pixel. Estados menores por cima."""
    lab = np.zeros((grid.H, grid.W), np.int32)
    order = sorted(range(len(states)), key=lambda i: -states[i]["_parea"])
    for idx in order:
        rings = states[idx]["_rings"]
        allp = np.vstack(rings)
        j0 = max(int(math.floor((allp[:, 0].min() - grid.x0) * R)) - 2, 0)
        j1 = min(int(math.ceil((allp[:, 0].max() - grid.x0) * R)) + 3, grid.W)
        i0 = max(int(math.floor((grid.y1 - allp[:, 1].max()) * R)) - 2, 0)
        i1 = min(int(math.ceil((grid.y1 - allp[:, 1].min()) * R)) + 3, grid.H)
        mask = np.zeros((i1 - i0, j1 - j0), np.uint8)
        polys = []
        for r in rings:
            p = grid.to_cv(r)
            p[:, 0] -= j0 * 16
            p[:, 1] -= i0 * 16
            polys.append(p)
        cv2.fillPoly(mask, polys, 1, lineType=cv2.LINE_8, shift=4)
        sub = lab[i0:i1, j0:j1]
        sub[mask.astype(bool)] = idx + 1
    return lab


def clean_fragments(lab):
    """Pedacinhos de um estado (sobras da rasterizacao entre vizinhos) sao
    anexados ao estado vizinho; ilhotas isoladas e minusculas sao apagadas."""
    objs = ndimage.find_objects(lab)
    cross = ndimage.generate_binary_structure(2, 1)
    moved = 0
    for k, sl in enumerate(objs, start=1):
        if sl is None:
            continue
        sub = lab[sl]
        m = sub == k
        comp, nc = measure.label(m, connectivity=1, return_num=True)
        if nc < 2 and m.sum() >= MIN_FRAGMENT_PX:
            continue
        sizes = np.bincount(comp.ravel(), minlength=nc + 1)
        biggest = int(sizes[1:].argmax()) + 1 if nc else 0
        for c in range(1, nc + 1):
            if c == biggest or sizes[c] >= MIN_FRAGMENT_PX:
                continue
            cm = comp == c
            ring = ndimage.binary_dilation(cm, structure=cross) & ~cm
            neigh = sub[ring]
            neigh = neigh[(neigh != 0) & (neigh != k)]
            sub[cm] = int(np.bincount(neigh).argmax()) if len(neigh) else 0
            moved += 1
    return moved


def largest_remainder(weights, total, minimum=1):
    """Reparte `total` inteiros proporcionalmente aos pesos, com minimo por item."""
    n = len(weights)
    total = max(total, n * minimum)
    w = np.asarray(weights, float)
    w = w / w.sum() if w.sum() > 0 else np.full(n, 1.0 / n)
    spare = total - n * minimum
    raw = w * spare
    base = np.floor(raw).astype(int)
    rem = spare - base.sum()
    order = np.argsort(-(raw - base))
    base[order[:rem]] += 1
    return base + minimum


def fix_components(cl, allow_new=True):
    """Cada provincia deve ser uma regiao conexa: pedacos soltos sao anexados ao
    vizinho de maior contato (ou viram provincia propria, se forem ilhas grandes)."""
    comp, ncomp = measure.label(cl, background=0, connectivity=1, return_num=True)
    if ncomp == 0:
        return cl
    sizes = np.bincount(comp.ravel(), minlength=ncomp + 1)
    objs = ndimage.find_objects(comp)
    by_val = {}
    for c, sl in enumerate(objs, start=1):
        if sl is None:
            continue
        v = int(cl[sl][comp[sl] == c][0])
        by_val.setdefault(v, []).append(c)
    next_label = int(cl.max()) + 1
    cross = ndimage.generate_binary_structure(2, 1)
    for v, comps in by_val.items():
        if len(comps) < 2:
            continue
        comps.sort(key=lambda c: -sizes[c])
        for c in comps[1:]:
            sl = objs[c - 1]
            i0 = max(sl[0].start - 1, 0)
            i1 = min(sl[0].stop + 1, cl.shape[0])
            j0 = max(sl[1].start - 1, 0)
            j1 = min(sl[1].stop + 1, cl.shape[1])
            m = comp[i0:i1, j0:j1] == c
            ring = ndimage.binary_dilation(m, structure=cross) & ~m
            neigh = cl[i0:i1, j0:j1][ring]
            neigh = neigh[(neigh != 0) & (neigh != v)]
            if len(neigh):
                tgt = int(np.bincount(neigh).argmax())
            elif m.sum() < MIN_FRAGMENT_PX or not allow_new:
                tgt = 0                      # ilhota minuscula: descarta
            else:
                tgt = next_label
                next_label += 1
            cl[i0:i1, j0:j1][m] = tgt
    return cl


def contours_of(mask, grid, i0, j0, tol_px=TOL_PX, min_px=MIN_RING_PX):
    """Contornos (aneis em coordenadas do mundo) de uma mascara booleana."""
    padded = np.pad(mask.astype(np.uint8), 1)
    cs = measure.find_contours(padded, 0.5)
    out = []
    for c in cs:
        if len(c) < 4:
            continue
        c = c - 1.0
        w = grid.to_world(c, i0, j0)
        s = simplify_ring(w, tol_px / R)
        if len(s) >= 3 and abs(ring_area(s)) * R * R >= min_px:
            out.append(s)
    return out


def best_label_point(ys, xs, grid):
    """Pixel da regiao mais proximo do centroide (garante ponto dentro da regiao)."""
    cy, cx = ys.mean(), xs.mean()
    k = int(np.argmin((ys - cy) ** 2 + (xs - cx) ** 2))
    return grid.to_world(np.array([[ys[k], xs[k]]], float))[0]


# ------------------------------------------------------------ provincias (Lloyd)
def smooth_noise(h, w, wl, rng):
    """Ruido suave (desvio padrao 1) com comprimento de onda aproximado `wl` pixels."""
    wl = max(int(wl), 2)
    lh, lw = h // wl + 4, w // wl + 4
    low = rng.standard_normal((lh, lw)).astype(np.float32)
    big = cv2.resize(low, (lw * wl, lh * wl), interpolation=cv2.INTER_CUBIC)
    out = big[:h, :w]
    sd = float(out.std()) or 1.0
    return out / sd


def init_seeds(Ps, N, n, rng):
    """Sementes iniciais numa malha hexagonal levemente perturbada."""
    if n >= len(Ps):
        return Ps.astype(np.float64).copy()
    s = math.sqrt(N / (n * 0.866))
    x0, y0 = Ps.min(0)
    x1, y1 = Ps.max(0)
    rows = np.arange(y0, y1 + s, s * 0.866)
    pts = []
    for r, y in enumerate(rows):
        off = 0.0 if r % 2 == 0 else s / 2
        xs = np.arange(x0 + off, x1 + s, s)
        pts.append(np.stack([xs, np.full_like(xs, y)], 1))
    L = np.concatenate(pts)
    L += rng.uniform(-0.25 * s, 0.25 * s, L.shape)
    tree = cKDTree(Ps)
    d, idx = tree.query(L)
    keep = d <= 0.6 * s + 2
    S = Ps[np.unique(idx[keep])].astype(np.float64)
    if len(S) > n:
        S = S[rng.choice(len(S), n, replace=False)]
    elif len(S) < n:
        extra = Ps[rng.choice(len(Ps), n - len(S), replace=False)].astype(np.float64)
        S = np.vstack([S, extra])
    return S


def lloyd(P, S, iters, rng, fixed=0):
    n = len(S)
    for _ in range(iters):
        _, lbl = cKDTree(S).query(P, workers=-1)
        cnt = np.bincount(lbl, minlength=n)
        cx = np.bincount(lbl, weights=P[:, 0], minlength=n)
        cy = np.bincount(lbl, weights=P[:, 1], minlength=n)
        ok = cnt > 0
        S2 = S.copy()
        S2[ok, 0] = cx[ok] / cnt[ok]
        S2[ok, 1] = cy[ok] / cnt[ok]
        if (~ok).any():
            S2[~ok] = P[rng.choice(len(P), int((~ok).sum()), replace=False)]
        S2[:fixed] = S[:fixed]                 # as primeiras `fixed` sementes (cidades) nao se mexem
        moved = float(np.abs(S2 - S).max())
        S = S2
        if moved < 0.05:
            break
    return S


def assign_balanced(Pw, S, tw=None, iters=45):
    """Atribui cada ponto a uma semente (diagrama de potencia): minimiza
    |p - s|^2 - w[s] e ajusta os pesos w ate cada celula ter o tamanho pedido
    (tw = tamanho relativo de cada semente; todas iguais se omitido).
    Da celulas de tamanho uniforme e bordas retas."""
    N, n = len(Pw), len(S)
    if n == 1:
        return np.zeros(N, np.int32)
    K = min(10, n)
    d, idx = cKDTree(S).query(Pw, k=K, workers=-1)
    d2 = (d * d).astype(np.float32)
    idx = idx.astype(np.int32)
    del d
    tw = np.ones(n) if tw is None else np.asarray(tw, float)
    target = N * tw / tw.sum()
    w = np.zeros(n)
    rows = np.arange(N)
    lbl = idx[:, 0]
    for _ in range(iters):
        cost = d2 - w.astype(np.float32)[idx]
        lbl = idx[rows, cost.argmin(axis=1)]
        err = target - np.bincount(lbl, minlength=n)      # > 0: a celula esta pequena
        if np.abs(err / target).max() <= 0.04:
            break
        w += 0.35 * err
    return lbl


def process_component(M0, cities, n_total, avg, rng):
    """Divide um componente (mascara M0) em n_total provincias de tamanho uniforme.
    As cidades sao celulas do MESMO diagrama das demais, so que menores (cerca de
    30% de uma provincia comum): assim ficam cercadas por varias provincias, como
    no HOI4, e nao viram "bolhas" soltas dentro de uma so.
    Devolve (rotulos, {rotulo: cidade})."""
    h, w = M0.shape
    lab = np.zeros((h, w), np.int32)
    info = {}
    ys, xs = np.nonzero(M0)
    N = len(ys)
    if N == 0:
        return lab, info
    if n_total <= 1 or N < 30:
        lab[M0] = 1
        return lab, info
    cs = []
    if n_total >= 4:
        for ct in cities:
            if len(cs) >= n_total - 3:
                break
            if M0[ct["li"], ct["lj"]]:
                cs.append(ct)
    n_reg = n_total - len(cs)
    tw = np.array([CAPITAL_AREA_FRAC if c["cap"] else CITY_AREA_FRAC for c in cs] + [1.0] * n_reg)
    P = np.stack([xs, ys], 1).astype(np.float64)
    step = 2 if N > 150000 else 1
    sel = ((xs % step) == 0) & ((ys % step) == 0)
    Ps = P[sel]
    if len(Ps) < n_total:
        Ps = P
    C = np.array([[c["lj"], c["li"]] for c in cs], np.float64).reshape(-1, 2)
    S = np.vstack([C, init_seeds(Ps, N, n_reg, rng)])
    S = lloyd(Ps, S, 25, rng, fixed=len(cs))
    spacing = math.sqrt(N / tw.sum())
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    nx = smooth_noise(y1 - y0, x1 - x0, 1.3 * spacing, rng)
    ny = smooth_noise(y1 - y0, x1 - x0, 1.3 * spacing, rng)
    Pw = P.copy()
    Pw[:, 0] += WARP * spacing * nx[ys - y0, xs - x0]
    Pw[:, 1] += WARP * spacing * ny[ys - y0, xs - x0]
    idx = assign_balanced(Pw, S, tw)
    lab[ys, xs] = idx + 1
    for k, c in enumerate(cs):
        info[k + 1] = c
    return lab, info


# --------------------------------------------------- grafo de provincias / ajustes
def edges(P, K):
    """Contato entre provincias vizinhas: (origem, destino, tamanho da fronteira)."""
    parts = []
    sea = np.zeros(K + 1, bool)
    for a, b in ((P[:, :-1], P[:, 1:]), (P[:-1, :], P[1:, :])):
        m = (a != b) & (a > 0) & (b > 0)
        aa, bb = a[m].astype(np.int64), b[m].astype(np.int64)
        parts.append(aa * (K + 1) + bb)
        parts.append(bb * (K + 1) + aa)
        m = (a > 0) & (b == 0)
        sea[np.unique(a[m])] = True
        m = (b > 0) & (a == 0)
        sea[np.unique(b[m])] = True
    u, c = np.unique(np.concatenate(parts), return_counts=True)
    return u // (K + 1), u % (K + 1), c, sea


def graph(P, K):
    src, dst, cnt, sea = edges(P, K)
    nb = [dict() for _ in range(K + 1)]
    for s, d, c in zip(src.tolist(), dst.tolist(), cnt.tolist()):
        nb[s][d] = c
    return nb, sea


def heal(P, ids, prov_owner):
    """Garante que cada provincia em `ids` seja conexa (pedacos soltos vao para o vizinho)."""
    for pid in ids:
        ys, xs = np.nonzero(P == pid)
        if len(ys) == 0:
            continue
        i0, i1, j0, j1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        sub = P[i0:i1, j0:j1]
        comp, nc = measure.label(sub == pid, connectivity=1, return_num=True)
        if nc < 2:
            continue
        sizes = np.bincount(comp.ravel(), minlength=nc + 1)
        big = int(sizes[1:].argmax()) + 1
        cross = ndimage.generate_binary_structure(2, 1)
        for c in range(1, nc + 1):
            if c == big:
                continue
            m = comp == c
            ring = ndimage.binary_dilation(m, structure=cross) & ~m
            neigh = sub[ring]
            neigh = neigh[(neigh > 0) & (neigh != pid)]
            neigh = np.array([x for x in neigh.tolist() if prov_owner[x] == prov_owner[pid]], int)
            if len(neigh):
                sub[m] = int(np.bincount(neigh).argmax())
            elif m.sum() < MIN_FRAGMENT_PX:
                sub[m] = 0


def split_province(P, pid, point, rng, prov_owner, prov_city, along=None):
    """Divide a provincia pid em duas por uma reta que passa por `point` (x, y).
    `along` (ux, uy) e a direcao da reta; sem ela, escolhe-se ao acaso."""
    ys, xs = np.nonzero(P == pid)
    if len(ys) < 2:
        return None
    if along is None:
        ang = rng.uniform(0, math.pi)
        along = (math.cos(ang), math.sin(ang))
    ux, uy = along
    side = ((xs - point[0]) * uy - (ys - point[1]) * ux) > 0
    if side.all() or (~side).all():
        return None
    new = len(prov_owner)
    prov_owner.append(prov_owner[pid])
    prov_city.append(None)
    P[ys[side], xs[side]] = new
    heal(P, [pid, new], prov_owner)
    return new


def fix_cities(P, prov_owner, prov_city, rng):
    """Toda cidade-provincia precisa tocar pelo menos DUAS outras provincias, e
    nenhuma vizinha pode ocupar mais de 75% da fronteira dela (senao a cidade
    estaria praticamente cercada por uma so). Nesses casos, a vizinha dominante
    e dividida por uma reta que passa pela cidade."""
    total = 0
    for _ in range(8):
        K = len(prov_owner) - 1
        nb, _ = graph(P, K)
        used = set()
        n = 0
        for cid in range(1, K + 1):
            if prov_city[cid] is None or not nb[cid]:
                continue
            tot = sum(nb[cid].values())
            if len(nb[cid]) >= 2 and max(nb[cid].values()) <= 0.75 * tot:
                continue
            N = max(nb[cid], key=nb[cid].get)
            if N in used or prov_city[N] is not None or prov_owner[N] != prov_owner[cid]:
                continue
            ys, xs = np.nonzero(P == cid)
            if len(ys) == 0:
                continue
            if split_province(P, N, (xs.mean(), ys.mean()), rng, prov_owner, prov_city):
                used.add(N)
                n += 1
        total += n
        if n == 0:
            break
    return total


def rebalance(P, prov_owner, prov_city, want, rng):
    """Ajusta o total de provincias de cada dono ao alvo: funde as menores
    (sem deixar nenhuma cidade com menos de 2 vizinhas) ou divide as maiores."""
    for _ in range(80):
        K = len(prov_owner) - 1
        areas = np.bincount(P.ravel(), minlength=K + 1)
        count = {k: 0 for k in want}
        for pid in range(1, K + 1):
            if areas[pid] > 0 and prov_owner[pid] in count:
                count[prov_owner[pid]] += 1
        diff = {k: count[k] - want[k] for k in want}
        if all(v == 0 for v in diff.values()):
            return True
        nb, _ = graph(P, K)
        used = set()
        for k, d in diff.items():
            cand = [p for p in range(1, K + 1)
                    if areas[p] > 0 and prov_owner[p] == k and prov_city[p] is None]
            if d > 0:
                cand.sort(key=lambda p: areas[p])
                left = d
                for a in cand:
                    if left == 0:
                        break
                    if a in used:
                        continue
                    opts = [(c, b) for b, c in nb[a].items()
                            if prov_owner[b] == k and prov_city[b] is None and b not in used]
                    if not opts:
                        continue
                    b = max(opts)[1]
                    ok = True
                    for c in nb[a]:
                        if prov_city[c] is not None:
                            new = (set(nb[c]) - {a}) | {b}
                            new.discard(c)
                            if len(new) < 2:
                                ok = False
                                break
                    if not ok:
                        continue
                    P[P == a] = b
                    used.update([a, b])
                    left -= 1
            elif d < 0:
                cand.sort(key=lambda p: -areas[p])
                left = -d
                for a in cand:
                    if left == 0:
                        break
                    if a in used:
                        continue
                    ys, xs = np.nonzero(P == a)
                    pts = np.stack([xs, ys], 1).astype(float)
                    c0 = pts.mean(0)
                    cov = np.cov((pts - c0).T)
                    w, v = np.linalg.eigh(cov)
                    ux, uy = v[:, 1]            # eixo principal; a reta corta ao meio
                    if split_province(P, a, c0, rng, prov_owner, prov_city, along=(-uy, ux)):
                        used.add(a)
                        left -= 1
    return False


# ----------------------------------------------------------------------- main
def main():
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True, help="pasta com os .geojson do Natural Earth")
    ap.add_argument("--out", default=os.path.join(here, "..", "client", "data", "map.json"))
    ap.add_argument("--targets", default=os.path.join(here, "province_targets.json"))
    args = ap.parse_args()

    with open(args.targets, encoding="utf-8") as f:
        cfg = json.load(f)
    targets = {k: int(v) for k, v in cfg["targets"].items() if v}
    equal = bool(cfg.get("equal_size"))

    def load(name):
        with open(os.path.join(args.src, name), encoding="utf-8") as f:
            return json.load(f)["features"]

    a1 = load("ne_10m_admin_1_states_provinces.geojson")
    a0 = load("ne_10m_admin_0_countries.geojson")
    places = load("ne_10m_populated_places_simple.geojson")
    rng = np.random.default_rng(SEED)

    # ---- estados administrativos (poligonos projetados)
    states = []

    def add_state(name, country, owner, geom):
        rings = process_geometry(geom, 0.004, 0.0004)
        if not rings:
            return
        states.append({
            "name": name, "country": country, "owner": owner,
            "_rings": rings, "_parea": sum(abs(ring_area(r)) for r in rings),
        })

    skipped_bg = []
    for ft in a1:
        p = ft["properties"]
        admin, name = p["admin"], (p.get("name") or p.get("name_en") or "?")
        if admin == "Republic of Serbia":
            if name not in BACKA:
                continue
        elif admin not in INTERACTIVE:
            continue
        if admin == "Russia":
            xs = [pt[0] for poly in polys_of(ft["geometry"]) for ring in poly for pt in ring]
            if max(xs) - min(xs) > 120:
                continue
            if name in RUSSIA_SKIP:
                skipped_bg.append(ft)
                continue
        country = "Serbia" if admin == "Republic of Serbia" else admin
        add_state(name, country, owner_of(admin, name), ft["geometry"])
    single = {"LVA": ("Letônia", "Latvia"), "MDA": ("Moldávia (Bessarábia)", "Moldova")}
    for ft in a0:
        code = ft["properties"]["ADM0_A3"]
        if code in single:
            nm, country = single[code]
            add_state(nm, country, "SOV", ft["geometry"])

    # ---- grade de trabalho
    x0, y0 = project(WEST, SOUTH)
    x1, y1 = project(EAST, NORTH)
    grid = Grid((x0, y0, x1, y1))
    H, W = grid.H, grid.W
    print(f"grade: {W}x{H} px, {len(states)} estados administrativos")
    while True:
        lab = rasterize_states(grid, states)
        clean_fragments(lab)
        present = np.bincount(lab.ravel(), minlength=len(states) + 1)
        gone = {i for i in range(len(states)) if present[i + 1] == 0}
        if not gone:
            break
        print("estados sem pixels (removidos):", [states[i]["name"] for i in gone])
        states = [s for i, s in enumerate(states) if i not in gone]
    owner_idx = {c: k for k, c in enumerate(PROVINCED, start=1)}
    st_owner = np.array([0] + [owner_idx.get(s["owner"], 0) for s in states], np.int8)
    ownr = st_owner[lab]                       # 0 = sem provincias, 1.. = dono
    row_km2 = np.repeat(grid.km2_row, W).reshape(H, W)

    # ---- cidades candidatas
    def snap(i, j, rad=10):
        if 0 <= i < H and 0 <= j < W and ownr[i, j] > 0:
            return i, j
        i0, i1 = max(i - rad, 0), min(i + rad + 1, H)
        j0, j1 = max(j - rad, 0), min(j + rad + 1, W)
        ys, xs = np.nonzero(ownr[i0:i1, j0:j1] > 0)
        if len(ys) == 0:
            return None
        d = (ys + i0 - i) ** 2 + (xs + j0 - j) ** 2
        k = int(d.argmin())
        return int(ys[k] + i0), int(xs[k] + j0)

    cand = []
    for nome, lon, lat, cap in CITIES_FORCED:
        i, j = grid.pixel(lon, lat)
        s = snap(i, j)
        if s:
            cand.append({"name": nome, "i": s[0], "j": s[1], "pop": 1e12, "cap": cap, "forced": True})
    for ft in places:
        p = ft["properties"]
        lon, lat = ft["geometry"]["coordinates"][:2]
        if not (WEST <= lon <= EAST and SOUTH <= lat <= NORTH) or (p.get("pop_max") or 0) < POP_MIN:
            continue
        i, j = grid.pixel(lon, lat)
        s = snap(i, j, rad=6)
        if s:
            nm = NOMES.get(p["name"]) or NOMES.get(p.get("nameascii") or "") or p["name"]
            cand.append({"name": nm, "i": s[0], "j": s[1], "pop": p["pop_max"], "cap": False, "forced": False})

    if equal and targets.get("GER"):
        # mesmo tamanho na tela para todos: totais calculados pela area (ignora o HOI4)
        px_all = {c: int((ownr == k).sum()) for k, c in enumerate(PROVINCED, start=1)}
        ref = px_all["GER"] / targets["GER"]
        targets = {c: (targets["GER"] if c == "GER" else max(1, int(round(px_all[c] / ref))))
                   for c in PROVINCED if px_all[c]}
        print("modo equal_size, totais pela area:", targets)

    # ---- provincias, dono por dono
    P = np.zeros((H, W), np.int32)
    prov_owner = [0]
    prov_city = [None]
    want = {}
    for code in PROVINCED:
        k = owner_idx[code]
        mask_o = ownr == k
        if not mask_o.any():
            continue
        T = targets.get(code)
        comps, nc = measure.label(mask_o, connectivity=1, return_num=True)
        sizes = np.bincount(comps.ravel(), minlength=nc + 1)
        px = int(sizes[1:].sum())
        if not T:
            T = max(1, int(round(float((row_km2 * mask_o).sum()) / 2500.0)))
        avg = px / T
        keep = [c for c in range(1, nc + 1) if sizes[c] >= max(120, 0.2 * avg)]
        avg = sum(int(sizes[c]) for c in keep) / T
        want[k] = T
        # cidades deste dono: forcadas primeiro, depois por populacao, com espacamento minimo
        mine = [c for c in cand if ownr[c["i"], c["j"]] == k]
        mine.sort(key=lambda c: (not c["forced"], -c["pop"]))
        cmax = max(2, int(round(CITY_MAX_SHARE * T)))
        dmin = CITY_SPACING * math.sqrt(avg)
        chosen = []
        for c in mine:
            if any((c["i"] - o["i"]) ** 2 + (c["j"] - o["j"]) ** 2 < dmin ** 2 for o in chosen):
                continue
            if not c["forced"] and len(chosen) >= cmax:
                continue
            chosen.append(c)
        alloc = largest_remainder([int(sizes[c]) for c in keep], T, 1)
        objs = ndimage.find_objects(comps)
        n_cities = 0
        for c, n in zip(keep, alloc):
            sl = objs[c - 1]
            M0 = comps[sl] == c
            local = []
            for ct in chosen:
                if comps[ct["i"], ct["j"]] == c:
                    d = dict(ct)
                    d["li"], d["lj"] = ct["i"] - sl[0].start, ct["j"] - sl[1].start
                    local.append(d)
            cl, info = process_component(M0, local, int(n), avg, rng)
            cl = fix_components(cl)
            ids = np.unique(cl[cl > 0])
            lut = np.zeros(int(cl.max()) + 1, np.int32)
            for v in ids.tolist():
                lut[v] = len(prov_owner)
                prov_owner.append(k)
                ct = info.get(v)
                prov_city.append(ct)
                n_cities += ct is not None
            sub = P[sl]
            m = cl > 0
            sub[m] = lut[cl[m]]
        km2_o = float((row_km2 * mask_o).sum())
        print(f"  {code}: alvo {T}, {km2_o:,.0f} km2 -> {km2_o / T:,.0f} km2 por provincia, cidades {n_cities}")
    print("provincias iniciais:", len(prov_owner) - 1)

    # ---- ajustes: cidades com 2+ vizinhas e totais exatos
    for rodada in range(5):
        s1 = fix_cities(P, prov_owner, prov_city, rng)
        ok = rebalance(P, prov_owner, prov_city, want, rng)
        s2 = fix_cities(P, prov_owner, prov_city, rng)
        print(f"  ajuste {rodada + 1}: divisoes para cidades {s1}+{s2}, totais ok={ok}")
        if ok and s2 == 0:
            break

    # ---- renumera as provincias (sem buracos)
    K0 = len(prov_owner) - 1
    ids = np.unique(P)
    ids = ids[ids > 0]
    lut = np.zeros(K0 + 1, np.int32)
    lut[ids] = np.arange(1, len(ids) + 1)
    P = lut[P]
    K = len(ids)
    owner_p = np.array([0] + [prov_owner[i] for i in ids.tolist()], np.int8)
    city_p = [None] + [prov_city[i] for i in ids.tolist()]
    nb, sea = graph(P, K)
    areas = np.bincount(P.ravel(), minlength=K + 1)
    km2_p = np.bincount(P.ravel(), weights=row_km2.ravel(), minlength=K + 1)
    few = [city_p[p]["name"] for p in range(1, K + 1) if city_p[p] is not None and len(nb[p]) < 2]
    encl = [p for p in range(1, K + 1) if len(nb[p]) == 1 and not sea[p]]
    print(f"cidades com menos de 2 vizinhas: {len(few)} {few[:8]}   enclaves (1 so vizinha, sem mar): {len(encl)}")
    cs_ = [p for p in range(1, K + 1) if city_p[p] is not None and nb[p]]
    dom = np.array([max(nb[p].values()) / sum(nb[p].values()) for p in cs_])
    print(f"cidades: {len(cs_)}; com 3+ vizinhas: {sum(len(nb[p]) >= 3 for p in cs_)}; "
          f"maior fatia da fronteira com uma so vizinha: media {dom.mean():.2f}, "
          f"acima de 75%: {(dom > 0.75).sum()}, acima de 90%: {(dom > 0.9).sum()}")

    # ---- estado de cada provincia: o estado administrativo que mais a cobre;
    # a cidade fica no estado em que ela esta
    S = len(states)
    pair = np.bincount(P.ravel().astype(np.int64) * (S + 1) + lab.ravel(), minlength=(K + 1) * (S + 1))
    pair = pair.reshape(K + 1, S + 1)
    pair[:, 0] = 0
    state_of = pair.argmax(axis=1)
    state_of[0] = 0
    objs_p = ndimage.find_objects(P)
    cityprov = [p for p in range(1, K + 1) if city_p[p] is not None]
    for p in cityprov:
        ct = city_p[p]
        ys, xs = np.nonzero(P[objs_p[p - 1]] == p)
        ys = ys + objs_p[p - 1][0].start
        xs = xs + objs_p[p - 1][1].start
        k = int(np.argmin((ys - ct["i"]) ** 2 + (xs - ct["j"]) ** 2))
        st = int(lab[ys[k], xs[k]])
        if st > 0:
            state_of[p] = st
    # cidades-estado minusculas (Berlim, Praga, Bucareste...): viram parte do vizinho
    noncity = np.array([q for q in range(1, K + 1) if city_p[q] is None])
    for _ in range(3):
        cnt = np.bincount(state_of[1:], minlength=S + 1)
        valid = np.bincount(state_of[noncity], minlength=S + 1) > 0   # estados que tem provincia comum
        for p in cityprov:
            st = int(state_of[p])
            if cnt[st] != 1:
                continue
            # 1) o estado que mais envolve a cidade (anel de 8 px ao redor dela)
            pad = 8
            sl = objs_p[p - 1]
            i0, i1 = max(sl[0].start - pad, 0), min(sl[0].stop + pad, H)
            j0, j1 = max(sl[1].start - pad, 0), min(sl[1].stop + pad, W)
            m = P[i0:i1, j0:j1] == p
            ring = ndimage.binary_dilation(m, iterations=pad) & ~m
            near = lab[i0:i1, j0:j1][ring]
            near = near[(near > 0) & (near != st)]
            near = near[valid[near] & (st_owner[near] == st_owner[st])]
            if len(near):
                state_of[p] = int(np.bincount(near).argmax())
                cnt[st] -= 1
                continue
            # 2) senao, o estado do vizinho com maior contato
            weight = {}
            for q, c in nb[p].items():
                if owner_p[q] == owner_p[p] and state_of[q] != st:
                    weight[int(state_of[q])] = weight.get(int(state_of[q]), 0) + c
            if weight:
                state_of[p] = max(weight, key=weight.get)
                cnt[st] -= 1
    used_states = sorted(set(state_of[1:].tolist()))
    new_idx = {s: i for i, s in enumerate(used_states)}
    st_lut = np.zeros(S + 1, np.int32)
    for s, i in new_idx.items():
        st_lut[s] = i + 1
    Sg = st_lut[state_of][P]                      # raster dos estados finais (1..)
    Og = owner_p.astype(np.int32)[P]              # raster dos donos

    # ---- exporta provincias
    out_provs = []
    for p in range(1, K + 1):
        sl = objs_p[p - 1]
        m = P[sl] == p
        rings = contours_of(m, grid, sl[0].start, sl[1].start, min_px=MIN_RING_PROV_PX)
        if not rings:
            rings = contours_of(m, grid, sl[0].start, sl[1].start, min_px=0.0)
        ys, xs = np.nonzero(m)
        lp = best_label_point(ys + sl[0].start, xs + sl[1].start, grid)
        item = {
            "s": int(new_idx[int(state_of[p])]),
            "r": pack(rings),
            "l": [round(float(lp[0]), 3), round(float(lp[1]), 3)],
            "a": sorted(int(q) - 1 for q in nb[p]),
        }
        ct = city_p[p]
        if ct is not None:
            item["c"] = ct["name"]
            if ct["cap"]:
                item["k"] = 1
        out_provs.append(item)

    # ---- exporta estados (uniao das provincias)
    objs_s = ndimage.find_objects(Sg)
    st_km2 = np.bincount(Sg.ravel(), weights=row_km2.ravel(), minlength=len(used_states) + 1)
    st_n = np.bincount(st_lut[state_of][1:], minlength=len(used_states) + 1)
    out_states = []
    for i, s_old in enumerate(used_states):
        sl = objs_s[i]
        m = Sg[sl] == i + 1
        rings = contours_of(m, grid, sl[0].start, sl[1].start, min_px=MIN_RING_PROV_PX)
        ys, xs = np.nonzero(m)
        lp = best_label_point(ys + sl[0].start, xs + sl[1].start, grid)
        src = states[s_old - 1]
        out_states.append({
            "id": i, "name": src["name"], "country": src["country"], "owner": src["owner"],
            "area": int(round(st_km2[i + 1])), "n": int(st_n[i + 1]),
            "label": [round(float(lp[0]), 2), round(float(lp[1]), 2)],
            "rings": pack(rings),
        })

    # ---- contorno de cada dono
    outlines = {}
    for k, code in enumerate(PROVINCED, start=1):
        objs_o = ndimage.find_objects((Og == k).astype(np.int8))
        if not objs_o or objs_o[0] is None:
            continue
        sl = objs_o[0]
        outlines[code] = pack(contours_of(Og[sl] == k, grid, sl[0].start, sl[1].start))

    # ---- fundo: paises inteiros (contexto) e regioes russas fora do recorte
    background = []
    for ft in a0:
        p = ft["properties"]
        code = p["ADM0_A3"]
        if code == "RUS":
            continue
        rings = process_geometry(ft["geometry"], TOL_BG, MIN_AREA_BG)
        if not rings:
            continue
        background.append({
            "code": code, "name": p.get("NAME_EN") or p.get("NAME"),
            "owner": BG_CLASS.get(code, "NEU"), "inter": code in INTER_A3, "rings": pack(rings),
        })
    for ft in skipped_bg:
        rings = process_geometry(ft["geometry"], TOL_BG, MIN_AREA_BG)
        if rings:
            background.append({
                "code": "RUS", "name": ft["properties"].get("name") or "Rússia (Ásia)",
                "owner": "OUT", "inter": False, "rings": pack(rings),
            })

    counts = {c: int(((owner_p == k)[1:]).sum()) for k, c in enumerate(PROVINCED, start=1)}
    data = {
        "meta": {
            "title": "Frente Oriental - início da Operação Barbarossa",
            "date": DATE,
            "projection": "equirectangular",
            "scale": SC,
            "bounds": [round(x0, 2), round(y0, 2), round(x1, 2), round(y1, 2)],
            "window": [WEST, EAST, SOUTH, NORTH],
            "source": "Natural Earth (dominio publico)",
            "targets": targets,
            "counts": counts,
        },
        "owners": OWNERS,
        "states": out_states,
        "provinces": out_provs,
        "outlines": outlines,
        "background": background,
    }
    out = os.path.abspath(args.out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))

    # ---- resumo
    print("\ndono   alvo  provs  cidades  km2/prov(media)  variacao(desv/media)")
    for k, code in enumerate(PROVINCED, start=1):
        sel = [p for p in range(1, K + 1) if owner_p[p] == k and city_p[p] is None]
        nc_ = sum(1 for p in range(1, K + 1) if owner_p[p] == k and city_p[p] is not None)
        a = np.array([areas[p] for p in sel], float)
        kk = np.array([km2_p[p] for p in sel], float)
        print(f"{code:5s} {targets.get(code, 0):5d} {counts[code]:6d} {nc_:8d} {kk.mean():15.0f} "
              f"{a.std() / a.mean():21.2f}")
    print(f"estados: {len(out_states)}   provincias: {K}   arquivo: {out}  {round(os.path.getsize(out) / 1024)} KB")


if __name__ == "__main__":
    main()
