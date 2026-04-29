#!/usr/bin/env python3
"""
Data Parasite - Generic Web Research Framework
A task-agnostic framework for entity data curation using LLMs with web search.

Usage:
    python data_parasite.py config.yaml input.csv output.jsonl [options]
"""

from __future__ import annotations
import os, csv, json, time, argparse, logging, random
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional, List, Dict, Any, Type
from pydantic import BaseModel, create_model
from openai import APIConnectionError, APITimeoutError, OpenAI, RateLimitError
import yaml
import pandas as pd

# ============================================================================
# INFRASTRUCTURE CONFIGURATION
# ============================================================================

PRICING = {
    'gpt-5':       dict(inp=1.25,  cache=0.125, out=10.00, search=10.00),
    'gpt-5-mini':  dict(inp=0.25,  cache=0.025, out=2.00,  search=10.00),
    'gpt-5.1':     dict(inp=1.25,  cache=0.125, out=10.00, search=10.00),
    'gpt-5.2':     dict(inp=1.75,  cache=0.175, out=14.00, search=10.00),
    'gpt-4.1':     dict(inp=2.00,  cache=0.50,  out=8.00,  search=10.00),
    'gpt-4.1-mini':dict(inp=0.40,  cache=0.10,  out=1.60,  search=10.00),
    'gpt-4o':      dict(inp=2.50,  cache=1.25,  out=10.00, search=10.00),
    'gpt-4o-mini': dict(inp=0.15,  cache=0.075, out=0.60,  search=10.00),
    'o3-deep-research':      dict(inp=10.00, cache=2.50,  out=40.00, search=10.00),
    'o4-mini-deep-research': dict(inp=2.00,  cache=0.50,  out=8.00,  search=10.00),
}

TYPE_MAPPING = {
    'Optional[str]': Optional[str],
    'str': str,
    'Optional[int]': Optional[int],
    'int': int,
    'Optional[float]': Optional[float],
    'float': float,
    'Optional[bool]': Optional[bool],
    'bool': bool,
}

# ============================================================================
# CONFIGURATION MANAGEMENT
# ============================================================================

class TaskConfig:
    """Container for task-specific configuration loaded from YAML."""
    
    def __init__(self, config_path: Path):
        with config_path.open('r', encoding='utf-8') as f:
            data = yaml.safe_load(f)
        
        self.output_model = self._create_output_model(data.get('output_schema', {}))
        self.csv_column_mapping = data.get('csv_column_mapping', {})
        self.required_columns = data.get('required_columns', [])
        self.prompt_system = data.get('prompt_system', '')
        self.prompt_user = data.get('prompt_user', '')
        self.default_model = data.get('default_model', 'gpt-4o-mini')
    
    def _create_output_model(self, schema: Dict[str, Any]) -> Type[BaseModel]:
        """Dynamically create a Pydantic model from YAML schema definition."""
        fields = {}
        for field_name, field_spec in schema.items():
            field_type_str = field_spec.get('type', 'Optional[str]')
            field_type = TYPE_MAPPING.get(field_type_str, Optional[str])
            fields[field_name] = (field_type, None)
        return create_model('OutputRecord', **fields)

# ============================================================================
# UTILITIES
# ============================================================================

def setup_logger(verbose: bool) -> logging.Logger:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s"
    )
    return logging.getLogger("data_parasite")

def compute_cost(model: str, usage: Dict[str, int]) -> float:
    p = PRICING.get(model, PRICING.get('gpt-4o-mini'))
    non_cached = max(usage.get('input_tokens', 0) - usage.get('cached_tokens', 0), 0)
    return (
        (non_cached / 1_000_000) * p['inp'] +
        (usage.get('cached_tokens', 0) / 1_000_000) * p['cache'] +
        (usage.get('output_tokens', 0) / 1_000_000) * p['out'] +
        (usage.get('web_search_calls', 0) / 1000) * p['search']
    )

def ensure_paths(out_path: Path) -> Path:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text("")  # truncate/create
    return out_path

def append_jsonl(path: Path, obj: Dict[str, Any]) -> None:
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(obj, ensure_ascii=False) + "\n")

def tidy(value: Optional[str]) -> str:
    """Convert None or empty strings to 'not_found'."""
    if value is None:
        return "not_found"
    if isinstance(value, bool):
        return str(value).lower()
    if isinstance(value, (int, float)):
        return str(value)
    return value if (value and value.strip()) else "not_found"

