#!/usr/bin/env python3
"""Render a Blip incident diagnosis as an A4 post-mortem PDF.

The official Blip cover and page chrome are bundled as PDF assets. Incident
content is rendered from structured JSON and never copied from a prior case.
"""

from __future__ import annotations

import argparse
import html
import io
import json
import math
import os
import sys
from pathlib import Path
from typing import Any

from pypdf import PdfReader, PdfWriter
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Flowable,
    Frame,
    Image,
    KeepTogether,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)


SCRIPT_DIR = Path(__file__).resolve().parent
SKILL_DIR = SCRIPT_DIR.parent
ASSET_DIR = SKILL_DIR / "assets"
PAGE_W, PAGE_H = A4

BLIP_BLUE = colors.HexColor("#0D95E8")
TEXT = colors.HexColor("#171717")
MUTED = colors.HexColor("#555555")
GRID = colors.HexColor("#A9A9A9")
HEADER_FILL = colors.HexColor("#E7E7E7")
SOFT_BLUE = colors.HexColor("#EAF6FD")
SOFT_ORANGE = colors.HexColor("#FFF0E5")
SOFT_RED = colors.HexColor("#FDEBEC")
SOFT_GREEN = colors.HexColor("#E8F6ED")


def die(message: str) -> None:
    raise SystemExit(f"erro: {message}")


def read_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        die(f"arquivo de entrada não encontrado: {path}")
    except json.JSONDecodeError as exc:
        die(f"JSON inválido em {path}: {exc}")
    if not isinstance(data, dict):
        die("a raiz do JSON deve ser um objeto")
    return data


def require(data: dict[str, Any], key: str) -> Any:
    value = data.get(key)
    if value is None or value == "" or value == []:
        die(f"campo obrigatório ausente ou vazio: {key}")
    return value


def register_fonts() -> None:
    regular = ASSET_DIR / "Lexend-Regular.ttf"
    bold = ASSET_DIR / "Lexend-Bold.ttf"
    for path in (regular, bold):
        if not path.exists():
            die(f"asset tipográfico ausente: {path}")
    pdfmetrics.registerFont(TTFont("Lexend", str(regular)))
    pdfmetrics.registerFont(TTFont("Lexend-Bold", str(bold)))
    pdfmetrics.registerFontFamily(
        "Lexend", normal="Lexend", bold="Lexend-Bold", italic="Lexend", boldItalic="Lexend-Bold"
    )


def clean(value: Any) -> str:
    if value is None or value == "":
        return "não determinado"
    if isinstance(value, (list, tuple)):
        return "<br/>".join(clean(item) for item in value)
    return html.escape(str(value)).replace("\n", "<br/>")


def paragraph(value: Any, style: ParagraphStyle) -> Paragraph:
    return Paragraph(clean(value), style)


def link_paragraph(label: Any, url: Any, style: ParagraphStyle) -> Paragraph:
    label_text = clean(label)
    if not url or str(url).strip().lower() in {"indisponível", "na", "n/a", "não determinado"}:
        return Paragraph(label_text, style)
    safe_url = html.escape(str(url), quote=True)
    return Paragraph(f'<link href="{safe_url}" color="#0877B7">{label_text}</link>', style)


def styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    return {
        "body": ParagraphStyle(
            "BlipBody", parent=base["BodyText"], fontName="Lexend", fontSize=9.2,
            leading=13.2, textColor=TEXT, spaceAfter=5,
        ),
        "body_small": ParagraphStyle(
            "BlipBodySmall", parent=base["BodyText"], fontName="Lexend", fontSize=7.2,
            leading=9.4, textColor=TEXT,
        ),
        "tiny": ParagraphStyle(
            "BlipTiny", parent=base["BodyText"], fontName="Lexend", fontSize=5.5,
            leading=6.8, textColor=TEXT,
        ),
        "tiny_center": ParagraphStyle(
            "BlipTinyCenter", parent=base["BodyText"], fontName="Lexend", fontSize=5.5,
            leading=6.8, alignment=TA_CENTER, textColor=TEXT,
        ),
        "h1": ParagraphStyle(
            "BlipH1", parent=base["Heading1"], fontName="Lexend-Bold", fontSize=14,
            leading=17, textColor=TEXT, spaceBefore=7, spaceAfter=5, keepWithNext=True,
        ),
        "h2": ParagraphStyle(
            "BlipH2", parent=base["Heading2"], fontName="Lexend-Bold", fontSize=11,
            leading=14, textColor=TEXT, spaceBefore=7, spaceAfter=4, keepWithNext=True,
        ),
        "title": ParagraphStyle(
            "BlipTitle", parent=base["Heading1"], fontName="Lexend-Bold", fontSize=16,
            leading=20, textColor=TEXT, spaceAfter=6,
        ),
        "kicker": ParagraphStyle(
            "BlipKicker", parent=base["BodyText"], fontName="Lexend-Bold", fontSize=8,
            leading=10, textColor=BLIP_BLUE, spaceAfter=8,
        ),
        "conclusion": ParagraphStyle(
            "BlipConclusion", parent=base["BodyText"], fontName="Lexend", fontSize=9.2,
            leading=13.4, textColor=TEXT, leftIndent=8, rightIndent=8, spaceBefore=4, spaceAfter=4,
        ),
        "table_header": ParagraphStyle(
            "BlipTableHeader", parent=base["BodyText"], fontName="Lexend-Bold", fontSize=7,
            leading=8.4, textColor=TEXT,
        ),
        "table": ParagraphStyle(
            "BlipTable", parent=base["BodyText"], fontName="Lexend", fontSize=7,
            leading=9.2, textColor=TEXT,
        ),
    }


class ConclusionBox(Flowable):
    def __init__(self, content: Paragraph, width: float):
        super().__init__()
        self.content = content
        self.width = width
        _, height = content.wrap(width - 16, 10_000)
        self.height = height + 16

    def wrap(self, avail_width: float, avail_height: float) -> tuple[float, float]:
        return min(self.width, avail_width), self.height

    def draw(self) -> None:
        canvas = self.canv
        canvas.saveState()
        canvas.setFillColor(SOFT_BLUE)
        canvas.setStrokeColor(BLIP_BLUE)
        canvas.setLineWidth(1.2)
        canvas.roundRect(0, 0, self.width, self.height, 5, fill=1, stroke=1)
        self.content.drawOn(canvas, 8, 8)
        canvas.restoreState()


class CausalGraph(Flowable):
    STATE_COLORS = {
        "OBSERVADO": SOFT_GREEN,
        "DECLARADO": SOFT_BLUE,
        "INFERIDO": SOFT_ORANGE,
        "LACUNA": SOFT_RED,
    }

    def __init__(self, graph: dict[str, Any], width: float):
        super().__init__()
        self.graph = graph
        self.width = width
        self.nodes = graph.get("nodes") or []
        self.edges = graph.get("edges") or []
        per_row = 3
        rows = max(1, math.ceil(len(self.nodes) / per_row))
        self.height = rows * 78 + 24

    def wrap(self, avail_width: float, avail_height: float) -> tuple[float, float]:
        return min(self.width, avail_width), self.height

    def draw(self) -> None:
        c = self.canv
        if not self.nodes:
            c.setFont("Lexend", 8)
            c.drawString(0, self.height - 12, "Grafo não determinado — evidência insuficiente.")
            return

        cols = 3
        box_w = (self.width - 28) / cols
        box_h = 48
        positions: dict[str, tuple[float, float]] = {}
        for idx, node in enumerate(self.nodes):
            row, col = divmod(idx, cols)
            if row % 2 == 1:
                col = cols - 1 - col
            x = col * (box_w + 14)
            y = self.height - 18 - (row + 1) * 68
            positions[str(node.get("id", idx))] = (x, y)

        c.saveState()
        c.setStrokeColor(colors.HexColor("#737373"))
        c.setLineWidth(0.8)
        for edge in self.edges:
            a = positions.get(str(edge.get("from")))
            b = positions.get(str(edge.get("to")))
            if not a or not b:
                continue
            ax, ay = a[0] + box_w, a[1] + box_h / 2
            bx, by = b[0], b[1] + box_h / 2
            if abs(ay - by) > 5:
                ax = a[0] + box_w / 2
                ay = a[1]
                bx = b[0] + box_w / 2
                by = b[1] + box_h
            if edge.get("inferred", False):
                c.setDash(3, 2)
            else:
                c.setDash()
            c.line(ax, ay, bx, by)
            angle = math.atan2(by - ay, bx - ax)
            for delta in (0.45, -0.45):
                c.line(bx, by, bx - 6 * math.cos(angle + delta), by - 6 * math.sin(angle + delta))
            label = str(edge.get("label", ""))
            if label:
                c.setFont("Lexend", 5.3)
                c.setFillColor(MUTED)
                c.drawCentredString((ax + bx) / 2, (ay + by) / 2 + 3, label[:42])

        for idx, node in enumerate(self.nodes):
            node_id = str(node.get("id", idx))
            x, y = positions[node_id]
            state = str(node.get("state", "LACUNA")).upper()
            fill = self.STATE_COLORS.get(state, colors.white)
            c.setFillColor(fill)
            c.setStrokeColor(BLIP_BLUE if node.get("anomaly") else GRID)
            c.setLineWidth(1.5 if node.get("anomaly") else 0.7)
            c.roundRect(x, y, box_w, box_h, 4, fill=1, stroke=1)
            text = clean(node.get("label", node_id))
            if node.get("anomaly"):
                text += "<br/><b>PRIMEIRO PONTO ANÔMALO</b>"
            text += f"<br/><font size='5'>{html.escape(state)}</font>"
            p = Paragraph(text, ParagraphStyle(
                f"node-{idx}", fontName="Lexend", fontSize=6.5, leading=7.8,
                alignment=TA_CENTER, textColor=TEXT,
            ))
            _, ph = p.wrap(box_w - 8, box_h - 6)
            p.drawOn(c, x + 4, y + max(3, (box_h - ph) / 2))
        c.restoreState()


