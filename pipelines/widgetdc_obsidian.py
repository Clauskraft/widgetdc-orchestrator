"""
title: WidgeTDC Obsidian Bridge
author: WidgeTDC
date: 2026-04-03
version: 1.0
license: MIT
description: Open WebUI Tool — Bridge between Open WebUI and Obsidian vault. Search, read, write notes. Sync intelligence briefings. Manifestopunkt #9 Allestedsnærværende.
requirements: aiohttp
"""

from pydantic import BaseModel, Field
import os
import glob
import json
import re
from datetime import datetime
from pathlib import Path
import logging

logger = logging.getLogger(__name__)


class Tools:
    class Valves(BaseModel):
        VAULT_PATH: str = Field(
            default="C:/Users/claus/Obsidian/WidgeTDC",
            description="Path to Obsidian vault root",
        )
        ORCHESTRATOR_URL: str = Field(
            default="https://orchestrator-production-c27e.up.railway.app",
            description="WidgeTDC Orchestrator URL",
        )
        ORCHESTRATOR_API_KEY: str = Field(
            default="",
            description="Orchestrator API key",
        )
        BRIEFING_FOLDER: str = Field(
            default="Daily Briefings",
            description="Subfolder for auto-generated briefings",
        )

    def __init__(self):
        self.valves = self.Valves()

    def _vault_root(self) -> Path:
        return Path(self.valves.VAULT_PATH)

    async def vault_search(self, query: str, max_results: int = 10, __user__: dict = {}) -> str:
        """
        Search Obsidian vault for notes matching a query.
        Searches filenames and content. Returns matching notes with previews.

        :param query: Search text (searches filenames and note content)
        :param max_results: Maximum results to return (default 10)
        """
        root = self._vault_root()
        if not root.exists():
            return f"⚠️ Obsidian vault not found at `{root}`. Check VAULT_PATH in Valves."

        query_lower = query.lower()
        terms = query_lower.split()
        results = []

        for md_file in root.rglob("*.md"):
            # Skip hidden folders
            if any(part.startswith(".") for part in md_file.relative_to(root).parts):
                continue

            score = 0
            rel_path = str(md_file.relative_to(root))
            name_lower = md_file.stem.lower()

            # Filename match (high weight)
            for term in terms:
                if term in name_lower:
                    score += 10

            # Content match
            try:
                content = md_file.read_text(encoding="utf-8", errors="ignore")[:5000]
                content_lower = content.lower()
                for term in terms:
                    count = content_lower.count(term)
                    score += min(count, 5)  # Cap at 5 per term
            except Exception:
                content = ""

            if score > 0:
                # Extract first meaningful line as preview
                preview = ""
                for line in content.split("\n"):
                    stripped = line.strip()
                    if stripped and not stripped.startswith("#") and not stripped.startswith("---"):
                        preview = stripped[:120]
                        break

                results.append((score, rel_path, preview))

        results.sort(key=lambda x: -x[0])
        results = results[:max_results]

        if not results:
            return f"Ingen noter fundet for '{query}' i vault."

        lines = [f"## 📓 Vault Search: '{query}'", f"**{len(results)} matches**\n"]
        for score, path, preview in results:
            lines.append(f"- **[[{path}]]** (score: {score})")
            if preview:
                lines.append(f"  _{preview}_")

        return "\n".join(lines)

    async def vault_read(self, note_path: str, __user__: dict = {}) -> str:
        """
        Read a specific note from the Obsidian vault.

        :param note_path: Relative path to the note (e.g. "Daily Briefings/2026-04-03.md")
        """
        root = self._vault_root()
        target = root / note_path

        if not target.exists():
            # Try with .md extension
            target = root / f"{note_path}.md"
            if not target.exists():
                return f"⚠️ Note not found: `{note_path}`"

        # Safety: ensure path is within vault
        try:
            target.resolve().relative_to(root.resolve())
        except ValueError:
            return "❌ Path traversal detected — access denied."

        try:
            content = target.read_text(encoding="utf-8")
            return f"## 📄 {target.stem}\n_Path: {note_path}_\n\n---\n\n{content}"
        except Exception as e:
            return f"❌ Fejl ved læsning: {e}"

    async def vault_write(self, title: str, content: str, folder: str = "", __user__: dict = {}) -> str:
        """
        Write or update a note in the Obsidian vault.

        :param title: Note title (becomes filename)
        :param content: Markdown content to write
        :param folder: Subfolder within vault (optional, e.g. "Competitive Intel")
        """
        root = self._vault_root()
        if not root.exists():
            return f"⚠️ Vault not found at `{root}`."

        # Sanitize title for filename
        safe_title = re.sub(r'[<>:"/\\|?*]', '-', title)
        target_dir = root / folder if folder else root
        target_dir.mkdir(parents=True, exist_ok=True)
        target = target_dir / f"{safe_title}.md"

        # Safety check
        try:
            target.resolve().relative_to(root.resolve())
        except ValueError:
            return "❌ Path traversal detected — access denied."

        try:
            # Add YAML frontmatter
            now = datetime.now().isoformat()
            frontmatter = f"---\ntitle: {title}\ncreated: {now}\nsource: widgetdc-openwebui\n---\n\n"
            target.write_text(frontmatter + content, encoding="utf-8")
            rel_path = str(target.relative_to(root))
            return f"✅ Note skrevet: **[[{rel_path}]]**"
        except Exception as e:
            return f"❌ Skriv-fejl: {e}"

    async def generate_daily_briefing(self, __user__: dict = {}) -> str:
        """
        Generate a daily intelligence briefing and save it to the Obsidian vault.
        Combines: platform pulse, failure analysis, competitive intel, graph health.
        """
        import aiohttp

        lines = [f"# WidgeTDC Daily Briefing — {datetime.now().strftime('%Y-%m-%d')}"]
        lines.append(f"_Auto-generated at {datetime.now().isoformat()}_\n")

        url = self.valves.ORCHESTRATOR_URL
        headers = {"Authorization": f"Bearer {self.valves.ORCHESTRATOR_API_KEY}", "Content-Type": "application/json"}

        async with aiohttp.ClientSession() as session:
            # Health
            try:
                async with session.get(f"{url}/health", headers=headers, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                    h = await resp.json()
                    lines.append(f"## Platform Status")
                    lines.append(f"- **Version**: {h.get('version','?')} | **Status**: {h.get('status','?')}")
                    lines.append(f"- **Agents**: {h.get('agents_registered',0)} | **Crons**: {h.get('cron_jobs',0)}")
                    lines.append(f"- Redis: {'✓' if h.get('redis_enabled') else '✗'} | RLM: {'✓' if h.get('rlm_available') else '✗'}\n")
            except Exception:
                lines.append("## Platform Status\n_Unavailable_\n")

            # Failures
            try:
                async with session.get(f"{url}/api/failures/summary", headers=headers, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                    data = await resp.json()
                    if data.get("success"):
                        f = data["data"]
                        lines.append(f"## Failure Analysis")
                        lines.append(f"**{f.get('total_failures',0)} failures** in last {f.get('window_hours',24)}h\n")
                        for cat, count in f.get("by_category", {}).items():
                            if count > 0:
                                lines.append(f"- {cat}: {count}")
                        top = f.get("top_tools", [])
                        if top:
                            lines.append("\nTop failing tools:")
                            for t in top[:5]:
                                lines.append(f"- `{t['tool']}`: {t['count']}×")
                        lines.append("")
            except Exception:
                pass

            # Competitive
            try:
                async with session.get(f"{url}/api/competitive/report", headers=headers, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                    data = await resp.json()
                    if data.get("success") and data.get("data") and data["data"].get("total_capabilities_found", 0) > 0:
                        c = data["data"]
                        lines.append(f"## Competitive Intelligence")
                        lines.append(f"**{c['total_capabilities_found']} capabilities** tracked\n")
                        for comp, count in c.get("by_competitor", {}).items():
                            lines.append(f"- {comp}: {count}")
                        lines.append("")
            except Exception:
                pass

        briefing_content = "\n".join(lines)

        # Write to vault
        result = await self.vault_write(
            title=f"briefing-{datetime.now().strftime('%Y-%m-%d')}",
            content=briefing_content,
            folder=self.valves.BRIEFING_FOLDER,
        )

        return f"{briefing_content}\n\n---\n{result}"
