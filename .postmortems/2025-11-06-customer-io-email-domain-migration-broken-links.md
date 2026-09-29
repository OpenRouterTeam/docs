during the domain migration for email sent from [customer.io](http://customer.io) to an https [openrouter.ai](http://openrouter.ai) domain there was a brief window (~5 minutes) where email links on a subset of emails were broken. these emails would've been:

• "Welcome Email Campaign" emails (eg "Getting started with Openrouter", "From hello world to real world", etc.)
• Sent between 10AM and 1:15PM Pacific
• Where the user tried to click the link between ~1:05PM and 1:10PM Pacific
[customer.io](http://customer.io) doesn't break down delivery by hour, but we send ~1M of these emails per day. assuming even distribution, ~125K email sent today could've had an affected link. our click rate is ~1%, and since the issue was in effect for ~3% of the period, that *suggests ~40 potentially broken email clicks*. these links should work now; they were only broken during that window.

none of these broken links should've affected users' ability to get access to the site. no authentication or product-essential links would've been impacted.
