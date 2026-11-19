"""Puente JSON-lines para el servidor: una solicitud por línea en stdin, una respuesta por línea en stdout."""
import json
import sys

from predict import predecir  # el directorio del script ya está en sys.path

for line in sys.stdin:
    try:
        req = json.loads(line)
        out = predecir({"id_solicitud": req["id"], "county_fips": req.get("county_fips")})
    except Exception as e:  # una línea mal formada no debe matar el puente
        out = {"id_solicitud": None, "status": "error", "mensaje": str(e)}
    print(json.dumps(out, ensure_ascii=False), flush=True)
