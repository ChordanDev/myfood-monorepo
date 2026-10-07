#!/bin/sh

set -eu

mode=${1:-login}

case "$mode" in
  login | restore) ;;
  *)
    printf 'Unknown Maestro E2E mode: %s\n' "$mode" >&2
    exit 1
    ;;
esac

if [ "$mode" = 'restore' ]; then
  wait_seconds=${E2E_ACCESS_TOKEN_EXPIRY_WAIT_SECONDS:-4}

  case "$wait_seconds" in
    '' | *[!0-9]*) wait_seconds='' ;;
  esac

  if [ -z "$wait_seconds" ] || [ "${#wait_seconds}" -gt 3 ] || [ "$wait_seconds" -lt 4 ] || [ "$wait_seconds" -gt 300 ]; then
    printf '%s\n' \
      'E2E_ACCESS_TOKEN_EXPIRY_WAIT_SECONDS must be an integer from 4 through 300.' \
      >&2
    exit 1
  fi
fi

java_major() {
  java_home=$1
  java_bin="$java_home/bin/java"

  [ -x "$java_bin" ] || return 1

  version_output=$($java_bin -version 2>&1) || return 1
  version=$(printf '%s\n' "$version_output" | sed -n '1s/.*version "\([^"]*\)".*/\1/p')
  [ -n "$version" ] || return 1

  case "$version" in
    1.*)
      major=${version#1.}
      major=${major%%.*}
      ;;
    *)
      major=${version%%.*}
      major=${major%%-*}
      ;;
  esac

  case "$major" in
    '' | *[!0-9]*) return 1 ;;
  esac

  printf '%s\n' "$major"
}

if [ -z "${E2E_LOGIN_EMAIL:-}" ]; then
  printf '%s\n' 'E2E_LOGIN_EMAIL is required.' >&2
  exit 1
fi

if [ -z "${E2E_LOGIN_CODE:-}" ]; then
  printf '%s\n' 'E2E_LOGIN_CODE is required.' >&2
  exit 1
fi

java_home_resolver=${E2E_JAVA_HOME_RESOLVER:-/usr/libexec/java_home}
brew_bin=${E2E_BREW_BIN:-brew}
resolved_java_home=''
resolved_java_major=''

if candidate=$($java_home_resolver -v 17 2>/dev/null); then
  if candidate_major=$(java_major "$candidate") && [ "$candidate_major" -ge 17 ]; then
    resolved_java_home=$candidate
    resolved_java_major=$candidate_major
  fi
fi

if [ -z "$resolved_java_home" ]; then
  if brew_prefix=$($brew_bin --prefix openjdk@17 2>/dev/null); then
    candidate="$brew_prefix/libexec/openjdk.jdk/Contents/Home"
    if candidate_major=$(java_major "$candidate") && [ "$candidate_major" -ge 17 ]; then
      resolved_java_home=$candidate
      resolved_java_major=$candidate_major
    fi
  fi
fi

if [ -z "$resolved_java_home" ]; then
  printf '%s\n' \
    'Java 17 or newer is required for Maestro. Neither macOS java_home nor Homebrew openjdk@17 provided a valid runtime.' \
    >&2
  exit 1
fi

export JAVA_HOME="$resolved_java_home"
export PATH="$JAVA_HOME/bin:$HOME/.maestro/bin:$PATH"

if ! command -v maestro >/dev/null 2>&1; then
  printf '%s\n' "Maestro was not found in $HOME/.maestro/bin or PATH." >&2
  exit 1
fi

printf 'Using Java %s from %s\n' "$resolved_java_major" "$JAVA_HOME"

run_login_flow() {
  maestro test \
    -e E2E_LOGIN_EMAIL="$E2E_LOGIN_EMAIL" \
    -e E2E_LOGIN_CODE="$E2E_LOGIN_CODE" \
    --test-output-dir=e2e/artifacts/maestro \
    e2e/maestro/login-verification.yaml
}

run_login_flow

if [ "$mode" = 'restore' ]; then
  sleep "$wait_seconds"
  exec maestro test \
    --test-output-dir=e2e/artifacts/maestro \
    e2e/maestro/authenticated-restoration.yaml
fi

if [ "$mode" = 'login' ]; then
  exit 0
fi
