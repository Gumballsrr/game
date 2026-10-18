#!/usr/bin/env python3
"""
Gera client/data/map.json a partir do Natural Earth (dominio publico).

Uso:
    python3 tools/build_map.py --src /caminho/para/natural-earth-vector/geojson

Arquivos necessarios na pasta --src:
    ne_10m_admin_1_states_provinces.geojson
    ne_10m_admin_0_countries.geojson

Dependencias: numpy, scipy, scikit-image e opencv-python.

O que o script faz:
  1. Recorta a regiao do mapa (Alemanha ate os Urais).
  2. Atribui cada regiao ("estado") ao dono em 22/06/1941 (regras em owner_of()).
  3. Projeta em Mercator (parecido com o mapa de Hearts of Iron IV).
  4. Divide cada estado em PROVINCIAS pequenas e compactas, sem nunca cruzar a
     fronteira do estado (como no HOI4). A quantidade de provincias por dono vem
     de tools/province_targets.json.
  5. Grava um JSON compacto.

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
from scipy.cluster.vq import kmeans2
from scipy.spatial import cKDTree
from skimage import measure

# Janela do mapa (graus). Oeste = Alemanha, leste = Urais.
WEST, EAST, SOUTH, NORTH = 5.0, 60.0, 40.0, 71.5
DATE = "1941-06-22"      # inicio da Operacao Barbarossa

SC = 200                 # coordenadas gravadas = inteiro / SC (unidades projetadas)
R = 40                   # pixels por unidade projetada na grade de trabalho
TOL_PX = 0.3             # simplificacao dos contornos de provincias (em pixels)
TOL_BG = 0.04
MIN_AREA_BG = 0.004
MIN_RING_PX = 3.0        # descarta aneis menores que isso (em pixels quadrados)
MIN_RING_PROV_PX = 10.0   # idem, para provincias (ilhotas minusculas nao viram provincia)
MIN_FRAGMENT_PX = 20      # fragmentos de estado menores que isso sao anexados ao vizinho
KM_PER_UNIT = 111.32     # km por grau no equador
SEED = 1941

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
}

TRANSILVANIA_NORTE = {  # Segunda Arbitragem de Viena (agosto de 1940)
    "Satu Mare", "Maramures", "Salaj", "Cluj", "Bistrita-Nasaud",
    "Mures", "Harghita", "Covasna", "Bihor",
}
BACKA = {"Severno-Backi", "Zapadno-Backi", "Južno-Backi"}  # ocupada pela Hungria em 1941
ESLOVAQUIA_SUL = {"Košický", "Nitriansky"}                  # Primeira Arbitragem de Viena

# Paises cujas regioes (admin-1) viram "estados" clicaveis do jogo.
INTERACTIVE = {
    "Germany", "Austria", "Czech Republic", "Poland", "Slovakia", "Hungary",
    "Romania", "Finland", "Estonia", "Lithuania", "Belarus", "Ukraine", "Russia",
}
# Codigos ISO dos paises que tem provincias (o fundo nao traca borda neles).
INTER_A3 = {"DEU", "AUT", "CZE", "POL", "SVK", "HUN", "ROU", "FIN", "EST", "LTU",
            "BLR", "UKR", "RUS", "LVA", "MDA"}
# Regioes russas fora da area de interesse (ou que so tocam a borda da janela).
RUSSIA_SKIP = {"Chukchi Autonomous Okrug", "Kurgan", "Khanty-Mansiy"}


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
    if admin in ("Estonia", "Belarus"):
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
for _c in "RUS UKR BLR MDA EST LVA LTU GEO ARM AZE KAZ UZB TKM KGZ TJK".split():
    BG_CLASS[_c] = "SOV"
BG_CLASS.update({"HUN": "HUN", "ROU": "ROM", "FIN": "FIN"})
for _c in "ITA BGR SVK HRV ALB".split():
    BG_CLASS[_c] = "AXM"
for _c in "DNK NOR NLD BEL FRA GRC SRB SVN BIH MNE MKD KOS".split():
    BG_CLASS[_c] = "OCC"

# (nome, lon, lat, dono, capital?)  - nomes como em 1941
CITIES = [
    ("Berlim", 13.405, 52.52, "GER", True),
    ("Moscou", 37.62, 55.755, "SOV", True),
    ("Bucareste", 26.10, 44.43, "ROM", True),
    ("Helsinque", 24.94, 60.17, "FIN", True),
    ("Budapeste", 19.04, 47.50, "HUN", True),
    ("Varsóvia", 21.01, 52.23, "GER", False),
    ("Viena", 16.37, 48.21, "GER", False),
    ("Praga", 14.42, 50.09, "GER", False),
    ("Königsberg", 20.51, 54.71, "GER", False),
    ("Bratislava", 17.11, 48.15, "AXM", False),
    ("Kiev", 30.52, 50.45, "SOV", False),
    ("Minsk", 27.56, 53.90, "SOV", False),
    ("Leningrado", 30.32, 59.93, "SOV", False),
    ("Riga", 24.11, 56.95, "SOV", False),
    ("Tallinn", 24.75, 59.44, "SOV", False),
    ("Vilnius", 25.28, 54.69, "SOV", False),
    ("Kishinev", 28.86, 47.01, "SOV", False),
    ("Odessa", 30.73, 46.48, "SOV", False),
    ("Sebastopol", 33.53, 44.62, "SOV", False),
    ("Carcóvia", 36.23, 49.99, "SOV", False),
    ("Rostov", 39.72, 47.23, "SOV", False),
    ("Stalingrado", 44.52, 48.71, "SOV", False),
    ("Smolensk", 32.04, 54.78, "SOV", False),
    ("Murmansk", 33.08, 68.97, "SOV", False),
    ("Arcangel", 40.54, 64.54, "SOV", False),
    ("Lvov", 24.03, 49.84, "SOV", False),
    ("Oulu", 25.47, 65.01, "FIN", False),
    ("Ploiești", 26.03, 44.94, "ROM", False),
    ("Constança", 28.65, 44.18, "ROM", False),
]


# ------------------------------------------------------------------ geometria
def merc(lon, lat):
    y = math.degrees(math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)))
    return lon, y


def unmerc_lat(y):
    """Inverso do Mercator (aceita numpy): y (graus) -> latitude (graus)."""
    return np.degrees(2 * np.arctan(np.exp(np.radians(y))) - np.pi / 2)


def ring_area(pts):
    a = 0.0
    n = len(pts)
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        a += x1 * y2 - x2 * y1
    return a / 2.0


def ring_centroid(pts):
    a = ring_area(pts)
    if abs(a) < 1e-12:
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        return sum(xs) / len(xs), sum(ys) / len(ys)
    cx = cy = 0.0
    n = len(pts)
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        f = x1 * y2 - x2 * y1
        cx += (x1 + x2) * f
        cy += (y1 + y2) * f
    return cx / (6 * a), cy / (6 * a)


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
    """Simplifica um anel (lista de (x, y) ou ndarray) preservando a forma fechada."""
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
            proj = np.array([merc(x, y) for x, y in clipped])
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


# -------------------------------------------------------------- grade / provincias
class Grid:
    def __init__(self, bounds):
        self.x0, self.y0, self.x1, self.y1 = bounds
        self.W = int(math.ceil((self.x1 - self.x0) * R))
        self.H = int(math.ceil((self.y1 - self.y0) * R))
        rows = np.arange(self.H)
        lat = unmerc_lat(self.y1 - (rows + 0.5) / R)
        # km2 por pixel em cada linha (Mercator estica a area por 1/cos^2)
        self.km2_row = (KM_PER_UNIT / R) ** 2 * np.cos(np.radians(lat)) ** 2

    def to_cv(self, ring):
        """Mundo -> coordenadas do OpenCV (centro do pixel (j, i) = (j, i)), com shift=4."""
        u = (ring[:, 0] - self.x0) * R - 0.5
        v = (self.y1 - ring[:, 1]) * R - 0.5
        return np.round(np.stack([u, v], axis=1) * 16).astype(np.int32)

    def to_world(self, rc, i0=0, j0=0):
        """Contorno (linha, coluna) em pixels -> mundo."""
        x = self.x0 + (rc[:, 1] + j0 + 0.5) / R
        y = self.y1 - (rc[:, 0] + i0 + 0.5) / R
        return np.stack([x, y], axis=1)


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


def clean_fragments(lab, n_states):
    """Pedacinhos de um estado (sobras da rasterizacao entre vizinhos) sao
    anexados ao estado vizinho; ilhotas isoladas e minusculas sao apagadas."""
    objs = ndimage.find_objects(lab)  # um slice por estado (rotulo = indice + 1)
    cross = ndimage.generate_binary_structure(2, 1)
    moved = 0
    for k, sl in enumerate(objs, start=1):
        if sl is None:
            continue
        sub = lab[sl]
        m = sub == k
        comp, nc = measure.label(m, connectivity=1, return_num=True)
        if nc < 2:
            if nc == 1 and m.sum() >= MIN_FRAGMENT_PX:
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


def split_state(pix, n, rng):
    """pix: (N, 2) coordenadas (col, lin) dos pixels. Devolve rotulos 0..n-1 (compactos)."""
    N = len(pix)
    if n <= 1 or N == 0:
        return np.zeros(N, int)
    n = min(n, N)
    sample = pix if N <= 50000 else pix[:: int(math.ceil(N / 50000))]
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        cent, _ = kmeans2(sample.astype(float), n, iter=15, minit="++", seed=rng, missing="warn")
    cent = cent[~np.isnan(cent).any(axis=1)]
    _, lbl = cKDTree(cent).query(pix)
    return lbl


def fix_components(cl):
    """Cada provincia deve ser uma regiao conexa: pedacos soltos sao anexados ao
    vizinho de maior contato (ou viram provincia propria, se forem ilhas)."""
    comp, ncomp = measure.label(cl, background=0, connectivity=1, return_num=True)
    if ncomp == 0:
        return cl
    sizes = np.bincount(comp.ravel(), minlength=ncomp + 1)
    # valor de cluster de cada componente
    objs = ndimage.find_objects(comp)
    vals = {}
    for c, sl in enumerate(objs, start=1):
        if sl is None:
            continue
        m = comp[sl] == c
        vals[c] = int(cl[sl][m][0])
    by_val = {}
    for c, v in vals.items():
        by_val.setdefault(v, []).append(c)
    next_label = int(cl.max()) + 1
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
            ring = ndimage.binary_dilation(m, structure=ndimage.generate_binary_structure(2, 1)) & ~m
            neigh = cl[i0:i1, j0:j1][ring]
            neigh = neigh[(neigh != 0) & (neigh != v)]
            if len(neigh):
                tgt = int(np.bincount(neigh).argmax())
            elif m.sum() < MIN_FRAGMENT_PX:
                tgt = 0                      # ilhota minuscula: descarta
            else:
                tgt = next_label
                next_label += 1
            sub = cl[i0:i1, j0:j1]
            sub[m] = tgt
    return cl


def contours_of(mask, grid, i0, j0, tol_px=TOL_PX, min_px=MIN_RING_PX):
    """Contornos (aneis em coordenadas do mundo) de uma mascara booleana."""
    padded = np.pad(mask.astype(np.uint8), 1)
    cs = measure.find_contours(padded, 0.5)
    out = []
    for c in cs:
        if len(c) < 4:
            continue
        c = c - 1.0  # remove o preenchimento
        w = grid.to_world(c, i0, j0)
        s = simplify_ring(w, tol_px / R)
        if len(s) >= 3 and abs(ring_area(s)) * R * R >= min_px:
            out.append(s)
    return out


def best_label_point(ys, xs, grid, i0, j0):
    """Pixel da regiao mais proximo do centroide (garante ponto dentro da regiao)."""
    cy, cx = ys.mean(), xs.mean()
    k = int(np.argmin((ys - cy) ** 2 + (xs - cx) ** 2))
    return grid.to_world(np.array([[ys[k], xs[k]]], float), i0, j0)[0]


def build_provinces(states, lab, grid, ns, verbose=False):
    """Divide cada estado em ns[i] provincias. Devolve (provincias, indices por estado)."""
    rng = np.random.default_rng(SEED)
    provinces = []
    prov_of_state = [[] for _ in states]
    for si, s in enumerate(states):
        ys, xs = np.nonzero(lab == (si + 1))
        if len(ys) == 0:
            continue
        i0, i1, j0, j1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        pix = np.stack([xs - j0, ys - i0], axis=1).astype(float)
        lbl = split_state(pix, ns[si], rng) + 1
        cl = np.zeros((i1 - i0, j1 - j0), np.int32)
        cl[ys - i0, xs - j0] = lbl
        cl = fix_components(cl)
        for v in np.unique(cl[cl > 0]):
            m = cl == v
            pys, pxs = np.nonzero(m)
            if len(pys) == 0:
                continue
            ri0, ri1, rj0, rj1 = pys.min(), pys.max() + 1, pxs.min(), pxs.max() + 1
            rings = contours_of(m[ri0:ri1, rj0:rj1], grid, i0 + ri0, j0 + rj0, min_px=MIN_RING_PROV_PX)
            if not rings:
                continue
            lp = best_label_point(pys.astype(float), pxs.astype(float), grid, i0, j0)
            provinces.append({
                "s": si,
                "r": pack(rings),
                "l": [round(float(lp[0]), 3), round(float(lp[1]), 3)],
            })
            prov_of_state[si].append(len(provinces) - 1)
        if verbose and (si + 1) % 100 == 0:
            print(f"  estados processados: {si + 1}/{len(states)}  provincias: {len(provinces)}")
    return provinces, prov_of_state


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
    density = float(cfg.get("density_km2_per_province", 2500))
    targets = {k: v for k, v in cfg.get("targets", {}).items() if v}

    with open(os.path.join(args.src, "ne_10m_admin_1_states_provinces.geojson"), encoding="utf-8") as f:
        a1 = json.load(f)["features"]
    with open(os.path.join(args.src, "ne_10m_admin_0_countries.geojson"), encoding="utf-8") as f:
        a0 = json.load(f)["features"]

    # ---- estados (poligonos em coordenadas projetadas, ainda sem provincias)
    states = []

    def add_state(name, country, owner, geom, area, minor=False):
        rings = process_geometry(geom, 0.004, 0.0004)
        if not rings:
            return
        states.append({
            "name": name, "country": country, "owner": owner,
            "area": int(area or 0), "minor": minor,
            "_rings": rings,
            "_parea": sum(abs(ring_area(r)) for r in rings),
        })

    for ft in a1:
        p = ft["properties"]
        admin, name = p["admin"], (p.get("name") or p.get("name_en") or "?")
        if admin == "Republic of Serbia":
            if name not in BACKA:
                continue
        elif admin not in INTERACTIVE:
            continue
        if admin == "Russia":
            if name in RUSSIA_SKIP:
                continue
            xs = [pt[0] for poly in polys_of(ft["geometry"]) for ring in poly for pt in ring]
            if max(xs) - min(xs) > 120:
                continue
        minor = (admin == "Hungary" and p.get("type_en") == "Urban county")
        country = "Serbia" if admin == "Republic of Serbia" else admin
        add_state(name, country, owner_of(admin, name), ft["geometry"], p.get("area_sqkm"), minor)

    single = {"LVA": ("Letônia", "Latvia"), "MDA": ("Moldávia (Bessarábia)", "Moldova")}
    for ft in a0:
        code = ft["properties"]["ADM0_A3"]
        if code in single:
            nm, country = single[code]
            add_state(nm, country, "SOV", ft["geometry"], 0)

    # ---- grade de trabalho
    x0, y0 = merc(WEST, SOUTH)
    x1, y1 = merc(EAST, NORTH)
    grid = Grid((x0, y0, x1, y1))
    print(f"grade: {grid.W}x{grid.H} px")
    row_idx = np.repeat(np.arange(grid.H), grid.W)
    while True:
        lab = rasterize_states(grid, states)
        print("fragmentos limpos:", clean_fragments(lab, len(states)))
        present = np.bincount(lab.ravel(), minlength=len(states) + 1)
        gone = [i for i, s in enumerate(states) if present[i + 1] == 0]
        if not gone:
            break
        print("estados sem pixels (removidos):", [states[i]["name"] for i in gone])
        states = [s for i, s in enumerate(states) if i not in set(gone)]

    # area real (km2) de cada estado, a partir dos pixels
    km2 = np.bincount(lab.ravel(), weights=grid.km2_row[row_idx], minlength=len(states) + 1)
    for i, s in enumerate(states):
        s["_km2"] = float(km2[i + 1])
        s["_px"] = int(present[i + 1])

    # ---- quantas provincias por dono (config) ou por densidade
    owners_present = sorted({s["owner"] for s in states})
    eff = {}
    for o in owners_present:
        mine = [s for s in states if s["owner"] == o]
        if o in targets:
            eff[o] = int(targets[o])
        else:
            eff[o] = max(len(mine), int(round(sum(s["_km2"] for s in mine) / density)))
    # reparte entre os estados do dono, proporcionalmente a area na tela
    for o in owners_present:
        idxs = [i for i, s in enumerate(states) if s["owner"] == o]
        alloc = largest_remainder([states[i]["_px"] for i in idxs], eff[o])
        for i, n in zip(idxs, alloc):
            states[i]["_n"] = int(n)

    # ---- divide cada estado em provincias. A divisao pode gerar provincias extras
    # (ilhas soltas viram provincia propria); a 2a passada compensa isso para o
    # total de cada dono ficar o mais proximo possivel do alvo.
    ns = [s["_n"] for s in states]
    for passo in (1, 2, 3):
        provinces, prov_of_state = build_provinces(states, lab, grid, ns, verbose=(passo == 1))
        extra = [len(prov_of_state[i]) - ns[i] for i in range(len(states))]
        wanted = {o: eff[o] for o in owners_present}
        got = {o: sum(len(prov_of_state[i]) for i, s in enumerate(states) if s["owner"] == o) for o in owners_present}
        print(f"passo {passo}:", {o: f"{got[o]}/{wanted[o]}" for o in owners_present})
        if all(got[o] == wanted[o] for o in owners_present):
            break
        changed = False
        for o in owners_present:
            diff = got[o] - wanted[o]
            if diff == 0:
                continue
            mine = [i for i, s in enumerate(states) if s["owner"] == o]
            if diff > 0:   # sobrou: tira onde houve mais extras, depois nos maiores
                order = sorted(mine, key=lambda i: (-extra[i], -states[i]["_px"]))
                step = -1
            else:          # faltou: poe nos maiores, em rodizio
                order = sorted(mine, key=lambda i: -states[i]["_px"])
                step = 1
            guard = 0
            while diff != 0 and guard < 10 * len(order):
                for i in order:
                    if diff == 0:
                        break
                    if step < 0 and ns[i] <= 1:
                        continue
                    ns[i] += step
                    diff -= 1 if step < 0 else -1
                    changed = True
                guard += 1
        if not changed:
            break

    # ---- contornos dos estados e dos donos (alinhados com as provincias)
    out_states = []
    for si, s in enumerate(states):
        m = lab == (si + 1)
        ys, xs = np.nonzero(m)
        if len(ys) == 0:
            continue
        i0, i1, j0, j1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        rings = contours_of(m[i0:i1, j0:j1], grid, i0, j0, tol_px=0.2)
        if not rings:
            continue
        big = max(rings, key=lambda r: abs(ring_area(r)))
        lx, ly = best_label_point(ys.astype(float), xs.astype(float), grid, 0, 0)
        out_states.append({
            "id": si, "name": s["name"], "country": s["country"], "owner": s["owner"],
            "area": int(round(s["_km2"])), "minor": s["minor"],
            "label": [round(float(lx), 2), round(float(ly), 2)],
            "n": len(prov_of_state[si]),
            "rings": pack(rings),
        })
    assert [s["id"] for s in out_states] == list(range(len(out_states))), "estado sem pixels"

    owner_of_state = np.array([0] + [list(OWNERS).index(s["owner"]) + 1 for s in states])
    own_lab = owner_of_state[lab]
    outlines = {}
    for k, code in enumerate(OWNERS, start=1):
        m = own_lab == k
        if not m.any():
            continue
        ys, xs = np.nonzero(m)
        i0, i1, j0, j1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        outlines[code] = pack(contours_of(m[i0:i1, j0:j1], grid, i0, j0, tol_px=0.25))

    # ---- fundo: paises inteiros (contexto)
    background = []
    for ft in a0:
        p = ft["properties"]
        code = p["ADM0_A3"]
        rings = process_geometry(ft["geometry"], TOL_BG, MIN_AREA_BG)
        if not rings:
            continue
        background.append({
            "code": code,
            "name": p.get("NAME_EN") or p.get("NAME"),
            "owner": BG_CLASS.get(code, "NEU"),
            "inter": code in INTER_A3,
            "rings": pack(rings),
        })

    cities = []
    for nm, lon, lat, owner, cap in CITIES:
        x, y = merc(lon, lat)
        cities.append({"name": nm, "x": round(x, 2), "y": round(y, 2), "owner": owner, "capital": cap})

    data = {
        "meta": {
            "title": "Frente Oriental - início da Operação Barbarossa",
            "date": DATE,
            "projection": "mercator",
            "scale": SC,
            "bounds": [round(x0, 2), round(y0, 2), round(x1, 2), round(y1, 2)],
            "source": "Natural Earth (dominio publico)",
            "density_km2_per_province": density,
        },
        "owners": OWNERS,
        "states": out_states,
        "provinces": provinces,
        "outlines": outlines,
        "background": background,
        "cities": cities,
    }

    out = os.path.abspath(args.out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))

    print("\nowner  estados  area(km2)   alvo  provincias  km2/prov")
    tot = 0
    for o in owners_present:
        sts = [i for i, s in enumerate(states) if s["owner"] == o]
        pc = sum(len(prov_of_state[i]) for i in sts)
        area = sum(states[i]["_km2"] for i in sts)
        tot += pc
        origem = "config" if o in targets else "densidade"
        print(f"{o:5s} {len(sts):8d} {area:10.0f} {eff[o]:6d} {pc:10d} {area / max(pc, 1):9.0f}  ({origem})")
    print(f"total de provincias: {tot}")
    print("arquivo:", out, round(os.path.getsize(out) / 1024), "KB")


if __name__ == "__main__":
    main()
