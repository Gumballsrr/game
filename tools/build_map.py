#!/usr/bin/env python3
"""
Gera client/data/map.json a partir do Natural Earth (dominio publico).

Uso:
    python3 tools/build_map.py --src /caminho/para/natural-earth-vector/geojson

Arquivos necessarios na pasta --src:
    ne_10m_admin_1_states_provinces.geojson
    ne_10m_admin_0_countries.geojson

Nao depende de bibliotecas externas (so a biblioteca padrao do Python).

O que o script faz:
  1. Recorta a regiao do mapa (Alemanha ate os Urais).
  2. Atribui cada regiao ao dono em junho de 1941 (regras em owner_of()).
  3. Projeta em Mercator (parecido com o mapa de Hearts of Iron IV).
  4. Simplifica a geometria e grava um JSON compacto.

As regioes sao as divisoes administrativas ATUAIS dos paises. As fronteiras de
1941 sao aproximadas: regioes inteiras mudam de dono, sem dividi-las.
"""
import argparse
import json
import math
import os

# Janela do mapa (graus). Oeste = Alemanha, leste = Urais.
WEST, EAST, SOUTH, NORTH = 5.0, 60.0, 40.0, 71.5

TOL_STATE = 0.012       # tolerancia da simplificacao (unidades projetadas)
TOL_BG = 0.04
MIN_AREA_STATE = 0.001  # descarta aneis menores que isso
MIN_AREA_BG = 0.004

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


def _dp_open(pts, tol):
    n = len(pts)
    if n <= 2:
        return pts
    keep = [False] * n
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    tol2 = tol * tol
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        x1, y1 = pts[i]
        x2, y2 = pts[j]
        dx, dy = x2 - x1, y2 - y1
        d2 = dx * dx + dy * dy
        best, bi = -1.0, -1
        for k in range(i + 1, j):
            px, py = pts[k]
            if d2 == 0:
                dist2 = (px - x1) ** 2 + (py - y1) ** 2
            else:
                t = ((px - x1) * dx + (py - y1) * dy) / d2
                t = max(0.0, min(1.0, t))
                dist2 = (px - (x1 + t * dx)) ** 2 + (py - (y1 + t * dy)) ** 2
            if dist2 > best:
                best, bi = dist2, k
        if best > tol2:
            keep[bi] = True
            stack.append((i, bi))
            stack.append((bi, j))
    return [p for p, k in zip(pts, keep) if k]


def simplify_ring(pts, tol):
    if len(pts) <= 4:
        return pts
    # divide o anel no ponto mais distante do primeiro e simplifica as duas metades
    x0, y0 = pts[0]
    k = max(range(len(pts)), key=lambda i: (pts[i][0] - x0) ** 2 + (pts[i][1] - y0) ** 2)
    a = _dp_open(pts[: k + 1], tol)
    b = _dp_open(pts[k:] + [pts[0]], tol)
    out = a[:-1] + b[:-1]
    return out if len(out) >= 3 else pts[:3]


def polys_of(geom):
    if geom["type"] == "Polygon":
        return [geom["coordinates"]]
    if geom["type"] == "MultiPolygon":
        return geom["coordinates"]
    return []


def bbox_of_rings(rings):
    xs = [p[0] for r in rings for p in r]
    ys = [p[1] for r in rings for p in r]
    return min(xs), min(ys), max(xs), max(ys)


