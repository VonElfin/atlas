# Atlas

Globo interativo para desktop: relevo, densidade populacional, clima e outras camadas sobre imagens de satélite, com terreno 3D.

## Rodar

```bash
npm install
npm run setup     # baixa os binários do Neutralino (bin/) e resources/js/neutralino.js
npm start         # abre a janela em modo de desenvolvimento
npm run dev       # idem, com DevTools (F12)
npm run build     # gera dist/atlas/atlas-win_x64.exe (executável único, ~4 MB)
```

O executável depende só do WebView2, que já vem no Windows 10/11. Ele também é gerado para Linux e macOS.

## Uso

- **Arrastar** gira o globo. **Botão direito ou Ctrl + arrastar** inclina e rotaciona. **Roda do mouse** dá zoom.
- **Passe o mouse** sobre o mapa para ver um selo com o valor de cada camada temática ligada (densidade, temperatura, precipitação, altitude…).
- **Clique** em um ponto para ver: elevação, densidade populacional, temperatura e precipitação do mês escolhido, NDVI, cobertura do solo, classificação de Köppen-Geiger e climograma das normais de 1991–2020.
- **Ctrl+K** abre a busca de lugares. **Esc** fecha painéis.
- **Plano · Equal Earth** mostra o mapa-múndi na projeção de área igual Equal Earth em vez de Mercator. O terreno 3D só existe no modo Globo.
- **Data dos dados mensais** troca o mês das camadas de clima e vegetação. O ▶ anima mês a mês.

## Camadas

| Camada | Fonte | Resolução |
|---|---|---|
| Satélite | Esri World Imagery | até ~0,3 m |
| Blue Marble | NASA GIBS | ~500 m |
| Altitude/batimetria, sombreamento, terreno 3D | AWS Terrain Tiles (Terrarium) | ~30 m em terra |
| Densidade populacional 2000–2020 | NASA SEDAC GPWv4 | ~1 km |
| Luzes noturnas 2012/2016 | NASA Black Marble | ~500 m |
| Temperatura e precipitação mensais | NASA MERRA-2 | ~50 km |
| Vegetação (NDVI) mensal | MODIS Terra | ~1 km |
| Cobertura do solo 2001–2024 | MODIS IGBP | ~500 m |
| Normais climáticas (clique) | ERA5 via Open-Meteo | ~25 km |
| Busca e nomes de lugares | OpenStreetMap Nominatim | — |

## Como funciona

- **Equal Earth:** o MapLibre (6.15, API experimental `addProjection`) posiciona os tiles no grid da projeção, mas não reprojeta o conteúdo. Por isso cada tile Equal Earth é montado em [resources/js/tiles.js](resources/js/tiles.js) a partir dos tiles Web Mercator. Em cada linha do tile a latitude é constante e a longitude é linear em x, o que deixa a reprojeção barata.
- **Sem tiles cinza:** o satélite é pedido com `blankTile=false`. Onde o Esri não tem imagem naquele zoom, o app usa o tile ancestral ampliado em vez do aviso "Map data not yet available".
- **Inclinação:** abaixo do z12 o Esri usa outro mosaico, bem mais escuro. Com a câmera perto do chão, os tiles distantes não descem abaixo do z12, o que evita a faixa escura no horizonte.
- **Nitidez:** os tiles de satélite são exibidos a ~181 px em vez de 256 px, para nunca serem ampliados entre níveis de zoom.
- **Carregamento:** cada servidor de tiles é acessado por dois hostnames, o que dobra as conexões HTTP/1.1 em paralelo.

Para ler o valor de um ponto, o app pega a cor do pixel no próprio tile e a converte de volta pelo colormap publicado pela NASA. A elevação é decodificada do tile Terrarium. Não é preciso nenhuma chave de API.

## Adicionar uma camada

1. Ache o id da camada no [GetCapabilities do GIBS](https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml) e coloque em `LAYERS` em [scripts/build-catalog.mjs](scripts/build-catalog.mjs).
2. Rode `npm run catalog`. Ele atualiza [resources/data/gibs-catalog.json](resources/data/gibs-catalog.json) com as datas disponíveis e o colormap.
3. Adicione uma entrada em `OVERLAYS` em [resources/js/layers.js](resources/js/layers.js) e defina `format`/`unit` para o valor aparecer no clique.

Rode `npm run catalog` de vez em quando para incluir os meses mais recentes.

## Estrutura

```
neutralino.config.json   janela, permissões nativas, versão do runtime
resources/
  index.html, css/app.css
  js/main.js             mapa, painel, tempo, clique, busca
  js/layers.js           registro de mapas base e camadas
  js/tiles.js            cache de tiles, fallback de tiles ausentes, Equal Earth
  js/probe.js            leitura de valores por pixel (elevação, colormaps)
  js/climate.js          normais, Köppen-Geiger, climograma
  js/legend.js           legendas
  vendor/maplibre/       MapLibre GL JS 6.15 (WebGL2)
  data/gibs-catalog.json gerado por scripts/build-catalog.mjs
```
