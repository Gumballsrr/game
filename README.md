# Frente Oriental 1941

Jogo de estratégia no navegador inspirado em Hearts of Iron IV, focado em
**Alemanha, União Soviética, Romênia, Finlândia e Hungria**, com um modo online
simples planejado.

Estado atual: **mapa interativo** com 2.297 províncias, em **22 de junho de 1941**
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

## Estados, províncias e cidades

- **Estado**: região administrativa (por exemplo, "Cluj"). Cada estado tem um dono.
- **Província**: divisão menor de um estado, que nunca cruza a fronteira do estado
  (como no HOI4). Geradas automaticamente, com formas irregulares e tamanho parecido.
- **Cidade**: uma mini-província (como Bucareste no HOI4), não um pino. Ela tem a
  cidade como nome, encosta em pelo menos 2 províncias vizinhas e nenhuma vizinha ocupa
  mais de 75% da sua borda, então nunca fica cercada por uma só província.
  Capitais têm contorno dourado.

O mapa usa projeção **equirretangular** (como o HOI4), então províncias do mesmo
tamanho no jogo têm o mesmo tamanho na tela. A janela vai até 54°L (Volga/Kama): os
Urais, o Cazaquistão e a Sibéria aparecem escuros como "Fora do mapa (Ásia)". O
Cáucaso fica por causa de Baku.

### Quantidade de províncias (igual ao HOI4)

Totais por dono em `tools/province_targets.json`: GER 392, SOV 1607, ROM 59, FIN 152,
HUN 73, AXM 14. Eles vêm do CSV de contagem do HOI4 em 22/06/1941, filtrado para a
parte europeia por `tools/derive_targets.py`. O CSV **não** é versionado (é dado do
jogo da Paradox).

```bash
python tools/count_hoi4_provinces.py --game "C:\\...\\Hearts of Iron IV" --date 1941.6.22
python3 tools/derive_targets.py hoi4_provincias_1941-6-22.csv
```

Como a densidade do próprio HOI4 muda de país para país, o tamanho médio varia até
~1,4x entre donos (Alemanha = 1,00x, URSS 1,36x, Finlândia 1,42x). Para tamanho
**idêntico** em todos, ponha `"equal_size": true` no `province_targets.json` e gere de
novo (os totais passam a ser recalculados pela área).

### Verificar o mapa

```bash
python3 tools/check_map.py
```

Confere totais contra o alvo, tamanho médio e variação por dono, e se toda cidade tem
2+ vizinhas e o grafo de vizinhança é simétrico.

## Como o mapa foi feito

O mapa é **original**: não usa nenhum arquivo do jogo da Paradox. Ele é gerado a
partir de dados geográficos de domínio público do
[Natural Earth](https://www.naturalearthdata.com/) pelo script `tools/build_map.py`
(precisa de numpy, scipy, scikit-image e opencv-python):

```bash
git clone --depth 1 https://github.com/nvkelso/natural-earth-vector
python3 tools/build_map.py --src natural-earth-vector/geojson
```

O script rasteriza cada estado, posiciona as cidades como células pequenas e divide
o resto em províncias de tamanho equilibrado (diagrama de potência com Lloyd e
ruído nas bordas), monta o grafo de vizinhança e grava `client/data/map.json`.

### Limitações (de propósito)

- Os estados são as **divisões administrativas atuais**; as fronteiras de 1941 são
  aproximadas, trocando o dono de estados inteiros. Exemplos: Petsamo (hoje na
  região de Murmansk) era finlandesa e aparece soviética; o sul da Eslováquia aparece
  inteiro húngaro nas regiões de Košice e Nitra.
- Letônia e Moldávia são um estado cada (muitas subdivisões minúsculas).
- Estados cortados pela borda leste entram com uma fração estimada no total
  (pesos em `derive_targets.py`); são palpites meus.
- As regras de donos estão em `owner_of()` no script e são fáceis de ajustar.
- As províncias não têm nome nem forma histórica: são só uma malha.

## Assets do Hearts of Iron IV

Logos, texturas e modelos do HOI4 são da Paradox e **não devem ser versionados
aqui**. O `.gitignore` já bloqueia as pastas e extensões típicas. Para uso pessoal
local, coloque os arquivos convertidos em `assets/hoi4/` (ignorada pelo git).

## Próximos passos

1. Movimento de divisões usando o grafo de vizinhança (já exportado no `map.json`).
2. Combate e turnos, ainda offline.
3. Servidor Node.js com WebSocket e dois jogadores.
4. Visual: bandeiras, ícones de unidades.

O GitHub Pages hospeda só o cliente (`client/`); o servidor do modo online
precisa de outro lugar (Render, Railway, Fly.io).

Dados: Natural Earth (domínio público).
