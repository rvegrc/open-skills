"""
documents — render transcript.md / chapters-summary.md to .docx and .pdf beside the source.

    uv run python documents.py <file.md> [more.md ...]   # writes <stem>.docx + <stem>.pdf

Handles the markdown subset the skills emit: frontmatter (dropped), `#`/`##`/`###` headings,
paragraphs, `- ` bullets, `**bold**` / `*italic*` / `code` inline. Dependencies come from the
repo's pyproject.toml (`uv sync`).

Text is untrusted transcript content. python-docx writes it as plain runs; reportlab's
Paragraph parses XML-like markup, so `& < >` are escaped before any <b>/<i> tag is added.
"""

import os
import re
import sys
from pathlib import Path
from xml.sax.saxutils import escape

from docx import Document
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import ListFlowable, ListItem, Paragraph, SimpleDocTemplate, Spacer

# ponytail: system DejaVu (covers Cyrillic); set PDF_FONT_DIR on hosts without it.
FONT_DIR = Path(os.environ.get("PDF_FONT_DIR", "/usr/share/fonts/truetype/dejavu"))
INLINE_RE = re.compile(r"(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)")


def parse_blocks(md: str) -> list[tuple[str, object]]:
    """[(kind, payload)]: ("h", (level, text)), ("p", text), ("ul", [items]).

    The frontmatter is dropped, but its `title:` becomes the top heading unless the body already starts with it.
    """
    front = re.match(r"\A---\n(.*?)\n---\n", md, flags=re.S)
    title = re.search(r'^title:\s*"?(.*?)"?\s*$', front[1], flags=re.M) if front else None
    md = md[front.end():] if front else md
    blocks: list[tuple[str, object]] = []
    para: list[str] = []

    def flush() -> None:
        if para:
            blocks.append(("p", " ".join(para)))
            para.clear()

    for raw in md.splitlines():
        line = raw.strip()
        heading = re.match(r"^(#{1,3})\s+(.*)$", line)
        bullet = re.match(r"^[-*]\s+(.*)$", line)
        if heading:
            flush()
            blocks.append(("h", (len(heading[1]), heading[2])))
        elif bullet:
            flush()
            if blocks and blocks[-1][0] == "ul":
                blocks[-1][1].append(bullet[1])
            else:
                blocks.append(("ul", [bullet[1]]))
        elif line:
            para.append(line)
        else:
            flush()
    flush()
    if title and title[1] and blocks[:1] != [("h", (1, title[1]))]:
        blocks.insert(0, ("h", (1, title[1])))
    return blocks


def inline_runs(text: str) -> list[tuple[str, bool, bool]]:
    """Split inline markdown into (text, bold, italic) runs; backticks are dropped."""
    runs = []
    for part in INLINE_RE.split(text):
        if not part:
            continue
        if part.startswith("**") and part.endswith("**") and len(part) > 4:
            runs.append((part[2:-2], True, False))
        elif part.startswith("`") and part.endswith("`") and len(part) > 2:
            runs.append((part[1:-1], False, False))
        elif part.startswith("*") and part.endswith("*") and len(part) > 2:
            runs.append((part[1:-1], False, True))
        else:
            runs.append((part, False, False))
    return runs


def to_docx(blocks, out: Path) -> None:
    doc = Document()

    def fill(paragraph, text: str) -> None:
        for chunk, bold, italic in inline_runs(text):
            run = paragraph.add_run(chunk)
            run.bold, run.italic = bold, italic

    for kind, payload in blocks:
        if kind == "h":
            level, text = payload
            fill(doc.add_heading(level=level), text)
        elif kind == "p":
            fill(doc.add_paragraph(), payload)
        else:
            for item in payload:
                fill(doc.add_paragraph(style="List Bullet"), item)
    doc.save(out)


def pdf_markup(text: str) -> str:
    out = []
    for chunk, bold, italic in inline_runs(text):
        safe = escape(chunk)
        out.append(f"<b>{safe}</b>" if bold else f"<i>{safe}</i>" if italic else safe)
    return "".join(out)


def to_pdf(blocks, out: Path) -> None:
    if "DejaVu" not in pdfmetrics.getRegisteredFontNames():
        pdfmetrics.registerFont(TTFont("DejaVu", str(FONT_DIR / "DejaVuSans.ttf")))
        pdfmetrics.registerFont(TTFont("DejaVu-Bold", str(FONT_DIR / "DejaVuSans-Bold.ttf")))
        # No oblique face installed: italic renders upright.
        pdfmetrics.registerFontFamily("DejaVu", normal="DejaVu", bold="DejaVu-Bold", italic="DejaVu", boldItalic="DejaVu-Bold")

    body = ParagraphStyle("body", fontName="DejaVu", fontSize=10.5, leading=15, spaceAfter=6)
    heads = {n: ParagraphStyle(f"h{n}", parent=body, fontName="DejaVu-Bold", fontSize=size, leading=size * 1.3, spaceBefore=10)
             for n, size in ((1, 18), (2, 14), (3, 12))}

    story = []
    for kind, payload in blocks:
        if kind == "h":
            level, text = payload
            story.append(Paragraph(pdf_markup(text), heads[level]))
        elif kind == "p":
            story.append(Paragraph(pdf_markup(payload), body))
        else:
            items = [ListItem(Paragraph(pdf_markup(i), body), leftIndent=12) for i in payload]
            story.append(ListFlowable(items, bulletType="bullet", start="•", leftIndent=12))
            story.append(Spacer(1, 4))
    SimpleDocTemplate(str(out), leftMargin=50, rightMargin=50, topMargin=50, bottomMargin=50).build(story)


def render(md_path: Path) -> list[Path]:
    blocks = parse_blocks(md_path.read_text(encoding="utf-8"))
    docx_path, pdf_path = md_path.with_suffix(".docx"), md_path.with_suffix(".pdf")
    to_docx(blocks, docx_path)
    to_pdf(blocks, pdf_path)
    return [docx_path, pdf_path]


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("Usage: uv run python documents.py <file.md> [more.md ...]")
    for arg in sys.argv[1:]:
        for path in render(Path(arg)):
            print(path)