def process_geometry(geom, tol, min_area):
    """Recorta, projeta e simplifica. Devolve lista de aneis (listas de (x, y))
    e o ponto de rotulo, ou (None, None) se nada sobrou na janela."""
    bounds = (WEST, SOUTH, EAST, NORTH)
    out_rings = []
    for poly in polys_of(geom):
        for ring in poly:
            xs = [p[0] for p in ring]
            ys = [p[1] for p in ring]
            if max(xs) < WEST or min(xs) > EAST or max(ys) < SOUTH or min(ys) > NORTH:
                continue
            clipped = clip_ring(ring, bounds)
            if not clipped:
                continue
            proj = [merc(x, y) for x, y in clipped]
            if abs(ring_area(proj)) < min_area:
                continue
            proj = simplify_ring(proj, tol)
            if abs(ring_area(proj)) < min_area:
                continue
            out_rings.append(proj)
    if not out_rings:
        return None, None
    biggest = max(out_rings, key=lambda r: abs(ring_area(r)))
    lx, ly = ring_centroid(biggest)
    return out_rings, (lx, ly)


def pack(rings):
    """Aneis -> listas planas de inteiros (coordenada * 100)."""
    flat = []
    for r in rings:
        arr = []
        for x, y in r:
            arr.append(int(round(x * 100)))
            arr.append(int(round(y * 100)))
        flat.append(arr)
    return flat


# ----------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True, help="pasta com os .geojson do Natural Earth")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "client", "data", "map.json"))
    args = ap.parse_args()

    with open(os.path.join(args.src, "ne_10m_admin_1_states_provinces.geojson"), encoding="utf-8") as f:
        a1 = json.load(f)["features"]
    with open(os.path.join(args.src, "ne_10m_admin_0_countries.geojson"), encoding="utf-8") as f:
        a0 = json.load(f)["features"]

    states = []

    def add_state(name, country, owner, geom, area, minor=False):
        rings, label = process_geometry(geom, TOL_STATE, MIN_AREA_STATE)
        if not rings:
            return
        states.append({
            "id": len(states),
            "name": name,
            "country": country,
            "owner": owner,
            "area": int(area or 0),
            "minor": minor,
            "label": [round(label[0], 2), round(label[1], 2)],
            "rings": pack(rings),
        })

    # --- estados (divisoes administrativas)
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

    # --- paises pequenos com muitas subdivisoes: um estado so (Natural Earth admin-0)
    single = {"LVA": ("Letônia", "Latvia"), "MDA": ("Moldávia (Bessarábia)", "Moldova")}
    for ft in a0:
        code = ft["properties"]["ADM0_A3"]
        if code in single:
            nm, country = single[code]
            add_state(nm, country, "SOV", ft["geometry"], 0)

    # --- fundo: paises inteiros (contexto)
    background = []
    for ft in a0:
        p = ft["properties"]
        code = p["ADM0_A3"]
        rings, _ = process_geometry(ft["geometry"], TOL_BG, MIN_AREA_BG)
        if not rings:
            continue
        background.append({
            "code": code,
            "name": p.get("NAME_EN") or p.get("NAME"),
            "owner": BG_CLASS.get(code, "NEU"),
            "rings": pack(rings),
        })

    cities = []
    for nm, lon, lat, owner, cap in CITIES:
        x, y = merc(lon, lat)
        cities.append({"name": nm, "x": round(x, 2), "y": round(y, 2), "owner": owner, "capital": cap})

    x0, y0 = merc(WEST, SOUTH)
    x1, y1 = merc(EAST, NORTH)
    data = {
        "meta": {
            "title": "Frente Oriental - junho de 1941",
            "date": "1941-06-21",
            "projection": "mercator",
            "scale": 100,                       # coordenadas = inteiro / 100
            "bounds": [round(x0, 2), round(y0, 2), round(x1, 2), round(y1, 2)],
            "source": "Natural Earth (dominio publico)",
        },
        "owners": OWNERS,
        "states": states,
        "background": background,
        "cities": cities,
    }

    out = os.path.abspath(args.out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))

    counts = {}
    for s in states:
        counts[s["owner"]] = counts.get(s["owner"], 0) + 1
    print("estados:", len(states), counts)
    print("fundo:", len(background), "paises | cidades:", len(cities))
    print("arquivo:", out, round(os.path.getsize(out) / 1024), "KB")


if __name__ == "__main__":
    main()
