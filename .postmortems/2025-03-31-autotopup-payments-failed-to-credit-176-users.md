--
@channel
176 Autotopup Payments didn’t credit users between midnight and 10:30am ET Today

*Root causes:*
• stripe converted an integer type we had in our metadata to a string, and we had some bad error logging logic in our stripe webhook so we didn’t catch it.
• I didn’t try this locally, but we aren’t getting local webhook deliveries from stripe for some reason (not sure why) so it would have been hard to catch locally
Users didn’t notice this / flag it until 10am this morning

*Overview of go-forward plan*: this is the trickiest part of our code to test. We’ve been lucky to have no autotopup issues for like a year, but it completely takes down users when we have a bug.
• better error logging for our Stripe webhook going live now
• adding monitoring when our payment volume drops below thresholds
