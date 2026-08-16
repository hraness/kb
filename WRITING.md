# Internal writing and voice

This guide covers agent responses, code comments, commits, pull requests, plans, and knowledge-base notes. `STYLE.md` adds rules for public prose.

## Write for the spoken voice

- Lead with the answer, outcome, or required action.
- Have a position. State the conclusion and its reason.
- Connect related ideas. Do not stack choppy sentences that all carry equal weight.
- Vary sentence length and structure enough to avoid a mechanical rhythm.
- Do not force each paragraph to announce its point and repeat it at the end.
- Remove throat-clearing openers, recaps, setup-and-payoff framing, and decorative closing lines.
- Ask a real question only when the reader needs to answer it. Do not use rhetorical questions to manufacture momentum.
- State a claim directly instead of staging a “not X but Y” contrast.
- Do not build rhythm from repeated negatives, contrasting pairs, parallel sentence forms, or automatic groups of three.
- Keep parallel grammar when a list, procedure, or exact comparison needs it.
- Prefer concrete verbs to noun phrases that hide the action. Write “evaluate,” not “perform an evaluation.”
- Unpack long stacks of nouns so the relationship between terms is explicit.
- Remove filler intensifiers such as *genuinely, really, truly,* and *actually*.
- Replace vague corporate verbs such as *leverage, utilize, showcase,* and *underscore* with the exact action.
- Use one accurate qualifier when uncertainty matters. Remove empty or repeated hedges.
- Use natural contractions when they fit the voice. Do not force a formal register.
- Keep enthusiasm proportional to the evidence. Do not perform excitement or agreement.
- Use humor rarely. Do not let humor carry technical meaning.

These rules target rhetorical habits, not necessary grammar. Keep a contrast, qualifier, parallel structure, or technical noun when accuracy requires it.

## Keep technical prose exact

- Preserve facts, names, numbers, quotations, links, code, commands, and necessary qualifications.
- Use one stable term for each concept. Define an unfamiliar term at its first use.
- Keep exact code identifiers, interface values, proper names, and approved project vocabulary.
- Prefer a short familiar word only when it preserves the technical distinction.
- Prefer active voice when the actor and action matter. Use passive voice when the actor is unknown or the result is the subject.
- Give one required action in each procedural step. Start the step with an imperative verb.
- Put a prerequisite condition before its command.
- Put required actions in steps, not notes. Use notes for supporting information.
- Start safety text with a clear command or condition. Name the risk and the possible result.
- Use a vertical list when prose hides complex parallel information.
- Use inclusive language. Avoid regional expressions, slang, and unexplained jargon.

[ASD-STE100 Simplified Technical English, Issue 9](https://www.asd-ste100.org/assets/files/ASD-STE100_ISSUE9.pdf) remains an additional standard for controlled technical English. Use it only when a procedure, safety instruction, maintenance document, or contract requires STE.

Apply its controlled dictionary and numeric limits only when the task requires STE compliance. Do not claim compliance without a review against the full standard.

## Keep the structure operational

- Use bullets for parallel independent items. Use paragraphs for connected reasoning.
- Use informative, sentence-case headings. Do not use decorative emoji.
- Reserve callouts for destructive actions, breaking changes, or required reader action.
- Name the file, function, count, command, date, or failure.
- Describe the scale of a change accurately. A configuration edit is a configuration edit.
- State failures with evidence. Write “3 of 41 tests fail,” and name the failed tests.
- Name skipped checks and real uncertainty once.
- Stop when the useful content ends. Do not add a recap to text the reader has just read.
- Match the length to the reader's next decision. Delete details that do not change it.

## Match the writing surface

- Agent responses give the answer first, then necessary reasoning and limits. Match the user's register and time pressure.
- Code comments explain intent, a tradeoff, or a non-obvious risk. They do not narrate visible code.
- Commits and pull requests name the outcome and its reason. Keep file inventories secondary.
- Knowledge-base notes use complete thoughts, durable context, source links, and descriptive titles.
- Riffs preserve first-person voice and uncertainty while they repair transcription errors. Do not flatten personality into a summary.
