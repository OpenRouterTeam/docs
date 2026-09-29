# Class Name

## Rule

State the single invariant that defines this class.

## Failure modes to reject

### Named wrong shape

Describe the recurring wrong shape and anchor it to independent incidents.

State the accepted remedy and the evidence-backed reason it works.

Cite current-branch evidence separately from proposed-remedy evidence. Never
present line ranges from an unmerged PR as in-repo evidence.

### Another named wrong shape

Describe another way the invariant breaks, with the accepted remedy and
evidence.

## What the primitives do not give you

State the guarantees the accepted primitive does not provide, including any
caller obligations or degraded behavior.

## Test requirement

Include this section when the class demands a proof, and omit it when the class
does not. `classes/ssrf.md` deliberately omits it: its findings are reachable
URL-construction paths, and it asks for a fix rather than a fixture.

State the proof a change in scope must ship, and the file to copy it from.
Report a missing proof as `TEST GAP`, never as a vulnerability finding: it
means the logic may be correct while its required evidence is absent. Keep the
label exact, so a reader can separate the two kinds of finding at a glance.

## Calibration

Give dated prevalence evidence without turning stale counts into review rules.