def extract_tool_usage(response) -> dict:
    """Extract accurate web_search usage counts."""
    tool_usage = {'web_search_calls': 0}
    try:
        if hasattr(response, 'output') and response.output:
            search_count = 0
            for item in response.output:
                if getattr(item, "type", None) == "web_search_call":
                    action = getattr(item, "action", None)
                    if action is not None and getattr(action, "type", None) == "search":
                        search_count += 1
            tool_usage['web_search_calls'] = search_count
    except Exception as e:
        logging.getLogger("data_parasite").warning("Could not extract tool usage: %s", e)
    return tool_usage

def parse_row_data(row: Dict[str, str], mapping: Dict[str, str]) -> Dict[str, str]:
    """Extract and map CSV columns to prompt variables."""
    data = {}
    for csv_col, var_name in mapping.items():
        data[var_name] = (row.get(csv_col) or "").strip()
    return data


def is_retryable_error(error: Exception) -> bool:
    """Return True for transient API errors worth retrying."""
    if isinstance(error, (RateLimitError, APITimeoutError, APIConnectionError)):
        return True

    status_code = getattr(error, "status_code", None)
    if status_code in {408, 409, 429, 500, 502, 503, 504}:
        return True

    text = str(error).lower()
    return any(
        marker in text
        for marker in ["timeout", "timed out", "temporarily unavailable", "connection reset"]
    )


def compute_retry_delay(
    attempt: int,
    base_delay: float,
    max_delay: float,
    jitter_ratio: float,
) -> float:
    """Exponential backoff with bounded jitter."""
    raw_delay = min(max_delay, base_delay * (2 ** attempt))
    jitter_window = raw_delay * max(0.0, jitter_ratio)
    lower = max(0.0, raw_delay - jitter_window)
    upper = raw_delay + jitter_window
    return random.uniform(lower, upper)

# ============================================================================
# API INTERACTION
# ============================================================================

def call_model(
    client: OpenAI,
    model: str,
    config: TaskConfig,
    prompt_vars: Dict[str, str],
    reasoning_effort: str,
    search_context_size: str,
) -> Dict[str, Any]:
    """Generic API call with web search and structured output."""
    params = {
        "model": model,
        "input": [
            {"role": "system", "content": config.prompt_system},
            {"role": "user", "content": config.prompt_user.format(**prompt_vars)}
        ],
        "tools": [{"type": "web_search", "search_context_size": search_context_size}],
    }
    if model in {"gpt-5", "gpt-5-mini", "gpt-5.1", "gpt-5.2"}:
        params["reasoning"] = {"effort": reasoning_effort}

    resp = client.responses.parse(text_format=config.output_model, **params)

    usage_obj = getattr(resp, "usage", None)
    usage = {
        "input_tokens": getattr(usage_obj, "input_tokens", 0) or 0,
        "output_tokens": getattr(usage_obj, "output_tokens", 0) or 0,
        "total_tokens": getattr(usage_obj, "total_tokens", 0) or 0,
        "cached_tokens": getattr(getattr(usage_obj, "input_tokens_details", None), "cached_tokens", 0) or 0,
    }
    usage.update(extract_tool_usage(resp))

    parsed = getattr(resp, "output_parsed", None)
    ok = getattr(resp, "status", "completed") == "completed" and parsed is not None

    return {
        "success": ok,
        "response_id": getattr(resp, "id", "N/A"),
        "parsed": parsed,
        "usage": usage,
        "error": None if ok else "incomplete or no parsed payload"
    }

# ============================================================================
# WORKER
# ============================================================================

def _build_error_result(config: TaskConfig, prompt_vars: Dict[str, str]) -> Dict[str, str]:
    """Build a result dict with error values for all output fields plus inputs."""
    result = {k: "error" for k in config.output_model.model_fields.keys()}
    result.update({f"input_{k}": v for k, v in prompt_vars.items()})
    return result

def _empty_usage() -> Dict[str, int]:
    """Return empty usage dict."""
    return {"input_tokens": 0, "output_tokens": 0, "cached_tokens": 0, "web_search_calls": 0}

