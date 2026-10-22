#!/usr/bin/env python3
"""
Verifica client/data/map.json (so biblioteca padrao do Python).

Uso:
    python3 tools/check_map.py [caminho/para/map.json]

Confere:
  - total de provincias de cada dono contra o alvo (HOI4);
  - tamanho das provincias comuns: media por dono, variacao dentro do dono e
    tamanho relativo a Alemanha (na tela, como o jogador ve);
  - toda cidade tem pelo menos 2 provincias vizinhas (nenhuma e cercada por uma so);
  - o grafo de vizinhanca e simetrico e sem indices invalidos.
Sai com codigo 1 se algo essencial falhar.
"""
import json
import os
import sys
from collections import defaultdict


def decode(flat, sc):
    pts, x, y = [], 0, 0
    for i in range(0, len(flat), 2):
        if i == 0:
            x, y = flat[0], flat[1]
        else:
            x += flat[i]
            y += flat[i + 1]
        pts.append((x / sc, y / sc))
    return pts


def area(pts):
    n = len(pts)
    return sum(pts[i][0] * pts[(i + 1) % n][1] - pts[(i + 1) % n][0] * pts[i][1] for i in range(n)) / 2


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, "..", "client", "data", "map.json")
    d = json.load(open(path, encoding="utf-8"))
    sc = d["meta"]["scale"]
    states, provs = d["states"], d["provinces"]
    K = len(provs)
    bad = 0

    print(f"{path}")
    print(f"projecao: {d['meta']['projection']}   data: {d['meta']['date']}   "
          f"estados: {len(states)}   provincias: {K}\n")

    # vizinhanca
    for i, p in enumerate(provs):
        for j in p["a"]:
            if not (0 <= j < K) or j == i or i not in provs[j]["a"]:
                bad += 1
                print("vizinhanca invalida/assimetrica:", i, j)
                break

    per, cit, nbr = defaultdict(list), defaultdict(list), defaultdict(list)
    few = []
    for i, p in enumerate(provs):
        own = states[p["s"]]["owner"]
        a = abs(sum(area(decode(r, sc)) for r in p["r"]))
        if "c" in p:
            cit[own].append(a)
            nbr[own].append(len(p["a"]))
            if len(p["a"]) < 2:
                few.append(p["c"])
        else:
            per[own].append(a)

    targets = d["meta"].get("targets", {})
    ref = None
    print(f"{'dono':5s} {'alvo':>5s} {'provs':>6s} {'cidades':>8s} {'tamanho':>9s} {'vs GER':>7s} {'variacao':>9s}  vizinhas das cidades (min/media)")
    for o in ("GER", "HUN", "ROM", "SOV", "FIN", "AXM"):
        a = per[o]
        if not a:
            continue
        m = sum(a) / len(a)
        sd = (sum((x - m) ** 2 for x in a) / len(a)) ** 0.5
        ref = ref or m
        total = len(a) + len(cit[o])
        flag = "" if total == targets.get(o) else "  <-- difere do alvo"
        if flag:
            bad += 1
        nb = nbr[o]
        nbs = f"{min(nb)}/{sum(nb) / len(nb):.1f}" if nb else "-"
        print(f"{o:5s} {targets.get(o, 0):5d} {total:6d} {len(cit[o]):8d} {m:9.4f} {m / ref:6.2f}x {sd / m:9.2f}  {nbs}{flag}")

    print()
    if few:
        bad += 1
        print(f"FALHA: {len(few)} cidades com menos de 2 vizinhas: {few[:10]}")
    else:
        print("ok: todas as cidades tocam pelo menos 2 provincias diferentes")
    islands = sum(1 for p in provs if "c" not in p and len(p["a"]) == 0)
    one = sum(1 for p in provs if "c" not in p and len(p["a"]) == 1)
    print(f"info: provincias comuns sem vizinha (ilhas): {islands}; com 1 vizinha (costa/canto): {one}")
    sizes = sorted(len([1 for p in provs if p["s"] == i]) for i in range(len(states)))
    print(f"info: provincias por estado: min {sizes[0]}, mediana {sizes[len(sizes) // 2]}, max {sizes[-1]}")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
