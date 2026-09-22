"""
inference/server.py imports, and its routes are the ones it claims.

Worth a test of its own because of how this file fails. FastAPI evaluates an
endpoint's annotations when the decorator runs, which is import time, so a
`list[UploadFile]` in one endpoint's signature raises a TypeError under the
Python 3.8 this service is deployed on and takes down *every* endpoint — skin,
lung, nodule, /healthz — not just the new one. It reached a running service
once: the whole process refused to start with

    TypeError: Unable to evaluate type annotation 'list[UploadFile]'

and the 88 tests in this suite were all green, because not one of them
imported the module that serves them.

The import is the assertion. Everything below it is a cheap check that the
surface did not change silently.
"""
from __future__ import annotations

import sys

import pytest

pytest.importorskip("fastapi", reason="fastapi absent")


@pytest.fixture(scope="module")
def app():
    """The real application object, imported exactly as uvicorn imports it.

    Slow — importing it loads the resident models — and deliberately not
    skippable on a missing artifact: a model that cannot be loaded is a state
    the service handles, whereas a module that cannot be imported is not.
    """
    import server  # noqa: PLC0415

    return server.app


def routes(app) -> dict:
    return {
        route.path: sorted(route.methods)
        for route in app.routes
        if getattr(route, "methods", None)
    }


def test_the_service_imports_under_the_deployed_interpreter(app):
    assert app is not None
    # 3.8 is what the service runs on today. If this ever moves, the PEP 585
    # and 604 syntax in endpoint signatures becomes legal and this file's
    # reason for existing changes with it.
    assert sys.version_info >= (3, 8)


def test_every_endpoint_the_node_server_calls_is_registered(app):
    registered = routes(app)
    # Grad-CAM is not among them: an explanation is a flag on the inference
    # call, not an endpoint, so that it cannot be produced for a result the
    # model did not issue.
    for path, method in [
        ("/infer/skin", "POST"),
        ("/infer/lung", "POST"),
        ("/infer/lung_nodule", "POST"),
        ("/ingest/series", "POST"),
        ("/deidentify", "POST"),
        ("/healthz", "GET"),
    ]:
        assert path in registered, f"{path} is not registered"
        assert method in registered[path], f"{path} does not accept {method}"


def test_the_series_endpoint_streams_rather_than_returning_one_document(app):
    """A 133-slice study is roughly 93 MB of base64 as a single JSON body, held
    whole on both sides. The response type is part of the contract."""
    import inspect

    import server

    source = inspect.getsource(server.ingest_series)
    assert "StreamingResponse" in source
    assert "application/x-ndjson" in source
