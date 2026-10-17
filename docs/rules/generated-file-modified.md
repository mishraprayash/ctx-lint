# generated-file-modified

**Default:** warn

Content written by `ctx-lint sync` carries a hash of what was generated: in the header of a
generated file, or in the `<!-- ctx-lint:begin hash=… -->` marker of a managed block. When the
text no longer matches, someone edited it by hand, and the next `sync` will overwrite those edits.
Make the change in `.context/rules` instead and run `ctx-lint sync`.

Other rules don't report problems inside generated content. The same text is checked in the
source rule it came from, which is where it should be fixed.
