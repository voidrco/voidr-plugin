#!/usr/bin/env python3
"""Validate recorded capability evidence without contacting any provider."""

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

REQUIRED = {
    "loki", "prometheus", "tempo", "github_blip_ai", "argo_history",
    "kafka_assignments_rebalances", "redis_snapshots", "vault_effective_config",
    "slack", "drive_docs",
}
STATES = {"disponível", "inacessível por permissão/interface", "não verificada", "não aplicável"}
COVERAGE = {
    "com evidência", "sem amostras", "não verificada", "fora da retenção comprovada",
    "inacessível por permissão/interface", "não aplicável",
}


def validate(data: object) -> list[str]:
    errors = []
    if not isinstance(data, dict):
        return ["preflight deve ser um objeto"]
    if type(data.get("schemaVersion")) is not int or data["schemaVersion"] != 1:
        errors.append("schemaVersion deve ser 1")
    if data.get("organization") != "Blip":
        errors.append("organization deve identificar Blip")
    try:
        instant = datetime.fromisoformat(str(data.get("checkedAt", "")).replace("Z", "+00:00"))
        if instant.tzinfo is None:
            errors.append("checkedAt precisa de fuso horário")
    except ValueError:
        errors.append("checkedAt deve ser um timestamp ISO preenchido")
    if not isinstance(data.get("causalCeiling"), str) or not data["causalCeiling"].strip():
        errors.append("causalCeiling deve declarar o limite causal")
    entries = data.get("capabilities")
    if not isinstance(entries, list):
        return errors + ["capabilities deve ser uma lista"]
    seen = set()
    for entry in entries:
        if not isinstance(entry, dict) or not isinstance(entry.get("id"), str):
            errors.append("capacidade deve ser objeto com id textual")
            continue
        key = entry["id"]
        if key in seen or key not in REQUIRED:
            errors.append(f"{key}: id duplicado ou desconhecido")
        seen.add(key)
        state = entry.get("status")
        if not isinstance(state, str) or state not in STATES:
            errors.append(f"{key}: status inválido")
        coverage = entry.get("historicalCoverage")
        if not isinstance(coverage, str) or coverage not in COVERAGE:
            errors.append(f"{key}: historicalCoverage inválida")
        fields = ("operation", "source", "scope", "evidence", "outcome") if state == "disponível" else ("reason",)
        for field in fields:
            if not isinstance(entry.get(field), str) or not entry[field].strip():
                errors.append(f"{key}: {field} obrigatório para {state}")
        outcome = entry.get("outcome")
        if state == "disponível" and (not isinstance(outcome, str) or outcome not in {"sucesso com dados", "sucesso sem amostras"}):
            errors.append(f"{key}: resultado precisa de sucesso real, não erro/inventário")
        if isinstance(coverage, str) and coverage in {"com evidência", "fora da retenção comprovada"}:
            if not isinstance(entry.get("historicalEvidence"), str) or not entry["historicalEvidence"].strip():
                errors.append(f"{key}: historicalEvidence obrigatória para esta cobertura")
        if state != "disponível" and coverage == "com evidência":
            errors.append(f"{key}: cobertura não pode alegar evidência de interface não comprovada")
    if REQUIRED - seen:
        errors.append("capacidades ausentes: " + ", ".join(sorted(REQUIRED - seen)))
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    args = parser.parse_args()
    try:
        data = json.loads(args.input.read_text(encoding="utf-8"))
        errors = validate(data)
    except (OSError, ValueError) as error:
        print(f"Preflight inválido: {error}", file=sys.stderr)
        return 2
    if errors:
        print("Preflight inválido:\n- " + "\n- ".join(errors), file=sys.stderr)
        return 2
    available = [entry["id"] for entry in data["capabilities"] if entry["status"] == "disponível"]
    print(json.dumps({
        "structureValid": True,
        "remoteSmokeProven": False,
        "availableRecorded": available,
        "causalCeiling": data["causalCeiling"],
        "notice": "Valida o registro, não a autenticidade da evidência nem o acesso aos provedores.",
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