def table(
    rows: list[list[Any]],
    widths: list[float],
    st: dict[str, ParagraphStyle],
    header: bool = True,
    font_size: str = "table",
) -> Table:
    processed: list[list[Paragraph]] = []
    for row_idx, row in enumerate(rows):
        style = st["table_header"] if header and row_idx == 0 else st[font_size]
        processed.append([paragraph(cell, style) for cell in row])
    tbl = Table(processed, colWidths=widths, repeatRows=1 if header else 0, hAlign="LEFT")
    commands: list[tuple[Any, ...]] = [
        ("GRID", (0, 0), (-1, -1), 0.45, GRID),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]
    if header:
        commands.append(("BACKGROUND", (0, 0), (-1, 0), HEADER_FILL))
    for idx in range(1 if header else 0, len(processed)):
        if idx % 2 == 0:
            commands.append(("BACKGROUND", (0, idx), (-1, idx), colors.HexColor("#F8F8F8")))
    tbl.setStyle(TableStyle(commands))
    return tbl


def section_heading(text: str, st: dict[str, ParagraphStyle], level: int = 1) -> Paragraph:
    return Paragraph(html.escape(text), st["h1" if level == 1 else "h2"])


def build_story(data: dict[str, Any], st: dict[str, ParagraphStyle]) -> list[Flowable]:
    title = require(data, "title")
    conclusion = require(data, "conclusion")
    incident_info = require(data, "incident_info")
    events = require(data, "events")
    sections = require(data, "sections")
    evidence = require(data, "evidence")
    causal = require(data, "causal_ladder")
    coverage = require(data, "coverage")
    graph = require(data, "graph")

    story: list[Flowable] = []
    kind = "POST MORTEM — DIAGNÓSTICO PARCIAL" if data.get("partial") else "POST MORTEM"
    story.append(Paragraph(f"{html.escape(kind)} — {html.escape(str(title))}", st["title"]))
    if data.get("status"):
        story.append(Paragraph(str(data["status"]).upper(), st["kicker"]))
    story.append(ConclusionBox(paragraph(conclusion, st["conclusion"]), 496))
    story.append(Spacer(1, 7))

    story.append(section_heading("1. APLICABILIDADE", st))
    story.append(paragraph(data.get("applicability", "Este documento se aplica aos clientes da Blip afetados pelo incidente descrito abaixo."), st["body"]))

    story.append(section_heading("2. OBJETIVO", st))
    story.append(paragraph(data.get("objective", "Informar os acontecimentos identificáveis, o impacto observado e as ações tomadas pela Blip em relação à indisponibilidade ou degradação da plataforma, ou de parte dela."), st["body"]))

    story.append(section_heading("3. INFORMAÇÕES DO INCIDENTE", st))
    info_rows = [["Campo", "Informação"]]
    if isinstance(incident_info, dict):
        info_rows += [[key, value] for key, value in incident_info.items()]
    else:
        info_rows += [[row.get("field"), row.get("value")] for row in incident_info]
    story.append(table(info_rows, [245, 251], st))

    story.append(section_heading("4. EVENTOS IMPORTANTES DO INCIDENTE", st))
    event_rows = [["Data/hora", "Ação ou evento", "Evidência"]]
    event_rows += [[row.get("datetime"), row.get("event"), row.get("evidence")] for row in events]
    story.append(table(event_rows, [92, 294, 110], st))

    story.append(section_heading("5. AÇÕES PREVENTIVAS", st))
    section_map = [
        ("Causa raiz", "root_cause"),
        ("Investigação", "investigation"),
        ("Solução aplicada", "solution"),
        ("Resultado e impacto", "result"),
        ("Ações futuras", "future_actions"),
    ]
    for label, key in section_map:
        story.append(section_heading(label, st, level=2))
        story.append(paragraph(sections.get(key), st["body"]))

    story.append(section_heading("ANEXO TÉCNICO A — TRACE DO PROBLEMA", st))
    graph_title = graph.get("title", "Grafo causal reconstruído — sem trace distribuído disponível")
    story.append(Paragraph(html.escape(str(graph_title)), st["h2"]))
    if graph.get("image"):
        image_path = Path(str(graph["image"])).expanduser()
        if not image_path.is_absolute():
            image_path = Path.cwd() / image_path
        if not image_path.exists():
            die(f"imagem do grafo não encontrada: {image_path}")
        img = Image(str(image_path), width=496, height=250, kind="proportional")
        story.append(img)
    else:
        story.append(CausalGraph(graph, 496))
    story.append(paragraph(graph.get("legend", "Nós e arestas são classificados conforme a força da evidência; linhas tracejadas representam relações inferidas."), st["body_small"]))

    story.append(section_heading("ANEXO TÉCNICO B — EVIDÊNCIAS E LIMITAÇÕES", st))
    story.append(section_heading("Livro de evidências", st, level=2))
    ev_headers = ["ID", "Afirmação", "Fonte", "Escopo/versão", "Janela", "Consulta ou método", "Estado", "Link"]
    ev_rows: list[list[Any]] = [ev_headers]
    for row in evidence:
        ev_rows.append([
            row.get("id"), row.get("claim"), row.get("source"), row.get("scope"),
            row.get("window"), row.get("method"), row.get("state"), row.get("link"),
        ])
    story.append(table(ev_rows, [24, 83, 50, 62, 56, 91, 61, 69], st, font_size="tiny"))

    story.append(section_heading("Decomposição causal", st, level=2))
    causal_rows = [["Nível", "Conclusão", "Evidência", "Confiança"]]
    causal_rows += [[row.get("level"), row.get("conclusion"), row.get("evidence"), row.get("confidence")] for row in causal]
    story.append(table(causal_rows, [100, 230, 106, 60], st, font_size="body_small"))

    story.append(section_heading("Matriz de cobertura", st, level=2))
    coverage_rows = [["Família", "Datasource/escopo", "Janela e consulta", "Resultado", "Estado"]]
    coverage_rows += [[row.get("family"), row.get("scope"), row.get("query"), row.get("result"), row.get("state")] for row in coverage]
    story.append(table(coverage_rows, [80, 94, 132, 90, 100], st, font_size="tiny"))

    story.append(section_heading("Limitações", st, level=2))
    story.append(paragraph(data.get("limitations"), st["body"]))
    story.append(section_heading("Próximo desbloqueio prioritário", st, level=2))
    story.append(paragraph(data.get("next_unlock"), st["body"]))

    return story


