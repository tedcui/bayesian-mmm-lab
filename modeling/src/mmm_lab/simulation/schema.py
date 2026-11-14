"""Source inventories adapted from the checked-in user-provided schema contract."""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from functools import lru_cache

import pyarrow as pa

from mmm_lab.paths import REPOSITORY_ROOT

SOURCE_DOCUMENT = REPOSITORY_ROOT / "docs" / "SOURCE_SCHEMA_AND_ETL.md"
TABLES = {
    "transactions": ("SOURCE_TRANSACTIONS", 44),
    "stores": ("SOURCE_STORES", 42),
    "brands": ("SOURCE_BRANDS", 19),
}
_COLUMN = re.compile(r"^\| `([^`]+)` \| `([^`]+)` \| (Yes|No) \|")


@dataclass(frozen=True)
class SourceColumn:
    name: str
    source_type: str
    nullable: bool


@lru_cache(maxsize=None)
def source_columns(table: str) -> tuple[SourceColumn, ...]:
    """Extract the exact checked-in inventory, failing if the document drifts."""
    heading, count = TABLES[table]
    text = SOURCE_DOCUMENT.read_text(encoding="utf-8")
    section = text.split(f"### {heading} — {count} columns", 1)[1].split("\n### ", 1)[0]
    columns = tuple(
        SourceColumn(match.group(1), match.group(2), match.group(3) == "Yes")
        for line in section.splitlines()
        if (match := _COLUMN.match(line))
    )
    if len(columns) != count or len({column.name for column in columns}) != count:
        raise ValueError(f"{table} source inventory no longer has {count} distinct columns")
    return columns


def arrow_type(source_type: str) -> pa.DataType:
    if source_type.startswith("VARCHAR2"):
        return pa.string()
    if source_type == "NUMBER(19,0)":
        return pa.int64()
    if source_type == "NUMBER(10,0)":
        return pa.int32()
    if source_type.startswith("NUMBER(") and source_type.endswith(",3)"):
        precision = int(source_type.split("(", 1)[1].split(",", 1)[0])
        return pa.decimal128(precision, 3)
    if source_type == "BOOLEAN":
        return pa.bool_()
    if source_type == "BINARY_DOUBLE":
        return pa.float64()
    if source_type == "TIMESTAMP(7) WITH TIME ZONE":
        return pa.timestamp("ns", tz="UTC")
    if source_type == "TIMESTAMP(7)":
        return pa.timestamp("ns")
    raise ValueError(f"Unsupported source type: {source_type}")


@lru_cache(maxsize=None)
def source_schema(table: str) -> pa.Schema:
    return pa.schema(
        pa.field(column.name, arrow_type(column.source_type), nullable=column.nullable)
        for column in source_columns(table)
    )


def schema_sha256() -> str:
    inventories = {
        table: [column.__dict__ for column in source_columns(table)] for table in TABLES
    }
    return hashlib.sha256(json.dumps(inventories, sort_keys=True).encode("utf-8")).hexdigest()
