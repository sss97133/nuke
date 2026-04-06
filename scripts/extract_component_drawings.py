#!/usr/bin/env python3
"""
Extract dimensional/engineering drawings from component PDFs as high-res PNGs.
Uses PyMuPDF (fitz) at 250 DPI.
"""

import fitz
import os
import sys

BASE_DIR = "/Users/skylar/nuke/reference_documents/component_drawings"
OUT_DIR = os.path.join(BASE_DIR, "extracted")
DPI = 250

os.makedirs(OUT_DIR, exist_ok=True)


def extract_page(pdf_filename, page_num_1indexed, output_filename, description=""):
    """Extract a single page from a PDF as a high-res PNG.
    page_num_1indexed: 1-based page number (as user sees it)
    """
    pdf_path = os.path.join(BASE_DIR, pdf_filename)
    out_path = os.path.join(OUT_DIR, output_filename)

    if not os.path.exists(pdf_path):
        print(f"  ERROR: {pdf_path} not found!")
        return None

    doc = fitz.open(pdf_path)
    page_idx = page_num_1indexed - 1  # convert to 0-indexed

    if page_idx >= len(doc) or page_idx < 0:
        print(f"  ERROR: Page {page_num_1indexed} out of range (PDF has {len(doc)} pages)")
        return None

    page = doc[page_idx]

    # Render at specified DPI
    mat = fitz.Matrix(DPI / 72, DPI / 72)
    pix = page.get_pixmap(matrix=mat)

    pix.save(out_path)

    file_size = os.path.getsize(out_path)
    page_w_mm = page.rect.width * 25.4 / 72
    page_h_mm = page.rect.height * 25.4 / 72

    print(f"  Extracted: {output_filename}")
    print(f"    Source: {pdf_filename} page {page_num_1indexed}/{len(doc)}")
    print(f"    Page size: {page_w_mm:.1f} x {page_h_mm:.1f} mm ({page.rect.width:.0f} x {page.rect.height:.0f} pt)")
    print(f"    Output: {pix.width} x {pix.height} px at {DPI} DPI")
    print(f"    File size: {file_size:,} bytes ({file_size/1024:.1f} KB)")
    if description:
        print(f"    Content: {description}")
    print()

    doc.close()
    return out_path


def extract_pages(pdf_filename, page_nums_1indexed, output_filename, description=""):
    """Extract multiple pages and combine vertically into a single PNG."""
    pdf_path = os.path.join(BASE_DIR, pdf_filename)
    out_path = os.path.join(OUT_DIR, output_filename)

    if not os.path.exists(pdf_path):
        print(f"  ERROR: {pdf_path} not found!")
        return None

    doc = fitz.open(pdf_path)

    pixmaps = []
    total_height = 0
    max_width = 0

    for page_num in page_nums_1indexed:
        page_idx = page_num - 1
        if page_idx >= len(doc) or page_idx < 0:
            print(f"  WARNING: Page {page_num} out of range, skipping")
            continue
        page = doc[page_idx]
        mat = fitz.Matrix(DPI / 72, DPI / 72)
        pix = page.get_pixmap(matrix=mat, alpha=False)
        pixmaps.append(pix)
        total_height += pix.height
        max_width = max(max_width, pix.width)

    if not pixmaps:
        print(f"  ERROR: No valid pages found")
        return None

    # Combine vertically - no alpha channel
    combined = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, max_width, total_height), 0)
    combined.clear_with(255)  # white background

    y_offset = 0
    for pix in pixmaps:
        # Copy pixel data
        combined.copy(pix, fitz.IRect(0, y_offset, pix.width, y_offset + pix.height))
        y_offset += pix.height

    combined.save(out_path)

    file_size = os.path.getsize(out_path)
    print(f"  Extracted (combined): {output_filename}")
    print(f"    Source: {pdf_filename} pages {page_nums_1indexed}")
    print(f"    Output: {max_width} x {total_height} px at {DPI} DPI")
    print(f"    File size: {file_size:,} bytes ({file_size/1024:.1f} KB)")
    if description:
        print(f"    Content: {description}")
    print()

    doc.close()
    return out_path


