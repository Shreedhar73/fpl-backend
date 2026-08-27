"""B-035/B-037 - fit one XGBoost per position on the B-034 export.

Two targets. 'points' trains on totalPoints directly (the first v4). 'residual' trains on
totalPoints - v3ep, the correction to the incumbent (B-037 increment 2): the decomposed model keeps
pricing what it prices exactly - the 2-4 point appearance band the RMSE fit under-served - and the
trees learn only what it gets wrong. The emitted JSON carries `target`; the TS harness adds the base
back for residual models. Select with --target, default residual.

Split discipline is v3's, reused not reinvented (calibration.service.ts):
  TRAIN     2023-24  +  2024-25 rounds < 20
  VALIDATE  2024-25 rounds >= 20      -- hyperparameters and early stopping ONLY
  TEST      2025-26                   -- never fitted, never tuned on, not even looked at here

The models are emitted as XGBoost's own JSON dump plus a provenance header, and a parity fixture of
held-row predictions the TypeScript scorer must reproduce to 1e-6. TEST rows are scored ONCE, blind,
into the parity fixture - the numbers are for reproduction, not for tuning, and no aggregate of them
is printed here so nobody can tune on a console line.
"""
import json
import hashlib
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb

ROOT = Path(__file__).resolve().parents[2]
DATASETS = ROOT / "reports" / "datasets"
OUT = ROOT / "src" / "modules" / "projections" / "v4"
POSITIONS = ["GKP", "DEF", "MID", "FWD"]
SEED = 20260827
VALIDATE_FROM_ROUND = 20  # calibration.service.ts VALIDATE_FROM_ROUND
TEST_SEASON = "2025-26"

# Modest grid, deliberately: 3 seasons is not OpenFPL's 4, and a big K-Best search over-fits a
# half-season validation set. 24 candidates per position. gamma and the higher min_child_weight
# exist for the residual target: an unregularised tree happily "corrects" the 0-2 point band where
# the incumbent is already exact, which is pure added variance - measured as a 7.2% Blanks
# degradation on the first residual fit. Selection stays on VALIDATE.
# The union grid, fixed here as final for this cycle: 36 candidates, selected on VALIDATE only.
# Three architectures had already been read against TEST (direct, residual, regularised residual),
# which is the edge of what a holdout survives - so the grid is frozen as the union of everything
# tried, the selection rule is val RMSE and nothing else, and the next TEST reading is the last.
GRID = [
    {"max_depth": d, "learning_rate": lr, "min_child_weight": mcw, "gamma": g}
    for d in (3, 4, 5)
    for lr in (0.03, 0.06)
    for mcw in (5, 20, 100)
    for g in (0.0, 2.0)
]
FIXED = {
    "n_estimators": 2000,
    "subsample": 0.8,
    "colsample_bytree": 0.8,
    "objective": "reg:squarederror",
    "eval_metric": "rmse",
    "early_stopping_rounds": 50,
    "random_state": SEED,
    "n_jobs": -1,
}


def load(position: str) -> pd.DataFrame:
    df = pd.read_csv(DATASETS / f"v4-{position}.csv")
    # empty cells are missing history; pandas already reads them as NaN, which XGBoost handles
    return df


def split(df: pd.DataFrame):
    train = df[
        (df.season == "2023-24")
        | ((df.season == "2024-25") & (df["round"] < VALIDATE_FROM_ROUND))
    ]
    val = df[(df.season == "2024-25") & (df["round"] >= VALIDATE_FROM_ROUND)]
    test = df[df.season == TEST_SEASON]
    assert len(train) and len(val) and len(test)
    # the one guarantee that matters: no TEST row anywhere near the fit
    assert not (set(train.index) | set(val.index)) & set(test.index)
    return train, val, test


def feature_columns(df: pd.DataFrame) -> list[str]:
    # v3epBase is the residual base (identity), v3ep the feature copy the trees may read.
    return [c for c in df.columns if c not in ("season", "round", "fixture", "playerCode", "position", "totalPoints", "v3epBase")]


def main(target: str = "residual") -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((DATASETS / "manifest.json").read_text())
    provenance = {
        "date": datetime.now(timezone.utc).isoformat(),
        "seed": SEED,
        "datasetGenerated": manifest["generated"],
        "datasetRows": manifest["totalRows"],
        "versions": {
            "python": sys.version.split()[0],
            "xgboost": xgb.__version__,
            "pandas": pd.__version__,
            "numpy": np.__version__,
        },
        "split": {
            "train": "2023-24 + 2024-25 r<20",
            "validate": "2024-25 r>=20 (hyperparameters only)",
            "test": TEST_SEASON + " (never fitted, never tuned on)",
        },
    }

    parity_rows = []
    for position in POSITIONS:
        df = load(position)
        cols = feature_columns(df)
        train, val, test = split(df)
        label = (lambda part: part["totalPoints"] - part["v3epBase"]) if target == "residual" else (lambda part: part["totalPoints"])
        Xtr, ytr = train[cols], label(train)
        Xva, yva = val[cols], label(val)

        best, best_rmse, best_params = None, float("inf"), None
        for params in GRID:
            model = xgb.XGBRegressor(**FIXED, **params)
            model.fit(Xtr, ytr, eval_set=[(Xva, yva)], verbose=False)
            rmse = float(np.sqrt(np.mean((model.predict(Xva) - yva) ** 2)))
            if rmse < best_rmse:
                best, best_rmse, best_params = model, rmse, params
        assert best is not None

        booster = best.get_booster()
        dump = json.loads(booster.save_raw("json").decode())
        out = {
            "position": position,
            "target": target,
            "provenance": provenance,
            "hyperparameters": {**best_params, "best_iteration": int(best.best_iteration)},
            "validationRmse": best_rmse,
            "features": cols,
            "baseScore": None,  # read from the model JSON by the scorer
            "model": dump,
        }
        path = OUT / f"model-{position}.json"
        path.write_text(json.dumps(out) + "\n")
        digest = hashlib.sha256(path.read_bytes()).hexdigest()[:16]
        print(f"{position}: {len(train)} train / {len(val)} val rows, "
              f"depth={best_params['max_depth']} lr={best_params['learning_rate']} "
              f"mcw={best_params['min_child_weight']} iter={best.best_iteration} "
              f"val_rmse={best_rmse:.4f} sha={digest}")

        # Parity fixture: 50 TEST rows per position, scored blind. No aggregate printed.
        sample = test.sample(n=min(50, len(test)), random_state=SEED)
        preds = best.predict(sample[cols])
        for (_, row), pred in zip(sample.iterrows(), preds):
            parity_rows.append({
                "position": position,
                "season": row["season"],
                "round": int(row["round"]),
                "fixture": int(row["fixture"]),
                "playerCode": int(row["playerCode"]),
                "features": {c: (None if pd.isna(row[c]) else float(row[c])) for c in cols},
                "expected": float(pred),
            })

    (OUT / "parity-fixture.json").write_text(json.dumps({
        "note": "TEST-season rows scored blind by the Python fit. model-v4.ts must reproduce "
                "'expected' to 1e-6. Regenerated only by tools/fit-v4/fit.py; drift here means the "
                "TS scorer and the committed models no longer agree.",
        "rows": parity_rows,
    }, indent=1) + "\n")
    print(f"parity fixture: {len(parity_rows)} rows")


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", choices=["points", "residual"], default="residual")
    main(ap.parse_args().target)
