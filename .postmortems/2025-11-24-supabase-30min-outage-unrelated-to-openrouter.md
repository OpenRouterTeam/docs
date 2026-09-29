supabase had [an outage for ~30m](https://openrouter.slack.com/archives/C0760HXFSAW/p1763981740121889) this morning from 430-5a eastern, unrelated to any actions on our end  (*1*)

initially, they claimed it was only for the management api,  but later incident updates say it was platform-wide

we were serving traffic through the entire incident, however there was a noticeable dip  (*2*)

still investigating what dimensions were failing, but can see in (*3*) that it may have been mostly isolated to a single user or group of users in the San Jose colo -- though unsure why
