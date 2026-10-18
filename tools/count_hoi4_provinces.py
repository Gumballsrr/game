#!/usr/bin/env python3
"""
Conta quantas provincias cada pais tem no Hearts of Iron IV numa data qualquer.

Le SO os seus arquivos locais do jogo (somente leitura) e grava uma tabela com:
id do estado, nome, quantidade de provincias e dono na data escolhida.
Nenhum arquivo do jogo e copiado ou alterado.

Uso (Windows, no Prompt de Comando):
    python count_hoi4_provinces.py --game "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Hearts of Iron IV"

Opcoes:
    --date 1941.6.22    data para aplicar as mudancas de dono (padrao: 1941.6.22)
    --out  arquivo.csv  onde gravar a tabela (padrao: hoi4_provincias_<data>.csv)

O dono em cada data vem dos blocos "AAAA.M.D = { owner = TAG }" dentro de
history/states/*.txt. Se o seu jogo tem mods, o resultado reflete a pasta
indicada em --game (jogo base).
"""
import argparse
import csv
import os
import re
import sys

DATE_KEY = re.compile(r"^(\d{4})\.(\d{1,2})\.(\d{1,2})(?:\.(\d{1,2}))?$")


def tokenize(text):
    text = re.sub(r"#[^\n]*", "", text)               # comentarios
    tokens = []
    for m in re.finditer(r'"[^"]*"|[{}=]|[^\s{}=]+', text):
        tokens.append(m.group(0))
    return tokens


def parse_block(tokens, i):
    """Devolve (itens, proximo_indice). Item = (chave, valor) ou (None, token)."""
    items = []
    n = len(tokens)
    while i < n:
        t = tokens[i]
        if t == "}":
            return items, i + 1
        if i + 1 < n and tokens[i + 1] == "=":
            key = t
            i += 2
            if i < n and tokens[i] == "{":
                val, i = parse_block(tokens, i + 1)
            elif i < n:
                val = tokens[i].strip('"')
                i += 1
            else:
                val = ""
            items.append((key, val))
        else:
            items.append((None, t))
            i += 1
    return items, i


def date_tuple(key):
    m = DATE_KEY.match(key)
    if not m:
        return None
    y, mo, d, h = m.groups()
    return (int(y), int(mo), int(d), int(h or 0))


def owner_at(history, cutoff):
    owner = None
    dated = []
    for k, v in history:
        if k == "owner" and isinstance(v, str):
            owner = v
        dt = date_tuple(k) if k else None
        if dt and isinstance(v, list):
            for k2, v2 in v:
                if k2 == "owner" and isinstance(v2, str):
                    dated.append((dt, v2))
    for dt, o in sorted(dated):
        if dt <= cutoff:
            owner = o
    return owner


def load_names(game):
    names = {}
    loc = os.path.join(game, "localisation", "english")
    if not os.path.isdir(loc):
        return names
    pat = re.compile(r'^\s*(STATE_\d+)\s*:\s*\d*\s*"(.*)"')
    for fn in os.listdir(loc):
        if not fn.endswith(".yml") or "state" not in fn.lower():
            continue
        with open(os.path.join(loc, fn), encoding="utf-8-sig", errors="replace") as f:
            for line in f:
                m = pat.match(line)
                if m:
                    names[m.group(1)] = m.group(2)
    return names


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--game", required=True, help="pasta de instalacao do Hearts of Iron IV")
    ap.add_argument("--date", default="1941.6.22")
    ap.add_argument("--out")
    args = ap.parse_args()

    cutoff = date_tuple(args.date)
    if not cutoff:
        sys.exit("Data invalida. Use o formato AAAA.M.D, por exemplo 1941.6.22")
    folder = os.path.join(args.game, "history", "states")
    if not os.path.isdir(folder):
        sys.exit(f"Nao encontrei {folder}. Confira o caminho de --game.")

    names = load_names(args.game)
    rows = []
    for fn in sorted(os.listdir(folder)):
        if not fn.endswith(".txt"):
            continue
        with open(os.path.join(folder, fn), encoding="utf-8-sig", errors="replace") as f:
            tokens = tokenize(f.read())
        items, _ = parse_block(tokens, 0)
        state = next((v for k, v in items if k == "state" and isinstance(v, list)), None)
        if state is None:
            continue
        sid = next((v for k, v in state if k == "id"), None)
        name_key = next((v for k, v in state if k == "name"), "")
        provs = next((v for k, v in state if k == "provinces" and isinstance(v, list)), [])
        history = next((v for k, v in state if k == "history" and isinstance(v, list)), [])
        n_prov = sum(1 for k, t in provs if k is None)
        rows.append({
            "id": int(sid) if sid and str(sid).isdigit() else sid,
            "nome": names.get(name_key, name_key),
            "provincias": n_prov,
            "dono": owner_at(history, cutoff) or "",
        })

    rows.sort(key=lambda r: (str(r["dono"]), str(r["nome"])))
    out = args.out or f"hoi4_provincias_{args.date.replace('.', '-')}.csv"
    with open(out, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=["id", "nome", "provincias", "dono"], delimiter=";")
        w.writeheader()
        w.writerows(rows)

    totals = {}
    for r in rows:
        t = totals.setdefault(r["dono"], [0, 0])
        t[0] += 1
        t[1] += r["provincias"]
    print(f"Data: {args.date}   estados lidos: {len(rows)}   "
          f"provincias no total: {sum(r['provincias'] for r in rows)}\n")
    print(f"{'dono':6s} {'estados':>8s} {'provincias':>11s}")
    for tag in ("GER", "SOV", "ROM", "FIN", "HUN"):
        e, p = totals.get(tag, [0, 0])
        print(f"{tag:6s} {e:8d} {p:11d}")
    print("\nTabela completa gravada em:", os.path.abspath(out))
    print("Anexe esse arquivo na conversa com o Claude.")


if __name__ == "__main__":
    main()
