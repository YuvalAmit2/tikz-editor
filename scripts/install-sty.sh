#!/usr/bin/env bash
# Link tex/tikzfig.sty into your personal TeX folder, so every document can
# \usepackage{tikzfig} (yalatex loads it automatically when it's there).
set -eu
here=$(cd -P "$(dirname "$0")/.." && pwd)
texmf=$(kpsewhich -var-value TEXMFHOME)
dest="$texmf/tex/latex/tikzfig"
mkdir -p "$dest"
ln -sf "$here/tex/tikzfig.sty" "$dest/tikzfig.sty"
echo "Linked $dest/tikzfig.sty -> $here/tex/tikzfig.sty"
kpsewhich tikzfig.sty >/dev/null && echo "LaTeX finds it: $(kpsewhich tikzfig.sty)"
