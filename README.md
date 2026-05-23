# Control de horas extras

Aplicacion local para cargar dias trabajados, indicar si fueron horas extras o a compensar, asociar WO-CM, agregar notas y marcar si la carga fue abonada.

## Como iniciar

1. Abrir una terminal en esta carpeta.
2. Ejecutar:

```powershell
python server.py
```

3. Abrir en el navegador:

```text
http://127.0.0.1:8000
```

La base de datos se crea automaticamente como `horas_extras.db`.

## Funciones

- Carga de fecha, tipo, cantidad, WO-CM y nota.
- Calendario mensual con dias resaltados segun horas cargadas.
- Checklist mensual para marcar abonado.
- Boton de notas por cada carga.
- Edicion y eliminacion de registros.
