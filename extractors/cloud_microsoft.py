from pathlib import Path
import re
import pandas as pd

from extractors.common import (
    canonicalize_billing,
    canonicalize_term,
    get_canonical_product_name,
    get_strict_period_key,
    normalize_name_text,
    readable_excel_path,
    resolve_column,
    safe_float,
    safe_str,
)


def build_cloud_product(
    distributor,
    product_type,
    part_number,
    name,
    term,
    billing,
    price,
    erp,
    segment,
    product_id="",
):
    clean_name = normalize_name_text(name)
    clean_part_number = safe_str(part_number)
    clean_product_id = safe_str(product_id)
    clean_term = safe_str(term)
    clean_billing = safe_str(billing)
    clean_segment = safe_str(segment)

    # Exclude Charity / NonProfit products
    seg_upper = clean_segment.upper()
    name_upper = clean_name.upper()
    if (
        "CHARITY" in seg_upper
        or "NONPROFIT" in seg_upper
        or "NFP" in seg_upper
        or "NON-PROFIT" in name_upper
        or "NONPROFIT" in name_upper
    ):
        return None

    # Normalize segment names to Commercial or Education
    if "EDU" in seg_upper or "FACULTY" in seg_upper or "STUDENT" in seg_upper:
        normalized_segment = "Education"
    else:
        normalized_segment = "Commercial"

    if product_type == "PERPETUO":
        clean_term = "OneTime"
        clean_billing = "OneTime"
        normalized_term = "onetime"
        normalized_billing = "onetime"
        strict_period_key = "onetime_onetime"
    elif product_type == "TRIAL":
        clean_billing = ""
        normalized_term = "trial"
        normalized_billing = "trial"
        strict_period_key = "trial"
    else:
        normalized_term = canonicalize_term(clean_term, clean_part_number, clean_name)
        normalized_billing = canonicalize_billing(clean_billing, clean_part_number, clean_name)
        strict_period_key = get_strict_period_key(normalized_term, normalized_billing)

    return {
        "area": "cloud",
        "distributor": distributor,
        "type": product_type,
        "partNumber": clean_part_number,
        "productId": clean_product_id,
        "name": clean_name,
        "term": clean_term,
        "billing": clean_billing,
        "price": price,
        "erp": erp,
        "segment": normalized_segment,
        "canonicalName": get_canonical_product_name(clean_name),
        "normalizedTerm": normalized_term,
        "normalizedBilling": normalized_billing,
        "strictPeriodKey": strict_period_key,
    }


def extract_lol(path):
    items = []
    with readable_excel_path(path) as readable_path:
        xl = pd.ExcelFile(readable_path)
        sheet_names = xl.sheet_names

        for sheet in sheet_names:
            s_lower = sheet.lower()
            df = pd.read_excel(readable_path, sheet_name=sheet)

            erp_col = resolve_column(df.columns, "ERP Price", "ERP", "ERP_Price")
            product_id_col = resolve_column(df.columns, "ProductId", "Product Id", "ProductID")
            part_col = resolve_column(
                df.columns,
                "NUMERO DE PARTE",
                "Numero Parte",
                "Part Number",
                "ProductId",
                "Product Id",
                "ProductID",
            )
            name_col = resolve_column(
                df.columns,
                "SkuTitle",
                "Descripción",
                "Descripcion",
                "Product Title",
                "Title",
                "ProductTitle",
            )
            term_col = resolve_column(df.columns, "TermDuration", "Term")
            billing_col = resolve_column(df.columns, "BillingPlan", "Billing Plan", "Billing")
            price_col = resolve_column(
                df.columns,
                "PARTNER PRICE",
                "Partner Price",
                "UnitPrice",
                "Unit Price",
                "Unit_Price",
                "Price",
            )
            segment_col = resolve_column(df.columns, "Segment")
            tags_col = resolve_column(df.columns, "Tags", "Tag")

            # Determine default type from sheet or filename
            default_type = "NCE"
            if "perpetu" in s_lower:
                default_type = "PERPETUO"
            elif "suscrip" in s_lower or "subscript" in s_lower or "software" in s_lower:
                default_type = "SUSCRIPCION"
            elif "nce" in s_lower:
                default_type = "NCE"
            elif "perpetu" in path.name.lower():
                default_type = "SUSCRIPCION"
            else:
                default_type = "NCE"

            for _, row in df.iterrows():
                name = safe_str(row.get(name_col)) if name_col else ""
                price = safe_float(row.get(price_col, 0)) if price_col else 0.0

                if not name or price <= 0:
                    continue

                product_id = safe_str(row.get(product_id_col)) if product_id_col else ""
                part_number = (
                    safe_str(row.get(part_col)) if part_col else product_id
                ) or product_id
                raw_term = safe_str(row.get(term_col)) if term_col else ""
                raw_billing = safe_str(row.get(billing_col)) if billing_col else ""
                if raw_billing.lower() in ("none", "nan"):
                    raw_billing = ""
                raw_segment = safe_str(row.get(segment_col)) if segment_col else ""
                raw_tags = safe_str(row.get(tags_col)) if tags_col else ""
                erp = safe_float(row.get(erp_col, 0)) if erp_col else 0.0

                # Fine-grained classification into TRIAL, NCE, SUSCRIPCION, or PERPETUO
                row_type = default_type
                tags_upper = raw_tags.upper()
                name_lower = name.lower()
                part_upper = part_number.upper()
                term_upper = raw_term.upper()
                is_trial = "TRIAL" in tags_upper or (
                    default_type == "NCE"
                    and not raw_billing
                    and (
                        "P1M" in term_upper
                        or part_upper.endswith(":P1M")
                        or "trial" in name_lower
                    )
                )

                if is_trial:
                    row_type = "TRIAL"
                elif default_type == "PERPETUO":
                    row_type = "PERPETUO"
                elif "perpetu" in path.name.lower() or "perpetual" in path.name.lower():
                    if raw_billing.lower() == "onetime" or raw_term.lower() == "onetime":
                        row_type = "PERPETUO"
                    else:
                        row_type = "SUSCRIPCION"
                elif "software" in s_lower:
                    row_type = "SUSCRIPCION"
                elif (
                    "server" in name_lower
                    and ("1 year" in name_lower or "3 year" in name_lower)
                    and ("azure" in name_lower or "esu" in name_lower or "sql" in name_lower)
                ):
                    row_type = "SUSCRIPCION"

                prod = build_cloud_product(
                    distributor="LOL",
                    product_type=row_type,
                    part_number=part_number,
                    name=name,
                    term=raw_term or ("OneTime" if row_type == "PERPETUO" else ""),
                    billing=raw_billing
                    or ("OneTime" if row_type == "PERPETUO" else ""),
                    price=price,
                    erp=erp,
                    segment=raw_segment,
                    product_id=product_id,
                )
                if prod:
                    items.append(prod)

    return items


