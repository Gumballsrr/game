# Frente Oriental 1941

Jogo de estratégia no navegador inspirado em Hearts of Iron IV, focado em
**Alemanha, União Soviética, Romênia, Finlândia e Hungria**, com um modo online
simples planejado.

Estado atual: **mapa interativo** (zoom, arrastar, regiões clicáveis, legenda por
facção). Ainda não há unidades, turnos nem servidor.

## Como abrir o mapa

O navegador não carrega o `map.json` se você abrir o arquivo direto, então use
um servidor local:

```bash
python3 -m http.server 8000 --directory client
# abra http://localhost:8000
```

Controles: roda do mouse = zoom, arrastar = mover, clique = fixar região,
clique na legenda = destacar uma facção, `+`/`-`/`0` = zoom/ver tudo, `Esc` = limpar.

## Como o mapa foi feito

O mapa é **original**: não usa nenhum arquivo do jogo da Paradox. Ele é gerado a
partir de dados geográficos de domínio público do
[Natural Earth](https://www.naturalearthdata.com/) pelo script
`tools/build_map.py` (só biblioteca padrão do Python):

```bash
git clone --depth 1 https://github.com/nvkelso/natural-earth-vector
python3 tools/build_map.py --src natural-earth-vector/geojson
```

O script recorta a região (Alemanha até os Urais), projeta em Mercator, simplifica
os contornos e grava `client/data/map.json`.

### Limitações (de propósito)

- As regiões são as **divisões administrativas atuais**; as fronteiras de 1941 são
  aproximadas, trocando o dono de regiões inteiras. Exemplos: Petsamo (hoje na
  região de Murmansk) era finlandesa e aparece soviética; o sul da Eslováquia aparece
  inteiro húngaro nas regiões de Košice e Nitra.
- Letônia e Moldávia são um estado cada (muitas subdivisões minúsculas).
- As regras de donos estão em `owner_of()` no script e são fáceis de ajustar.

## Assets do Hearts of Iron IV

Logos, texturas e modelos do HOI4 são da Paradox e **não devem ser versionados
aqui**. O `.gitignore` já bloqueia as pastas e extensões típicas. Para uso pessoal
local, coloque os arquivos convertidos em `assets/hoi4/` (ignorada pelo git).

## Próximos passos

1. Vizinhança entre regiões (grafo) e movimento de divisões.
2. Combate e turnos, ainda offline.
3. Servidor Node.js com WebSocket e dois jogadores.
4. Visual: bandeiras, ícones de unidades.

O GitHub Pages hospeda só o cliente (`client/`); o servidor do modo online
precisa de outro lugar (Render, Railway, Fly.io).

Dados: Natural Earth (domínio público).
