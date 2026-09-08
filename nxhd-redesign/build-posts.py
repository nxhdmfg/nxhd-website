#!/usr/bin/env python3
"""
build-posts.py — Regenerate /posts.json from /content/posts/*.md

Reads each Markdown file, parses the front-matter (YAML-ish, simple key:value),
extracts the body, and aggregates everything into a single sorted-by-date-desc
JSON array at /posts.json. Run this:
  - manually before zipping for Direct Upload
  - automatically by Cloudflare Pages build step on every git push
"""
from __future__ import annotations

import glob
import json
import os
import re
import sys
from typing import Any, Dict, List

HERE = os.path.dirname(os.path.abspath(__file__))
POSTS_DIR = os.path.join(HERE, "content", "posts")
OUTPUT = os.path.join(HERE, "posts.json")


def parse_simple_frontmatter(text: str) -> tuple[Dict[str, Any], str]:
    """Parse `---\nkey: value\n---` block. Multi-line values supported.

    Supports:
      - key: value
      - key: "value with spaces"
      - key: [a, b, c]   (JSON-style list)
    Everything else is treated as a plain string.
    """
    if not text.startswith("---"):
        return {}, text
    parts = text.split("---", 2)
    if len(parts) < 3:
        return {}, text
    raw_fm, body = parts[1], parts[2]
    fm: Dict[str, Any] = {}
    current_key = None
    for line in raw_fm.splitlines():
        s = line.rstrip()
        if not s.strip():
            continue
        m = re.match(r"^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$", s)
        if m:
            current_key = m.group(1)
            v = m.group(2).strip()
            if not v:
                continue
            fm[current_key] = _parse_scalar(v)
        else:
            # indented continuation list line, e.g. "  - foo"
            if current_key and s.lstrip().startswith("- "):
                v = s.lstrip()[2:].strip()
                if current_key not in fm or not isinstance(fm.get(current_key), list):
                    fm[current_key] = []
                fm[current_key].append(v)
    return fm, body.lstrip()


def _parse_scalar(v: str) -> Any:
    """Parse a scalar that may be a quoted string, a list '[a, b]', or plain."""
    if not v:
        return ""
    if v.startswith('"') and v.endswith('"'):
        return v[1:-1]
    if v.startswith("'") and v.endswith("'"):
        return v[1:-1]
    if v.startswith("[") and v.endswith("]"):
        inner = v[1:-1].strip()
        if not inner:
            return []
        items = [x.strip() for x in inner.split(",")]
        return [_parse_scalar(x) for x in items]
    return v


def build_posts() -> List[Dict[str, Any]]:
    if not os.path.isdir(POSTS_DIR):
        print(f"No posts dir: {POSTS_DIR}", file=sys.stderr)
        return []
    out: List[Dict[str, Any]] = []
    for path in sorted(glob.glob(os.path.join(POSTS_DIR, "*.md"))):
        with open(path, "r", encoding="utf-8") as fh:
            text = fh.read()
        fm, body = parse_simple_frontmatter(text)
        if not fm.get("title") or not fm.get("slug"):
            print(f"Skipping {path}: missing title/slug", file=sys.stderr)
            continue
        out.append(
            {
                "slug": fm.get("slug", "").strip(),
                "title": fm.get("title", "").strip(),
                "date": fm.get("date", "").strip(),
                "author": fm.get("author", "").strip() or "NXHD Team",
                "cover": fm.get("cover", "").strip(),
                "excerpt": fm.get("excerpt", "").strip(),
                "tags": fm.get("tags", []) if isinstance(fm.get("tags"), list) else [],
                "content": body.strip(),
            }
        )
    out.sort(key=lambda x: x.get("date", ""), reverse=True)
    return out


def main() -> int:
    posts = build_posts()
    with open(OUTPUT, "w", encoding="utf-8") as fh:
        json.dump(posts, fh, ensure_ascii=False, indent=2)
    print(f"Built {len(posts)} posts → {OUTPUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
