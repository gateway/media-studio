"""Optional CI timing recorder. Does not change fixture lifetimes or test selection."""

import json
import os
import platform
import sys
from collections import Counter
from pathlib import Path
from time import perf_counter

import pytest


class TimingProfile:
    def __init__(self):
        self.started = perf_counter()
        self.collection_seconds = None
        self.initial_conftests_seconds = None
        self.collected = []
        self.phases = []
        self.fixtures = []

    @pytest.hookimpl(wrapper=True)
    def pytest_load_initial_conftests(self):
        started = perf_counter()
        try:
            return (yield)
        finally:
            self.initial_conftests_seconds = perf_counter() - started

    @pytest.hookimpl(wrapper=True)
    def pytest_collection(self):
        started = perf_counter()
        try:
            return (yield)
        finally:
            self.collection_seconds = perf_counter() - started

    def pytest_collection_finish(self, session):
        self.collected = [item.nodeid for item in session.items]

    @pytest.hookimpl(wrapper=True)
    def pytest_fixture_setup(self, fixturedef, request):
        started = perf_counter()
        try:
            return (yield)
        finally:
            self.fixtures.append({
                "nodeid": request.node.nodeid,
                "fixture": fixturedef.argname,
                "scope": fixturedef.scope,
                "seconds": perf_counter() - started,
            })

    def pytest_runtest_logreport(self, report):
        self.phases.append({
            "nodeid": report.nodeid,
            "phase": report.when,
            "outcome": report.outcome,
            "seconds": report.duration,
        })

    def write(self, output, exit_code):
        totals = Counter()
        for phase in self.phases:
            totals[phase["phase"]] += phase["seconds"]
        report = {
            "schema_version": 1,
            "exit_code": int(exit_code),
            "wall_seconds": perf_counter() - self.started,
            "initial_conftests_seconds": self.initial_conftests_seconds,
            "collection_seconds": self.collection_seconds,
            "phase_seconds": dict(totals),
            "collected": self.collected,
            "phases": self.phases,
            "fixture_setups": self.fixtures,
            "runtime": {
                "python": platform.python_version(),
                "pytest": pytest.__version__,
                "platform": platform.platform(),
                "runner_os": os.environ.get("RUNNER_OS"),
                "runner_arch": os.environ.get("RUNNER_ARCH"),
                "image_os": os.environ.get("ImageOS"),
                "image_version": os.environ.get("ImageVersion"),
                "commit": os.environ.get("GITHUB_SHA"),
                "run_id": os.environ.get("GITHUB_RUN_ID"),
                "run_attempt": os.environ.get("GITHUB_RUN_ATTEMPT"),
            },
        }
        Path(output).write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")


def main():
    output, *args = sys.argv[1:]
    profile = TimingProfile()
    exit_code = pytest.ExitCode.INTERNAL_ERROR
    try:
        exit_code = pytest.main(args, plugins=[profile])
    finally:
        profile.write(output, exit_code)
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
