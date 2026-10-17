// Registro da geometria do mapa.
// N: nós compartilhados [lon, lat]. S: estados (polígonos feitos de nomes de nós).
// Estados vizinhos usam os MESMOS nós nas fronteiras, então não há frestas entre eles.
// Geografia aproximada e desenhada à mão (estilo "low poly"), situação em 22/06/1941.
window.GEO = { N: {}, S: [], C: [] };

GEO.n = function (obj) { Object.assign(GEO.N, obj); };

// id, nome, dono (GER, SOV, ROM, FIN, HUN ou OUT), lista de nós em ordem
GEO.s = function (id, name, owner, nodes) {
  GEO.S.push({ id: id, name: name, owner: owner, nodes: nodes });
};

// cidades/capitais: nome, lon, lat, tamanho (1 = capital, 2 = cidade grande)
GEO.c = function (name, lon, lat, rank) {
  GEO.C.push({ name: name, lon: lon, lat: lat, rank: rank });
};
