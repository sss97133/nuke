# Dependency Graph — Category Co-occurrence

Which categories appear together in the same session?

## Top 30 Co-occurring Pairs (raw count)

| Category A | Category B | Sessions Together | % of All Sessions |
|-----------|-----------|------------------|------------------|
| ops/debug | ui/vehicle-profile | 285 | 52.7% |
| meta/learning | ops/debug | 281 | 51.9% |
| data/extraction | meta/learning | 278 | 51.4% |
| data/extraction | ops/debug | 275 | 50.8% |
| meta/learning | ui/vehicle-profile | 270 | 49.9% |
| ui/general | ui/vehicle-profile | 267 | 49.4% |
| ops/debug | ui/general | 266 | 49.2% |
| data/extraction | ui/vehicle-profile | 265 | 49.0% |
| infra/database | ops/debug | 263 | 48.6% |
| meta/learning | ui/general | 262 | 48.4% |
| data/extraction | infra/database | 257 | 47.5% |
| infra/database | meta/learning | 254 | 47.0% |
| infra/database | ui/vehicle-profile | 254 | 47.0% |
| meta/learning | meta/next | 251 | 46.4% |
| data/extraction | ui/general | 250 | 46.2% |
| infra/database | ui/general | 246 | 45.5% |
| ui/vehicle-profile | yono/images | 246 | 45.5% |
| data/extraction | meta/next | 245 | 45.3% |
| meta/next | ops/debug | 245 | 45.3% |
| ops/debug | yono/images | 241 | 44.5% |
| meta/next | ui/vehicle-profile | 236 | 43.6% |
| meta/next | ui/general | 228 | 42.1% |
| meta/learning | yono/images | 227 | 42.0% |
| infra/database | meta/next | 225 | 41.6% |
| infra/database | yono/images | 223 | 41.2% |
| ui/general | yono/images | 221 | 40.9% |
| meta/learning | ui/search | 219 | 40.5% |
| data/extraction | yono/images | 219 | 40.5% |
| meta/codebase | meta/learning | 212 | 39.2% |
| data/extraction | ui/search | 211 | 39.0% |

## Top 30 by PMI (strongest association, min 5 co-occurrences)

| Category A | Category B | Co-occur | PMI | Interpretation |
|-----------|-----------|---------|-----|---------------|
| business/monetize | tool/stripe | 8 | 3.92 | strong |
| ui/dashboard | vision/condition | 6 | 3.69 | strong |
| infra/dns | ui/feedback | 5 | 3.64 | strong |
| ops/npm | vision/analysis | 6 | 3.46 | strong |
| meta/follow-up | ops/handoff | 6 | 3.10 | strong |
| business/sdk | meta/frustration | 5 | 3.07 | strong |
| data/pricing | vision/condition | 5 | 3.02 | strong |
| infra/monitoring | social/telegram | 6 | 2.99 | strong |
| config/creds | ops/github | 5 | 2.87 | strong |
| data/observation | ui/dashboard | 7 | 2.83 | strong |
| meta/follow-up | tool/claude | 6 | 2.81 | strong |
| business/monetize | ui/feedback | 6 | 2.80 | strong |
| infra/monitoring | ops/git | 5 | 2.77 | strong |
| infra/monitoring | tool/claude | 5 | 2.77 | strong |
| infra/api | ops/npm | 6 | 2.77 | strong |
| tool/cursor | vision/analysis | 5 | 2.76 | strong |
| tool/stripe | vision/analysis | 5 | 2.76 | strong |
| business/sdk | photos/mgmt | 5 | 2.76 | strong |
| agents/automation | meta/prompts | 9 | 2.76 | strong |
| infra/storage | ui/auction | 5 | 2.73 | strong |
| ui/design-system | vision/analysis | 9 | 2.73 | strong |
| business/monetize | tool/claude | 6 | 2.71 | strong |
| business/monetize | ui/dashboard | 5 | 2.69 | strong |
| photos/mgmt | vision/condition | 6 | 2.66 | strong |
| tool/stripe | ui/dashboard | 6 | 2.61 | strong |
| ui/dashboard | ui/design-system | 11 | 2.60 | strong |
| agents/frustration | hardware/obd | 5 | 2.57 | strong |
| infra/api | tool/stripe | 7 | 2.55 | strong |
| hardware/device | social/telegram | 8 | 2.53 | strong |
| infra/storage | ui/component | 5 | 2.49 | strong |

## Domain Co-occurrence Matrix

|  | meta | ui | data | infra | ops | yono | vision | pasted | social | business | agents | personal |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| meta | - | 404 | 395 | 373 | 365 | 284 | 267 | 166 | 254 | 260 | 234 | 224 |
| ui | 404 | - | 387 | 359 | 365 | 289 | 269 | 163 | 264 | 259 | 229 | 222 |
| data | 395 | 387 | - | 356 | 353 | 278 | 263 | 165 | 254 | 251 | 231 | 220 |
| infra | 373 | 359 | 356 | - | 340 | 273 | 255 | 165 | 241 | 246 | 222 | 205 |
| ops | 365 | 365 | 353 | 340 | - | 274 | 253 | 158 | 244 | 238 | 218 | 210 |
| yono | 284 | 289 | 278 | 273 | 274 | - | 221 | 133 | 201 | 203 | 183 | 179 |
| vision | 267 | 269 | 263 | 255 | 253 | 221 | - | 133 | 193 | 198 | 178 | 168 |
| pasted | 166 | 163 | 165 | 165 | 158 | 133 | 133 | - | 123 | 123 | 115 | 104 |
| social | 254 | 264 | 254 | 241 | 244 | 201 | 193 | 123 | - | 192 | 169 | 185 |
| business | 260 | 259 | 251 | 246 | 238 | 203 | 198 | 123 | 192 | - | 173 | 171 |
| agents | 234 | 229 | 231 | 222 | 218 | 183 | 178 | 115 | 169 | 173 | - | 164 |
| personal | 224 | 222 | 220 | 205 | 210 | 179 | 168 | 104 | 185 | 171 | 164 | - |