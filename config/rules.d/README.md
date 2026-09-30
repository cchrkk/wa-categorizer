# Extra rules

Every `.yaml` or `.yml` file in this folder is loaded **together with**
`config/rules.yaml`, in alphabetical order. It exists so you can keep rules
separate by topic instead of having one long file.

```bash
mkdir -p config/rules.d
cp ../examples/06-home-assistant-commands.yaml .
# then open the file and set enabled: true
npm run check
```

Rules for this folder:

- they may contain **only** a `rules:` list — `settings` are valid only in
  `config/rules.yaml`, and are ignored here (with a warning)
- evaluation order is still decided by `priority`, not by file name
- the file name appears in the startup banner and in `npm run check`, so you
  can tell where a rule comes from
