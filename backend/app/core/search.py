import re


INVISIBLE_SEARCH_CHAR_PATTERN = re.compile(r"[\u00AD\u200B-\u200D\u2060\uFEFF]+")


def normalize_search_term(value: str) -> str:
    collapsed = INVISIBLE_SEARCH_CHAR_PATTERN.sub("", value)
    return " ".join(collapsed.split())
