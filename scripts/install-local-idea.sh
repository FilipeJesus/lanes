#!/usr/bin/env bash
set -euo pipefail

# Lanes Local Install Script (IntelliJ IDEA)
# Usage:
#   ./scripts/install-local-idea.sh
#   ./scripts/install-local-idea.sh /path/to/JetBrains/IdeaIC2024.1

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN_PROJECT_DIR="$ROOT_DIR/intellij-plugin"
TEMP_DIR=""

cleanup() {
  if [[ -n "${TEMP_DIR:-}" && -d "${TEMP_DIR:-}" ]]; then
    rm -rf "$TEMP_DIR"
  fi
}

trap cleanup EXIT

detect_ide_base_dir() {
  local os_name
  os_name="$(uname -s)"

  case "$os_name" in
    Linux*)
      echo "${XDG_CONFIG_HOME:-$HOME/.config}/JetBrains"
      ;;
    Darwin*)
      echo "$HOME/Library/Application Support/JetBrains"
      ;;
    *)
      return 1
      ;;
  esac
}

detect_latest_selector_from_config() {
  local config_base_dir="$1"
  if [[ ! -d "$config_base_dir" ]]; then
    return 1
  fi

  local latest_selector
  latest_selector="$(
    find "$config_base_dir" -maxdepth 1 -mindepth 1 -type d \
      \( -name 'IdeaIC*' -o -name 'IntelliJIdea*' \) 2>/dev/null \
      | xargs -r -n1 basename \
      | sort -V | tail -n 1
  )"

  if [[ -z "$latest_selector" ]]; then
    return 1
  fi

  echo "$latest_selector"
}

resolve_plugins_dir() {
  local selector="$1"
  local config_base_dir="$2"
  local data_base_dir="$3"

  local candidate_data="$data_base_dir/$selector"
  local candidate_config="$config_base_dir/$selector"

  if [[ -d "$candidate_data" ]]; then
    echo "$candidate_data"
    return 0
  fi

  if [[ -d "$candidate_config" ]]; then
    echo "$candidate_config"
    return 0
  fi

  # Default location for Linux/macOS JetBrains plugin path.
  echo "$candidate_data"
}

ensure_java() {
  if command -v java >/dev/null 2>&1 && [[ -n "${JAVA_HOME:-}" ]]; then
    return 0
  fi

  if command -v brew >/dev/null 2>&1; then
    local candidate
    for formula in openjdk@17 openjdk@21 openjdk; do
      candidate="$(brew --prefix "$formula" 2>/dev/null || true)"
      if [[ -n "$candidate" && -x "$candidate/bin/java" ]]; then
        export JAVA_HOME="$candidate"
        export PATH="$JAVA_HOME/bin:$PATH"
        return 0
      fi
    done
  fi

  if ! command -v java >/dev/null 2>&1; then
    echo "Error: Java is required. Install JDK 17+ and set JAVA_HOME." >&2
    exit 1
  fi
}

main() {
  ensure_java

  local selector
  local config_base_dir
  local data_base_dir
  config_base_dir="${HOME}/.config/JetBrains"
  data_base_dir="${HOME}/.local/share/JetBrains"

  if [[ $# -gt 0 ]]; then
    selector="$(basename "$1")"
  else
    local detected_base_dir
    detected_base_dir="$(detect_ide_base_dir || true)"
    if [[ -z "$detected_base_dir" ]]; then
      echo "Error: unsupported OS for auto-detection. Pass IDEA config dir explicitly." >&2
      exit 1
    fi
    config_base_dir="$detected_base_dir"
    selector="$(detect_latest_selector_from_config "$config_base_dir" || true)"
    if [[ -z "$selector" ]]; then
      echo "Error: could not auto-detect IntelliJ IDEA selector under: $config_base_dir" >&2
      echo "Run with an explicit path, e.g. ./scripts/install-local-idea.sh \"$config_base_dir/IntelliJIdea2025.3\"" >&2
      exit 1
    fi
  fi

  local plugins_root
  plugins_root="$(resolve_plugins_dir "$selector" "$config_base_dir" "$data_base_dir")"

  echo "Building extension artifacts..."
  cd "$ROOT_DIR"
  npm run compile

  echo "Building IntelliJ plugin archive..."
  cd "$PLUGIN_PROJECT_DIR"
  ./gradlew buildPlugin

  local plugin_zip
  plugin_zip="$(find "$PLUGIN_PROJECT_DIR/build/distributions" -maxdepth 1 -type f -name '*.zip' | sort -V | tail -n 1)"
  if [[ -z "$plugin_zip" ]]; then
    echo "Error: plugin archive not found in $PLUGIN_PROJECT_DIR/build/distributions" >&2
    exit 1
  fi

  mkdir -p "$plugins_root"
  TEMP_DIR="$(mktemp -d)"

  unzip -q -o "$plugin_zip" -d "$TEMP_DIR"

  local plugin_root
  plugin_root="$(find "$TEMP_DIR" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
  if [[ -z "$plugin_root" ]]; then
    echo "Error: could not extract plugin contents from $plugin_zip" >&2
    exit 1
  fi

  local plugin_name
  plugin_name="$(basename "$plugin_root")"
  rm -rf "$plugins_root/$plugin_name"
  cp -R "$plugin_root" "$plugins_root/"

  echo
  echo "Installed Lanes IntelliJ plugin locally:"
  echo "  $plugins_root/$plugin_name"
  echo "Target IDE selector:"
  echo "  $selector"
  echo "Restart IntelliJ IDEA to load the updated plugin."
}

main "$@"
