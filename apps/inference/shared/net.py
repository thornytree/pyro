"""HTTPS for the data fetchers: certificate setup and a connection check in one place.

Check the connection from apps/inference before a long download:

    python -m shared.net

Certificates are verified against the operating system's trust store. If the
network or an antivirus product re-signs HTTPS traffic with its own root
certificate, Python fails with CERTIFICATE_VERIFY_FAILED ("self-signed
certificate in certificate chain"). Two ways to trust that root, no code change:

- `pip install truststore` (used automatically when installed): verifies the
  way the browser does, through the Windows / macOS certificate store.
- Export the root certificate as Base64 (.cer / .pem) and set the environment
  variable PYRO_CA_BUNDLE to its path.

Verification is never switched off: an intercepting network can hand back a
login page instead of data.
"""
from __future__ import annotations

import os
import socket
import ssl
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from functools import lru_cache

CA_BUNDLE_ENV = "PYRO_CA_BUNDLE"
CHECK_URLS = [
    "https://daymet.ornl.gov/single-pixel/api/data?lat=40&lon=-105&vars=tmax&start=2020-01-01&end=2020-01-03",
    "https://archive-api.open-meteo.com/v1/archive?latitude=40&longitude=-105"
    "&start_date=2020-01-01&end_date=2020-01-01&hourly=temperature_2m",
]


class CertificateProblem(SystemExit):
    """HTTPS certificate could not be verified. Not retried: every request would fail the same way."""


def uses_truststore() -> bool:
    try:
        import truststore  # noqa: F401
    except ImportError:
        return False
    return True


@lru_cache(maxsize=1)
def ssl_context() -> ssl.SSLContext:
    if uses_truststore():
        import truststore
        context = truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    else:
        context = ssl.create_default_context()
    extra = os.environ.get(CA_BUNDLE_ENV)
    if extra:
        context.load_verify_locations(cafile=extra)
    return context


def presented_issuer(host: str, port: int = 443) -> str:
    """Who signed the certificate this network presents for `host` (best effort, '' if unknown)."""
    path = None
    try:
        unverified = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        unverified.check_hostname = False
        unverified.verify_mode = ssl.CERT_NONE  # read-only look at the certificate; no data is fetched
        with socket.create_connection((host, port), timeout=15) as raw:
            with unverified.wrap_socket(raw, server_hostname=host) as tls:
                pem = ssl.DER_cert_to_PEM_cert(tls.getpeercert(binary_form=True))
        with tempfile.NamedTemporaryFile("w", suffix=".pem", delete=False) as handle:
            handle.write(pem)
            path = handle.name
        issuer = ssl._ssl._test_decode_cert(path)["issuer"]
        return ", ".join(value for part in issuer for _, value in part)
    except Exception:
        return ""
    finally:
        if path:
            os.unlink(path)


def _certificate_problem(url: str, reason: BaseException) -> CertificateProblem:
    host = urllib.parse.urlsplit(url).hostname or ""
    issuer = presented_issuer(host, urllib.parse.urlsplit(url).port or 443)
    lines = [
        f"HTTPS certificate for {host} could not be verified: {reason}",
        f"Certificate presented here was issued by: {issuer}" if issuer else "",
        "Something on this network or computer (TLS inspection, VPN, antivirus HTTPS scanning,"
        " a Wi-Fi login page) is re-signing HTTPS traffic. To fix it, either:",
        "  1. pip install truststore        (uses the system certificate store, as the browser does)",
        f"  2. set {CA_BUNDLE_ENV} to the exported root certificate (.pem / Base64 .cer)",
        "or try another network. See shared/net.py.",
    ]
    return CertificateProblem("\n".join(line for line in lines if line))


def open_url(request: urllib.request.Request | str, timeout: float):
    """urlopen with the shared certificate setup. Certificate failures raise CertificateProblem."""
    try:
        return urllib.request.urlopen(request, timeout=timeout, context=ssl_context())
    except urllib.error.HTTPError:
        raise
    except urllib.error.URLError as error:
        if isinstance(error.reason, ssl.SSLCertVerificationError):
            url = request if isinstance(request, str) else request.full_url
            raise _certificate_problem(url, error.reason) from None
        raise


def main() -> None:
    print(f"Python {sys.version.split()[0]}, OpenSSL {ssl.OPENSSL_VERSION}")
    print(f"truststore: {'in use' if uses_truststore() else 'not installed'}")
    for name in (CA_BUNDLE_ENV, "SSL_CERT_FILE", "SSL_CERT_DIR", "HTTPS_PROXY", "https_proxy"):
        if os.environ.get(name):
            print(f"{name} is set")
    failed = False
    for url in CHECK_URLS:
        host = urllib.parse.urlsplit(url).hostname
        try:
            with open_url(url, timeout=60) as response:
                print(f"OK    {host}: HTTP {response.status}, {len(response.read()):,} bytes")
        except CertificateProblem as problem:
            failed = True
            print(f"FAIL  {problem}")
        except Exception as error:
            failed = True
            print(f"FAIL  {host}: {error}")
    raise SystemExit(1 if failed else 0)


if __name__ == "__main__":
    main()
