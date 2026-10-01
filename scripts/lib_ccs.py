r"""Assign an ACM CCS 2012 top-level class to a funding programme.

Hand classification does not scale to a weekly sweep, so this exists to give new
imports a starting class. It is deliberately conservative:

  * a class is only assigned when a rule matches; otherwise the programme is
    "General and reference", which is what a genuinely cross-cutting call is
  * everything it assigns is marked `ccs_auto: true`, so a human can tell its
    guesses from a read solicitation, and the weekly job opens a PR rather than
    committing
  * it never overwrites a class a person has set

Order matters. A domain application is checked before the technique it uses, so
"AI for chemistry" lands in Applied computing while "foundations of AI" lands in
Computing methodologies - the distinction a keyword count always gets wrong.

Patterns end in \w* on purpose: several terms are stems, and "robot" with a
trailing word boundary does not match "Robotics", which is the form that appears.
"""

from __future__ import annotations

import re

CLASSES = [
    "General and reference", "Hardware", "Computer systems organization", "Networks",
    "Software and its engineering", "Theory of computation", "Mathematics of computing",
    "Information systems", "Security and privacy", "Human-centered computing",
    "Computing methodologies", "Applied computing", "Social and professional topics",
]

# (class, pattern) in priority order.
RULES: list[tuple[str, re.Pattern]] = [
    # Funds the profession rather than a research area. First, because these
    # programmes describe the research they enable and would otherwise match it.
    ("Social and professional topics", re.compile(
        r"(?i)\b(EPSCoR|HBCU|historically black colleges|minority[- ]serving|"
        r"inclusion|broadening participation|"
        r"early[- ]career development|CAREER program|research security|capacity building|"
        r"I-Corps|translation to practice|predominantly undergraduate)\w*\b")),
    # Education and training programmes.
    ("Applied computing", re.compile(
        r"(?i)\b(traineeship|research experiences? for (teachers|undergraduates)|"
        r"scholarship for service|curricul|K-1[24]|workforce development|"
        r"education (innovation|and workforce)|graduate education)\w*\b")),
    # Computing applied to another discipline.
    ("Applied computing", re.compile(
        r"(?i)\b(chemistry|chemical process|biolog|biomedical|health|clinical|"
        r"materials|climate|geoscience|astronom|energy systems|manufacturing|"
        r"for scientific discovery|science and engineering research)\w*\b")),
    ("Software and its engineering", re.compile(
        r"(?i)\b(open[- ]source|software engineering|programming language|compiler|"
        r"software sustainability)\w*\b")),
    ("Security and privacy", re.compile(
        r"(?i)\b(cybersecurity|security and privacy|privacy|cryptograph|"
        r"trusted systems|secure|threat|malware|intrusion)\w*\b")),
    ("Networks", re.compile(
        r"(?i)\b(networking|network architecture|wireless|spectrum|5G|6G|"
        r"telecommunication|air interface|communications? and networking)\w*\b")),
    ("Hardware", re.compile(
        r"(?i)\b(semiconductor|integrated circuit|photonic|microelectronic|VLSI|"
        r"chip|quantum (testbed|device|technolog)|sensing[- ]systems|"
        r"wave-based computing|electronic.{0,20}devices)\w*\b")),
    ("Computer systems organization", re.compile(
        r"(?i)\b(robot|cyber-physical|embedded system|real-time system|"
        r"computer architecture|infrastructure hubs|compute infrastructure)\w*\b")),
    ("Information systems", re.compile(
        r"(?i)\b(data management|database|dataset|data infrastructure|"
        r"cyberinfrastructure|information retrieval|repositor|open science|FAIR data)\w*\b")),
    ("Computing methodologies", re.compile(
        r"(?i)(\bartificial intelligence|\bAI\b|\bmachine learning|\bfoundation model|"
        r"computer vision|natural language|computer graphics|"
        r"parallel computing|distributed computing)\w*\b")),
    ("Theory of computation", re.compile(
        r"(?i)\b(algorithmic foundations|theoretical computer science|"
        r"computational complexity|formal method|algorithms? and complexity)\w*\b")),
    ("Mathematics of computing", re.compile(
        r"(?i)\b(computational mathematics|numerical analysis|"
        r"mathematical foundations of comput|probability and statistics)\w*\b")),
    ("Human-centered computing", re.compile(
        r"(?i)\b(human[- ]computer interaction|usability|accessibility|"
        r"visuali[sz]ation|social computing|human[- ]centered)\w*\b")),
]


def classify(title: str, description: str = "") -> tuple[str, str]:
    """Return (class, matched rule text).

    The title only. Descriptions were tried and made it worse: every NSF
    solicitation mentions security, data and AI somewhere in its boilerplate, so
    "Expeditions in Computing" came back as Security and privacy. A programme's
    title is the one place its subject is stated deliberately.
    """
    for cls, pattern in RULES:
        hit = pattern.search(title or "")
        if hit:
            return cls, hit.group(0)
    return "General and reference", ""
