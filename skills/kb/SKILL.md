---
name: kb
description: >-
  Set up, evolve, or operate a hraness/kb local-first Markdown knowledge base
  for coding-agent memory. Use when a user asks to design KB conventions or a
  recurring KB ritual; search or query a KB or Obsidian vault; load repository
  context, plans, decisions, concepts, backlinks, semantic search, or Git
  provenance; save, clip, scrape, or archive a URL, article, social thread,
  signed-in browser page, or PDF as auditable Markdown; create or update a
  durable plan in the vault; or refresh, check, percolate, and maintain its
  knowledge graph. Do not use for generic web research, generic PDF reading,
  or ordinary planning that will not use a hraness/kb vault.
---

# Work with KB

Use hraness/kb to preserve and retrieve inspectable agent memory in Markdown
and Git. Select the smallest workflow that matches the request, then load only
its references.

## Route the request

Route the request before discovering, installing, or running the CLI. A setup,
evolution, or custom-ritual request begins with read-only inspection and an
approved proposal; it does not require a runtime merely because this skill was
selected.

| User intent | Read |
| --- | --- |
| Design, set up, or evolve a KB; choose its boundaries and conventions; or define a recurring KB ritual | [Customize a KB setup](references/customize.md); add [Companion skill contracts](references/companion-skills.md) only when the proposal includes a new or revised skill |
| Find notes, search one vault or an authorized portfolio, load repository-path context, inspect plans or decisions, follow backlinks or relationships, audit vault organization, or retrieve Git provenance | [Query the knowledge base](references/query.md) |
| Save, clip, scrape, or archive a URL, article, social post or thread, GitHub or Discourse discussion, signed-in page, feed, inbox, private document, WhatsApp conversation, or YouTube page | [Capture web content](references/save-url.md); add [browser authentication](references/url-authentication.md) for signed-in sources and [platform routing](references/url-platforms.md) when route choice or completeness matters |
| Import, extract, archive, OCR, or convert a local or public PDF into Markdown | [Save a PDF](references/save-pdf.md); add [PDF image review](references/pdf-review.md) for scans, screenshots, conversations, charts, or mixed media |
| Create or update an implementation plan, proposal, RFC, migration plan, execution audit, or phased checklist in the vault | [Write a durable plan](references/plan.md) and [use its structure](references/plan-structure.md) |
| Review recurring ideas, promote concepts, or add and verify typed relationships | [Percolate concepts and relationships](references/percolate.md) |
| Refresh or validate the catalog, graph, attachments, repository scopes, context mappings, or overall vault health | [Refresh and check the knowledge base](references/refresh.md) |

Read more than one primary reference only when the request spans those
workflows. For example, saving a source and linking it from a maintained note
uses the capture workflow followed by the relevant percolation and refresh
steps.

## Prepare the runtime when execution needs it

Use an existing `kb` command when one is available. Do not reinstall or upgrade
it merely because this skill loaded.

If `kb` is missing, check for Bun. Bun is the required runtime. When Bun is
also missing, install it with the official instructions at
<https://bun.sh/docs/installation> under the environment's normal approval
rules, then repeat command discovery. Install KB only while `kb` remains
missing:

```sh
command -v kb >/dev/null 2>&1 || {
  command -v bun >/dev/null 2>&1 || exit 1
  bun add --global @hraness/kb@0.18.0
}
kb --help
```

The exact npm version is the immutable release owned by this skill. Do not
replace it with `latest`, a branch, or an unpinned package source. Both installed
commands require Bun `1.3.14` or newer in `PATH`. Run `kb doctor` when the
chosen workflow may need browser capture, media tools, PDF extraction, OCR, or
local semantic search.

Installation ends after command verification. Never run `kb init`, create a
vault, refresh a catalog, or edit Markdown as an installation side effect.
Initialize or mutate a vault only when the user's request requires that change.

## Preserve the KB contract

- For an existing vault, resolve `KB_ROOT` to the directory that contains its
  managed or authored `index.md`. During setup, inspect the explicitly proposed
  location without assuming that `index.md` or any KB directory exists. Read
  the applicable repository and vault `AGENTS.md` files before writing. Do not
  assume the session started in the vault.
- Treat authored Markdown and Git as the record. Catalogs, backlinks, graph
  reports, search indexes, embeddings, and percolation candidates are derived
  views.
- Open cited notes and source records before turning search results, tags,
  mentions, or similarity into a conclusion. Author only relationships that
  the source note's prose and evidence support.
- Keep source capture separate from synthesis. Preserve access, pagination,
  extraction, OCR, and configured-limit failures instead of upgrading partial
  evidence to complete.
- Follow the selected reference's final checks. In a managed-catalog vault,
  parallel edit lanes use `kb check --root "$KB_ROOT" --no-catalog`; the
  integrating agent performs one refresh and normal check.
