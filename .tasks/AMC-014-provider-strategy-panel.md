# AMC-014 — Provider Strategy Panel

Owner: Tadashi
Status: Done

## Goal
Represent Akib's provider strategy honestly in Agent Mission Control after the policy update.

## Requirements
- Do not restart Gateway during the build.
- Show disk web_search configuration without claiming runtime has reloaded it.
- Represent Perplexity via OpenRouter as the short-term web_search route.
- Represent Brave as the durable search candidate to avoid OpenRouter limit burn.
- Surface NVIDIA as the preferred lightweight/high-limit model-work pool when auth/availability is healthy.
- Reserve OpenRouter primarily for Perplexity web search in the short term.
- Never expose API key or secret values.

## Verification
- `npm run build`
- `npm run smoke`
