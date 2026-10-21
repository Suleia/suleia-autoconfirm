# Suleia Ads Intelligence V4 · diagnóstico real

Periodo: **21/09–20/10/2026**, 30 días completos, Europe/Madrid. Lecturas Meta y operativas del 21/10/2026; las fuentes conservan su timestamp propio. Desarrollo para revisión: no fusionado ni desplegado. LIVE desactivado.

## Por qué entran pedidos en bloques

Hay **425 pedidos Shopify**, **439 de 720 horas sin pedidos** y **94 horas con dos o más pedidos**. Un Poisson homogéneo con 0,5903 pedidos/hora espera 85,5 horas con varias compras. Que haya compras consecutivas es compatible con azar; este modelo uniforme no explica toda la variación.

La varianza horaria es 0,8625 y la dispersión 1,4612. El contraste exploratorio Poisson por día de semana/hora, con 499 réplicas y reajuste de medias, devuelve p=0,002. Es evidencia de falta de ajuste, **no evidencia de que Meta agrupe ventas**. La binomial negativa ajustada por momentos (tamaño 1,2800) espera 97,9 horas con varias compras; ese ajuste usa la propia muestra y necesita validación fuera de muestra. Autocorrelación de primer retardo: 0.204; puede reflejar tendencia y estacionalidad, no necesariamente dependencia causal.

El intervalo mediano entre pedidos es **46,93 minutos**; el percentil 90, **266,67 minutos**. La correlación diaria gasto–pedidos es **0,884** en 30 observaciones: consistente con variaciones de volumen, confundida por tendencia, demanda y cambios de campaña. No mide calidad del tráfico ni causalidad.

**Conclusión:** las agrupaciones son reales en la creación de Shopify, así que un retraso de nuestro panel no puede ser la única explicación. Variación aleatoria, horarios y volumen explican parte del patrón; queda variación residual. No puede cuantificarse la contribución de subastas, aprendizaje, calidad del tráfico o retardo clic–compra con estas fuentes.

Gráfico exportable: `analisis-horario.png` (entrega privada fuera de Git).

Gráfico exportable: `mapa-pedidos.png` (entrega privada fuera de Git).

## Atribución, operaciones y contra reembolso

**412/425 pedidos** preservan un ID de anuncio exacto en «UTM medium» y un origen Facebook válido. Se resuelve la jerarquía ad → campaña desde el inventario real, sin coincidencias de nombres ni fechas. Los otros **13 permanecen NO_ATRIBUIDOS**. Esta trazabilidad del origen **no equivale** a atribución causal ni al contrato 7d_click + 1d_view de Meta. Los campos UTM de campaña/contenido contienen nombres; no se usan como claves.

La unión HMAC de la referencia exacta encuentra **418/425 pedidos** en el espejo Dropea, sin duplicados: 321 tienen fecha de confirmación y 195 fecha de entrega. Son estados operativos, no liquidaciones de contra reembolso. Siete referencias no enlazadas no se consideran automáticamente perdidas.

La cohorte exploratoria con al menos 14 días de madurez (creación hasta 2026-10-06) contiene **203 pedidos**, de los cuales 202 enlazan con operaciones y 100 tienen entrega. Deben contrastarse plazos reales antes de declarar 14 días una regla definitiva. Faltan cobros liquidados y costes reales por pedido para acreditar beneficio por campaña. Hay tarifas verificadas en finanzas; una tarifa no equivale a una factura/coste aplicado.

Los tres niveles Meta concilian **3.482,72 €** de gasto y **413 compras observadas** con la misma atribución. En las filas diarias de campaña, 17 de 132 no exponen el alias de compra requerido; no se convierten a cero ni se publica ROAS/CPA global como completo. Shopify y Meta no se concilian restando sus compras: tienen contratos distintos.

## Cambios presupuestarios y estrategia nocturna

Hay **315 cambios de importe** reconstruibles con estructura payment_amount/EUR. Las sumas se conservan en céntimos, sin inferir importes de cadenas o formatos desconocidos. El CSV adjunto contiene cada cambio y ventanas de 1, 3 y 7 días, madurez y cambios simultáneos. También se capturan 156 actividades de hoy para proteger propuestas actuales; no se mezclan con el periodo histórico completo.

