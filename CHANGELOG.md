# Changelog

Todas as mudanças relevantes do projeto ficam registradas aqui. O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/), e as versões seguem o [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [1.0.0] - 2026-10-21

Primeira versão pública.

### Recursos
- Globo 3D e mapa plano, com atmosfera, inclinação e rotação.
- Terreno 3D com exagero vertical ajustável.
- Mapas base: satélite (Esri), Blue Marble (NASA) e escuro (Esri).
- Camadas: altitude e batimetria, sombreamento do relevo, densidade populacional (2000–2020), luzes noturnas (2012/2016), temperatura e precipitação mensais (1980 até hoje), vegetação NDVI mensal (2000 até hoje) e cobertura do solo (2001–2024).
- Selo junto ao cursor com o valor de cada camada ligada.
- Ficha de qualquer ponto: elevação, valores das camadas, classificação de Köppen-Geiger e climograma.
- Linha do tempo com animação mensal.
- Busca de lugares (Nominatim).
- Configurações e posição da câmera salvas entre sessões.
- Instalador para Windows (Inno Setup), por usuário, em português e inglês, que baixa o WebView2 se faltar.

### Desempenho e confiabilidade
- Pré-carregamento dos tiles ao redor da tela e dos níveis de zoom vizinhos.
- Fetch com timeout e pedido de reserva no host espelho para servidores que às vezes travam.
- Cache em memória para os tiles do NASA GIBS, que proíbe o cache do navegador.
- Elevação servida pelo Mapterhorn (CDN), ~6× mais rápido que a fonte anterior.
- Tiles de satélite ausentes no zoom máximo trocados pelo ancestral ampliado.

[1.0.0]: https://github.com/VonElfin/atlas/releases/tag/v1.0.0
