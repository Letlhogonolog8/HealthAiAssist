#!/usr/bin/env python3
"""Measure a cancer-detection model against a labelled image directory.

Produces the numbers that belong in a model card: sensitivity, specificity,
accuracy, and the majority-class baseline to compare them against. A model that
does not beat its baseline is not a working model, regardless of what the
training logs said.

Usage:
    python scripts/evaluate-model.py <model.h5> <data_dir> <class0> <class1>

`data_dir` must contain one subdirectory per class. Class order must match the
model's output index order (index 0 = class0, index 1 = class1).

Example:
    python scripts/evaluate-model.py \\
        dataset/data/resnet50v2_skin_cancer_model.h5 \\
        dataset/dataset/data/test benign malignant
"""
import json
import os
import sys

import numpy as np
from PIL import Image
import tensorflow as tf

IMG_SIZE = (224, 224)

# The artifacts in this repo have no recorded preprocessing, so every plausible
# scheme is tried and the best reported. A real pipeline records exactly one.
SCHEMES = {
    "div255": lambda a: a / 255.0,
    "resnet_v2_preprocess": lambda a: tf.keras.applications.resnet_v2.preprocess_input(a.copy()),
    "raw_0_255": lambda a: a,
}


def load_dir(path):
    images = []
    for name in sorted(os.listdir(path)):
        try:
            img = Image.open(os.path.join(path, name)).convert("RGB").resize(IMG_SIZE)
            images.append(np.array(img, dtype=np.float32))
        except Exception:
            continue
    if not images:
        raise SystemExit(f"No readable images in {path}")
    return np.array(images)


def main():
    if len(sys.argv) != 5:
        raise SystemExit(__doc__)

    model_path, data_dir, class0, class1 = sys.argv[1:5]
    model = tf.keras.models.load_model(model_path)

    data = {c: load_dir(os.path.join(data_dir, c)) for c in (class0, class1)}
    n0, n1 = len(data[class0]), len(data[class1])
    baseline = max(n0, n1) / (n0 + n1)

    results = {}
    for scheme, fn in SCHEMES.items():
        p0 = model.predict(fn(data[class0]), verbose=0)
        p1 = model.predict(fn(data[class1]), verbose=0)

        # class1 is treated as the positive (disease) class
        tn = int((p0[:, 0] > p0[:, 1]).sum())
        fp = n0 - tn
        tp = int((p1[:, 1] > p1[:, 0]).sum())
        fn_ = n1 - tp

        sensitivity = tp / n1
        specificity = tn / n0
        results[scheme] = {
            "accuracy": round((tp + tn) / (n0 + n1), 4),
            "sensitivity": round(sensitivity, 4),
            "specificity": round(specificity, 4),
            # Mean of sensitivity and specificity. Raw accuracy is not a usable
            # selector on an imbalanced set: a classifier that answers "negative"
            # for every image scores the majority-class rate while detecting
            # nothing. Balanced accuracy scores that degenerate case at 0.5.
            "balancedAccuracy": round((sensitivity + specificity) / 2, 4),
            "confusion": {"TP": tp, "FN": fn_, "TN": tn, "FP": fp},
        }

    best = max(results, key=lambda k: results[k]["balancedAccuracy"])
    best_balanced = results[best]["balancedAccuracy"]
    # 0.5 balanced accuracy == chance. Compare with a margin so that noise around
    # chance does not read as a passing model.
    usable = best_balanced > 0.55

    report = {
        "model": os.path.basename(model_path),
        "dataset": data_dir,
        "positiveClass": class1,
        "counts": {class0: n0, class1: n1},
        "majorityClassBaseline": round(baseline, 4),
        "chanceBalancedAccuracy": 0.5,
        "byPreprocessing": results,
        "bestScheme": best,
        "bestBalancedAccuracy": best_balanced,
        "usable": usable,
    }
    print(json.dumps(report, indent=2))

    if not usable:
        print(
            f"\nFAIL: best balanced accuracy {best_balanced} is at or near chance "
            f"(0.5). This model does not discriminate and must not be served.",
            file=sys.stderr,
        )
        sys.exit(1)


if __name__ == "__main__":
    main()
