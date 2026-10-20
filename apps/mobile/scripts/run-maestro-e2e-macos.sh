#!/bin/sh

set -eu

# `login` and `restore` are the auth tracers. Any other mode names one flow of
# e2e/maestro/, and `all` runs every journey in `all_flows` order.
mode=${1:-login}

# Run after `restore` (login, expiry wait and restoration). planning-confirm
# goes before shopping-check-off, which checks off an item of its plan.
all_flows='planning-confirm shopping-check-off'

case "$mode" in
  login | restore | all) ;;
  '' | *[!a-z0-9-]*)
    printf 'Unknown Maestro E2E mode: %s\n' "$mode" >&2
    exit 1
    ;;
  *)
    if [ ! -f "e2e/maestro/$mode.yaml" ]; then
      printf 'Unknown Maestro E2E mode: %s\n' "$mode" >&2
      exit 1
    fi
    ;;
esac

if [ "$mode" = 'restore' ] || [ "$mode" = 'all' ]; then
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

run_flow() {
  maestro test \
    -e E2E_LOGIN_EMAIL="$E2E_LOGIN_EMAIL" \
    -e E2E_LOGIN_CODE="$E2E_LOGIN_CODE" \
    --test-output-dir=e2e/artifacts/maestro \
    "e2e/maestro/$1.yaml"
}

# The login flow, the wait for its access token to expire, then the cold
# relaunch that must restore the session.
run_restore() {
  run_flow login-verification
  sleep "$wait_seconds"
  maestro test \
    --test-output-dir=e2e/artifacts/maestro \
    e2e/maestro/authenticated-restoration.yaml
}

# `set -e` stops at the first flow that fails, with its exit status.
case "$mode" in
  login)
    run_flow login-verification
    ;;
  restore)
    run_restore
    ;;
  all)
    run_restore
    for flow in $all_flows; do
      run_flow "$flow"
    done
    ;;
  *)
    run_flow "$mode"
    ;;
esac