MONTH_TOKENS = [
    (12, ("DIC", "DICIEMBRE", "DEC", "DECEMBER")),
    (11, ("NOV", "NOVIEMBRE", "NOVEMBER")),
    (10, ("OCT", "OCTUBRE", "OCTOBER")),
    (9, ("SEP", "SEPT", "SEPTIEMBRE", "SEPTEMBER")),
    (8, ("AGO", "AGOSTO", "AUG", "AUGUST")),
    (7, ("JUL", "JULIO", "JULY")),
    (6, ("JUN", "JUNIO", "JUNE")),
    (5, ("MAY", "MAYO")),
    (4, ("ABR", "ABRIL", "APR", "APRIL")),
    (3, ("MAR", "MARZO", "MARCH")),
    (2, ("FEB", "FEBRERO", "FEBRUARY")),
    (1, ("ENE", "ENERO", "JAN", "JANUARY")),
]


def _cloud_file_sort_key(path):
    upper = path.name.upper()
    year_match = re.search(r"20(\d{2})|(?:ENE|FEB|MAR|ABR|MAY|JUN|JUL|AGO|SEP|OCT|NOV|DIC)(\d{2})\b", upper)
    year = 0
    if year_match:
        year = 2000 + int(year_match.group(1) or year_match.group(2))

    month = 0
    for month_num, tokens in MONTH_TOKENS:
        if any(re.search(rf"(?:^|[^A-Z]){token}(?:\d{{2}}|\b|[^A-Z])", upper) for token in tokens):
            month = month_num
            break

    is_nueva = 1 if "NUEVA" in upper else 0
    is_provexpress = 1 if "PROVEXPRESS" in upper else 0
    return (year, month, is_nueva, is_provexpress, path.stat().st_mtime)


def build_cloud_catalog(base_dir=None):
    root_dir = Path(base_dir or Path(__file__).resolve().parent.parent)
    catalog = []

    data_dir = root_dir / "data"
    all_excel = [
        f
        for f in data_dir.glob("*.xlsx")
        if not f.name.startswith("~$")
        and "acronis" not in f.name.lower()
        and "calculadora" not in f.name.lower()
    ]

    if not all_excel:
        return catalog

    ranked = sorted(all_excel, key=_cloud_file_sort_key, reverse=True)
    best = ranked[0]
    best_ym = _cloud_file_sort_key(best)[:2]

    # Prefer the single newest consolidated workbook; if the latest month splits NCE & Perpetual, include sibling
    same_month = [f for f in ranked if _cloud_file_sort_key(f)[:2] == best_ym]
    if "perpetu" in best.name.lower():
        target_files = same_month
    else:
        target_files = [best]

    seen_keys = set()
    for f in target_files:
        for item in extract_lol(f):
            key = (
                item["type"],
                item["partNumber"],
                item["normalizedTerm"],
                item["normalizedBilling"],
                item["segment"],
            )
            if key not in seen_keys:
                seen_keys.add(key)
                catalog.append(item)

    return catalog
