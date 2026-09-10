# M4b design reference

Static mockups approved on 2026-09-10. `files-screen.html` and `map.html` are the build targets. The two `alt-*` files are the directions not chosen, kept for the record. Each file is a self-contained 1440×900 frame; open it in a browser.

What the build takes from the mockups, and from the unchosen "plan rail" direction:

1. One primary action in the header that names the next step.
2. A plan strip under the header: TL;DR, phase progress, step position, high-risk count. Before/after flow and watch-for bullets show once, then collapse to one line after the first Next.
3. The rail lists files in review order, not alphabetically. Skippable groups sit at the bottom. Hovering a rail item shows its step note.
4. Only the current file is open; every other file is a one-line row with its step number and heat.
5. Heat is loud only for high: a bar plus one reason line plus factors. Medium is a thin bar with nothing else. Low is nothing.
6. A step card above the current file says why you are here, with Prev and Mark reviewed.
7. Pinned bot comments are one-line chips that expand on click.
8. "Ask Claude about this hunk" on the step card copies a ready prompt with file, symbol and hunk context to the clipboard.
9. Map: package cards listing their top changed functions, border colour by heat, edge width by call count, dashed grey for unchanged callers. Level 2 opens per package with callers grouped by package and folded counts stated.
