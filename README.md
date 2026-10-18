# Frente Oriental 1941

Jogo de estratégia no navegador inspirado em Hearts of Iron IV, focado em
**Alemanha, União Soviética, Romênia, Finlândia e Hungria**, com um modo online
simples planejado.

Estado atual: **mapa interativo** com 2.570 províncias, em **22 de junho de 1941**
(início da Operação Barbarossa). Ainda não há unidades, turnos nem servidor.

## Como abrir o mapa

O navegador não carrega o `map.json` se você abrir o arquivo direto, então use
um servidor local:

```bash
python3 -m http.server 8000 --directory client
# abra http://localhost:8000
```

Controles: roda do mouse = zoom, arrastar = mover, clique = fixar um estado,
clique na legenda = destacar uma facção, `+`/`-`/`0` = zoom/ver tudo, `Esc` = limpar.

## Estados e províncias

- **Estado**: região administrativa (por exemplo, "Cluj"). Cada estado tem um dono.
- **Província**: divisão menor de um estado, que nunca cruza a fronteira do estado
  (como no HOI4). São geradas automaticamente, com formas compactas e tamanho parecido.

A quantidade de províncias por dono fica em `tools/province_targets.json`.
Valor `null` usa uma densidade provisória de 1 província a cada 2.500 km², que é
uma **estimativa minha, não o número do HOI4**.

### Usar a contagem real do HOI4

O script `tools/count_hoi4_provinces.py` lê a pasta do seu jogo (somente leitura,
não copia nem altera nada) e conta as províncias de cada país numa data:

```bash
python count_hoi4_provinces.py --game "C:\Program Files (x86)\Steam\steamapps\common\Hearts of Iron IV" --date 1941.6.22
```

Ele grava um `.csv` com id, nome, província e dono de cada estado. Como a URSS do
HOI4 inclui a Sibéria e a Ásia Central (fora da janela deste mapa), os totais
precisam ser filtrados para a parte europeia antes de entrar no
`province_targets.json`.

## Como o mapa foi feito

O mapa é **original**: não usa nenhum arquivo do jogo da Paradox. Ele é gerado a
partir de dados geográficos de domínio público do
[Natural Earth](https://www.naturalearthdata.com/) pelo script `tools/build_map.py`
(precisa de numpy, scipy, scikit-image e opencv-python):

```bash
git clone --depth 1 https://github.com/nvkelso/natural-earth-vector
python3 tools/build_map.py --src natural-earth-vector/geojson
```

O script recorta a região (Alemanha até os Urais), projeta em Mercator, divide cada
estado em províncias (k-means sobre uma grade de pixels) e grava
`client/data/map.json`. Leva cerca de 1 minuto.

### Limitações (de propósito)

- Os estados são as **divisões administrativas atuais**; as fronteiras de 1941 são
  aproximadas, trocando o dono de estados inteiros. Exemplos: Petsamo (hoje na
  região de Murmansk) era finlandesa e aparece soviética; o sul da Eslováquia aparece
  inteiro húngaro nas regiões de Košice e Nitra.
- Letônia e Moldávia são um estado cada (muitas subdivisões minúsculas).
- As regras de donos estão em `owner_of()` no script e são fáceis de ajustar.
- As províncias não têm nome nem forma histórica: são só uma malha.

## Assets do Hearts of Iron IV

Logos, texturas e modelos do HOI4 são da Paradox e **não devem ser versionados
aqui**. O `.gitignore` já bloqueia as pastas e extensões típicas. Para uso pessoal
local, coloque os arquivos convertidos em `assets/hoi4/` (ignorada pelo git).

## Próximos passos

1. Vizinhança entre províncias (grafo) e movimento de divisões.
2. Combate e turnos, ainda offline.
3. Servidor Node.js com WebSocket e dois jogadores.
4. Visual: bandeiras, ícones de unidades.

O GitHub Pages hospeda só o cliente (`client/`); o servidor do modo online
precisa de outro lugar (Render, Railway, Fly.io).

Dados: Natural Earth (domínio público).
