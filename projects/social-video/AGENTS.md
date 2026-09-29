# Social video authoring conventions

Each scene kind owns its DOM construction and GSAP timeline segment. Adding a
scene kind means adding its module and schema entry without changing the
composer. Adding a video means adding one typed config file under `videos/`.

The `4:3` `ori-prime-launch` preset is the authored, visually reviewed layout.
The `16:9` and `1:1` presets are derived and remain unverified until rendered
and reviewed independently.

Do not commit font binaries. The renderer mounts the repository's Plus Jakarta
Sans, Gordita, and Geist Mono assets at stable local URLs.

The first frame is the social embed poster and must not be blank. A blank first
frame fails the render. Later blank frames are informational diagnostic data.
Unsafe edge-band output is also a render gate.
