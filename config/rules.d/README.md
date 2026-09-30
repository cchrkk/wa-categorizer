# Regole sparse

Ogni file `.yaml` o `.yml` in questa cartella viene caricato insieme a
`config/rules.yaml`, in ordine alfabetico. Serve a tenere separate le regole
per argomento, invece di avere un file unico lungo.

```bash
mkdir -p config/rules.d
cp ../examples/06-comandi-casa-home-assistant.yaml .
# poi apri il file e metti enabled: true
npm run check
```

Regole di questa cartella:

- possono contenere **solo** una lista `rules:` — le `settings` valgono solo in
  `config/rules.yaml`, e se le metti qui vengono ignorate (con un avviso)
- l'ordine di valutazione resta deciso da `priority`, non dal nome del file
- il nome del file compare nel banner di avvio e in `npm run check`, così si
  capisce da dove arriva una regola
