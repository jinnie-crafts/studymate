# Skill: Quiz Engine
Stateful sequential MCQ flow.
- State: `currentQuestion` (passed from frontend).
- Flow: 
  1. Gen 1 MCQ (Format: Q: | A) | B) | C) | D)).
  2. Eval answer (Correct! + NextQ OR Explain + Retry).
Rule: Strictly one question at a time.
