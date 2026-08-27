"""
Renders a repository Markdown document to print-ready HTML.

For the evidence pack. A model card that lives only in a git repository is
checkable by an engineer and invisible to an evaluation panel, and the
reproduction commands are the part that makes the figures worth anything — so
they have to survive the trip to paper legibly.

    python scripts/render-doc.py MODEL_CARDS.md docs/pack/model-cards.html

Then either open it and print to PDF, or:

    agent-browser open file:///.../model-cards.html
    agent-browser pdf docs/pack/model-cards.pdf

Deliberately no external CSS or webfonts: the output must render identically on
a machine with no network, which is the situation a PDF is usually opened in.
"""
import io
import os
import re
import sys

import markdown

CSS = """
@page { size: A4; margin: 18mm 16mm 20mm 16mm; }

:root {
  --ink: #14191b;
  --ink-mid: #454f54;
  --ink-faint: #6b7378;
  --rule: #d4d8d4;
  --accent: #0e6e6b;
  --crit: #a8302a;
  --sunk: #f4f5f3;
}

* { box-sizing: border-box; }

body {
  font-family: "Source Serif 4", Georgia, "Times New Roman", serif;
  font-size: 10.5pt;
  line-height: 1.5;
  color: var(--ink);
  max-width: 190mm;
  margin: 0 auto;
  padding: 8mm 0;
  background: #fff;
}

h1, h2, h3, h4 {
  font-family: "Segoe UI", Arial, Helvetica, sans-serif;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--ink);
  page-break-after: avoid;
}
h1 { font-size: 21pt; border-bottom: 2.5pt solid var(--ink); padding-bottom: 4mm; margin: 0 0 6mm; }
h2 { font-size: 14pt; margin: 9mm 0 3mm; border-bottom: 0.5pt solid var(--rule); padding-bottom: 1.5mm; }
h3 { font-size: 11.5pt; margin: 6mm 0 2mm; }
h4 { font-size: 10pt; margin: 4mm 0 1.5mm; color: var(--ink-mid); }

p { margin: 0 0 3mm; orphans: 3; widows: 3; }
ul, ol { margin: 0 0 3mm; padding-left: 6mm; }
li { margin-bottom: 1.2mm; }

strong { font-weight: 600; }

/* Reproduction commands are the point of the document. They must be legible
   and must not wrap in a way that changes what they say. */
code {
  font-family: "Cascadia Mono", Consolas, "Courier New", monospace;
  font-size: 8.8pt;
  background: var(--sunk);
  padding: 0.3mm 1mm;
  border-radius: 0.6mm;
  word-break: break-word;
}
pre {
  font-family: "Cascadia Mono", Consolas, "Courier New", monospace;
  font-size: 8.4pt;
  line-height: 1.45;
  background: var(--sunk);
  border: 0.4pt solid var(--rule);
  border-left: 2pt solid var(--accent);
  padding: 3mm 4mm;
  overflow-wrap: break-word;
  white-space: pre-wrap;
  page-break-inside: avoid;
  margin: 0 0 4mm;
}
pre code { background: none; padding: 0; font-size: inherit; }

table {
  border-collapse: collapse;
  width: 100%;
  font-size: 9pt;
  margin: 0 0 4mm;
  page-break-inside: avoid;
}
th, td {
  border: 0.4pt solid var(--rule);
  padding: 1.6mm 2.2mm;
  text-align: left;
  vertical-align: top;
}
th {
  background: var(--sunk);
  font-family: "Segoe UI", Arial, sans-serif;
  font-size: 8.2pt;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ink-mid);
}

blockquote {
  margin: 0 0 4mm;
  padding: 2.5mm 4mm;
  border-left: 2pt solid var(--crit);
  background: #faf3f2;
  page-break-inside: avoid;
}
blockquote p:last-child { margin-bottom: 0; }

hr { border: 0; border-top: 0.5pt solid var(--rule); margin: 7mm 0; }

a { color: var(--accent); text-decoration: none; }

.docfoot {
  margin-top: 10mm;
  padding-top: 3mm;
  border-top: 1pt solid var(--ink);
  font-family: "Cascadia Mono", Consolas, monospace;
  font-size: 7.6pt;
  color: var(--ink-faint);
  line-height: 1.6;
}
"""


def render(source_path: str, out_path: str) -> None:
    text = io.open(source_path, encoding="utf-8").read()

    # Repository-relative links mean nothing on paper. Kept as text so the
    # reader can still find the file, but not presented as clickable.
    text = re.sub(r"\[([^\]]+)\]\((?!https?:)[^)]+\)", r"\1", text)

    body = markdown.markdown(
        text,
        extensions=["tables", "fenced_code", "sane_lists", "attr_list"],
    )

    title = os.path.basename(source_path).replace(".md", "").replace("_", " ").title()

    html = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>{title}</title>
<style>{CSS}</style>
</head><body>
{body}
<div class="docfoot">
Generated from {os.path.basename(source_path)} by scripts/render-doc.py.<br>
Every figure in this document is reproducible with the commands it contains.
HealthAI Assistant &middot; 2026 South Africa MedTech Innovation Challenge.
</div>
</body></html>
"""

    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    io.open(out_path, "w", encoding="utf-8").write(html)
    print(f"{source_path} -> {out_path}")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("usage: python scripts/render-doc.py <source.md> <out.html>")
        raise SystemExit(1)
    render(sys.argv[1], sys.argv[2])
