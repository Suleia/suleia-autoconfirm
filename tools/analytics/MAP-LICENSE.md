# Cartografía de provincias

`provinces-source.json` procede de [es-atlas 0.6.0](https://unpkg.com/es-atlas@0.6.0/es/provinces.json).
Datos originales: Instituto Geográfico Nacional / CNIG, licencia CC BY 4.0.
[Fuente y licencia del distribuidor](https://github.com/martgnz/es-atlas).

`build-map.mjs` transforma el TopoJSON en trazados SVG, con las Canarias en un
recuadro. No hay descargas, servicios cartográficos ni seguimiento de usuarios
en tiempo de ejecución. El panel conserva la atribución visible.
