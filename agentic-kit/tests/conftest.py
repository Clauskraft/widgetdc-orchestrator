"""conftest.py — Shared pytest fixtures for WidgeTDC conformance tests."""
import os
import pytest
from fantom_validator import FantomContractValidator
from mrp_engine import MRPEngine
from router import DynamicRouter


@pytest.fixture(scope="session")
def neo4j_creds():
    uri  = os.environ.get("NEO4J_URI",      "bolt://localhost:7687")
    user = os.environ.get("NEO4J_USER",     "neo4j")
    pw   = os.environ.get("NEO4J_PASSWORD", "")
    if not pw:
        pytest.skip("NEO4J_PASSWORD not set — skip live conformance tests")
    return uri, user, pw


@pytest.fixture(scope="session")
def validator(neo4j_creds):
    uri, user, pw = neo4j_creds
    v = FantomContractValidator(uri, user, pw)
    yield v
    v.close()


@pytest.fixture(scope="session")
def mrp(neo4j_creds):
    e = MRPEngine()
    yield e
    e.close()


@pytest.fixture(scope="session")
def router(neo4j_creds):
    r = DynamicRouter()
    yield r
    r.close()
