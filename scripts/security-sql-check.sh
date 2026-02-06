#!/usr/bin/env bash
set -euo pipefail

# Fail on common SQL interpolation footguns in app/lib files.
# Use PCRE2 for \${} detection. False positives can be suppressed with a comment: "sqlcheck:ignore".

TARGETS=(app lib)

rg --pcre2 -n "(SELECT|UPDATE|DELETE|INSERT)[\s\S]*\$\{" -g "*.{ts,tsx,js,jsx}" "${TARGETS[@]}" && {
  echo "Found possible SQL template interpolation. Use parameterized queries." >&2
  exit 1
} || true

rg -n "(SELECT|UPDATE|DELETE|INSERT).*\+" -g "*.{ts,tsx,js,jsx}" "${TARGETS[@]}" && {
  echo "Found possible SQL concatenation. Use parameterized queries." >&2
  exit 1
} || true

rg -n "WHERE .*='\$\{" -g "*.{ts,tsx,js,jsx}" "${TARGETS[@]}" && {
  echo "Found possible SQL interpolation in WHERE clause." >&2
  exit 1
} || true

echo "SQL interpolation check passed."
