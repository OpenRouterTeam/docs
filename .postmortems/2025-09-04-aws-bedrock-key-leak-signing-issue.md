# 2025-09-04-aws-bedrock-key-leak-signing-issue

**Follow up email:**

Hi developers,
Following up on this morning’s notice (Sep 4, 2025):
- **The fix for Bedrock signatures is live and verified.** We updated our Bedrock request-signing to send only the minimum required signature headers. This prevents credential-related headers from being echoed back by AWS Bedrock in 403 error bodies.
- **Bedrock is re-enabled on OpenRouter.** Requests to Bedrock (including Anthropic models) are working again. If your apps may have forwarded provider error bodies to external logs/monitors, we **still recommend rotating the AWS Bedrock credentials** you used for Bedrock out of caution.
If you need further help, contact **support@openrouter.ai**.
Thanks for your quick attention and for building with OpenRouter.
OpenRouter Team

---

**Subject: \[Security Notice, Action Recommended\] Possible leak of AWS Bedrock BYOK credentials on OpenRouter**

Hi developers,
**TLDR: **OpenRouter customers who set up AWS Bedrock with BYOK (bring your own key) and access Anthropic models may have had their credentials echoed in Bedrock error responses, forwarded by OpenRouter. If apps using your OpenRouter credentials log errors, your Bedrock key may have been logged. We recommend rotating your Bedrock key out of precaution.
**Details:**
We received a report this morning that some AWS Bedrock **403** error responses, under certain conditions, could include an AWS `accessKeyId` and `secretAccessKey`.
While this only impacts a subset of error messages sent down from Bedrock on Anthropic models, we consider this a possible credential leak and our responsibility to remedy, so we disabled Bedrock on OpenRouter at 11:45am ET today (Sep 4, 2025).
You’re receiving this email because we detected Bedrock + Anthropic BYOK usage from you in the relevant time period below. Out of an abundance of caution, **we recommend rotating the AWS Bedrock credentials you used with OpenRouter** and review your logs for possible exposure.
We will be following up with more tools for detecting this kind of behavior from inference providers in the near future.

**What happened**
- Bedrock requests to Anthropic models on OpenRouter were intermittently returning a **403** error beginning with:
> The request signature we calculated does not match the signature you provided.
That error **included accessKeyId and secretAccessKey** in the message body, since OpenRouter included them in the request header to Bedrock, when only a signature header was necessary.
- Based on the root cause, we believe this would have started on May 23, 2025. It affected a small subset of error messages, and was not detected by any users until today.
- OpenRouter forwards upstream provider error messages down to developers to help with debugging. If your app logs errors verbatim, those credentials may have been written to your logs without your knowledge.

**What we’ve done**
- **8:13am ET (Sep 4):** Received the initial report from a user.
- **11:45am ET:** Disabled Bedrock on OpenRouter to prevent further exposure.
- **1pm ET: **OpenRouter met with AWS to identify the root cause in OpenRouter’s request signing logic
We’re sending this notice **preemptively** before Bedrock is re-enabled on OpenRouter; we will email again after it is.

**What you should do now (recommended)**
1. **Rotate AWS credentials** used for Bedrock (the IAM users/roles whose keys were configured for Bedrock access).
2. **(Optional) audit your logs/observability systems** for:
	- The phrase: “The request signature we calculated does not match the signature you provided”
	- Any occurrences of accessKeyId or secretAccessKey

**Scope & impact**
- Affected surface: **Anthropic models** on **AWS Bedrock **returning** 403 error responses** that were **related to request signing** since May 23.
- Risk: Credentials may exist in **application logs**, third-party logging platforms, or error monitors if error bodies were recorded.
- Other providers and models on OpenRouter are **not affected** by this issue.

**Next steps**
- OpenRouter will re-enable Bedrock when the fix is live and verified (very soon after this email), and then send a follow-up.
- OpenRouter is debugging these signature rejections to see why they are happening occasionally.
- OpenRouter will follow up with automated detection of credentials in LLM inference responses for this type of response in the future.

If you have questions or need help rotating keys, contact [support@openrouter.ai](mailto:support@openrouter.ai). Thank you for your quick attention and for building with OpenRouter.

OpenRouter Team