def run_one(
    client: OpenAI,
    model: str,
    config: TaskConfig,
    row: Dict[str, str],
    reasoning_effort: str,
    search_context_size: str,
    max_retries: int,
    retry_base_delay: float,
    retry_max_delay: float,
    retry_jitter: float,
) -> Dict[str, Any]:
    """Process one entity from the CSV."""
    prompt_vars = parse_row_data(row, config.csv_column_mapping)
    start = time.time()
    
    # Check required fields
    missing = [k for k in config.required_columns if not row.get(k, "").strip()]
    if missing:
        return {
            "ok": False,
            "prompt_vars": prompt_vars,
            "result": _build_error_result(config, prompt_vars),
            "usage": _empty_usage(),
            "response_id": "N/A",
            "duration": time.time() - start,
            "cost": 0.0,
            "retries_used": 0,
            "error": f"Missing required fields: {missing}"
        }

    for attempt in range(max_retries + 1):
        try:
            res = call_model(client, model, config, prompt_vars, reasoning_effort, search_context_size)
            usage = res["usage"]
            cost = compute_cost(model, usage)
            duration = time.time() - start

            if res["success"]:
                parsed = res["parsed"]
                result = {k: tidy(v) for k, v in parsed.model_dump().items()}
                result.update({f"input_{k}": v for k, v in prompt_vars.items()})

                return {
                    "ok": True,
                    "prompt_vars": prompt_vars,
                    "result": result,
                    "usage": usage,
                    "response_id": res["response_id"],
                    "duration": duration,
                    "cost": cost,
                    "retries_used": attempt,
                    "error": None
                }

            error_text = res.get("error") or "incomplete or no parsed payload"
            should_retry = attempt < max_retries and "incomplete" in error_text.lower()
            if should_retry:
                delay = compute_retry_delay(attempt, retry_base_delay, retry_max_delay, retry_jitter)
                logging.getLogger("data_parasite").warning(
                    "Incomplete response; retrying in %.2fs (attempt %d/%d)",
                    delay,
                    attempt + 1,
                    max_retries,
                )
                time.sleep(delay)
                continue

            return {
                "ok": False,
                "prompt_vars": prompt_vars,
                "result": _build_error_result(config, prompt_vars),
                "usage": usage,
                "response_id": res["response_id"],
                "duration": duration,
                "cost": 0.0,
                "retries_used": attempt,
                "error": error_text
            }

        except Exception as e:
            if attempt < max_retries and is_retryable_error(e):
                delay = compute_retry_delay(attempt, retry_base_delay, retry_max_delay, retry_jitter)
                logging.getLogger("data_parasite").warning(
                    "Transient API error (%s); retrying in %.2fs (attempt %d/%d)",
                    e.__class__.__name__,
                    delay,
                    attempt + 1,
                    max_retries,
                )
                time.sleep(delay)
                continue

            return {
                "ok": False,
                "prompt_vars": prompt_vars,
                "result": _build_error_result(config, prompt_vars),
                "usage": _empty_usage(),
                "response_id": "N/A",
                "duration": time.time() - start,
                "cost": 0.0,
                "retries_used": attempt,
                "error": str(e)
            }

# ============================================================================
# MAIN PIPELINE
# ============================================================================

def load_rows(csv_path: Path) -> List[Dict[str, str]]:
    with csv_path.open("r", encoding="utf-8") as f:
        return list(csv.DictReader(f))

