// Eslováquia, Hungria (com as aquisições de 1938-1941) e Romênia.
GEO.n({
  // fronteira Eslováquia / Hungria
  sk6: [22.15, 48.85], sh1: [17.7, 48.1], sh2: [18.8, 48.3], sh3: [20.3, 48.7], sh4: [21.4, 48.9],
  // fronteira húngara antiga (Trianon) e Danúbio
  th2: [21.7, 48.35], th3: [20.8, 48.55], th4: [19.9, 48.1], th5: [19.1, 47.95],
  du1: [18.7, 47.8], du2: [19.05, 47.5], du3: [18.95, 46.6], db1: [18.95, 46.2],
  hs1: [16.4, 46.55], hs2: [16.9, 46.35], hs3: [17.7, 45.95], hs4: [18.95, 45.95], hs5: [19.2, 45.4],
  hr1: [20.3, 46.1], hr2: [20.25, 45.25], hb1: [19.55, 46.15],
  // Rutênia Subcarpática
  ru1: [22.15, 48.4], rua: [22.8, 48.1], rt1: [23.1, 49.0], rt2: [24.6, 48.3], rt3: [24.6, 47.95],
  // Transilvânia do Norte (húngara desde 1940)
  ro1: [22.6, 47.85], ro2: [21.5, 47.0], ro3: [21.2, 46.2],
  e2: [25.6, 47.0], e3: [26.1, 45.9], e4: [25.3, 45.85], e5: [23.8, 46.35], e6: [22.8, 46.3], e7: [22.2, 46.45],
  // Romênia
  ar1: [21.7, 46.0], bn1: [22.4, 45.3], sr2: [20.9, 45.55], sr3: [21.4, 44.85], sr4: [22.4, 44.7],
  bg2: [22.67, 44.22], bg3: [23.95, 43.75],
  ts1: [25.5, 45.55], ts2: [24.4, 45.55], ts3: [23.2, 45.4], ts5: [26.4, 45.4],
  ms1: [27.3, 45.35], ms2: [26.6, 45.45],
  mu1: [24.55, 44.6], mu2: [24.7, 43.7], mu3: [25.97, 43.88], mu4: [27.25, 44.1],
  do1: [28.0, 44.3], do2: [27.95, 45.25],
  ds1: [29.65, 45.2], ds2: [28.65, 44.2], ds3: [28.6, 43.75],
  b1: [26.0, 47.95], pr1: [26.65, 48.2], pr2: [27.2, 47.5], pr3: [27.55, 47.0], pr4: [28.1, 46.3], pr5: [28.2, 45.45]
});

// Eslováquia (Estado cliente, fora do foco do jogo)
GEO.s('sl', 'Eslováquia', 'OUT', ['a3', 'ck1', 'ck2', 's8', 'sk2', 'sk3', 'd8', 'sk6', 'sh4', 'sh3', 'sh2', 'sh1', 'v1']);

// Hungria
GEO.s('hd', 'Transdanubien', 'HUN', ['v1', 'sh1', 'du1', 'du2', 'du3', 'db1', 'hs4', 'hs3', 'hs2', 'hs1', 'sl1', 'sd1', 'v2']);
GEO.s('ha', 'Alföld', 'HUN', ['du1', 'th5', 'th4', 'th3', 'th2', 'ru1', 'rua', 'ro1', 'ro2', 'ro3', 'hr1', 'hb1', 'db1', 'du3', 'du2']);
GEO.s('hf', 'Felvidék', 'HUN', ['sh1', 'sh2', 'sh3', 'sh4', 'sk6', 'ru1', 'th2', 'th3', 'th4', 'th5', 'du1']);
GEO.s('hk', 'Karpatalja', 'HUN', ['ru1', 'sk6', 'd8', 'rt1', 'rt2', 'rt3', 'rua']);
GEO.s('he2', 'Észak-Erdély', 'HUN', ['rua', 'rt3', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'ro3', 'ro2', 'ro1']);
GEO.s('hv', 'Délvidék', 'HUN', ['db1', 'hb1', 'hr1', 'hr2', 'hs5', 'hs4']);

// Romênia
GEO.s('rmb', 'Banat', 'ROM', ['hr1', 'ro3', 'ar1', 'bn1', 'sr4', 'sr3', 'sr2']);
GEO.s('rts', 'Transilvânia do Sul', 'ROM', ['ro3', 'e7', 'e6', 'e5', 'e4', 'e3', 'ts5', 'ts1', 'ts2', 'ts3', 'bn1', 'ar1']);
GEO.s('rol', 'Oltênia', 'ROM', ['bn1', 'sr4', 'bg2', 'bg3', 'mu2', 'mu1', 'ts2', 'ts3']);
GEO.s('rmu', 'Muntênia', 'ROM', ['ts5', 'ts1', 'ts2', 'mu1', 'mu2', 'mu3', 'mu4', 'do1', 'do2', 'ms1', 'ms2']);
GEO.s('rmo', 'Moldávia', 'ROM', ['rt3', 'b1', 'pr1', 'pr2', 'pr3', 'pr4', 'pr5', 'do2', 'ms1', 'ms2', 'ts5', 'e3', 'e2']);
GEO.s('rdo', 'Dobruja', 'ROM', ['do1', 'do2', 'pr5', 'ds1', 'ds2', 'ds3', 'mu4']);

GEO.c('Budapeste', 19.05, 47.5, 1);
GEO.c('Bucareste', 26.1, 44.4, 1);
GEO.c('Cluj', 23.6, 46.77, 2);
GEO.c('Iași', 27.6, 47.15, 2);
GEO.c('Constança', 28.65, 44.2, 2);
GEO.c('Ploiești', 26.0, 44.95, 2);
GEO.c('Bratislava', 17.1, 48.15, 2);
