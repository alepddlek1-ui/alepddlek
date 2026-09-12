"""무한 생성(8번 역할)이 먹고 도는 시드 큐.

큐는 그냥 JSON 파일 하나다. 여러 세션이 동시에 손대는 물건이 아니고,
사람이 열어서 직접 고치는 일이 훨씬 잦기 때문에 DB 를 쓸 이유가 없다.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path

QUEUE_FILE = Path("work") / "queue.json"

# 시드가 거칠 수 있는 상태
PENDING, RUNNING, DONE, FAILED = "pending", "running", "done", "failed"


@dataclass
class Seed:
    name: str
    url: str = ""
    category: str = ""
    note: str = ""
    status: str = PENDING
    workspace: str = ""
    updated: str = field(default_factory=lambda: datetime.now().isoformat(timespec="seconds"))


class SeedQueue:
    def __init__(self, path: Path | None = None) -> None:
        self.path = path or QUEUE_FILE
        self.seeds: list[Seed] = []
        if self.path.is_file():
            raw = json.loads(self.path.read_text(encoding="utf-8"))
            self.seeds = [Seed(**item) for item in raw.get("seeds", [])]

    # ----------------------------------------------------------------- #
    def save(self) -> Path:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = {"seeds": [asdict(s) for s in self.seeds]}
        self.path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        return self.path

    def add(self, seed: Seed) -> Seed:
        for existing in self.seeds:
            if existing.name == seed.name:
                return existing        # 같은 상품을 두 번 큐에 넣지 않는다
        self.seeds.append(seed)
        return seed

    def take(self) -> Seed | None:
        """대기 중인 시드 하나를 꺼내 running 으로 바꾼다."""
        for seed in self.seeds:
            if seed.status == PENDING:
                seed.status = RUNNING
                seed.updated = datetime.now().isoformat(timespec="seconds")
                return seed
        return None

    def mark(self, name: str, status: str, *, workspace: str = "") -> Seed:
        for seed in self.seeds:
            if seed.name == name:
                seed.status = status
                if workspace:
                    seed.workspace = workspace
                seed.updated = datetime.now().isoformat(timespec="seconds")
                return seed
        raise KeyError(f"큐에 없는 시드: {name}")

    def counts(self) -> dict[str, int]:
        out = {PENDING: 0, RUNNING: 0, DONE: 0, FAILED: 0}
        for seed in self.seeds:
            out[seed.status] = out.get(seed.status, 0) + 1
        return out
