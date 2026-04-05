#!/usr/bin/env python3
"""Convert how-accuracy-works.md to a clean PDF using fpdf2."""
from fpdf import FPDF

def render_rich(pdf, text, h=5.5):
    """Render a line with **bold** and `code` formatting."""
    parts = []
    i = 0
    while i < len(text):
        if text[i:i+2] == '**':
            end = text.find('**', i+2)
            if end > 0:
                parts.append(('B', text[i+2:end]))
                i = end + 2
                continue
        if text[i] == '`':
            end = text.find('`', i+1)
            if end > 0:
                parts.append(('C', text[i+1:end]))
                i = end + 1
                continue
        next_bold = text.find('**', i)
        next_code = text.find('`', i)
        ends = [e for e in [next_bold, next_code] if e > i]
        end = min(ends) if ends else len(text)
        parts.append(('N', text[i:end]))
        i = end
    for style, chunk in parts:
        if style == 'B':
            pdf.set_font("Helvetica", "B", 10)
            pdf.write(h, chunk)
            pdf.set_font("Helvetica", "", 10)
        elif style == 'C':
            pdf.set_font("Courier", "", 9)
            pdf.set_text_color(80, 80, 80)
            pdf.write(h, chunk)
            pdf.set_text_color(0, 0, 0)
            pdf.set_font("Helvetica", "", 10)
        else:
            pdf.write(h, chunk)
    pdf.ln(h)

def flush_code(pdf, buf):
    if not buf:
        return
    pdf.set_font("Courier", size=8)
    pdf.set_fill_color(244, 244, 244)
    for line in buf:
        pdf.cell(0, 4.5, "  " + line, new_x="LMARGIN", new_y="NEXT", fill=True)
    pdf.ln(3)
    pdf.set_font("Helvetica", size=10)
    buf.clear()

with open("how-accuracy-works.md") as f:
    raw = f.read()
# Replace Unicode chars that latin-1 can't handle
raw = raw.replace("\u2014", "--").replace("\u2013", "-").replace("\u2019", "'")
raw = raw.replace("\u201c", '"').replace("\u201d", '"').replace("\u2026", "...")
raw = raw.replace("\u2192", "->").replace("\u00b1", "+/-").replace("\u00d7", "x")
lines = raw.split("\n")

pdf = FPDF()
pdf.set_auto_page_break(auto=True, margin=20)
pdf.add_page()
pdf.set_font("Helvetica", size=10)

in_code = False
code_buf = []

for line in lines:
    if line.startswith("```"):
        if in_code:
            flush_code(pdf, code_buf)
            in_code = False
        else:
            in_code = True
        continue
    if in_code:
        code_buf.append(line)
        continue
    if line.strip() == "---":
        pdf.ln(3)
        y = pdf.get_y()
        pdf.set_draw_color(200, 200, 200)
        pdf.line(pdf.l_margin, y, pdf.w - pdf.r_margin, y)
        pdf.ln(5)
        continue
    if not line.strip():
        pdf.ln(3)
        continue
    if line.startswith("# ") and not line.startswith("##"):
        pdf.set_font("Helvetica", "B", 18)
        pdf.cell(0, 10, line[2:].strip(), new_x="LMARGIN", new_y="NEXT")
        y = pdf.get_y()
        pdf.set_draw_color(60, 60, 60)
        pdf.set_line_width(0.5)
        pdf.line(pdf.l_margin, y, pdf.w - pdf.r_margin, y)
        pdf.set_line_width(0.2)
        pdf.ln(4)
        pdf.set_font("Helvetica", size=10)
        continue
    if line.startswith("## "):
        pdf.ln(4)
        pdf.set_font("Helvetica", "B", 14)
        pdf.cell(0, 8, line[3:].strip(), new_x="LMARGIN", new_y="NEXT")
        y = pdf.get_y()
        pdf.set_draw_color(200, 200, 200)
        pdf.line(pdf.l_margin, y, pdf.w - pdf.r_margin, y)
        pdf.ln(3)
        pdf.set_font("Helvetica", size=10)
        continue
    if line.startswith("### "):
        pdf.ln(2)
        pdf.set_font("Helvetica", "B", 11)
        pdf.cell(0, 7, line[4:].strip(), new_x="LMARGIN", new_y="NEXT")
        pdf.ln(1)
        pdf.set_font("Helvetica", size=10)
        continue
    if line.startswith("- ") or line.startswith("* "):
        text = line[2:].strip()
        pdf.set_x(pdf.l_margin + 5)
        pdf.cell(4, 5.5, "-", new_x="END")
        render_rich(pdf, text)
        continue
    if len(line) > 2 and line[0].isdigit() and (line[1] == '.' or (line[1].isdigit() and line[2] == '.')):
        dot = line.index('.')
        num = line[:dot]
        text = line[dot+2:].strip()
        pdf.set_x(pdf.l_margin + 3)
        pdf.cell(7, 5.5, f"{num}.", new_x="END")
        render_rich(pdf, text)
        continue
    render_rich(pdf, line.strip())

pdf.output("how-accuracy-works.pdf")
print("Done: how-accuracy-works.pdf")
