[SEV I] - Website/All Services down for 2 minutes from 6 50 PM - 6 52 PM EST.
*Root Cause:*
Added a new Provider API key to the env without adding to cloudflare and vercel

*Impact:*
Cloudflare was just crash looping and couldnt serve any requests

What went well:
1. We had online or not monitors which caught the downtime immediately and alerted us
2. Caught early and cloudlfare rollbacks are instant
What went poorly:
1. Our env setup is too easy to footgun yourself
    a. Missing env vars, typos etc. can bring the whole site down
2. We had this issue once before but we didnt prioritize the fix
Resolution:
1. Rolled back
2. Added the keys
3. Rolled forward after making the key optional
Action Items:
1. Add a new env script that can check that cloudflare has all the needed envs to make the env check pass
    a. This should fix the env not matching problem.
