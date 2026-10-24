import hashlib
import ssl
import unittest

import certifi


def _trusted_fingerprints():
    context = ssl.create_default_context(cafile=certifi.where())
    return {
        hashlib.sha256(certificate).hexdigest()
        for certificate in context.get_ca_certs(binary_form=True)
    }


class CertifiRuntimeTrustTests(unittest.TestCase):
    def test_withdrawn_emsign_roots_are_not_trusted(self):
        # GHSA-6q48-6c7w-9gw2; upstream 2026.10.23 withdraws G3, C1 and C3.
        withdrawn = {
            "86a1ecba089c4a8d3bbe2734c612ba341d813e043cf9e8a862cd5c57a36bbe6b",
            "125609aa301da0a249b97a8239cb6a34216f44dcac9f3954b14292f2e8c8608f",
            "bc4d809b15189d78db3e1d8cf4f9726a795da1643ca5f1358e1ddb0edc0d7eb3",
        }
        self.assertFalse(withdrawn & _trusted_fingerprints())

    def test_unaffected_roots_remain_trusted(self):
        retained = {
            # emSign G1 remains trusted upstream; Amazon Root CA 1 is a control.
            "40f6af0346a99aa1cd1d555a4e9cce62c7f9634603ee406615833dc8c8d00367",
            "8ecde6884f3d87b1125ba31ac3fcb13d7016de7f57cc904fe1cb97c6ae98196e",
        }
        self.assertTrue(retained <= _trusted_fingerprints())


if __name__ == "__main__":
    unittest.main()
