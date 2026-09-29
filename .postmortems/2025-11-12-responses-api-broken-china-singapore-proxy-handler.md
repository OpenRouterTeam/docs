Very unfortunate bug: our proxy handler for China and Singapore meant that all Responses API requests have been broken for those two regions

This kind of bug is very hard to capture in e2e tests and in unit tests - and this time it also took us a surprisingly long time to hear about it from our users

thanks to @U091ECC3B3N (Abdalla) for escalating it and @U08RHK5KW5C (Robert Yeakel) for digging into it. When we make new API skins or fully new API endpoints in the future, this is the kind of thing we have to figure out how to catch preemptively, and I think we should explore using AI to do it (e.g. having AI look around the codebase for possible “did you remember to do X” things)