if __name__ == "__main__":
    print("=" * 70)
    print("Component Drawing Extraction")
    print(f"DPI: {DPI}, Output: {OUT_DIR}")
    print("=" * 70)
    print()

    results = []

    # 1. MoTeC M130 - Page 3: Dimensional drawing (orthographic front + side)
    print("[1] MoTeC M130 Dimensional Drawing")
    r = extract_page(
        "motec_m130_datasheet.pdf", 3,
        "motec_m130_dimensional.png",
        "Orthographic front + side view with all dimensions in mm"
    )
    results.append(("motec_m130_dimensional.png", r, 3, "motec_m130_datasheet.pdf"))

    # 2. MoTeC PDM30 - Page 2: Dimensional drawing at bottom of page
    print("[2] MoTeC PDM30 Dimensional Drawing")
    r = extract_page(
        "motec_pdm30_datasheet.pdf", 2,
        "motec_pdm30_dimensional.png",
        "Dimensions and mounting drawing with CAN wiring table"
    )
    results.append(("motec_pdm30_dimensional.png", r, 2, "motec_pdm30_datasheet.pdf"))

    # 3. Bosch EV14 - Page 4: Injector dimensional/cross-section drawing
    print("[3] Bosch EV14 Injection Valve Dimensional Drawing")
    r = extract_page(
        "Bosch_EV14_Injection_Valve_Datasheet.pdf", 4,
        "bosch_ev14_dimensional.png",
        "Injector dimensional cross-section with mounting specifications"
    )
    results.append(("bosch_ev14_dimensional.png", r, 4, "Bosch_EV14_Injection_Valve_Datasheet.pdf"))

    # 4. Holley Mid-Mount - Page 2 of the accessory drive kit (has Dimensions header)
    print("[4] Holley Mid-Mount Dimensional Drawing")
    r = extract_page(
        "Holley_Mid_Mount_Accessory_Drive_Kit.pdf", 2,
        "holley_midmount_dimensional.png",
        "Front-of-engine dimensional drawing showing alternator/AC positions"
    )
    results.append(("holley_midmount_dimensional.png", r, 2, "Holley_Mid_Mount_Accessory_Drive_Kit.pdf"))

    # 5. AEM TA2 LS3 Harness - Page 1: Complete engine harness component diagram
    print("[5] AEM TA2 LS3 Harness Component Diagram")
    r = extract_page(
        "AEM_TA2_LS3_harness_component_diagram.pdf", 1,
        "aem_ta2_ls3_harness_diagram.png",
        "Complete engine harness diagram with connector face views and GM part numbers"
    )
    results.append(("aem_ta2_ls3_harness_diagram.png", r, 1, "AEM_TA2_LS3_harness_component_diagram.pdf"))

    # 6. ACDelco Pigtail Catalog - Extract pages for 2-pin, 3-pin, 4-pin connectors
    # Pages: 5-6 (2-cavity), 15-16 (3-cavity), 19-20 (4-cavity)
    print("[6a] ACDelco Pigtail Catalog - 2-Pin Connectors")
    r = extract_pages(
        "ACDelco_Pigtail_Catalog_2013.pdf", [5, 6],
        "acdelco_pigtail_2pin.png",
        "2-cavity pigtails including EV6/USCAR and Metri-Pack types"
    )
    results.append(("acdelco_pigtail_2pin.png", r, "5-6", "ACDelco_Pigtail_Catalog_2013.pdf"))

    print("[6b] ACDelco Pigtail Catalog - 3-Pin Connectors")
    r = extract_pages(
        "ACDelco_Pigtail_Catalog_2013.pdf", [15, 16],
        "acdelco_pigtail_3pin.png",
        "3-cavity pigtails for LS3 sensors (MAP, coolant temp, etc.)"
    )
    results.append(("acdelco_pigtail_3pin.png", r, "15-16", "ACDelco_Pigtail_Catalog_2013.pdf"))

    print("[6c] ACDelco Pigtail Catalog - 4-Pin Connectors")
    r = extract_pages(
        "ACDelco_Pigtail_Catalog_2013.pdf", [19, 20],
        "acdelco_pigtail_4pin.png",
        "4-cavity pigtails for LS3 sensors (knock, cam, etc.)"
    )
    results.append(("acdelco_pigtail_4pin.png", r, "19-20", "ACDelco_Pigtail_Catalog_2013.pdf"))

    # 7. MoTeC C125 - Page 70 (0-indexed 69): Panel cutout dimensional drawing
    print("[7] MoTeC C125 Panel Cutout Dimensional Drawing")
    r = extract_page(
        "motec_c125_user_manual.pdf", 70,
        "motec_c125_panel_cutout.png",
        "Mounting dimensions for panel cutout with all dimensions in mm"
    )
    results.append(("motec_c125_panel_cutout.png", r, 70, "motec_c125_user_manual.pdf"))

    # 8. E-Stopp ESK001 - Page 2: Wiring diagram (image-only PDF)
    print("[8] E-Stopp ESK001 Wiring Diagram")
    r = extract_page(
        "E-Stopp_ESK001_Installation.pdf", 2,
        "estopp_esk001_wiring.png",
        "Complete wiring diagram with all wire colors and connections"
    )
    results.append(("estopp_esk001_wiring.png", r, 2, "E-Stopp_ESK001_Installation.pdf"))

    # Summary
    print("=" * 70)
    print("EXTRACTION SUMMARY")
    print("=" * 70)

    success = 0
    for filename, path, page, source in results:
        if path:
            size = os.path.getsize(path)
            print(f"  OK  {filename} ({size/1024:.1f} KB) from {source} p.{page}")
            success += 1
        else:
            print(f"  FAIL {filename}")

    print(f"\n{success}/{len(results)} extractions successful")
    print(f"Output directory: {OUT_DIR}")
