"""uv run python -m unittest test_documents  (from this scripts/ directory)"""

import tempfile
import unittest
from pathlib import Path

from docx import Document

from documents import inline_runs, parse_blocks, pdf_markup, render

SAMPLE = """---
title: "Урок: <тест>"
---

# Заголовок

Первая строка абзаца
и её продолжение с **жирным** словом.

## Глава [00:01:00]
- пункт один
- пункт <script>два</script>
"""


class DocumentsTest(unittest.TestCase):
    def test_parse_blocks_drops_frontmatter_and_groups_lines(self):
        self.assertEqual(
            parse_blocks(SAMPLE),
            [
                ("h", (1, "Урок: <тест>")),
                ("h", (1, "Заголовок")),
                ("p", "Первая строка абзаца и её продолжение с **жирным** словом."),
                ("h", (2, "Глава [00:01:00]")),
                ("ul", ["пункт один", "пункт <script>два</script>"]),
            ],
        )

    def test_title_not_duplicated_when_body_starts_with_it(self):
        blocks = parse_blocks("---\ntitle: Урок\n---\n\n# Урок\n\nтекст\n")
        self.assertEqual(blocks, [("h", (1, "Урок")), ("p", "текст")])

    def test_inline_runs(self):
        self.assertEqual(
            inline_runs("a **b** *c* `d`"),
            [("a ", False, False), ("b", True, False), (" ", False, False), ("c", False, True), (" ", False, False), ("d", False, False)],
        )

    def test_pdf_markup_escapes_untrusted_text(self):
        self.assertEqual(pdf_markup("x <b>y</b> & **z**"), "x &lt;b&gt;y&lt;/b&gt; &amp; <b>z</b>")

    def test_render_writes_docx_and_pdf(self):
        with tempfile.TemporaryDirectory() as tmp:
            md = Path(tmp) / "chapters-summary.md"
            md.write_text(SAMPLE, encoding="utf-8")
            docx_path, pdf_path = render(md)
            text = "\n".join(p.text for p in Document(docx_path).paragraphs)
            self.assertIn("жирным", text)
            self.assertIn("пункт <script>два</script>", text)
            self.assertTrue(pdf_path.read_bytes().startswith(b"%PDF"))


if __name__ == "__main__":
    unittest.main()
