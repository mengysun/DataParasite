# DataParasite

> *The name is inspired by the ethos of Park & Greene's "[A parasite's perspective on data sharing](https://academic.oup.com/gigascience/article/7/11/giy129/5140693)" [1]*

DataParasite is a simple yet versatile context engineered for scalable online data collection with LLMs. The project is optimized for coding agents (for example, Cursor-agent CLI automations) that orchestrate data collection runs end-to-end (with flexible level of human-in-the-loop), while still supporting a fully manual flow through the standalone Python script together with the ChatGPT web interface to help you draft task configs. Any reasonably capable coding agent can operate the workflow: give it a short task description, point it to `CONSTITUTION.md` for orientation, and it will draft configs, gather entities from a CSV you provide, or even curate the list online itself when internet access is available before running the pipeline.

## Key Advantages

### Solving the Long-Horizon Entity Collection Problem
Traditional deep research tools excel at individual deep-dive inquiries but struggle with structured data collection tasks that require gathering information for long lists of entities. Data Parasite exploits a key insight: **entity collection is embarrassingly parallel**. While curating 100 scholars' academic histories is a long-horizon task as a whole, each scholar's record is an independent subtask. By launching parallel agentic searches for each entity, we transform an intractable long-horizon problem into a scalable parallel workflow.

### Elegant Simplicity Over Multi-Agent Complexity
Implementing parallel collection of entity information typically demands sophisticated multi-agent orchestration systems with planners, coordinators, and specialized sub-agents [2]—solutions that are often over-engineered and brittle. Data Parasite takes a different approach: **leverage off-the-shelf coding agents as orchestrators** instead of building complex agent frameworks from scratch. The entire system reduces to:
- A single Python script that performs parallel agentic web search based on a CSV input
- A well-defined YAML config file that specifies task structure, prompts, and schema
- Powerful coding agents (or even ChatGPT's web interface) to generate custom configs from natural language descriptions

This architecture is both simpler and more robust than bespoke multi-agent systems, while remaining versatile enough to adapt to diverse collection tasks. An added benefit: **the config file itself becomes clear documentation** of your task intent, capturing prompts, schema, and logic in a human-readable format that serves as both a reproducible record and a foundation for iterative refinement.

### Zero-Input Bootstrap with Web-Enabled Agents
Modern coding agents increasingly incorporate web search capabilities, unlocking another dimension of automation: **zero-input entity list generation**. When entity lists are publicly available online (e.g., "S&P 500 CEOs," "Current U.S. Senators"), you can start without any input file—simply ask the coding agent to curate the entity list first, then proceed with the extraction pipeline. This capability transforms Data Parasite from a data processing tool into an end-to-end research automation framework.

## Workflow Overview
- Primary mode is agent-driven: prompt a coding agent with your task goal, remind it to read `CONSTITUTION.md`, and it can deduce the repo structure, author the config automatically, request or accept your CSV, or curate the entity list online (with internet access) before executing `src/data_parasite.py`.
- Human operators can execute the exact same pipeline by running the CLI themselves.
- No agent handy? Ask ChatGPT to craft the YAML config for your task requirements, save it under `tasks/<task_name>/`, and reuse the workflow.

## Quick Start
1. Clone/Download this repository and `cd` into it.
2. Ensure Python 3.10+ and install dependencies: `pip install -r requirements.txt`.
3. Export your OpenAI credential: `export OPENAI_API_KEY=sk-...`.
4. Install the Cursor-agent CLI (recommended) with the Playwright MCP enabled. Alternatively, you can use Codex CLI from https://github.com/openai/codex (note: internet access must be enabled using the `/approvals` command for curating datasets).
5. Run the sample task (the `Path2Power` template<sup>†</sup> tracks academic hiring patterns):
   ```
   python src/data_parasite.py \
     --config_file tasks/Path2Power/Path2Power_config.yaml \
     --csv_file tasks/Path2Power/author_sample50.csv \
     --output_file tasks/Path2Power/Path2Power_results.jsonl \
     --sample 10
   ```
   <sup>†</sup> *A subtle nod to Robert Caro's biographies, though the task itself is inspired by Clauset et al.'s work on hierarchy in faculty hiring networks [3].*
6. Inspect the JSONL output for telemetry and the auto-generated CSV sitting beside it for cleaned results.

## Standalone Script
`src/data_parasite.py` can be invoked directly without an agent:
- `--config_file`: task YAML defining schema, prompts, required columns, and default model.
- `--csv_file`: input entities CSV; must expose the columns referenced by the config. The CSV doesn't have to include only the entities to search for—you can include additional metadata columns that might be helpful for the search task. Coding agents will often be able to intelligently incorporate those columns if needed.
- `--output_file`: destination JSONL; a cleaned CSV with inputs and outputs is created automatically.
- `--model`: optional override for the model named in the config.
- `--sample`: randomly process only N rows.
- `--seed`: random seed for sampling (for reproducibility when using `--sample`).
- `--reasoning-effort`: `low|medium|high`, applicable to gpt-5 family models.
- `--search-context-size`: `low|medium|high` to adjust web-search context.
- `--max-workers`: parallel workers (defaults to a CPU-based heuristic).
- `--verbose`: enable debug logging.

Each JSONL record captures the normalized outputs, original inputs, timing, token usage, and cost estimates, making it easy to audit runs or feed downstream pipelines.

## Task Templates
Seed and user-created task folders live under `tasks/`. Copy an existing folder (for example, `tasks/Path2Power/`), tweak the YAML schema and prompts, drop in your CSV, and rerun the CLI or agent with those paths.

## Contribute Configs
Contributions are welcome—create a new subfolder under `tasks/`, add your config YAML, supporting CSVs, and documentation describing the prompts or special instructions. Focus on novel collection problems or data domains so others can reproduce and extend the workflow.

## Amend the Constitution
We encourage improvements to `CONSTITUTION.md`! This file defines the core guidelines and workflow rules for agents operating in this repository. If you discover better patterns, clearer instructions, or missing safeguards, propose amendments by submitting a pull request with your suggested changes. Thoughtful updates to the constitution benefit all users and agent interactions with the framework.

**Note on agent instruction following**: I use `CONSTITUTION.md` to stay coding agent agnostic—different agents expect different base instruction file names (e.g., `AGENTS.md` for Codex, `CLAUDE.md` for Claude). If an agent doesn't follow `CONSTITUTION.md`, try renaming it accordingly, but usually just referencing the file in your prompt works fine.

## Agent Demos

### Demo 1: Agent run with a user-supplied entity list
*Nothing lasts forever. Even the longest, the most glittering reign must come to an end some day.*  
This demo curates data about scientists in the `ValarMorghulis` task—a playful reference to a rather morbid but useful "treatment variable" in "science-of-science" research: the death of superstar scientists. Studies like Azoulay et al.'s "[Does science advance one funeral at a time?](https://www.aeaweb.org/articles?id=10.1257/aer.20161574)" [4] and Balsmeier et al.'s work on coinventor deaths [5] have shown how such events reveal knowledge spillovers and research dynamics.

<video src="https://github.com/user-attachments/assets/799d09be-9a46-4d05-ac1f-84a4a6d497f8" width="800"></video>

### Demo 2: Agent run that curates the entity list online before extraction
The `MeansOfAscent` task takes its name from the second volume of Robert Caro's masterful biography of Lyndon Johnson [6,7] (yea,I am a bit Caro-pilled lately). This demo showcases the full agent workflow: curating the entity list online, then executing the extraction pipeline—no input CSV required.

<video src="https://github.com/user-attachments/assets/4a96bf35-6390-4a08-b045-32e8ca441d3a" width="800"></video>

---

## Known Limitations

**URL Accuracy**: Manual review shows that while the core entity data is generally accurate, the supporting URLs provided in results may occasionally link to a search-start page or a broader section, rather than directly to the relevant reference or passage. Sometimes, links may be broken. Finding a way to instruct the model for precise citations remains a headache as of now. The extracted data itself is typically reliable, but you may need to manually locate the specific source context for verification.

## Citation

If you use **DataParasite** in your research, please cite the accompanying paper:

> Sun, M. (2025). *DataParasite enables scalable and repurposable online data curation*. arXiv preprint arXiv:2601.02578 [cs.CL]. https://doi.org/10.48550/arXiv.2601.02578

### BibTeX

```bibtex
@article{Sun2025DataParasite,
  title   = {DataParasite Enables Scalable and Repurposable Online Data Curation},
  author  = {Sun, Mengyi},
  journal = {arXiv preprint arXiv:2601.02578},
  year    = {2025},
  eprint  = {2601.02578},
  archivePrefix = {arXiv},
  primaryClass = {cs.CL},
  doi     = {10.48550/arXiv.2601.02578},
  url     = {https://doi.org/10.48550/arXiv.2601.02578}
}
```

## References

[1] Park, Y., & Greene, C. S. (2018). A parasite's perspective on data sharing. *GigaScience*, 7(11), giy129. https://doi.org/10.1093/gigascience/giy129

[2] How we built our multi-agent research system. *Engineering at Anthropic*. https://www.anthropic.com/engineering/multi-agent-research-system

[3] Clauset, A., Arbesman, S., & Larremore, D. B. (2015). Systematic inequality and hierarchy in faculty hiring networks. *Science Advances*, 1(1), e1400005. https://doi.org/10.1126/sciadv.1400005

[4] Azoulay, P., Fons-Rosen, C., & Graff Zivin, J. S. (2019). Does science advance one funeral at a time? *American Economic Review*, 109(8), 2889-2920. https://doi.org/10.1257/aer.20161574

[5] Balsmeier, B., Fleming, L., & Lück, S. (2023). Isolating personal knowledge spillovers: Coinventor deaths and spatial citation differentials. *American Economic Review: Insights*, 5(1), 21-33. https://doi.org/10.1257/aeri.20210275

[6] Caro, R. A. (1982). *The Years of Lyndon Johnson: The Path to Power*. Alfred A. Knopf, Inc., New York. ISBN 0-679-72945-3.

[7] Caro, R. A. (1990). *The Years of Lyndon Johnson: Means of Ascent*. Alfred A. Knopf, Inc., New York. ISBN 0-679-73371-X.


