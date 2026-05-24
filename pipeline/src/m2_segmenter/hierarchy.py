from __future__ import annotations

from dataclasses import dataclass

from m1_ingestor import CanonicalAncestor


@dataclass(frozen=True)
class SemanticNode:
    id: str
    parent_id: str | None
    level: str
    cts_urn: str
    passage_ref_range: str
    token_count: int
    passage_id: str | None = None
    aggregation_method: str = "token_weighted_mean"


def build_basic_hierarchy(author_id: str, work_id: str, passages: list[SemanticNode]) -> list[SemanticNode]:
    author = SemanticNode(
        id=f"author:{author_id}",
        parent_id=None,
        level="author",
        cts_urn=f"urn:cts:{author_id}",
        passage_ref_range="",
        token_count=sum(node.token_count for node in passages),
    )
    work = SemanticNode(
        id=f"work:{work_id}",
        parent_id=author.id,
        level="work",
        cts_urn=f"urn:cts:{author_id}.{work_id}",
        passage_ref_range="",
        token_count=sum(node.token_count for node in passages),
    )
    leaves = [
        SemanticNode(
            id=node.id,
            parent_id=work.id,
            level="passage",
            cts_urn=node.cts_urn,
            passage_ref_range=node.passage_ref_range,
            token_count=node.token_count,
            passage_id=node.passage_id,
            aggregation_method="leaf",
        )
        for node in passages
    ]
    return [author, work, *leaves]


def build_canonical_hierarchy(
    author_id: str,
    work_id: str,
    leaves: list[tuple[SemanticNode, tuple[CanonicalAncestor, ...]]],
) -> list[SemanticNode]:
    author_node_id = f"node:{author_id}"
    work_node_id = f"node:{work_id}"
    aggregate_tokens: dict[str, int] = {author_node_id: 0, work_node_id: 0}
    aggregate_defs: dict[str, tuple[str | None, str, str, str]] = {
        author_node_id: (None, "author", f"urn:cts:{author_id}", ""),
        work_node_id: (author_node_id, "work", f"urn:cts:{work_id}", ""),
    }
    leaf_nodes: list[SemanticNode] = []
    for leaf, ancestors in leaves:
        aggregate_tokens[author_node_id] += leaf.token_count
        aggregate_tokens[work_node_id] += leaf.token_count
        parent_id = work_node_id
        for ancestor in ancestors:
            if ancestor.level not in {"book", "chapter", "section"}:
                continue
            node_id = f"node:{ancestor.level}:{work_id}:{ancestor.ref}"
            aggregate_defs.setdefault(
                node_id,
                (parent_id, ancestor.level, ancestor.cts_urn, ancestor.ref),
            )
            aggregate_tokens[node_id] = aggregate_tokens.get(node_id, 0) + leaf.token_count
            parent_id = node_id
        leaf_nodes.append(
            SemanticNode(
                id=leaf.id,
                parent_id=parent_id,
                level="passage",
                cts_urn=leaf.cts_urn,
                passage_ref_range=leaf.passage_ref_range,
                token_count=leaf.token_count,
                passage_id=leaf.passage_id,
                aggregation_method="leaf",
            )
        )
    order = {"author": 0, "work": 1, "book": 2, "chapter": 3, "section": 4}
    aggregate_nodes = [
        SemanticNode(
            id=node_id,
            parent_id=definition[0],
            level=definition[1],
            cts_urn=definition[2],
            passage_ref_range=definition[3],
            token_count=aggregate_tokens[node_id],
        )
        for node_id, definition in aggregate_defs.items()
    ]
    aggregate_nodes.sort(key=lambda node: (order[node.level], node.id))
    return [*aggregate_nodes, *leaf_nodes]