def draw_page_chrome(canvas: Any, doc: BaseDocTemplate, classification: str, total_body_pages: int) -> None:
    canvas.saveState()
    # Remove prior incident content while preserving the official Blip header artwork.
    canvas.setFillColor(colors.white)
    canvas.rect(0, 44, PAGE_W, 731, fill=1, stroke=0)
    # Replace the reference classification/page text and footer.
    canvas.rect(444, 776, 108, 50, fill=1, stroke=0)
    canvas.rect(45, 20, 510, 27, fill=1, stroke=0)

    canvas.setStrokeColor(GRID)
    canvas.setLineWidth(0.45)
    canvas.line(444, 777, 444, 826)
    canvas.line(444, 801, 552, 801)
    canvas.setFillColor(TEXT)
    canvas.setFont("Lexend", 7.4)
    canvas.drawString(449, 812, "Classificação:")
    canvas.setFont("Lexend-Bold", 7.2)
    canvas.drawString(449, 802, classification)
    logical_page = doc.page + 1
    logical_total = total_body_pages + 1
    canvas.setFont("Lexend", 7.2)
    canvas.drawString(449, 790, f"PÁGINA {logical_page} DE {logical_total}")

    canvas.setStrokeColor(colors.black)
    canvas.setLineWidth(0.8)
    canvas.line(49, 42, 552, 42)
    canvas.setFillColor(TEXT)
    canvas.setFont("Lexend", 7.2)
    footer_class = "público" if classification == "PÚBLICA" else "interno — rascunho"
    footer = f"Classificação do documento: {footer_class} | As informações contidas neste documento são proprietárias da Blip"
    canvas.drawCentredString(PAGE_W / 2, 28, footer)
    canvas.restoreState()