La aplicación registrada para los 315 cambios es **Power Editor**. Esto identifica la aplicación, no demuestra autor humano ni descarta automatizaciones. **No hay reglas nativas devueltas actualmente**. No hay decisiones registradas del simulador VPS en los últimos 30 días. El código de simulación sí contiene un tope nocturno de 35 €, franja 00:00–07:00, límite 15–70 € e incrementos de 10 € con ROAS >6: no está acreditado como ejecutor de esos cambios.

Las reducciones se concentran especialmente a las 21:00–23:59 y hay subidas a las 06:00. No coincide exactamente con el horario 00:00/07:00 del simulador. **La estrategia noche/mañana no tiene ventaja causal demostrada.** Hay cambios de estado, creatividad, público y puja próximos a muchas modificaciones; las comparaciones antes/después quedan confundidas.

De 00:00–06:59 se registran **367.40 € (10.5 % del gasto)** y **47 pedidos (11.1 %)**. Son relojes y ámbitos distintos: no se calcula un CPA nocturno mezclándolos ni se recomienda eliminar esa franja.

Gráfico exportable: `horarios-presupuestos.png` (entrega privada fuera de Git).

## Recomendaciones y política propuesta

1. Mantener los límites actuales: bot 100 €/día y 10 % por cambio; el simulador VPS V1 tiene otra política, 15–70 €/día y tope nocturno 35 €. No activar ambos como propietarios de presupuesto.
2. Mantener mientras falten margen cobrado, muestra multidiaria, datos frescos o conciliación de cambios externos. Una compra aislada, unas horas sin ventas o frecuencia alta sin deterioro no justifican intervenir.
3. Proponer para revisión una política única: propietario exclusivo por campaña, límite absoluto vigente, porcentaje vigente, variación acumulada máxima 10 %/día, máximo un cambio diario y 72 h de observación. Los umbrales diagnósticos son candidatos versionados; no sustituyen autorización financiera ni garantizan conservar aprendizaje. Un incremento de 10 € solo es posible si satisface **todos** los límites. Con cap 100 € y 10 %, no existe presupuesto de partida que permita +10 €; no se relajan límites para hacerlo funcionar.
4. Antes de elegir estrategia nocturna: experimento prospectivo autorizado, grupos comparables no solapados, creatividades y pujas constantes, al menos dos ciclos semanales y madurez logística/atribución; calcular potencia antes de fijar duración. Métrica primaria: margen cobrado por cohorte; CPA y entregados como salvaguardas. Parar ante pérdida aprobada, fallos de medición, cambios externos o contaminación.
5. Preservar UTMs con IDs explícitos de campaña/conjunto/anuncio y versión de captura, sin sobrescribir los existentes. Añadir enlace estable a pedido y liquidación; comparar trazabilidad UTM, Meta y cobros como contratos separados. No se ha modificado la tienda ni el checkout.

## Datos técnicos y límites

El espejo marca ingestión incremental completa, cero errores y ciclo de cinco minutos. En 418 pedidos, creación Dropea → primera aparición en espejo: mediana 177,4 s; p95 318,8 s. No mide demora Shopify → Dropea ni actualización del navegador. Las tablas raw.ingestion_records y colas genéricas están vacías: no permiten reconstruir todo el historial de refresh/recepción. Los servicios relevantes estaban saludables durante la auditoría; se requieren más timestamps para atribuir las demoras individuales.

La API devuelve tráfico horario (2.838 filas) y acciones en el desglose horario (2.850 filas), pero no se ha validado que ese bucket sea la hora física de conversión. El panel conserva esa incertidumbre y no calcula tasas horarias incompatibles. Las páginas técnicas de Meta devolvieron 429/login; se contrastaron campos con el SDK oficial y consultas GET reales, sin inventar garantías sobre aprendizaje.

Fuentes: [SDK oficial Meta: insights](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adsinsights.py), [actividades](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adactivity.py), [NIST: Poisson](https://www.itl.nist.gov/div898/handbook/eda/section3/eda366j.htm), [Shopify: CustomerJourneySummary](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/CustomerJourneySummary). Evidencia de Suleia en capturas privadas de solo lectura; se omiten contactos y conversaciones.
