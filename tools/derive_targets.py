#!/usr/bin/env python3
"""
Calcula quantas provincias cada dono deve ter NESTE mapa, a partir do CSV gerado
por tools/count_hoi4_provinces.py (contagem real do HOI4 em 22/06/1941).

Uso:
    python3 tools/derive_targets.py caminho/para/hoi4_provincias_1941-6-22.csv

Grava tools/province_targets.json.

Por que nao e so somar por dono do CSV? Porque o CSV mostra a situacao inicial do
jogo (Polonia ainda existe, Baltico independente, etc.), enquanto o mapa mostra
o dono em 22/06/1941. Aqui cada estado do HOI4 e atribuido ao dono que ele tem
no mapa. Estados da Asia ficam de fora; estados cortados pela borda leste do
mapa entram com uma fracao estimada (peso < 1).
"""
import argparse
import csv
import json
import os
import sys

# ---- estados do HOI4 -> dono no mapa (22/06/1941) --------------------------------
# (tag no CSV, nome do estado) -> peso. Peso 1 = o estado inteiro esta no mapa.

# Polonia ocupada pela Alemanha (Governo Geral e territorios anexados)
POL_PARA_GER = ["Danzig", "Gdynia", "Katowice", "Kielce", "Kraków", "Lublin",
                "Poznań", "Płock", "Trans-Olza", "Warsaw", "Łódz"]
# Leste da Polonia, ocupado pela URSS em 1939
POL_PARA_SOV = ["Białystok", "Lwów", "Nowogródek", "Polesie", "Stanisławów",
                "Vilna", "Wilejka", "Wołyn"]

# URSS: so o que fica a oeste do recorte (aprox. 54 graus leste). Asia fora.
SOV_PESOS = {
    # Europa central/norte
    "Arkhangelsk": 1, "Belgorod": 1, "Bobruysk": 1, "Bryansk": 1, "Cherkasy": 1,
    "Chernigov": 1, "Chuvashia": 1, "Crimea": 1, "Dnipropetrovsk": 1, "Gomel": 1,
    "Gorky": 1, "Ivanovo": 1, "Kalinin": 1, "Kaluga": 1, "Kargopol": 1,
    "Kharkov": 1, "Kherson": 1, "Kiev": 1, "Kotlas": 1, "Kursk": 1, "Leningrad": 1,
    "Lipetsk": 1, "Luga": 1, "Mari El": 1, "Minsk": 1, "Moscow": 1, "Mozyr": 1,
    "Murmansk": 1, "Mykolaiv": 1, "Nevel": 1, "Novgorod": 1, "Odessa": 1,
    "Olonets": 1, "Onega": 1, "Orel": 1, "Penza": 1, "Poltava": 1, "Proskuriv": 1,
    "Pskov": 1, "Roslavl": 1, "Rzhev": 1, "Ryazan": 1, "Smolensk": 1, "Stalino": 1,
    "Sumy": 1, "Tambov": 1, "Tikhvin": 1, "Tula": 1, "Vinnytsia": 1, "Vitebsk": 1,
    "Volkhov": 1, "Vologda": 1, "Voronezh": 1, "Voroshilovgrad": 1, "Yaroslavl": 1,
    "Zaporozhe": 1, "Zhytomyr": 1, "Balta-Tiraspol": 1,
    # Sul e Volga
    "Astrakhan": 1, "Balakovo": 1, "Engels-Marxstadt": 1, "Kalmykia": 1,
    "Mikhaylovka": 1, "Millerovo": 1, "Rostov": 1, "Saratov": 1, "Stalingrad": 1,
    "Ulyanovsky": 1, "Volgodonsk": 1, "Krasnodar": 1, "Sochi": 1, "Stavropol": 1,
    # Caucaso
    "Abkhazia": 1, "Armenia": 1, "Azerbaijan": 1, "Georgia": 1, "Chechnya-Ingushetia": 1,
    "Dagestan": 1, "Kabardino-Balkaria": 1, "North Ossetia": 1,
    # Cortados pela borda leste (fracao estimada dentro do mapa)
    "Kazan": 0.9, "Kirov": 1, "Kuybyshev": 0.9, "Udmurtia": 0.7, "Akhtubinsk": 0.7,
    "Syktyvkar": 0.6, "Nenets": 0.5, "Perm": 0.15,
}
# Estados que o mapa mostra como sovieticos em 22/06/1941 mas o CSV lista com outro dono
OUTROS_PARA_SOV = {
    "EST": None, "LAT": None, "LIT": None,        # Baltico anexado em 1940 (todos os estados)
    "ROM": ["Bessarabia", "Southern Bessarabia", "Bucovina"],
    "FIN": ["Karjala", "Petsamo"],                # Guerra de Inverno (istmo da Carelia, Petsamo no mapa)
}

