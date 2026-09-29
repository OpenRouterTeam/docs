# default

The baseline Ori persona template. It consists of:

- A persona file `ori.md`
- A `dashboard` feature that serves the intern's own status at `GET /`.

Pulled in via:

```sh
ori init my-intern --template=default
```

`--template=default` is equivalent to a plain `ori init`.

## dashboard

`GET /` reports what this intern knows about itself: which feature answered, how
long the runtime has been up, and whether the intern's own state store opens and
answers. A store that does not answer is served as `503`, so an uptime check
pointed at the page fails when the intern is not fully healthy.

The page renders nothing about the request that asked for it. Credentials reach
an intern in request headers, so the route must never echo them back.
