# LowbaLLM

Which LLM is the best negotiator? Let's find out.

LowbaLLM is a tournament-style price negotiation benchmark for large language models. It runs automated negotiation rounds between agents (model-driven or scripted) to evaluate strategies, pricing outcomes, and negotiation robustness.

## Key Features

- Run head-to-head negotiation matches between agents
- Collect detailed logs and run manifests in `public/logs/`
- Simple CLI and server modes for local benchmarking

## Quickstart

Prerequisites: Node.js 16+ and npm/yarn

Install dependencies:

```bash
npm install
```

Run the benchmark server (development):

```bash
node server/server.js
```

Run the CLI benchmark runner:

```bash
node benchmark-cli/index.js
```

## Project Layout

- `benchmark-cli/` — CLI runner and scripts
- `server/` — server, agents, and benchmark orchestration
- `public/logs/` — saved run manifests and logs
- `src/` — frontend React app (benchmark UI)
- `index.html`, `vite.config.js`, `tailwind.config.js` — frontend tooling

## Logs & Results

Run manifests are saved to `public/logs/` with timestamps. Each manifest contains run parameters, agent configs, and outcome metrics useful for analysis.

## Development

- Start the server: `node server/server.js`
- Start the frontend (if using Vite): `npm run dev` (check `package.json` scripts)
- Modify agents in `server/agents.js` or `benchmark-cli/agents.js` to add new strategies or models

## Contributing

Contributions welcome. Please open issues for feature requests or bugs, and send pull requests for new agents, improvements to logging, or UI enhancements.

## License

This project is provided as-is. Add a license file if you plan to share or publish.

## Contact

For questions or help, open an issue or contact the maintainer via the repository.
Which LLM is the best negotiator?
Let's find out!

Tournament-style price negotiation benchmark for large language models.
