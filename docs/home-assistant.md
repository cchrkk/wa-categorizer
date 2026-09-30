# Home Assistant

Two things in `.env`:

```ini
HA_URL=http://192.168.1.50:8123
HA_TOKEN=eyJhbGciOi...
```

The token is created in Home Assistant under **Profile → Security → Long-lived access
tokens → Create token**. It is shown once: copy it immediately.

`npm run check` really verifies URL and token (it calls `/api/config`, read-only) and tells
you the house name and version:

```
✓ home assistant: Home · HA 2026.9.3 · http://192.168.1.50:8123
```

A wrong URL is the most common mistake, and it is not obvious: the action fails with
`fetch failed` and nothing happens. `npm run check` catches it before a real message does.

## Examples

Press a button:

```yaml
- type: ha.button
  button: button.doorbell
```

Run a **script** with variables. Placeholders work inside `variables` too, not just in
strings:

```yaml
- type: ha.script
  script: script.notify_order
  variables:
    text: "{{transcript}}"
    from: "{{sender}}"
    chat: "{{chat}}"
    when: "{{date}}"
```

With `wait: true` it waits for the script to finish and reads its `response:` key (the
script needs `return_response: true`):

```yaml
- type: ha.script
  script: script.summarise_order
  wait: true
  variables:
    text: "{{transcript}}"
```

Phone notification — the most convenient shortcut:

```yaml
- type: ha.notify
  service: mobile_app_my_phone
  title: "Order from {{sender}}"
  message: "{{transcript}}"
```

Trigger an automation, turn on a light, toggle a switch:

```yaml
- type: ha.automation
  automation: gate

- type: ha.action
  entityId: light.living_room
  action: turn_on
  data:
    brightness_pct: 60

- type: ha.action
  entityId: switch.machine_plug
  action: toggle

# same thing, raw form
- type: ha.service
  domain: light
  service: turn_on
  entityId: light.living_room
  data:
    rgb_color: [255, 200, 0]
```

`entityId`, `button`, `script`, `automation` and `service` all go through placeholder
rendering, so `entityId: "light.{{room}}"` works (see
[capture groups](actions.md#capture-groups-words-taken-from-the-message)).

## Testing without touching your house

There is a fake Home Assistant that logs every call it receives:

```bash
node tools/mock-ha.mjs 8199
# in another terminal
HA_URL=http://127.0.0.1:8199 HA_TOKEN=test \
  node src/index.js --simulate fixtures/sample-text.json \
  --config fixtures/ha-actions.yaml --live
```

It prints exactly which services and which bodies your Home Assistant would receive —
useful to check placeholders before moving anything real.

## A caveat about unavailable entities

If the target entity is `unavailable` (device offline, integration reloading), the service
call is a **silent no-op**: Home Assistant returns success, the script "finishes", and
nothing changes. There is no way for this program to detect it.

If that matters, prefer writing to an entity that always exists (`input_text`, an
`input_boolean`) and let the device read it when it comes back online.
