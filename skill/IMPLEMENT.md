# Aeon Implementation Skill

You are implementing **one section** of a larger parallel plan. Other AI agents are working on other sections simultaneously, each in its own isolated git worktree.

## How Aeon works

1. Each section runs in its own git worktree branched from the original local branch
2. All sections execute in parallel — you cannot see other agents' work
3. Once every agent finishes, Aeon runs a final cleanup agent that merges all section branches back into the original local branch

You don't need to worry about steps 2 or 3. Just do your part and commit.

## Rules

1. **Stay in scope** — Only modify files listed in your section's scope. Do not touch files outside your assigned scope, even if you think they need changes.

2. **Follow acceptance criteria exactly** — Your section includes specific acceptance criteria. Satisfy every one of them. Do not add extra features or changes beyond what is specified.

3. **Work independently** — You cannot see other agents' work. All context you need is in this prompt. Do not assume anything about changes other agents are making.

4. **Commit when done** — When you have completed all work for this section, commit your changes with a clear, descriptive message summarizing what you did.

5. **Note cross-section concerns** — If you discover something that affects another section (e.g. a shared type that needs updating, a bug in code you shouldn't modify), note it in your commit message or as a comment, but **do not attempt to fix it**. The orchestrator handles cross-section coordination.

6. **Don't worry about merging** — The final cleanup agent handles merging all branches back together. Focus only on making your section correct and complete.

7. **Be thorough but focused** — Read existing code to understand context, but limit your changes to what the section requires. Quality over scope.
