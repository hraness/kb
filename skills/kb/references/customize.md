# Customize a KB setup

Design the smallest KB arrangement that answers the user's recurring memory
questions. Begin with an interview and read-only inspection. Do not install a
runtime, initialize a vault, build an index, access an account, or write a file
before the proposal has the user's approval.

## Establish the boundary

Identify the repositories, vaults, people, agents, and time horizons in scope.
Ask what the KB must help a future agent recover, which information must remain
outside it, and which existing instructions govern the target paths. Treat the
user's explicit request as authorization for the named work. Do not extend it
to another path, repository, account, application, or integration.

For a new vault, ask for or propose an exact location. Do not require an
existing `index.md`. For an existing vault, resolve its front door and read the
applicable `AGENTS.md` files before proposing changes.

## Inspect without mutation

Inspect only the surfaces needed to understand the current setup. Typical
evidence includes directory structure, existing Markdown conventions, scoped
agent guides, active plans, source records, repository paths, and available
local commands. Keep filesystem, application, account, network, and
integration access within the user's stated scope and the host's actual
permissions.

Do not run `kb doctor`, `kb init`, `kb index`, QMD, hybrid or semantic search,
an installer, or a command that may create a cache during this phase. Do not
create a hidden profile such as `.context/me.md` or infer personal context from
an ambient account.

## Interview in small batches

Ask only questions whose answers change the proposed structure. Prefer a small
batch about one decision at a time:

- Which recurring questions should the KB answer?
- Which sources, maintained explanations, plans, and repository rules already
  exist?
- Which writes should happen automatically, require review, or never happen?
- Which recurring action is common enough to justify a companion skill?

Summarize each resolved decision before moving to the next uncertain one. A
short interview may conclude that the standard profile or no change is best.

## Propose the smallest useful change

Describe the exact files and surfaces before editing. Use this table:

| Surface | Exact target | Read | Write | Purpose | Approval |
| --- | --- | --- | --- | --- | --- |
| Vault | `<path>` | `<bounded inputs>` | `<files or none>` | `<memory question>` | `<approved or pending>` |

Propose zero to three companion skills. Each proposed skill must own a distinct
recurring request that the main `kb` router cannot express clearly enough. Do
not add a skill only to restate repository policy or wrap one command.

State the verification, idempotence, retry, and failure behavior for every
write. Keep Markdown and Git authoritative. Treat indexes, embeddings,
catalogs, graph reports, and caches as replaceable views.

## Obtain approval

Present the proposal and wait when its writes are not already authorized by
the user's explicit request. Approval applies to the exact targets and
operations shown. A changed path, expanded repository, additional skill,
account surface, network action, or broader write requires renewed approval.

Silence, a denial, or an ambiguous response is not approval. Inspection does
not grant write authority. Discovery of a command, application, account, or
integration does not authorize its use.

## Scaffold within the approved boundary

Create only approved paths. For a companion skill, read [Companion skill
contracts](companion-skills.md) and copy
[`companion-skill.template.md`](../templates/companion-skill.template.md) to
`<explicit-skill-root>/<name>/SKILL.md`. Never edit the template inside an
installed package or `node_modules`.

If approved execution needs the KB CLI, prepare the runtime now using the main
skill's pinned installation instructions. Installation does not authorize
`kb init`, indexing, semantic search, or vault writes. Run only the approved
commands and exact allowlisted writes.

On a repeated request, compare the desired bytes with the approved targets.
Treat an exact match as a no-op. Stop on divergent existing content, a symlink,
a path that escapes the approved root, an unapproved external surface, or a
partial write. Report the retained state instead of overwriting, silently
retrying, or widening the boundary.

## Start with real material

Use a small amount of material that exercises the agreed structure: one saved
source, one maintained explanation, one plan, or one repository-context
mapping. Do not manufacture empty directories, placeholder notes, a complete
ontology, or speculative metadata merely to make the vault look populated.

## Verify and hand off

Verify every approved file and record the exact paths changed. Run the
narrowest applicable KB checks only when they were approved and the runtime is
available. State what remains unconfigured, which views are rebuildable, and
which action would require separate authority.

Keep durable output free of credentials, session material, account exports,
and hidden ambient context. Record source provenance and the boundary of any
incomplete acquisition.

## Evolve an existing setup

Re-run the boundary, inspection, interview, proposal, and approval steps when
the vault's recurring questions change. Prefer a focused convention or skill
revision to a migration. Preserve authored Markdown and Git history, and do not
mass-rewrite metadata to fit a new taxonomy unless a measured retrieval or
maintenance problem justifies that work.
