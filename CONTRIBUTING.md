# Como contribuir

Obrigado pelo interesse! Este guia explica como rodar o projeto, onde fica cada coisa e o que conferir antes de abrir um pull request.

## Ambiente

Pré-requisitos: Windows 10/11 e [Node.js](https://nodejs.org) 20+.

```bash
npm install
npm run setup   # baixa os binários do Neutralinojs (não ficam no repositório)
npm run dev     # abre o app com DevTools (F12)
```

O app lê `resources/` direto do disco: depois de editar um arquivo, recarregue a janela (Ctrl+R no DevTools) ou reabra.

Para inspecionar o mapa no console, abra com `npm run dev -- --debug`: o objeto `window.atlas` expõe `map` (instância do MapLibre) e `state`.

## Onde fica cada coisa

| Quero mudar... | Arquivo |
|---|---|
| Camadas, mapas base, fontes de tiles | `resources/js/layers.js` |
| Interface, painel, ficha do ponto, busca | `resources/index.html`, `resources/css/app.css`, `resources/js/main.js` |
| Como os tiles são baixados (timeout, cache, fallback) | `resources/js/tiles.js` |
| Pré-carregamento | `resources/js/prefetch.js` |
| Leitura de valor por pixel | `resources/js/probe.js` |
| Clima, Köppen-Geiger, climograma | `resources/js/climate.js` |
| Instalador | `installer/atlas.iss`, `scripts/build-installer.mjs` |

## Adicionar uma camada da NASA

1. Encontre o id da camada no [GetCapabilities do GIBS](https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml) (projeção EPSG:3857).
2. Inclua o id em `LAYERS`, em `scripts/build-catalog.mjs`, e rode `npm run catalog`. O script grava em `resources/data/gibs-catalog.json` as datas disponíveis, o zoom máximo e a paleta de cores.
3. Adicione uma entrada em `OVERLAYS`, em `resources/js/layers.js`. Os campos principais:
   - `gibs(variante)`: devolve o id da camada;
   - `time`: `'monthly'` (usa a linha do tempo global) ou `'annual'`;
   - `format(entrada)` e `unit`: como mostrar o valor no selo e na ficha;
   - `tick(entrada)`: rótulos da legenda.
4. Confira o valor do selo em alguns pontos conhecidos.

Fontes que não sejam do GIBS funcionam igual, desde que sirvam tiles XYZ em Web Mercator com CORS liberado e não exijam chave de API.

## Estilo

- JavaScript moderno em módulos ES, sem framework e sem etapa de build.
- Comentários em português, explicando o **porquê** (decisões, medições, limitações de servidores).
- Textos da interface em português do Brasil.
- Não adicione dependências de runtime sem discutir antes numa issue: o app é pequeno de propósito.

## Antes de abrir o pull request

Não há testes automatizados ainda. Confira à mão, com `npm run dev` e o console aberto:

- [ ] O globo abre e carrega sem erros no console.
- [ ] Globo ↔ plano, terreno 3D e troca de mapa base funcionam.
- [ ] Ligar e desligar cada camada; a legenda aparece.
- [ ] O selo mostra valores ao passar o mouse sobre camadas ligadas.
- [ ] Clicar num ponto abre a ficha com clima e climograma.
- [ ] A busca (Ctrl+K) encontra um lugar e voa até ele.
- [ ] A linha do tempo troca o mês das camadas mensais.
- [ ] Se mexeu no instalador: `npm run installer`, instalar, abrir e desinstalar.

Descreva no PR o que mudou e como testou. Para mudanças visuais, inclua uma captura de tela.

## Publicar uma versão (mantenedores)

1. Atualize `version` em `package.json` e `neutralino.config.json`, e registre as mudanças no `CHANGELOG.md`.
2. Faça o commit e crie a tag: `git tag v1.2.3 && git push origin main --tags`.
3. O workflow [release.yml](.github/workflows/release.yml) gera o instalador no Windows e cria a release com ele anexado.
