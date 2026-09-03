from pathlib import Path
import re
import textwrap


PAGE_W = 595.28
PAGE_H = 841.89
LEFT = 54
TOP = 790
BOTTOM = 50
LINE_GAP = 4

STYLES = {
    "h1": ("F2", 20, 26),
    "h2": ("F2", 15, 20),
    "h3": ("F2", 12, 17),
    "body": ("F1", 10.5, 15),
    "quote": ("F1", 10, 14),
}


def wrap_line(text: str, width: int) -> list[str]:
    return textwrap.wrap(
        text,
        width=width,
        replace_whitespace=False,
        drop_whitespace=False,
    ) or [""]


def esc_pdf(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def normalize_lines(markdown: str) -> list[tuple[str, str]]:
    lines: list[tuple[str, str]] = []

    for raw in markdown.splitlines():
        if raw.startswith("# "):
            for part in wrap_line(raw[2:].strip(), 52):
                lines.append(("h1", part.strip()))
            lines.append(("body", ""))
            continue

        if raw.startswith("## "):
            for part in wrap_line(raw[3:].strip(), 68):
                lines.append(("h2", part.strip()))
            continue

        if raw.startswith("### "):
            for part in wrap_line(raw[4:].strip(), 78):
                lines.append(("h3", part.strip()))
            continue

        if raw.startswith("> "):
            for part in wrap_line(raw[2:].strip(), 82):
                lines.append(("quote", part.strip()))
            lines.append(("body", ""))
            continue

        if re.match(r"^\d+\.\s", raw):
            prefix, rest = raw.split(". ", 1)
            wrapped = wrap_line(rest, 88)
            lines.append(("body", f"{prefix}. {wrapped[0].strip()}"))
            for cont in wrapped[1:]:
                lines.append(("body", f"   {cont.strip()}"))
            continue

        if raw.startswith("- "):
            wrapped = wrap_line(raw[2:], 90)
            lines.append(("body", f"- {wrapped[0].strip()}"))
            for cont in wrapped[1:]:
                lines.append(("body", f"  {cont.strip()}"))
            continue

        if raw.strip():
            for part in wrap_line(raw.strip(), 94):
                lines.append(("body", part.strip()))
        else:
            lines.append(("body", ""))

    return lines


def paginate(lines: list[tuple[str, str]]) -> list[list[tuple[str, str, float]]]:
    pages: list[list[tuple[str, str, float]]] = []
    current: list[tuple[str, str, float]] = []
    y = TOP

    for style_name, line in lines:
        _, _, leading = STYLES[style_name]
        needed = leading + LINE_GAP
        if y - needed < BOTTOM:
            pages.append(current)
            current = []
            y = TOP
        current.append((style_name, line, y))
        y -= needed

    if current:
        pages.append(current)

    return pages


def add_obj(objects: list[bytes], data: bytes) -> int:
    objects.append(data)
    return len(objects)


def build_pdf(markdown: str) -> bytes:
    lines = normalize_lines(markdown)
    pages = paginate(lines)
    objects: list[bytes] = []

    font_obj = add_obj(objects, b"<< /F1 2 0 R /F2 3 0 R >>")
    add_obj(objects, b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    add_obj(objects, b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>")

    page_obj_ids: list[int] = []

    for page_index, page_lines in enumerate(pages, start=1):
        commands = ["BT"]

        for style_name, line, y_pos in page_lines:
            font, size, _ = STYLES[style_name]
            if style_name == "h1":
                commands.append("0.07 0.12 0.24 rg")
            elif style_name == "h2":
                commands.append("0.10 0.22 0.46 rg")
            elif style_name == "h3":
                commands.append("0.16 0.30 0.52 rg")
            else:
                commands.append("0 0 0 rg")
            commands.append(f"/{font} {size} Tf")
            commands.append(f"1 0 0 1 {LEFT} {y_pos:.2f} Tm ({esc_pdf(line)}) Tj")

        footer = f"Page {page_index} of {len(pages)}"
        commands.append("/F1 9 Tf")
        commands.append("0.35 0.35 0.35 rg")
        commands.append(f"1 0 0 1 {PAGE_W - 110:.2f} 24 Tm ({esc_pdf(footer)}) Tj")
        commands.append("ET")

        stream = "\n".join(commands).encode("latin-1", errors="replace")
        content_id = add_obj(
            objects,
            b"<< /Length "
            + str(len(stream)).encode()
            + b" >>\nstream\n"
            + stream
            + b"\nendstream",
        )

        page_dict = (
            f"<< /Type /Page /Parent 0 0 R /MediaBox [0 0 {PAGE_W} {PAGE_H}] "
            f"/Resources << /Font {font_obj} 0 R >> /Contents {content_id} 0 R >>"
        ).encode("latin-1")
        page_id = add_obj(objects, page_dict)
        page_obj_ids.append(page_id)

    kids = " ".join(f"{pid} 0 R" for pid in page_obj_ids)
    pages_obj = add_obj(
        objects,
        f"<< /Type /Pages /Count {len(page_obj_ids)} /Kids [{kids}] >>".encode("latin-1"),
    )

    for pid in page_obj_ids:
        objects[pid - 1] = objects[pid - 1].replace(
            b"/Parent 0 0 R",
            f"/Parent {pages_obj} 0 R".encode("latin-1"),
        )

    catalog_obj = add_obj(objects, f"<< /Type /Catalog /Pages {pages_obj} 0 R >>".encode("latin-1"))
    info_obj = add_obj(objects, b"<< /Title (Trading App Build Guide) /Producer (Codex Minimal PDF Renderer) >>")

    parts = [b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"]
    offsets = [0]

    for index, obj in enumerate(objects, start=1):
        offsets.append(sum(len(part) for part in parts))
        parts.append(f"{index} 0 obj\n".encode("latin-1"))
        parts.append(obj)
        parts.append(b"\nendobj\n")

    startxref = sum(len(part) for part in parts)
    parts.append(f"xref\n0 {len(objects) + 1}\n".encode("latin-1"))
    parts.append(b"0000000000 65535 f \n")

    for index in range(1, len(objects) + 1):
        parts.append(f"{offsets[index]:010d} 00000 n \n".encode("latin-1"))

    parts.append(
        f"trailer\n<< /Size {len(objects) + 1} /Root {catalog_obj} 0 R /Info {info_obj} 0 R >>\n".encode(
            "latin-1"
        )
    )
    parts.append(f"startxref\n{startxref}\n%%EOF\n".encode("latin-1"))

    return b"".join(parts)


def main() -> None:
    repo_root = Path(__file__).resolve().parents[1]
    md_path = repo_root / "docs" / "trading-app-build-guide.md"
    pdf_path = repo_root / "docs" / "trading-app-build-guide.pdf"
    markdown = md_path.read_text(encoding="utf-8")
    pdf_path.write_bytes(build_pdf(markdown))
    print(pdf_path)


if __name__ == "__main__":
    main()
