---
title: "Create OpenRouter Accounts via CLI with Stripe Projects"
date: "2026-04-29T12:00:00.000Z"
updated: "2026-06-24T16:29:34.000Z"
author: "Chris Watts"
teaser: "Run `stripe projects add openrouter/api` to get an OpenRouter account, an API key, and Stripe billing, all from the command line. Your agents can do it too."
headerImage:
  url: "/images/stripe-projects.jpg"
  width: 1500
  height: 837
category: "announcements"
---

We partnered with [Stripe Projects](https://projects.dev/) so your coding agent (or you) can set up an OpenRouter account from the command line. One command creates the account, generates an API key, wires up billing through Stripe, and drops the credentials into your `.env`. Your app is ready to call any of 400+ text, image, video, and audio models without opening a browser.

You'll first need to [install the Stripe CLI](https://docs.stripe.com/stripe-cli/install), then run:

```bash
stripe projects add openrouter/api
```

![Stripe Projects CLI provisioning OpenRouter](/images/stripe-projects-capture.png)

## Your account is automatically provisioned and you're issued an API key

Stripe Projects handles the full provisioning flow:

1. **Account creation.** A new OpenRouter account is created and linked to your Stripe identity. If you already have an OpenRouter account, you can connect it instead.
2. **API key generation.** A fresh key is generated and stored in your project's encrypted vault (`.projects/vault/vault.json`), then synced to your `.env` as `OPENROUTER_API_KEY`.
3. **Billing setup.** Your Stripe payment method is attached to the OpenRouter account. You can start on the free tier (no credit card required) or go straight to pay-as-you-go with per-token pricing across all models.

No signup forms, no dashboard clicking, no copying keys between tabs.

## Let your coding agent provision your account

If you're building with a coding agent, your agent can already write code, install packages, and configure services. The one thing it couldn't do was create the accounts those services need.

The credentials are stored securely and scoped to the project, so there's no risk of an agent leaking keys across environments.

## Link existing accounts

Already using OpenRouter? You don't need a new account every time. When you run the command, you can choose to link your existing OpenRouter account instead of creating a fresh one. Your current API keys and billing stay as they are; the CLI just connects everything to your Stripe Projects setup for easier credential management.

## One CLI for your whole stack

OpenRouter is one of 20+ providers available on Stripe Projects today. You can wire up your entire app stack from a single tool:

```bash
stripe projects init my-app
stripe projects add clerk/auth
stripe projects add posthog/analytics
stripe projects add openrouter/api
```

All credentials sync to your `.env`. All billing goes through your Stripe account. And all of it works from the command line, whether you're typing the commands or your agent is.

Browse the full provider catalog at [projects.dev/providers](https://projects.dev/providers/).

Each project is a lightweight manifest of the services, provider accounts, and credentials your app needs, all backed by Stripe. The setup is repeatable across machines and teammates: onboarding a new engineer or switching laptops becomes `stripe projects env --pull` instead of a scavenger hunt through Slack messages and old `.env` files. Credentials stay auditable and scoped, so agents and humans work from the same source of truth.

## Get started

1. Install the [Stripe CLI](https://docs.stripe.com/stripe-cli) and the Projects plugin: `stripe plugin install projects`
2. Run `stripe projects add openrouter/api`
3. Pick a tier (free or pay-as-you-go) and start calling models

Questions or feedback? Find us on [X](https://x.com/OpenRouter) or [Discord](https://discord.gg/openrouter).
