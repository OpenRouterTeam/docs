# benchmarks/explore

Components and data only — no routes live here. The media benchmark gallery
serves both the media and the artifact-generation rows at
`/benchmarks/media/{images,videos,speech,games,memes,sketch}/*` (see
`media-benchmark-paths.ts` and `media-benchmark-groups.ts`).
`/benchmarks/explore` itself is a permanent
redirect to the image gallery, configured in `projects/web/next.config.ts`.
