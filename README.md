# Atlas

Globo interativo para desktop: relevo, densidade populacional, clima e outras camadas sobre imagens de satélite, com terreno 3D.

## Rodar

```bash
npm install
npm run setup     # baixa os binários do Neutralino (bin/) e resources/js/neutralino.js
npm start         # abre a janela em modo de desenvolvimento
npm run dev       # idem, com DevTools (F12)
npm run build     # gera dist/atlas/atlas-win_x64.exe (executável único, ~4 MB)
npm run installer # build + instalador: release/Atlas-Setup-<versão>.exe (~3 MB)
```

O executável depende só do WebView2, que já vem no Windows 10/11. Ele também é gerado para Linux e macOS.

## Instalador para amigos

`npm run installer` gera `release/Atlas-Setup-<versão>.exe`. É só enviar esse arquivo.

- Instala só para o usuário atual, sem pedir administrador (em `%LOCALAPPDATA%ProgramsAtlas`), cria atalho no menu Iniciar (e na área de trabalho, se marcado) e aparece em "Aplicativos instalados" para desinstalar.
- Português do Brasil ou inglês, conforme o Windows.
- Se o Windows não tiver o WebView2 (já vem no Windows 11 e no Windows 10 atualizado), o instalador baixa o componente oficial da Microsoft.
- Rodar o instalador de novo atualiza a versão instalada. Para uma versão nova, mude `version` em package.json.
- **O instalador não é assinado digitalmente**, então o Windows SmartScreen mostra "O Windows protegeu o computador". Quem for instalar clica em **Mais informações → Executar assim mesmo**. Remover o aviso exige um certificado de assinatura de código (pago).

## Uso

- **Arrastar** gira o globo. **Botão direito ou Ctrl + arrastar** inclina e rotaciona. **Roda do mouse** dá zoom.
- **Passe o mouse** sobre o mapa para ver um selo com o valor de cada camada temática ligada (densidade, temperatura, precipitação, altitude…).
- **Clique** em um ponto para ver: elevação, densidade populacional, temperatura e precipitação do mês escolhido, NDVI, cobertura do solo, classificação de Köppen-Geiger e climograma das normais de 1991–2020.
- **Ctrl+K** abre a busca de lugares. **Esc** fecha painéis.
- **Globo / Plano** alterna entre o globo 3D e o mapa plano (Mercator).
- **Data dos dados mensais** troca o mês das camadas de clima e vegetação. O ▶ anima mês a mês.

## Camadas

| Camada | Fonte | Resolução |
|---|---|---|
| Satélite | Esri World Imagery | até ~0,3 m |
| Blue Marble | NASA GIBS | ~500 m |
| Sombreamento e terreno 3D | Mapterhorn (CDN) | ~30 m |
| Altitude e batimetria | AWS Terrain Tiles (Terrarium) | ~30 m em terra |
| Densidade populacional 2000–2020 | NASA SEDAC GPWv4 | ~1 km |
| Luzes noturnas 2012/2016 | NASA Black Marble | ~500 m |
| Temperatura e precipitação mensais | NASA MERRA-2 | ~50 km |
| Vegetação (NDVI) mensal | MODIS Terra | ~1 km |
| Cobertura do solo 2001–2024 | MODIS IGBP | ~500 m |
| Normais climáticas (clique) | NASA POWER (MERRA-2, 2001–2025) | ~50 km |
| Busca e nomes de lugares | OpenStreetMap Nominatim | — |

## Como funciona

- **Sem tiles cinza:** o satélite é pedido com `blankTile=false`. Onde o Esri não tem imagem naquele zoom, o app usa o tile ancestral ampliado em vez do aviso "Map data not yet available".
- **Inclinação:** abaixo do z12 o Esri usa outro mosaico, bem mais escuro. Com a câmera perto do chão, os tiles distantes não descem abaixo do z12, o que evita a faixa escura no horizonte.
- **Nitidez:** os tiles de satélite são exibidos a ~213 px em vez de 256 px, o que reduz a ampliação entre níveis de zoom.
- **Carregamento:**
  - Pré-carregamento: quando o mapa para, o app baixa em segundo plano um anel de tiles ao redor da tela e os níveis de zoom vizinhos. Qualquer movimento cancela.
  - O Esri segura ~10% das requisições por 30–60 s. Tile sem resposta em 1,2 s ganha um pedido de reserva no outro host; sem resposta em 5 s, a conexão é liberada e o tile é pedido de novo.
  - Tiles já baixados saem do cache em disco sem consultar o servidor.
  - O NASA GIBS proíbe cache (`no-store`); o app guarda esses tiles em memória durante a sessão.
  - Cada servidor é acessado por vários hostnames, o que multiplica as conexões em paralelo.

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
  js/tiles.js            cache de tiles e fallback de tiles ausentes
  js/probe.js            leitura de valores por pixel (elevação, colormaps)
  js/climate.js          normais, Köppen-Geiger, climograma
  js/legend.js           legendas
  vendor/maplibre/       MapLibre GL JS 6.15 (WebGL2)
  data/gibs-catalog.json gerado por scripts/build-catalog.mjs
```
