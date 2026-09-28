"""
scripts/benchmark_detector_training_env.py: measures a machine, trains nothing.

What is pinned: it fails clearly without CUDA; its estimates count only the
fit and selection splits; it writes no checkpoint and no experiment; its
output never looks like a detection metric; the card-size verdict comes from
a measurement, never from a default.
"""
from __future__ import annotations

import importlib.util
import json
import os

import pytest

from training import _paths
from training import config as training_config
from training.tests.test_cli import ROOT, _experiments, has_cuda, run

SCRIPT = "scripts/benchmark_detector_training_env.py"


def _module():
    spec = importlib.util.spec_from_file_location("benchmark", os.path.join(ROOT, SCRIPT))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


bench = _module()


@pytest.fixture(scope="module")
def config():
    return training_config.load(_paths.DEFAULT_CONFIG)


def test_without_cuda_it_says_so_and_exits_2(tmp_path):
    if has_cuda():
        pytest.skip("this machine has CUDA")
    out = tmp_path / "report.json"
    code, output = run(SCRIPT, "--no-dicom-scan", "--json", str(out))
    assert code == 2, output
    assert "GPU TRAINING BLOCKED — NO CUDA DEVICE" in output
    report = json.loads(out.read_text(encoding="utf-8"))
    assert report["verdict"] == "GPU TRAINING BLOCKED — NO CUDA DEVICE"
    assert report["measurements"] == []
    assert "NOT TRAINING" in report["label"] and "NOT A METRIC" in report["label"]


def test_the_cpu_smoke_run_is_labelled_as_not_a_benchmark(tmp_path):
    out = tmp_path / "smoke.json"
    code, output = run(SCRIPT, "--cpu-smoke", "--no-dicom-scan", "--json", str(out))
    assert code == 0, output
    report = json.loads(out.read_text(encoding="utf-8"))
    assert report["label"] == report["verdict"] == "CPU SMOKE — NOT A BENCHMARK"
    assert all(row["status"] == "ok" for row in report["measurements"])
    assert "sufficiency" not in report, "a CPU run must not say anything about GPU sizing"


def test_it_trains_nothing_and_writes_no_experiment(tmp_path):
    before = _experiments()
    run(SCRIPT, "--cpu-smoke", "--no-dicom-scan", "--json", str(tmp_path / "r.json"))
    assert _experiments() == before


def test_estimates_count_only_the_fit_and_selection_splits(config):
    availability = json.load(open(_paths.AVAILABILITY_INDEX, encoding="utf-8"))["perSplit"]
    est = bench.estimates(config, scan_dicom=False)
    negatives = int(config["sampling"]["negatives_per_series"])
    train, val = availability["train"], availability["validation"]
    assert est["samplesPerEpoch"] == {
        "train": train["nodulesAvailable"] + train["seriesAvailable"] * negatives,
        "validation": val["nodulesAvailable"] + val["seriesAvailable"] * negatives,
    }
    assert set(est["samplesPerEpoch"]) == {"train", "validation"}, "test and calibration never counted"


def test_the_cache_estimate_follows_the_stored_format(config):
    est = bench.estimates(config, scan_dicom=False)
    channels, side, _ = est["contextShape"]
    assert est["bytesPerCachedSample"] == channels * side * side * 2  # float16
    total = sum(est["samplesPerEpoch"].values()) * est["bytesPerCachedSample"]
    assert est["sampleCacheGB"] == round(total / float(1 << 30), 3)


def test_card_sizing_needs_a_measurement():
    assert bench.sufficiency([], 128)["measured"] is False
    assert bench.sufficiency([{"batchSize": 128, "status": "out_of_memory"}], 128)["measured"] is False


def test_card_sizing_applies_the_stated_headroom():
    rows = [{"batchSize": 128, "status": "ok", "trainPeakReservedGB": 7.0}]
    verdict = bench.sufficiency(rows, 128)
    # 7.0 GB exceeds 80% of 8 GB (6.4) and fits 80% of 12 GB (9.6).
    assert verdict["sufficient"] == {"8GB": False, "12GB": True, "16GB": True, "24GB": True}


def test_no_projection_without_a_measured_configured_batch(config):
    est = bench.estimates(config, scan_dicom=False)
    assert bench.projections(est, [], config) == {"measured": False}