def make_doc(buffer: io.BytesIO, data: dict[str, Any], total_body_pages: int) -> BaseDocTemplate:
    frame = Frame(50, 57, 496, 708, id="body", leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    classification = str(data.get("classification", "INTERNA — RASCUNHO")).upper()
    doc = BaseDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=50,
        rightMargin=50,
        topMargin=77,
        bottomMargin=57,
        title=str(data.get("title", "Post Mortem Blip")),
        author="Blip",
        subject="Diagnóstico de incidente",
    )
    doc.addPageTemplates(PageTemplate(
        id="blip-body",
        frames=[frame],
        onPage=lambda canvas, current_doc: draw_page_chrome(canvas, current_doc, classification, total_body_pages),
    ))
    return doc


def render_body(data: dict[str, Any]) -> bytes:
    st = styles()
    first = io.BytesIO()
    first_doc = make_doc(first, data, 999)
    first_doc.build(build_story(data, st))
    page_count = len(PdfReader(io.BytesIO(first.getvalue())).pages)

    final = io.BytesIO()
    final_doc = make_doc(final, data, page_count)
    final_doc.build(build_story(data, st))
    return final.getvalue()


def merge_with_official_assets(body_pdf: bytes, output: Path) -> None:
    cover_path = ASSET_DIR / "blip-cover-pages.pdf"
    background_path = ASSET_DIR / "blip-content-page.pdf"
    if not cover_path.exists() or not background_path.exists():
        die("assets oficiais de capa ou página interna ausentes")

    cover = PdfReader(str(cover_path))
    body = PdfReader(io.BytesIO(body_pdf))
    writer = PdfWriter()
    for page in cover.pages:
        writer.add_page(page)
    for overlay in body.pages:
        # A fresh reader prevents pypdf from reusing the same translated page
        # object and replacing every body page with the final overlay.
        page = PdfReader(str(background_path)).pages[0]
        page.merge_page(overlay)
        writer.add_page(page)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("wb") as handle:
        writer.write(handle)


def validate(data: dict[str, Any]) -> None:
    classification = str(data.get("classification", "INTERNA — RASCUNHO")).upper()
    allowed = {"INTERNA — RASCUNHO", "PÚBLICA"}
    if classification not in allowed:
        die(f"classification deve ser uma de: {', '.join(sorted(allowed))}")
    if classification == "PÚBLICA" and not data.get("public_release_authorized", False):
        die("PÚBLICA exige public_release_authorized=true")
    for key in ("title", "conclusion", "incident_info", "events", "sections", "graph", "evidence", "causal_ladder", "coverage"):
        require(data, key)
    expected_fields = {
        "Data/hora de início",
        "Data/hora da correção",
        "Duração do incidente",
        "Registro do incidente interno",
        "Sistema/Aplicação/Infraestrutura envolvida",
        "Sintomas identificados",
        "Impacto",
        "Causa raiz",
    }
    info = data["incident_info"]
    actual_fields = set(info.keys()) if isinstance(info, dict) else {str(row.get("field")) for row in info}
    missing = expected_fields - actual_fields
    if missing:
        die("incident_info não contém campos obrigatórios: " + ", ".join(sorted(missing)))


def main() -> None:
    parser = argparse.ArgumentParser(description="Gera post-mortem Blip em PDF a partir de JSON estruturado.")
    parser.add_argument("input", type=Path, help="JSON do diagnóstico")
    parser.add_argument("output", type=Path, help="PDF de saída")
    args = parser.parse_args()

    register_fonts()
    data = read_json(args.input)
    validate(data)
    body = render_body(data)
    merge_with_official_assets(body, args.output.resolve())
    print(args.output.resolve())


if __name__ == "__main__":
    main()
