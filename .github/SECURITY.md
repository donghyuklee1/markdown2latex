# Security Policy

## Threat model

CleanMath is a static, client-only application. There is no backend, no database,
no account system and no analytics. The text you paste is parsed by JavaScript in
your own tab and is never transmitted anywhere. Preferences are stored in
`localStorage` under `cleanmath:options:v1`.

That removes most of the usual surface, but two areas still matter:

- **Rendered output.** The output pane writes highlighted HTML via
  `dangerouslySetInnerHTML`. Everything that path touches is escaped in
  [`src/lib/highlight.ts`](../src/lib/highlight.ts) before any markup is added.
  A way to get unescaped input into that pane is a real vulnerability.
- **KaTeX.** Math is rendered with [KaTeX](https://katex.org) in its default
  configuration, which does not trust input to emit raw HTML.

## Reporting

Please report suspected vulnerabilities privately via
[GitHub Security Advisories](https://github.com/donghyuklee1/markdown2latex/security/advisories/new)
rather than a public issue. A maintainer will acknowledge within 7 days.

Include the input that triggers the issue and the browser you observed it in.
