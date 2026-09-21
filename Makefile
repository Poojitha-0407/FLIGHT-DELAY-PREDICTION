# Flight Delay Platform - one target per phase.
#
#   make setup      once, creates .venv and installs everything
#   make download   phase 1, ~3 GB of BTS + IEM + OpenFlights into data/raw/
#   make verify     checks the downloads cover the full year
#   make transform  phase 2, DuckDB SQL -> data/processed/features.parquet
#   make train      phase 3, LightGBM
#   make evaluate   phase 3, held-out metrics into ml/reports/
#   make export     phase 3, artifacts into web/api/_artifacts/
#   make api        phase 4, the API alone on :8000
#   make web        phase 5, the frontend on :3000, proxying to :8000
#
#   make all        transform -> train -> evaluate -> export

SHELL := /bin/bash
VENV := .venv
PY := $(VENV)/bin/python
PIP := uv pip install --python $(PY)

LGB_LIB := $(VENV)/lib/python3.12/site-packages/lightgbm/lib

.PHONY: all setup libomp download verify lint transform train evaluate export api web dev smoke clean clean-data help

help:
	@sed -n '2,14p' $(MAKEFILE_LIST) | sed 's/^# \{0,1\}//'

# ----------------------------------------------------------------- phase 0
setup:
	@command -v uv >/dev/null || { echo "uv not found: https://docs.astral.sh/uv/"; exit 1; }
	uv venv --python 3.12 $(VENV)
	$(PIP) -r requirements-dev.txt
	$(PIP) "fastapi==0.115.6" "uvicorn[standard]" "httpx==0.28.1"
	@$(MAKE) --no-print-directory libomp
	@$(PY) -c "import lightgbm, duckdb; print('lightgbm', lightgbm.__version__, '| duckdb', duckdb.__version__)"

# LightGBM's macOS wheel links against libomp, which macOS does not ship and
# which normally arrives via Homebrew. scikit-learn's wheel already bundles a
# copy, so vendor that one next to lib_lightgbm.dylib and teach the loader to
# look beside itself. Everything stays inside .venv, and no environment
# variable is needed - which matters because macOS strips DYLD_* across the
# process spawn that `uvicorn --reload` performs.
libomp:
	@if [ "$$(uname)" != "Darwin" ]; then echo "libomp: not macOS, nothing to do"; exit 0; fi; \
	if $(PY) -c "import lightgbm" 2>/dev/null; then echo "libomp: already resolvable"; exit 0; fi; \
	cp $(VENV)/lib/python3.12/site-packages/sklearn/.dylibs/libomp.dylib $(LGB_LIB)/ && \
	install_name_tool -add_rpath @loader_path $(LGB_LIB)/lib_lightgbm.dylib && \
	codesign -f -s - $(LGB_LIB)/lib_lightgbm.dylib 2>/dev/null; \
	$(PY) -c "import lightgbm" && echo "libomp: vendored into $(LGB_LIB)"

# ----------------------------------------------------------------- phase 1
download:
	$(PY) pipeline/download.py

# ----------------------------------------------------------------- phase 2
transform:
	$(PY) pipeline/run_sql.py

# ----------------------------------------------------------------- phase 3
train:
	$(PY) ml/train.py

evaluate:
	$(PY) ml/evaluate.py --plots

export:
	$(PY) ml/export.py

all: transform train evaluate export

# --------------------------------------------------------------- phases 4-5
# Local development runs the two halves as separate processes: uvicorn on
# :8000 and Next.js on :3000, which proxies /api/* to it (see next.config.js).
# No Vercel account needed.
api:
	cd web/api && ../../$(PY) -m uvicorn index:app --reload --port 8000

web:
	cd web && npm run dev

# The deployed shape: Next.js and the Python function under one server.
# Needs the Vercel CLI and a linked project.
dev:
	cd web && npx vercel dev

# ------------------------------------------------------------------- checks
# Runs the whole SQL pipeline against generated stand-in data. Confirms the
# joins and the schema without waiting for a 6 GB download.
smoke:
	$(PY) pipeline/sample_data.py
	$(PY) pipeline/run_sql.py
	$(PY) ml/train.py --rounds 50 --early-stopping 10
	$(PY) ml/evaluate.py
	$(PY) ml/export.py

# Python via ruff, frontend via the TypeScript compiler.
lint:
	uvx ruff check pipeline ml web/api --select F,E,W --line-length 100
	cd web && npx tsc --noEmit

clean:
	rm -rf ml/artifacts ml/reports web/api/_artifacts web/api/__pycache__ \
	       pipeline/__pycache__ ml/__pycache__

clean-data:
	rm -rf data/processed

verify:
	$(PY) pipeline/download.py --verify
