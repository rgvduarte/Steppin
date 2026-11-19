# Steppin

Análise de passada a partir de vídeo, no browser. Carregas um vídeo de lado e um de trás e recebes um relatório: tipo de apoio (calcanhar, médio-pé, antepé), pronação (pronador, neutro, supinador), cadência, overstride, joelho, tronco, oscilação, queda da anca, valgo e largura da passada, com recomendações.

Os vídeos nunca saem do dispositivo: a deteção de pose (MediaPipe) corre localmente em WebAssembly/WebGL.

Design: linguagem GD (Gonçalo Duarte), minimal, Space Grotesk, liquid glass.

## Correr

```bash
npm install   # copia o runtime WASM e descarrega o modelo de pose para public/mediapipe
npm run dev
npm test
npm run build # gera dist/
```

## Publicar

`.github/workflows/pages.yml` publica `dist/` no GitHub Pages a cada push para `main`. Em *Settings → Pages*, a fonte tem de estar em **GitHub Actions**.

## Estrutura

- `src/pose.ts` · extração de pose frame a frame e capturas com esqueleto
- `src/analysis/` · filtragem, deteção de apoios, métricas laterais (`side.ts`) e traseiras (`rear.ts`), recomendações (`advice.ts`)
- `src/ui/` · relatório e gráficos SVG
- `docs/PROTOCOLO.md` · protocolo de gravação, definições e referências
