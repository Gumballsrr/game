// Países bálticos (anexados pela URSS em 1940), Finlândia e norte soviético.
GEO.n({
  // Lituânia
  lt1: [24.0, 54.05], lt2: [25.2, 54.3], lt3: [25.9, 54.95], la3: [26.6, 55.7],
  la1: [22.2, 56.4], la2: [24.0, 56.2],
  // Letônia
  l1: [21.05, 56.5], l2: [21.7, 57.55], l3: [22.6, 57.75], l4: [23.6, 57.05], l5: [24.1, 57.0],
  l6: [24.35, 57.9], la4: [28.15, 56.6], la5: [28.15, 56.15],
  // Estônia
  es1: [24.4, 58.3], es2: [23.45, 58.75], es3: [23.6, 59.2], es4: [25.0, 59.55], es5: [27.0, 59.5],
  es6: [28.0, 59.5], es7: [27.6, 58.7], es8: [27.4, 57.9], es9: [27.35, 57.55], es10: [26.0, 57.75],
  // costa do Golfo da Finlândia (lado soviético) e Istmo da Carélia
  ls1: [28.6, 60.55], ls2: [29.5, 60.2], ls3: [30.25, 59.95], ls4: [29.4, 59.9], ls5: [28.3, 59.65],
  lad1: [31.0, 59.95],
  // Finlândia: costa sul e oeste
  fs1: [27.7, 60.5], fs2: [26.0, 60.4], fs3: [24.0, 59.95], fs4: [22.9, 59.85], fs5: [21.4, 60.6],
  fs6: [21.45, 61.6], fs7: [21.3, 62.8], fs8: [22.4, 63.65], fs9: [24.5, 64.5], fs10: [25.4, 65.05],
  fs11: [24.15, 65.85],
  // Finlândia: interior
  fh1: [22.6, 61.1], fh2: [24.5, 61.3], fh3: [26.5, 61.55], fh4: [28.0, 61.2],
  fc1: [22.4, 62.9], fc2: [24.6, 63.4], fc3: [27.5, 63.6], fc4: [28.4, 64.4],
  fo1: [26.5, 65.0], fo2: [28.5, 65.6], fo3: [26.5, 66.2], fo4: [25.0, 66.6],
  fl1: [23.6, 67.9], fl2: [20.6, 69.06], fl3: [25.5, 68.7], fl4: [27.0, 69.9],
  // Finlândia: fronteira com a URSS (após a Guerra de Inverno) e Petsamo
  f2: [28.95, 61.3], f3: [30.2, 61.9], f4: [31.6, 62.9], f5: [31.4, 63.9], f6: [30.1, 65.0],
  f7: [29.7, 66.2], f8: [29.1, 67.5], f9: [30.0, 68.8], f10: [31.1, 69.75], fp1: [28.9, 70.1],
  fp2: [28.5, 69.0],
  // URSS norte
  mu1: [33.0, 69.4], mu2: [36.0, 69.1], mu3: [41.0, 67.1], k3: [34.2, 66.9], k2: [35.5, 64.0],
  k1: [35.0, 61.5], k4: [41.0, 64.0], k5: [41.0, 61.0]
});

// Estados bálticos
GEO.s('lt', 'Lituânia (RSS)', 'SOV', ['n1', 'n2', 'n3', 'e02', 'e03', 'd1', 'lt1', 'lt2', 'lt3', 'la3', 'la2', 'la1']);
GEO.s('lv', 'Letônia (RSS)', 'SOV', ['n1', 'l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'es10', 'es9', 'la4', 'la5', 'la3', 'la2', 'la1']);
GEO.s('ee', 'Estônia (RSS)', 'SOV', ['l6', 'es1', 'es2', 'es3', 'es4', 'es5', 'es6', 'es7', 'es8', 'es9', 'es10']);

// Finlândia
GEO.s('fs', 'Uusimaa-Kymi', 'FIN', ['fs1', 'fs2', 'fs3', 'fs4', 'fs5', 'fh1', 'fh2', 'fh3', 'fh4', 'f2']);
GEO.s('fv', 'Satakunta-Pohjanmaa', 'FIN', ['fs5', 'fs6', 'fs7', 'fs8', 'fc1', 'fc2', 'fh2', 'fh1']);
GEO.s('fc', 'Savo-Karjala', 'FIN', ['fh2', 'fc2', 'fc3', 'fc4', 'f5', 'f4', 'f3', 'f2', 'fh4', 'fh3']);
GEO.s('fo', 'Pohjanmaa', 'FIN', ['fs8', 'fs9', 'fs10', 'fo1', 'fo2', 'fc4', 'fc3', 'fc2', 'fc1']);
GEO.s('fk', 'Kainuu-Oulu', 'FIN', ['fs10', 'fs11', 'fo4', 'fo3', 'f7', 'f6', 'f5', 'fc4', 'fo2', 'fo1']);
GEO.s('fl', 'Lappi', 'FIN', ['fs11', 'fl1', 'fl2', 'fl3', 'fl4', 'fp1', 'fp2', 'f8', 'f7', 'fo3', 'fo4']);
GEO.s('fp', 'Petsamo', 'FIN', ['fp2', 'fp1', 'f10', 'f9', 'f8']);

// URSS: Istmo da Carélia, Carélia e Murmansk
GEO.s('ki', 'Istmo da Carélia', 'SOV', ['fs1', 'f2', 'f3', 'lad1', 'ls3', 'ls2', 'ls1']);
GEO.s('kr', 'Carélia (RSS)', 'SOV', ['f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'k3', 'k2', 'k1', 'lad1']);
GEO.s('mu', 'Murmansk', 'SOV', ['f8', 'f9', 'f10', 'mu1', 'mu2', 'mu3', 'k4', 'k2', 'k3']);

GEO.c('Helsinque', 24.95, 60.17, 1);
GEO.c('Viipuri', 28.75, 60.7, 2);
GEO.c('Rovaniemi', 25.7, 66.5, 2);
GEO.c('Petrozavodsk', 34.35, 61.8, 2);
GEO.c('Murmansk', 33.1, 68.97, 2);
GEO.c('Riga', 24.1, 56.95, 2);
GEO.c('Tallinn', 24.75, 59.45, 2);
GEO.c('Kaunas', 23.9, 54.9, 2);