def main():
    ap = argparse.ArgumentParser(
        description="Data Parasite - Generic web research framework for entity data curation",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Example:
    python data_parasite.py --config_file task_config.yaml --csv_file input.csv --output_file output.jsonl --model gpt-5-mini
        """
    )
    ap.add_argument("--config_file", required=True, help="Task configuration YAML file")
    ap.add_argument("--csv_file", required=True, help="Input CSV file")
    ap.add_argument("--output_file", required=True, help="Output JSONL path")
    ap.add_argument("--model", help="OpenAI model (overrides config default)")
    ap.add_argument("--sample", type=int, help="Randomly sample N rows")
    ap.add_argument("--seed", type=int, help="Random seed for sampling (for reproducibility)")
    ap.add_argument("--reasoning-effort", choices=["low","medium","high"], default="medium",
                    help="Only for gpt-5* models; ignored otherwise")
    ap.add_argument("--search-context-size", choices=["low","medium","high"], default="medium")
    ap.add_argument("--max-workers", type=int, default=min(32, (os.cpu_count() or 4)))
    ap.add_argument("--max-retries", type=int, default=2,
                    help="Retries per row for transient API failures")
    ap.add_argument("--retry-base-delay", type=float, default=1.0,
                    help="Initial retry backoff delay in seconds")
    ap.add_argument("--retry-max-delay", type=float, default=20.0,
                    help="Maximum retry backoff delay in seconds")
    ap.add_argument("--retry-jitter", type=float, default=0.25,
                    help="Jitter ratio for retry delay randomization")
    ap.add_argument("-v","--verbose", action="store_true")
    args = ap.parse_args()

    if args.max_retries < 0:
        ap.error("--max-retries must be >= 0")
    if args.retry_base_delay < 0 or args.retry_max_delay < 0:
        ap.error("--retry-base-delay and --retry-max-delay must be >= 0")
    if args.retry_base_delay > args.retry_max_delay:
        ap.error("--retry-base-delay cannot be greater than --retry-max-delay")
    if args.retry_jitter < 0:
        ap.error("--retry-jitter must be >= 0")

    log = setup_logger(args.verbose)

    # Load task configuration
    config_path = Path(args.config_file)
    if not config_path.exists():
        ap.error(f"Config file not found: {config_path}")
    
    try:
        config = TaskConfig(config_path)
        log.info("Loaded task configuration from: %s", config_path)
    except Exception as e:
        ap.error(f"Failed to load config: {e}")

    # Use model from CLI or config default
    model = args.model or config.default_model

    # Check input CSV
    src = Path(args.csv_file)
    if not src.exists():
        ap.error(f"CSV not found: {src}")

    out_jsonl = ensure_paths(Path(args.output_file))

    # Setup API client
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        ap.error("OPENAI_API_KEY is not set")
    client = OpenAI(api_key=api_key)

    # Load and optionally sample data
    rows = load_rows(src)
    if args.sample and args.sample < len(rows):
        if args.seed is not None:
            random.seed(args.seed)
        rows = random.sample(rows, args.sample)
        log.info("Sampled %d rows", args.sample)

    n = len(rows)
    log.info("Processing %d entities with %d workers on model %s", n, args.max_workers, model)

    total_cost = 0.0
    ok_count = 0
    start_all = time.time()

    # Process entities in parallel
    with ThreadPoolExecutor(max_workers=args.max_workers) as ex:
        futures = [
            ex.submit(
                run_one,
                client,
                model,
                config,
                r,
                args.reasoning_effort,
                args.search_context_size,
                args.max_retries,
                args.retry_base_delay,
                args.retry_max_delay,
                args.retry_jitter,
            )
            for r in rows
        ]
        
        for i, fut in enumerate(as_completed(futures), 1):
            out = fut.result()

            # Build consolidated record: results + telemetry
            record = out["result"].copy()
            record.update({
                'timestamp': time.strftime("%Y-%m-%dT%H:%M:%S"),
                'model': model,
                'response_id': out["response_id"],
                'input_tokens': out["usage"].get("input_tokens", 0),
                'output_tokens': out["usage"].get("output_tokens", 0),
                'cached_tokens': out["usage"].get("cached_tokens", 0),
                'web_search_calls': out["usage"].get("web_search_calls", 0),
                'total_cost': round(out["cost"], 6),
                'duration_seconds': round(out["duration"], 2),
                'retries_used': out.get("retries_used", 0),
                'status': 'success' if out["ok"] else 'failed',
            })
            
            if not out["ok"] and out.get("error"):
                record['error'] = out["error"]
            
            append_jsonl(out_jsonl, record)

            if out["ok"]:
                ok_count += 1
                total_cost += out["cost"]
            else:
                log.debug("Failed: %s", out.get("error"))

            if i % 10 == 0 or i == n:
                log.info("Progress: %d/%d | cost=$%.4f", i, n, total_cost)

    dur = time.time() - start_all
    log.info("Done: %d processed, %d success, %d failed", n, ok_count, n-ok_count)
    log.info("Total cost=$%.4f | Avg per success=$%.4f", total_cost, (total_cost / max(ok_count,1)))
    log.info("Duration: %.2fs", dur)
    log.info("Results with telemetry: %s", out_jsonl)
    
    # Create cleaned CSV with only input and output fields
    if out_jsonl.exists() and out_jsonl.stat().st_size > 0:
        df = pd.read_json(out_jsonl, lines=True)
        input_cols = [c for c in df.columns if c.startswith('input_')]
        output_cols = [c for c in config.output_model.model_fields.keys() if c in df.columns]
        cleaned_df = df[input_cols + output_cols]

        csv_path = out_jsonl.with_suffix('.csv')
        cleaned_df.to_csv(csv_path, index=False)
        log.info("Cleaned CSV saved: %s", csv_path)
    else:
        log.warning("No records were written; skipping cleaned CSV export")

if __name__ == "__main__":
    main()

