# Protocolo de gravação e método de análise

## Gravação

| | Vídeo de lado | Vídeo de trás |
|---|---|---|
| Distância | 2 a 3 m, perpendicular ao sentido de corrida | 2 a 3 m, centrado atrás do corredor |
| Altura da câmara | Joelho (50 a 70 cm) | Joelho (40 a 50 cm) |
| Enquadramento | Corpo inteiro, margem nos pés | Corpo inteiro, calcanhares e gémeos visíveis |
| Duração | 15 s de corrida estável | 15 s de corrida estável |

- Passadeira ao ritmo de treino fácil, inclinação 1 %, depois de 5 min de aquecimento. Sem passadeira: piso plano, 15 m de corredor, câmara fixa a meio.
- Telemóvel em tripé, na horizontal, sem zoom nem panorâmica.
- Câmara lenta a 120 ou 240 fps. O contacto inicial dura ~30 ms: a 30 fps o ângulo de ataque é subestimado.
- Luz frontal, fundo liso, sem contraluz. Calções ou leggings curtas, meias e sapatilhas contrastantes, t-shirt justa.

## Método

Pose 2D com MediaPipe Pose Landmarker (33 pontos, incluindo calcanhar e ponta do pé), corrido no browser, frame a frame.

1. Limpeza: correção de troca esquerda/direita, preenchimento de falhas curtas, filtro Butterworth passa-baixo de 2.ª ordem sem desfasamento (8 Hz).
2. Período da passada por autocorrelação do sinal vertical do pé (independente do fps).
3. Apoios: o ponto mais baixo do pé dentro de 5 % do comprimento da perna acima da linha do chão (percentil 95 móvel).
4. Câmara lenta: se a cadência descodificada for < 125 ppm, procura o fator (×2, ×4, ×8…) que a põe entre 130 e 235 ppm.

### Vista lateral

| Métrica | Definição | Referência |
|---|---|---|
| Ângulo de ataque | Ângulo calcanhar–ponta no contacto menos o ângulo a meio do apoio (pé assente) | Calcanhar > 8°, antepé < -1,6° (Altman & Davis, 2012) |
| Tíbia no contacto | Inclinação joelho–tornozelo; + = tornozelo à frente | 0° a 8° |
| Calcanhar à frente da anca | Distância horizontal / comprimento da perna | ≤ 25 % |
| Joelho no contacto | Flexão anca–joelho–tornozelo | 15° a 30° |
| Flexão máxima no apoio | | 35° a 52° |
| Tronco | Linha anca–ombro vs vertical | 3° a 12° |
| Oscilação vertical | Amplitude da anca por passo; cm = % perna × 0,46 × altura | ≤ 8 cm |
| Cadência | 60 / mediana do tempo entre apoios alternados | 165 a 185 ppm |

### Vista de trás

| Métrica | Definição | Referência |
|---|---|---|
| Pronação | Pico (10–70 % do apoio) do ângulo tornozelo–calcanhar vs canela; + = eversão | Neutro 4° a 10°; < 4° supinador; > 10° pronador |
| Queda da anca | Obliquidade da bacia no apoio menos a mediana do clip | ≤ 5°; > 8° acentuada |
| Joelho para dentro | Ângulo de projeção frontal (FPPA) no apoio | ≤ 8° |
| Largura da passada | Tornozelo vs linha média a 40 % do apoio, % da largura da bacia | > 15 %; < 0 = cruzamento |

## Limites

- Medição 2D sem marcadores: serve para triagem e para comparar antes/depois, não para diagnóstico.
- A pronação é a métrica menos fiável (o calcanhar do modelo é um ponto estimado). A confiança da vista de trás nunca passa de «média».
- A evidência para escolher sapatilhas pelo tipo de pisada é fraca; o conforto é melhor critério.
