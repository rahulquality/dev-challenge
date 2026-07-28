#!/bin/bash

if [ "$PWD" = "/" ]; then
    echo "Error: No working directory set. Please set a WORKDIR in your Dockerfile before running this script."
    exit 1
fi

mkdir -p /logs/verifier

# pytest + pytest-json-ctrf are pre-installed in the verifier image (shared mode).
# allow_internet=false, so no wheels are resolved at run time — invoke pytest directly.
python -m pytest --ctrf /logs/verifier/ctrf.json /tests/test_outputs.py -rA
code=$?

# Surface pytest's raw exit code so the negative-control check can tell "tests ran
# and failed" (code 1, expected with no solution) from "tests could not run" (>=2).
echo "pytest exit code: ${code}"

if [ "$code" -eq 0 ]; then
  echo 1 > /logs/verifier/reward.txt
else
  echo 0 > /logs/verifier/reward.txt
fi
