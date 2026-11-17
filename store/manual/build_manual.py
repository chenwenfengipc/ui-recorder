"""Builds the user manual as one self-contained HTML file (screenshots embedded) and a PDF copy.

    python store/manual/build_manual.py

Outputs, next to this script:
    UI-Recorder-User-Manual.html   opens in any browser, works offline, no extra files needed
    UI-Recorder-User-Manual.pdf    printed with Microsoft Edge (headless), A4 pages
"""
import base64
import json
import os
import re
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
STORE = os.path.dirname(HERE)
ROOT = os.path.dirname(STORE)
IMAGES = os.path.join(STORE, "guide-images")
TEMPLATE = os.path.join(HERE, "manual.template.html")
HTML_OUT = os.path.join(HERE, "UI-Recorder-User-Manual.html")
PDF_OUT = os.path.join(HERE, "UI-Recorder-User-Manual.pdf")

EDGE_CANDIDATES = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]


def embed_image(match):
    name = match.group(1)
    path = os.path.join(IMAGES, name)
    if not os.path.exists(path):
        sys.exit(f"missing guide image: {path}")
    with open(path, "rb") as f:
        data = base64.b64encode(f.read()).decode("ascii")
    return f'<img src="data:image/png;base64,{data}" alt="{name}">'


def main():
    with open(os.path.join(ROOT, "manifest.json"), encoding="utf-8") as f:
        version = json.load(f)["version"]

    with open(TEMPLATE, encoding="utf-8") as f:
        html = f.read()
    html = html.replace("{{VERSION}}", version)
    html, count = re.subn(r"\{\{img:([^}]+)\}\}", embed_image, html)
    with open(HTML_OUT, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"wrote {HTML_OUT} ({count} screenshots embedded, version {version})")

    edge = next((p for p in EDGE_CANDIDATES if os.path.exists(p)), None)
    if not edge:
        print("Microsoft Edge not found: skipped the PDF. Open the HTML and use Ctrl+P > Save as PDF.")
        return
    if os.path.exists(PDF_OUT):
        os.remove(PDF_OUT)
    # Edge wants forward slashes in these paths; backslashes silently produce no PDF.
    # The profile is kept between runs: with a brand-new profile Edge hands off to a background
    # process and the launcher exits before the PDF is written.
    profile = os.path.join(STORE, "tools", ".work", "edge-pdf-profile")
    os.makedirs(profile, exist_ok=True)
    try:
        subprocess.run(
            [
                edge,
                "--headless=new",
                "--disable-gpu",
                "--no-pdf-header-footer",
                "--no-first-run",
                f"--user-data-dir={profile.replace(chr(92), '/')}",
                f"--print-to-pdf={PDF_OUT.replace(chr(92), '/')}",
                "file:///" + HTML_OUT.replace("\\", "/"),
            ],
            timeout=120,
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except subprocess.TimeoutExpired:
        pass  # Edge sometimes lingers after printing; the file check below decides
    for _ in range(60):
        if os.path.exists(PDF_OUT) and os.path.getsize(PDF_OUT) > 1000:
            break
        time.sleep(1)
    if os.path.exists(PDF_OUT) and os.path.getsize(PDF_OUT) > 1000:
        print(f"wrote {PDF_OUT} ({os.path.getsize(PDF_OUT) // 1024} KB)")
    else:
        sys.exit("PDF was not created. Open the HTML and use Ctrl+P > Save as PDF.")


if __name__ == "__main__":
    main()
