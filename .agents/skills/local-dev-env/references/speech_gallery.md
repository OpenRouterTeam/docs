# Speech gallery checks

Useful cases when working on `SpeechTakeList`, waveform decoding, or playback:

- Fetchable audio with stored peaks, missing peaks, and different durations; 404 and invalid-audio clips for failure states. A flat bar with an unfetchable story URL does not exercise decoding.
- A visibly varying waveform, seeking, and playback returning to an idle state after an error. Duration-probe audio elements are separate from the shared player.
- Repeated URLs and cards revealed by scrolling for deduplication and the two-job decode queue.
- Resource timings filtered to `initiatorType === 'fetch'`, excluding audio metadata probes; a larger timing buffer before scrolling avoids dropped entries in Storybook.
- Cross-origin clips with browser caching enabled and `crossOrigin="anonymous"` on playback and duration-probe elements, to expose cache-related CORS failures.

Temporary fetchable clips can live under `projects/web/public/`; remove temporary stories and clips after the check.
