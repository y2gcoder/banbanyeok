"""Require an unrestricted Kotlin filter rule for each committed pipeline test input."""

import os
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
TEST_BLOCK = re.compile(r'^tasks\.named<Test>\("test"\) \{\n(.*?)^\}', re.M | re.S)
INPUT = re.compile(
    r'inputs\.(dir|file)\(rootProject\.file\("([a-zA-Z0-9_./-]+)"\)\)'
    r'\.withPathSensitivity\(PathSensitivity\.RELATIVE\)'
)
KOTLIN_FILTER = re.compile(r'^kotlin:\n(.*?)(?=^\S|\Z)', re.M | re.S)
RULE = re.compile(r"- '([^']+)'(?:\s+#.*)?")


def block(pattern, text, name):
    sections = pattern.findall(text)
    if len(sections) != 1:
        raise SystemExit(f"Expected exactly one {name}")
    return sections[0].splitlines()


def entries(lines, pattern, comment, name):
    for line in lines:
        line = line.strip()
        if not line or line.startswith(comment):
            continue
        match = pattern.fullmatch(line)
        if not match:
            raise SystemExit(f"Unsupported {name} declaration: {line}")
        yield match


def main():
    if os.environ.get("CHANGE_FILTER_QUANTIFIER") != "some":
        raise SystemExit("The Kotlin input check requires paths-filter predicate-quantifier: some")

    gradle = (ROOT / "pipeline/build.gradle.kts").read_text(encoding="utf-8")
    inputs = block(TEST_BLOCK, gradle, 'pipeline tasks.named<Test>("test") block')
    expected = set()
    for match in entries(inputs, INPUT, "//", "pipeline test input"):
        kind, path = match.groups()
        expected.add(f"{path}/**" if kind == "dir" else path)
    if not expected:
        raise SystemExit("No committed pipeline test inputs found")

    filters = os.environ.get("CHANGE_FILTERS", "")
    kotlin = block(KOTLIN_FILTER, filters, "Kotlin path filter")
    actual = {match[1] for match in entries(kotlin, RULE, "#", "Kotlin path filter")}
    missing = expected - actual
    if missing:
        rules = "\n".join(f"  - '{rule}'" for rule in sorted(missing))
        raise SystemExit(f"Missing Kotlin path filter rules in .github/workflows/ci.yml:\n{rules}")

    print(f"Kotlin CI filter covers {len(expected)} committed pipeline test inputs")


if __name__ == "__main__":
    main()