HUN_EXTRA = {("ROM", "North Transylvania"): 1, ("ROM", "Crisana"): 1, ("YUG", "Vojvodina"): 0.6}
ROM_FORA = {"North Transylvania", "Crisana", "Bessarabia", "Southern Bessarabia", "Bucovina", "Dobrudja"}
FIN_FORA = {"Karjala", "Petsamo", "Åland"}        # Aland nao esta no mapa


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("csv")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "province_targets.json"))
    args = ap.parse_args()

    rows = {}
    with open(args.csv, encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f, delimiter=";"):
            rows[(r["dono"], r["nome"])] = rows.get((r["dono"], r["nome"]), 0) + int(r["provincias"])
    by_tag = {}
    for (tag, nome), n in rows.items():
        by_tag.setdefault(tag, []).append((nome, n))

    groups = {k: [] for k in ("GER", "SOV", "ROM", "FIN", "HUN", "AXM")}

    def add(group, tag, nome, peso=1.0):
        n = rows.get((tag, nome))
        if n is None:
            print(f"AVISO: estado nao encontrado no CSV: {tag} / {nome}", file=sys.stderr)
            return
        groups[group].append((tag, nome, n, peso))

    for nome, _ in by_tag.get("GER", []):
        add("GER", "GER", nome)
    for nome in POL_PARA_GER:
        add("GER", "POL", nome)

    for nome, peso in SOV_PESOS.items():
        add("SOV", "SOV", nome, peso)
    for tag, nomes in OUTROS_PARA_SOV.items():
        for nome in (nomes if nomes is not None else [n for n, _ in by_tag.get(tag, [])]):
            add("SOV", tag, nome)
    for nome in POL_PARA_SOV:
        add("SOV", "POL", nome)

    for nome, _ in by_tag.get("HUN", []):
        add("HUN", "HUN", nome)
    for (tag, nome), peso in HUN_EXTRA.items():
        add("HUN", tag, nome, peso)

    for nome, _ in by_tag.get("ROM", []):
        if nome not in ROM_FORA:
            add("ROM", "ROM", nome)

    for nome, _ in by_tag.get("FIN", []):
        if nome not in FIN_FORA:
            add("FIN", "FIN", nome)
    add("FIN", "FIN", "Salla")  # ja incluido acima; evita duplicar
    groups["FIN"] = list({(t, n): (t, n, c, p) for t, n, c, p in groups["FIN"]}.values())

    for nome, _ in by_tag.get("SLO", []):
        add("AXM", "SLO", nome)

    targets = {}
    print(f"{'dono':5s} {'estados':>8s} {'provincias':>11s}")
    for g, lst in groups.items():
        total = sum(c * p for _, _, c, p in lst)
        targets[g] = int(round(total))
        print(f"{g:5s} {len(lst):8d} {targets[g]:11d}")
        partial = [(n, c, p) for _, n, c, p in lst if p < 1]
        if partial:
            print("      parciais:", ", ".join(f"{n} {c}x{p}" for n, c, p in partial))

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump({
            "_comentario": "Quantidade de provincias por dono neste mapa, derivada do CSV do HOI4 de 22/06/1941 "
                           "(tools/derive_targets.py). So a parte europeia entra; estados cortados pela borda leste "
                           "entram com fracao estimada.",
            "targets": targets,
        }, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print("gravado:", args.out)


if __name__ == "__main__":
    main()
