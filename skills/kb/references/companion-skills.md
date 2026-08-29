# Companion skill contracts

A companion skill handles one recurring KB ritual that benefits from a
discriminating trigger and an explicit operating contract. It composes with
the public `kb` skill. It does not register code at runtime, execute vault
metadata, or gain authority by being installed.

## Identity and routing

Give the skill a lowercase action-oriented name and a description that states
the concrete request that should select it. Keep generic querying, capture,
planning, percolation, refresh, and validation in the main `kb` skill. Propose
at most three companions, and prefer zero when the standard router is enough.

## Inputs and preconditions

List the exact inputs that must be supplied or resolved before work starts.
Distinguish an existing vault from a proposed location. State required local
commands, repository state, source availability, and authorization without
installing or probing them as a side effect of skill discovery.

## Surfaces and authority

List each filesystem, repository, application, account, network, and
integration surface the workflow may read or write. Skill discovery,
installation, or an existing signed-in session grants no authority. The user's
scope, the applicable repository instructions, host permissions, and the
selected tool's own approval boundary remain controlling.

Do not infer that an account operation is read-only from its HTTP method. Do
not place secrets, cookies, tokens, session data, or ambient personal context
in durable output.

The shipped customization executor proves filesystem scaffolding only. It
does not execute an application, account, network, or integration write. A
companion skill that later needs such an action must treat it as a separate
runtime request with its own exact proposal, approval, capable tool, and
inspectable result.

## Approval boundary

Separate read-only inspection from mutation. Present exact targets and writes
before approval unless the user's request already authorizes them. A denial,
no response, changed proposal, path expansion, added account, or new external
surface requires stopping or renewed approval.

## Execution semantics

Define deterministic behavior for the first run and an exact repeat. Require
path confinement, reject symbolic-link targets, and preserve divergent
existing content. Name each effect explicitly instead of granting a broad
filesystem or application capability.

## Durable outputs and provenance

Name the files or records that persist, their authority, and the provenance
they retain. Markdown and Git remain authoritative KB state. Generated
catalogs, indexes, embeddings, and graph reports stay rebuildable. Exclude
credentials, session material, and unrelated account data.

## Verification and KB maintenance

Define the narrow checks that establish the intended result. After material KB
edits, review percolation candidates and run the appropriate catalog-aware
check. Parallel lanes use `kb check --no-catalog`; one integrating agent owns a
managed catalog refresh.

## Composition boundary

Call the installed `kb` command or its public package interfaces only when the
approved workflow needs them. Do not add a plugin registry, hook loader,
background process, executable vault metadata, or implicit account bridge. A
companion skill is an instruction boundary, not runtime extensibility.

## Review checklist

The repository's fake-capability suite is a tested contract example. It checks
the expected approval and failure transitions, but it does not prove that every
agent or host integration complies. Review the executing agent's actual tool
and permission boundaries as well.

- Does the trigger identify one recurring request without attracting generic
  KB work?
- Are inputs, preconditions, read surfaces, write surfaces, and exact targets
  explicit?
- Can inspection finish without installing, indexing, caching, or mutating?
- Does approval cover every effect, with renewed approval for any change?
- Is an exact repeat a no-op, while divergence, path escape, symlinks, partial
  failure, and unapproved external access stop safely?
- Do durable outputs preserve useful provenance without secrets or session
  data?
- Does the skill compose with the public router without copying its general
  instructions?

Start from [`companion-skill.template.md`](../templates/companion-skill.template.md)
only after the proposal's target skill root and name are approved.
