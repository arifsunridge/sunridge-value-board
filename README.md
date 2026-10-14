# Sunridge Value Board

A board for the Sunridge Value Creation and Investment team to track whether each portfolio company's value creation plan is being executed. It runs as an HBF Portal app: Sunridge Members see everything, and company Managers see only the Tasks Members share with them (ADR 0005, 0006).

- [GLOSSARY.md](GLOSSARY.md): the shared language
- [docs/spec.md](docs/spec.md): the spec for v1–v3 (approved)
- [docs/tech-stack.md](docs/tech-stack.md): the tech stack (approved)
- [docs/adr/](docs/adr/): decisions that are hard to reverse
- [docs/setup.md](docs/setup.md): the database, the portal, Render and Cloudflare, moving the team board across, and Claude access

## Working on it

```
cp .env.example .env   # local: in-memory illustrative data, choose who you are at sign-in (a Member or a Manager)
npm install
npm run dev            # http://localhost:3000
npm run check          # typecheck, lint, tests
```

No real portfolio company figures and no secrets belong in this repository.
