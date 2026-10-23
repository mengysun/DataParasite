# DataParasite Protips

## Always Test with a Small Sample First

Before running your curation task on the full dataset:

1. **Run a small sample** using the `--sample` flag to estimate costs and verify output quality
2. **Inspect the config file** to ensure all requested information is actually needed—trimming unnecessary fields can significantly reduce costs

Example:
```bash
python src/data_parasite.py \
  --config_file tasks/YourTask/config.yaml \
  --csv_file tasks/YourTask/input.csv \
  --output_file tasks/YourTask/results.jsonl \
  --sample 10
```

**Important**: When running the full dataset (without `--sample`), run it directly in your own terminal rather than through the coding agent CLI. The standard output from processing many entities can consume your coding agent CLI tokens unnecessarily.

## Model Selection: Performance vs. Cost Trade-offs

### For Best Results (Complex Tasks)
- **Use `gpt-6.1-sol` or `gpt-6-astra`** when each entity requires curating multiple, relatively independent pieces of information. Compare a small sample against the default `gpt-6-luna` before paying for a larger model.

- **Note**: Increase `--max-workers` to process more entities concurrently, but be aware that lower OpenAI API usage tiers may limit concurrent requests.

### For Simpler, Faster Tasks
- **Start with `gpt-6-luna`**, the default for task templates and configs that omit `default_model`. It supports web search, structured output, and configurable reasoning for high-volume collection. See the [model documentation](https://developers.openai.com/api/docs/models/gpt-6-luna).

### Model Availability (checked 2026-10-23)

| Models | Status in DataParasite |
| --- | --- |
| `gpt-6-luna` | Current default; no announced shutdown date. |
| `gpt-6.1-sol` | Newly added option for demanding tasks, with current pricing. |
| `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna` | Newly added supported alternatives; no announced shutdown date. |
| `gpt-6-sol`, `gpt-6-astra`, `gpt-5.2` | Retained; no announced shutdown date. |
| `gpt-4o`, `gpt-4o-mini`, `gpt-4.1`, `gpt-4.1-mini` | Still available; scheduled to shut down January 14, 2027. Use `gpt-6-luna` for new tasks. |
| `gpt-5.1` | Still available; scheduled to shut down April 1, 2027. |
| `gpt-5`, `gpt-5-mini` | Retained aliases. Their dated `2025-08-07` snapshots are scheduled to shut down December 11, 2026; the API currently reports no shutdown date on the undated aliases. |
| `o3-deep-research`, `o4-mini-deep-research` | Retired July 23, 2026; removed from supported choices. Use `gpt-6.1-sol` or `gpt-5.6-sol` for research tasks. |

Sources: [OpenAI deprecations](https://developers.openai.com/api/docs/deprecations), [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol), and [pricing](https://developers.openai.com/api/docs/pricing). A model can still appear in the API's model list after its shutdown date, so listing alone does not establish availability. Account access can also differ.

Supported choices and cost estimates share the `PRICING` table in `src/data_parasite.py`. To add another model, verify web search and structured-output support, then add its current rates there. The CLI and YAML config reject unlisted names instead of silently estimating them at GPT-4o Mini prices. Override an old config with `--model gpt-6-luna` or edit its `default_model`.

### Setting Parallel Workers
```bash
python src/data_parasite.py \
  --config_file tasks/YourTask/config.yaml \
  --csv_file tasks/YourTask/input.csv \
  --output_file tasks/YourTask/results.jsonl \
  --max-workers 10  # Adjust based on your API tier limits
```

## Cost Optimization Strategies

If budget constraints are tight relative to your task scope, consider these approaches:

### Short-term Solutions
- **Batch queries** where possible to reduce API call overhead
- However, note that **the primary cost driver is usually web search**, not the LLM calls themselves

### Ultimate Cost Reduction
For maximum savings, you may want to extend the current codebase (or we can write that together!):

- **Implement a custom web search tool** using cheaper search APIs (e.g., Bing, DuckDuckGo, or other cost-effective alternatives)
- **Use web scraping techniques** instead of paid search APIs


