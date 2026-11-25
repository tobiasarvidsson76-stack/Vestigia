#!/usr/bin/env bash

cd -- "$(dirname -- "${BASH_SOURCE[0]}")" || exit 1

if [[ -s /usr/local/share/nvm/nvm.sh ]]; then
    source /usr/local/share/nvm/nvm.sh
else
    if [[ ! -s "$HOME/.nvm/nvm.sh" ]]; then
        set -o pipefail
        curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.7/install.sh | bash || exit 1
    fi
    source "$HOME/.nvm/nvm.sh"
fi

nvm install 24 && (cd mobile && npm ci) && ./restart-expo
