[post mortem from supabase on the 2025-09-02 db incident](https://status.supabase.com/incidents/gvp38qdj3bm6)

> *SSL Handshake Failures Due to BGP Route Leak*
> Between 9:15 UTC and 11:09 UTC on August 28th, 2025, customers accessing Supabase services in the us-east-1 region experienced SSL handshake failures (525 errors) when connecting to their projects. The issue was caused by a third-party network route leak that misdirected traffic intended for AWS prefixes.
>
> Customers with projects hosted in the us-east-1 region were primarily affected. In total, over 5 million requests were blocked. The impacted requests received Cloudflare 525 and 520 errors, primarily affecting PostgREST and Auth services.
>
> We sincerely apologize for the disruption this caused to your applications and services. Here is additional detail about what happened and the steps we're taking to improve our resilience against similar incidents.
>
> *What happened?*
> A third-party network provider unintentionally propagated BGP routing announcements beyond their intended scope, causing a route leak that included AWS prefixes used by Supabase origins. This misdirected traffic away from its proper destination, resulting in SSL handshake failures at our CDN layer.
>
> The incident timeline was as follows:
> • WED 28 AUG 9:18 UTC: Multiple customer in us-east support tickets reported 525 and 520 errors
> • WED 28 AUG 9:20 UTC: We started an internal incident
> • WED 28 AUG 9:25 UTC: Our team identified the issue was concentrated in us-east-1 region and reached out to our upstream provider
> • WED 28 AUG 9:50 UTC: Issue was confirmed to be related to external network/CDN problem
> • WED 28 AUG 10:35 UTC: US traffic began recovering as BGP routes stabilized
> • WED 28 AUG 11:09 UTC: Full recovery confirmed, error rates returned to zero
> • WED 29 AUG 9:40 UTC: We were continuing to work with an upstream provider until the identification of the root cause
> What will we do to mitigate problems like this in the future?
> • Improve detection and alerting
> • Improve vendor communication to be able to faster detect similar issues in the future
>
> *What actions do you need to take?*
> No action is required from customers. This was an infrastructure issue outside of Supabase's direct control that has been resolved. The BGP route leak was corrected by the third-party network provider, and traffic routing has returned to normal.
