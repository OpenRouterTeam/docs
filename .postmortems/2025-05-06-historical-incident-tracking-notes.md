@U06DJ8YS066 (sam): @U07MHP3NEF8 (Shashank Goyal) promising so far with that first change!! will see if it persists

edit nvm lol

@U07MHP3NEF8 (Shashank Goyal): Thanks for keeping an eye on it

@U06DJ8YS066 (sam): for sure -- mightve spoke too soon (not concerned), but i'll see how it goes

@U06DJ8YS066 (sam): hmmf yeah did not persist

@U06DJ8YS066 (sam): adding a second replica onto the CH queue consumer yday made things way healthier -- so deploy boundaries should be less radioactive now

*the event loop delay on the left here is the main problematic symptom, grinding consumption to a halt with big delays between ticks.  unclear the _exact_ root cause, but  shedding the load across replicas helped a lot

@U054ACGRB2R (Alex Atallah): what’s the code to grep for to see the second replica?

@U07MHP3NEF8 (Shashank Goyal): Just this.

@U07MHP3NEF8 (Shashank Goyal): [PR](https://github.com/OpenRouterTeam/openrouter-web/pull/4941/files)
