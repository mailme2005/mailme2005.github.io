# How the help and privacy pages are made

The help and privacy pages for every app on this site share one layout and one way of saying things.
They are generated from plain-text sources so they stay consistent.

**Edit the sources, not the HTML.** A page changed by hand is overwritten the next time it is built.

| Where | What |
| --- | --- |
| `_content/<app>/privacy.<lang>.txt`, `support.<lang>.txt` | The text of each page |
| `_content/_shared/` | Paragraphs every app uses, such as "When you contact us" and "Children" |
| `_tools/build.py` | Builds the pages into `<app>/` |
| `_tools/check.py` | Checks tags, internal links and leftover template markers |
| `assets/site.css` | The one stylesheet all these pages use |
| `cargo-switch/*.html` | Written by hand in the same layout; edit these four files directly |
| `index.html` | The home page, written by hand |

GitHub Pages does not publish folders whose names start with an underscore, so `_content` and
`_tools` are kept in the repository but are not part of the website.

## Changing a page

1. Edit the text in `_content/`. Set the `@updated` line at the top of the file to today's date.
2. Build and check:

   ```bash
   python3 -I _tools/build.py && python3 -I _tools/check.py
   ```

3. Look at `git diff`: only the pages you meant to change should differ.
4. Commit and push. Pushing publishes the pages.

The format of the source files is described at the top of `_tools/build.py`.

## Pages that are held back

`build.py` has a `HOLD` list for pages whose new version is written but must not go live yet.
Right now it holds the Receipted (`huayouju`) help pages, which describe version 1.1.0 and should be
published when that version is released. To publish them, remove the entry from `HOLD` and build.
`python3 -I _tools/build.py --all` builds held pages too, for previewing.

## Rules the pages follow

- Written for players and users, not developers: no implementation terms, no version histories.
- One language per page, with a switch in the header.
- Privacy pages: one-sentence summary, what we receive, who helps handle it, where it is kept and
  how to delete it, children, contact.
- Help pages: contact first, then questions a user would ask as headings.
- A privacy page may be made plainer, but it must still say what is collected, who receives it,
  how long it is kept and how to delete it.
- The contact section of each privacy page names the publisher as
  "Little Everyday Apps (Guan Jie Tan)". Headers, footers and copyright lines use
  "Little Everyday Apps" only.
