# Contributing to Parenthèse

[Version française](CONTRIBUTING.fr.md)

Parenthèse is maintained by one person. Feedback is welcome, and a few pointers save everyone time. You can write in English or in French.

## Before writing code

- A bug or an idea: open an issue with the matching template.
- A security issue: no public issue, follow [SECURITY.md](SECURITY.md).
- For any change bigger than a fix, talk about it in an issue first. A pull request that wasn't discussed may be declined, even a careful one.
- Prefer small, focused pull requests: one topic per PR, a diff that can be reviewed in a few minutes.

## Running the project locally

Everything is in the "Development" section of the [README](README.md).

## Tests

Before opening a pull request, run what the CI checks:

```bash
npm --prefix frontend ci && npm --prefix frontend run lint && npm --prefix frontend test && npm --prefix frontend run build
npm --prefix landing ci && npm --prefix landing test && npm --prefix landing run build
npm --prefix backend ci && npm --prefix backend run prisma:generate && npm --prefix backend run build && npm --prefix backend test
```

The CI also checks that the Prisma migrations apply to an empty database and reproduce `backend/prisma/schema.prisma` exactly. Any schema change therefore comes with a migration (`npm --prefix backend run prisma:migrate`).

If you touch Docker or nginx, run `docker compose up -d --build` then `bash tools/docker-smoke.sh http://localhost`.

## Conventions

- The interface is in French, English and German. Every visible text goes through `t()` from `frontend/src/i18n/index.js`, with the French text as the key and its English entry in `frontend/src/i18n/en/`. A test fails if an English entry is missing. Other languages fall back to English, so a new text only needs French and English.
- No new heavy dependency (framework, UI library, external service) without discussing it in an issue.
- The README promise holds: no ads, and no analytics turned on by default on a self-hosted instance.

## License of contributions

Parenthèse is published under [PolyForm Noncommercial 1.0.0](LICENSE), and stays under it.

By opening a pull request, you:

- certify that you wrote the contribution or otherwise have the right to submit it, in the spirit of the [Developer Certificate of Origin](https://developercertificate.org/). Sign your commits with `git commit -s`, which adds a `Signed-off-by:` line;
- grant the maintainer, Ilies Allali, a perpetual, irrevocable, worldwide, royalty-free license to use, modify and relicense your contribution under any terms, including commercial ones.

If you can't agree to this, say so in the pull request before it is merged.
