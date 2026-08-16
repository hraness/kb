---
title: Repository seams
type: concept
tags:
  - architecture
  - dependencies
  - repositories
repository_scopes:
  - AGENTS.md
  - docs
  - package.json
  - skills
  - src
---

# Repository seams

`@hraness/kb` owns product-neutral Markdown graph, retrieval, authoring, capture, repository-memory, workflow, and agent-guide contracts. Repository-specific vault content, corpora, retriever configurations, promotion policy, and product interfaces remain with consumers.

Required Hraness forks and packages use reviewed immutable commits or releases. Consumers pin this package independently and do not rely on sibling paths, Git submodules, or coordinated `main` workflows. Extract another shared package only after two concrete consumers need the same stable, product-neutral interface; this package never imports a consumer product.

The package stays headless and has no design-system edge. Consumers may present KB data with accessible primitives from `@hraness/ui`, optional stable composition from `@hraness/design-kit`, and product-owned layout and content. Direct compositions are development-only and must not enter the packed file set or production dependency graph.

Freeze CLI, metadata, graph, workflow, and skill contracts before parallel lanes. Give `package.json`, `bun.lock`, committed `dist/`, canonical skill mirrors, and other convergence files one owner while independent lanes change disjoint source and test paths.

## Related

The normative rules remain in the root `AGENTS.md`. [[documentation-ownership|Documentation ownership]] explains how those rules relate to executable contracts and this pull-based context.
