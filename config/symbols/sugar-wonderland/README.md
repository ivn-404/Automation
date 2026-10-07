# Sugar Wonderland symbol catalog (Package 1)

Backend `slot.area` ids follow **Package Specification — Package 1**, not Help/Payout order.

| id | spec | kind | visual (in-game asset) |
|----|------|------|------------------------|
| 0 | Symbol 0 | scatter | Scatter Candy |
| 1 | Symbol 1 | high | Heart Candy |
| 2 | Symbol 2 | high | Star Candy |
| 3 | Symbol 3 | high | Flower Candy |
| 4 | Symbol 4 | high | Triangle Candy |
| 5 | Symbol 5 | low | Diamond Candy |
| 6 | Symbol 6 | low | Teardrop Candy |
| 7 | Symbol 7 | low | Circle Candy |
| 8 | Symbol 8 | low | Square Candy |
| 9 | Symbol 9 | low | Scallop Candy |
| 10–22 | Multiplier bombs | multiplier | Bomb 2x … 100x |

Reel size hint is **6 columns × 5 rows**. Automation always reads columns/rows from `slot.area` so Package 2 (5×3) can use the same reader.

DiJoker `slot.area[col][0]` is the **bottom** cell (`rowOrder: bottom-to-top`).
