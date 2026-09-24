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
- **Use `gpt-6-sol` or `gpt-6-astra`** when each entity requires curating multiple, relatively independent pieces of information. Compare a small sample against the default `gpt-6-luna` before paying for a larger model.

- **Note**: Increase `--max-workers` to process more entities concurrently, but be aware that lower OpenAI API usage tiers may limit concurrent requests.

### For Simpler, Faster Tasks
- **Start with `gpt-6-luna`**, the default for task templates and configs that omit `default_model`. It supports web search, structured output, and configurable reasoning for high-volume collection. See the [model documentation](https://developers.openai.com/api/docs/models/gpt-6-luna).

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


