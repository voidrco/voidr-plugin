#!/usr/bin/env python3
"""Local negative and positive contract tests; all evidence is synthetic."""

import copy
import json
import unittest
from pathlib import Path
from validate_dsh_preflight import validate


class PreflightTests(unittest.TestCase):
    def setUp(self) -> None:
        self.data = json.loads(Path(__file__).with_name("dsh-preflight.template.json").read_text())
        self.data["checkedAt"] = "2026-10-07T00:00:00Z"

    def available(self) -> dict:
        entry = self.data["capabilities"][0]
        entry.update(status="disponível", operation="synthetic-read", source="mock", scope="test-only",
                     evidence="synthetic-response", outcome="sucesso sem amostras")
        return entry

    def test_unverified_is_not_available(self) -> None:
        self.assertEqual(validate(self.data), [])

    def test_unfilled_timestamp_rejected(self) -> None:
        self.data["checkedAt"] = ""
        self.assertTrue(validate(self.data))

    def test_wrong_organization_rejected(self) -> None:
        self.data["organization"] = "Serasa"
        self.assertTrue(validate(self.data))

    def test_inventory_without_evidence_rejected(self) -> None:
        self.data["capabilities"][0]["status"] = "disponível"
        self.assertTrue(validate(self.data))

    def test_permission_error_is_not_success(self) -> None:
        self.available()["outcome"] = "403"
        self.assertTrue(validate(self.data))

    def test_empty_query_does_not_prove_retention(self) -> None:
        self.available()["historicalCoverage"] = "fora da retenção comprovada"
        self.assertTrue(validate(self.data))

    def test_history_requires_evidence(self) -> None:
        self.available()["historicalCoverage"] = "com evidência"
        self.assertTrue(validate(self.data))

    def test_duplicate_and_missing_rejected(self) -> None:
        self.data["capabilities"][-1] = copy.deepcopy(self.data["capabilities"][0])
        self.assertTrue(validate(self.data))

    def test_unavailable_requires_reason(self) -> None:
        entry = self.data["capabilities"][0]
        entry.update(status="inacessível por permissão/interface", reason="")
        self.assertTrue(validate(self.data))

    def test_explicit_interface_proof_accepted(self) -> None:
        self.available()
        self.assertEqual(validate(self.data), [])

    def test_non_text_states_rejected_without_crash(self) -> None:
        self.data["capabilities"][0].update(status=[], historicalCoverage={})
        self.assertTrue(validate(self.data))

    def test_non_text_outcome_rejected_without_crash(self) -> None:
        self.available()["outcome"] = []
        self.assertTrue(validate(self.data))


if __name__ == "__main__":
    unittest.main()
