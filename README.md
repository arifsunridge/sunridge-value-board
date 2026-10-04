# Sunridge Value Board

A board for the Sunridge Value Creation and Investment team to track whether each portfolio company's value creation plan is being executed.

- [GLOSSARY.md](GLOSSARY.md): the shared language
- [docs/spec.md](docs/spec.md): the spec for v1–v3 (approved)
- [docs/tech-stack.md](docs/tech-stack.md): the tech stack (approved)
- [docs/adr/](docs/adr/): decisions that are hard to reverse
- [docs/setup.md](docs/setup.md): SharePoint, Microsoft sign-in, Render and the prototype import

## Working on it

```
cp .env.example .env   # local: in-memory illustrative data, choose who you are at sign-in
npm install
npm run dev            # http://localhost:3000
npm run check          # typecheck, lint, tests
```

No real portfolio company figures and no secrets belong in this repository.
