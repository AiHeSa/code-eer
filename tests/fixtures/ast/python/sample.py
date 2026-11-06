from typing import List as Items


class Store:
    async def load(self, value: str, /, *, count: int = 1) -> str:
        return value * count


def plain(value):
    return value
