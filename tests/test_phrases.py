"""The filters behind trending phrases and research eras."""

from collections import Counter

import proceedings_dblp as P


def test_one_name_per_idea():
    assert P.related("transformer", "transformers")
    assert P.related("multimodal", "multi-modal")
    assert P.related("pre-training", "pre-trained")
    assert P.related("rag", "retrieval-augmented generation")
    assert P.related("generative adversarial", "adversarial networks")
    assert not P.related("graph neural networks", "neural radiance fields")
    assert not P.related("diffusion", "mamba")


def test_filler_and_based_variants_are_generic():
    uses = {2025: Counter({"diffusion": 10}), 2024: Counter()}
    totals = Counter({2025: 10000, 2024: 10000})
    vocab = P.ERA_VOCABULARY | P.TITLE_FILLER
    assert P.generic("unveiling", uses, totals, [2024, 2025], vocab)
    assert P.generic("llm-based", uses, totals, [2024, 2025], vocab)
    assert not P.generic("diffusion", uses, totals, [2024, 2025], vocab)


def test_a_word_common_in_any_period_is_generic():
    uses = {1990: Counter({"system": 300}), 2025: Counter({"system": 10})}
    totals = Counter({1990: 1000, 2025: 10000})
    assert P.generic("system", uses, totals, [1990, 2025], set())


def test_a_word_gives_way_to_the_phrase_that_carries_it():
    year = Counter({"splatting": 100, "gaussian splatting": 90, "diffusion": 50, "diffusion models": 10})
    assert P.inside_phrase("splatting", 100, year.keys(), year)
    assert not P.inside_phrase("diffusion", 50, year.keys(), year)
